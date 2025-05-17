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
          return Object.entries(value).map(([nestedKey, nestedValue]) => {
            if (['string', 'number', 'boolean'].includes(typeof nestedValue)) {
              return `${encodeURIComponent(`${key}[${nestedKey}]`)}=${encodeURIComponent(nestedValue)}`;
            }
            return '';
          });
        } else {
          return [`${encodeURIComponent(key)}=${encodeURIComponent(value)}`];
        }
      })
      .join('&');
  }
  return `${BASE_URL}${endpoint}${query ? `?${query}` : ''}`;
}

async function fetchFromApi(endpoint, params, urlAddon = '') {
  const now = Date.now();
  if (isRateLimited && now < rateLimitResetTime) {
    throw new Error('RATE_LIMITED');
  }

  const url = buildUrl(endpoint, params);
  const response = await fetch(`${url}${urlAddon}`);

  if (response.status === 429) {
    isRateLimited = true;
    rateLimitResetTime = Date.now() + 60 * 1000;
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

export default {
  id: 'mangadex-extension',
  name: 'Mangadex',
  version: '1.0.0',

  // Search manga by title
  fetchMangaList: async (query, options = {}) => {
    const { limit = 10, plusEighteen = true, order = { relevance: 'desc' } } = options;

    const data = await fetchFromApi(
      '/manga',
      {
        title: query,
        limit,
        order,
        contentRating: plusEighteen ? [] : ['safe', 'suggestive'],
        includes: ['cover_art'],
      },
      `?_=${Date.now()}`
    );

    const mangaList = data.data;

    const enriched = await Promise.all(
      mangaList.map(async manga => {
        const coverRel = manga.relationships?.find(rel => rel.type === 'cover_art');
        if (!coverRel) return manga;

        try {
          const coverData = await fetchFromApi(`/cover/${coverRel.id}`);
          const fileName = coverData?.data?.attributes?.fileName;
          return { ...manga, coverFileName: fileName };
        } catch {
          return manga;
        }
      })
    );

    return enriched;
  },

  // Fetch manga details by ID
  fetchMangaDetails: async (mangaId) => {
    const data = await fetchFromApi(`/manga/${mangaId}`, {
      includes: ['cover_art'],
    });

    const manga = data.data;

    const coverRel = manga.relationships?.find(rel => rel.type === 'cover_art');
    if (!coverRel) return manga;

    try {
      const coverData = await fetchFromApi(`/cover/${coverRel.id}`);
      const fileName = coverData?.data?.attributes?.fileName;
      return { ...manga, coverFileName: fileName };
    } catch {
      return manga;
    }
  },

  // Fetch chapters for a manga
  fetchChapterList: async (mangaId, options = {}) => {
    const { language = 'en', page = 1, limit = 100 } = options;

    const data = await fetchFromApi(`/manga/${mangaId}/feed`, {
      translatedLanguage: [language],
      order: { chapter: 'asc' },
      limit,
      offset: (page - 1) * limit,
    });

    return data.data;
  },

  // Fetch chapter page images
  fetchChapterPages: async (chapterId) => {
    const data = await fetchFromApi(`/at-home/server/${chapterId}`);

    const { baseUrl, chapter } = data;
    return chapter.data.map(filename => `${baseUrl}/data/${chapter.hash}/${filename}`);
  },

  // Get latest manga list
  fetchLatestManga: async (limit = 10, plusEighteen = true) => {
    try {
      return await this.fetchMangaList('', { limit, plusEighteen, order: { latestUploadedChapter: 'desc' } });
    } catch {
      return [];
    }
  },

  // Get most followed manga list
  fetchMostFollowedManga: async (limit = 10, plusEighteen = true) => {
    try {
      return await this.fetchMangaList('', { limit, plusEighteen, order: { followedCount: 'desc' } });
    } catch {
      return [];
    }
  },

  // Fetch cover filename by cover ID
  fetchCoverFileName: async (coverId) => {
    try {
      const coverData = await fetchFromApi(`/cover/${coverId}`);
      return coverData.data?.attributes?.fileName || null;
    } catch {
      return null;
    }
  },

  // Check if API is rate limited
  isApiRateLimited: () => isRateLimited,
};
