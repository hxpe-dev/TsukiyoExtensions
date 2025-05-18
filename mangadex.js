const BASE_URL = 'https://api.mangadex.org';

let isRateLimited = false;
let rateLimitResetTime = 0;

function buildUrl(endpoint, params) {
  let query = '';
  if (params) {
    query = Object.entries(params)
      .flatMap(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map(v => `${encodeURIComponent(key)}[]=${encodeURIComponent(v)}`);
        } else if (typeof value === 'object' && value !== null) {
          return Object.entries(value)
            .filter(([, nestedValue]) => ['string', 'number', 'boolean'].includes(typeof nestedValue))
            .map(([nestedKey, nestedValue]) =>
              `${encodeURIComponent(`${key}[${nestedKey}]`)}=${encodeURIComponent(nestedValue)}`
            );
        } else {
          return [`${encodeURIComponent(key)}=${encodeURIComponent(value)}`];
        }
      })
      .join('&');
  }
  return `${BASE_URL}${endpoint}${query ? '?' + query : ''}`;
}

function fetchFromApi(endpoint, params = {}, urlAddon = '') {
  if (isRateLimited && Date.now() < rateLimitResetTime) {
    return Promise.reject(new Error('RATE_LIMITED'));
  }

  const url = buildUrl(endpoint, params);
  return fetch(url + urlAddon).then(response => {
    if (response.status === 429) {
      isRateLimited = true;
      rateLimitResetTime = Date.now() + 60 * 1000;
      return Promise.reject(new Error('RATE_LIMITED'));
    }
    if (!response.ok) {
      return Promise.reject(new Error(`API Error: ${response.status}`));
    }
    return response.json();
  });
}

globalThis.extension = {
  id: 'mangadex-extension',
  name: 'Mangadex',
  version: '1.0.0',

  search: function (query, options = {}) {
    const {
      limit = 10,
      matureContent = true,
      order = { relevance: 'desc' },
    } = options;

    return fetchFromApi(
      '/manga',
      {
        title: query,
        limit,
        order,
        contentRating: matureContent ? [] : ['safe', 'suggestive'],
        includes: ['cover_art'],
      },
      `?_=${Date.now()}`
    ).then(data => {
      const mangaList = data.data || [];
      const enrichedPromises = mangaList.map(manga => {
        const coverRel = (manga.relationships || []).find(rel => rel.type === 'cover_art');
        if (!coverRel) return Promise.resolve(manga);

        return fetchFromApi(`/cover/${coverRel.id}`)
          .then(coverData => {
            const fileName = coverData?.data?.attributes?.fileName;
            return { ...manga, coverFileName: fileName };
          })
          .catch(() => manga);
      });

      return Promise.all(enrichedPromises);
    });
  },

  explorer: function (options = {}) {
    const {
      limit = 10,
      matureContent = true,
    } = options;

    const latestMangaPromise = this.search('', {
      limit,
      matureContent: matureContent,
      order: { latestUploadedChapter: 'desc' },
    }).catch(() => []);

    const mostFollowedMangaPromise = this.search('', {
      limit,
      matureContent: matureContent,
      order: { followedCount: 'desc' },
    }).catch(() => []);

    return Promise.all([latestMangaPromise, mostFollowedMangaPromise]).then(([latest, mostFollowed]) => ({
      'Latest Manga': latest,
      'Most Followed Manga': mostFollowed,
    }));
  },

  informations: function (mangaId) {
    return fetchFromApi(`/manga/${mangaId}`, { includes: ['cover_art'] })
      .then(data => {
        const manga = data.data;
        if (!manga) return null;

        const coverRel = (manga.relationships || []).find(rel => rel.type === 'cover_art');
        if (!coverRel) return manga;

        return fetchFromApi(`/cover/${coverRel.id}`)
          .then(coverData => {
            const fileName = coverData?.data?.attributes?.fileName;
            return { ...manga, coverFileName: fileName };
          })
          .catch(() => manga);
      });
  },

  chapters: function (mangaId, options = {}) {
    const {
      language = 'en',
      page = 1,
      limit = 100,
    } = options;

    return fetchFromApi(`/manga/${mangaId}/feed`, {
      translatedLanguage: [language],
      order: { chapter: 'asc' },
      limit,
      offset: (page - 1) * limit,
    }).then(data => data.data || []);
  },

  reader: function (chapterId, options = {}) {
    return fetchFromApi(`/at-home/server/${chapterId}`)
      .then(data => {
        const baseUrl = data.baseUrl;
        const chapter = data.chapter;
        if (!chapter?.data || !baseUrl) return [];
        return chapter.data.map(filename => `${baseUrl}/data/${chapter.hash}/${filename}`);
      });
  },

  isApiRateLimited: function () {
    return isRateLimited;
  },
};
