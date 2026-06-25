import { cleanMetadataSummary } from './metadataPolicy.js';

export const COMIC_METADATA_API_SOURCES = [
  { value: '리디북스', labelKey: 'api_source_ridi' },
  { value: '알라딘', labelKey: 'api_source_aladin' },
  { value: 'Google Books', labelKey: 'api_source_google' },
  { value: 'Anilist', labelKey: 'api_source_anilist' },
  { value: 'Vine', labelKey: 'api_source_vine' },
];

export const BOOK_METADATA_API_SOURCES = [
  { value: '리디북스', labelKey: 'api_source_ridi' },
  { value: '알라딘', labelKey: 'api_source_aladin' },
  { value: 'Google Books', labelKey: 'api_source_google' },
  { value: 'Amazon', labelKey: 'api_source_amazon' },
];

export const ALL_METADATA_API_SOURCES = [
  ...COMIC_METADATA_API_SOURCES,
  ...BOOK_METADATA_API_SOURCES.filter(source => (
    !COMIC_METADATA_API_SOURCES.some(comicSource => comicSource.value === source.value)
  )),
];

export function requiredApiKeyForSource(source = '') {
  return {
    '알라딘': 'aladin',
    'Google Books': 'google',
    Vine: 'vine',
  }[source] || '';
}

export function apiSourceHasRequiredKey(source, apiKeys = {}) {
  const requiredKey = requiredApiKeyForSource(source);
  return !requiredKey || String(apiKeys?.[requiredKey] || '').trim().length > 0;
}

export function metadataApiSourcesForBookType(bookType = 'comic') {
  return bookType === 'book'
    ? BOOK_METADATA_API_SOURCES
    : COMIC_METADATA_API_SOURCES;
}

export function metadataApiPreferenceKey(bookType = 'comic') {
  return bookType === 'book'
    ? 'preferred_meta_api_book'
    : 'preferred_meta_api_comic';
}

export function normalizeMetadataApiSourceForBookType(source = '', bookType = 'comic', apiKeys = {}) {
  const sources = metadataApiSourcesForBookType(bookType);
  if (sources.some(item => item.value === source)) return source;
  return sources.find(item => apiSourceHasRequiredKey(item.value, apiKeys))?.value || sources[0]?.value || '';
}

export function preferredMetadataApiSource(config = {}, bookType = 'comic') {
  const preferenceKey = metadataApiPreferenceKey(bookType);
  return normalizeMetadataApiSourceForBookType(
    config?.[preferenceKey] || config?.last_meta_api || '',
    bookType,
    config?.api_keys || {},
  );
}

export function metadataFromApiResult(result = {}, options = {}) {
  const metadata = result.metadata || {};
  const normalized = {
    ...metadata,
    Summary: cleanMetadataSummary(metadata.Summary || result.summary || ''),
  };
  if (options.bookType !== 'book') {
    normalized.Manga = metadata.Manga || 'YesAndRightToLeft';
  } else if (metadata.Manga) {
    normalized.Manga = metadata.Manga;
  }
  return normalized;
}
