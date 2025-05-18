const BASE_URL = 'https://api.mangadex.org';

let isRateLimited = false;
let rateLimitResetTime = 0;

function buildUrl(endpoint, params) {
  let query = '';
  if (params) {
    query = Object.entries(params)
      .flatMap(function ([key, value]) {
        if (Array.isArray(value)) {
          return value.map(function (v) {
            return encodeURIComponent(key) + '[]=' + encodeURIComponent(v);
          });
        } else if (typeof value === 'object' && value !== null) {
          return Object.entries(value).map(function ([nestedKey, nestedValue]) {
            if (['string', 'number', 'boolean'].indexOf(typeof nestedValue) !== -1) {
              return encodeURIComponent(key + '[' + nestedKey + ']') + '=' + encodeURIComponent(nestedValue);
            }
            return '';
          });
        } else {
          return [encodeURIComponent(key) + '=' + encodeURIComponent(value)];
        }
      })
      .join('&');
  }
  return BASE_URL + endpoint + (query ? '?' + query : '');
}

function fetchFromApi(endpoint, params, urlAddon) {
  if (urlAddon === undefined) urlAddon = '';
  var now = Date.now();
  if (isRateLimited && now < rateLimitResetTime) {
    return Promise.reject(new Error('RATE_LIMITED'));
  }

  var url = buildUrl(endpoint, params);
  return fetch(url + urlAddon).then(function (response) {
    if (response.status === 429) {
      isRateLimited = true;
      rateLimitResetTime = Date.now() + 60 * 1000;
      return Promise.reject(new Error('RATE_LIMITED'));
    }
    if (!response.ok) {
      return Promise.reject(new Error('API Error: ' + response.status));
    }
    return response.json();
  });
}

globalThis.extension = {
  id: 'mangadex-extension',
  name: 'Mangadex',
  version: '1.0.0',

  fetchMangaList: function (query, options) {
    if (!options) options = {};
    var limit = options.limit !== undefined ? options.limit : 10;
    var plusEighteen = options.plusEighteen !== undefined ? options.plusEighteen : true;
    var order = options.order !== undefined ? options.order : { relevance: 'desc' };

    return fetchFromApi(
      '/manga',
      {
        title: query,
        limit: limit,
        order: order,
        contentRating: plusEighteen ? [] : ['safe', 'suggestive'],
        includes: ['cover_art'],
      },
      '?_=' + Date.now()
    ).then(function (data) {
      var mangaList = data.data || [];

      var enrichedPromises = mangaList.map(function (manga) {
        var coverRel = (manga.relationships || []).find(function (rel) {
          return rel.type === 'cover_art';
        });
        if (!coverRel) {
          return Promise.resolve(manga);
        }
        return fetchFromApi('/cover/' + coverRel.id)
          .then(function (coverData) {
            var fileName = coverData && coverData.data && coverData.data.attributes && coverData.data.attributes.fileName;
            var extended = Object.assign({}, manga);
            extended.coverFileName = fileName;
            return extended;
          })
          .catch(function () {
            return manga;
          });
      });

      return Promise.all(enrichedPromises);
    });
  },

  fetchMangaDetails: function (mangaId) {
    return fetchFromApi('/manga/' + mangaId, {
      includes: ['cover_art'],
    }).then(function (data) {
      var manga = data.data;
      if (!manga) return null;

      var coverRel = (manga.relationships || []).find(function (rel) {
        return rel.type === 'cover_art';
      });
      if (!coverRel) return manga;

      return fetchFromApi('/cover/' + coverRel.id)
        .then(function (coverData) {
          var fileName = coverData && coverData.data && coverData.data.attributes && coverData.data.attributes.fileName;
          var extended = Object.assign({}, manga);
          extended.coverFileName = fileName;
          return extended;
        })
        .catch(function () {
          return manga;
        });
    });
  },

  fetchChapterList: function (mangaId, options) {
    if (!options) options = {};
    var language = options.language || 'en';
    var page = options.page || 1;
    var limit = options.limit || 100;

    return fetchFromApi('/manga/' + mangaId + '/feed', {
      translatedLanguage: [language],
      order: { chapter: 'asc' },
      limit: limit,
      offset: (page - 1) * limit,
    }).then(function (data) {
      return data.data || [];
    });
  },

  fetchChapterPages: function (chapterId) {
    return fetchFromApi('/at-home/server/' + chapterId).then(function (data) {
      var baseUrl = data.baseUrl;
      var chapter = data.chapter;
      if (!chapter || !chapter.data || !baseUrl) return [];

      return chapter.data.map(function (filename) {
        return baseUrl + '/data/' + chapter.hash + '/' + filename;
      });
    });
  },

  fetchLatestManga: function (limit, plusEighteen) {
    if (limit === undefined) limit = 10;
    if (plusEighteen === undefined) plusEighteen = true;

    return globalThis.extension
      .fetchMangaList('', { limit: limit, plusEighteen: plusEighteen, order: { latestUploadedChapter: 'desc' } })
      .catch(function () {
        return [];
      });
  },

  fetchMostFollowedManga: function (limit, plusEighteen) {
    if (limit === undefined) limit = 10;
    if (plusEighteen === undefined) plusEighteen = true;

    return globalThis.extension
      .fetchMangaList('', { limit: limit, plusEighteen: plusEighteen, order: { followedCount: 'desc' } })
      .catch(function () {
        return [];
      });
  },

  fetchCoverFileName: function (coverId) {
    return fetchFromApi('/cover/' + coverId)
      .then(function (coverData) {
        return (coverData && coverData.data && coverData.data.attributes && coverData.data.attributes.fileName) || null;
      })
      .catch(function () {
        return null;
      });
  },

  isApiRateLimited: function () {
    return isRateLimited;
  },
};
