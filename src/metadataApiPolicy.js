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

export const PDF_METADATA_API_SOURCES = [
  ...BOOK_METADATA_API_SOURCES,
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
  if (bookType === 'pdf') return PDF_METADATA_API_SOURCES;
  return bookType === 'book'
    ? BOOK_METADATA_API_SOURCES
    : COMIC_METADATA_API_SOURCES;
}

export function metadataApiPreferenceKey(bookType = 'comic') {
  if (bookType === 'pdf') return 'preferred_meta_api_pdf';
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

const API_SERIES_VOLUME_SUFFIX_PATTERNS = [
  /\s*(?:제|第)?\s*\d+(?:\.\d+)?\s*(?:권|화|회|巻|話)(?:\s*[~～\-–]\s*(?:제|第)?\s*\d+(?:\.\d+)?\s*(?:권|화|회|巻|話))?\s*$/iu,
  /\s*(?:제|第)?\s*\d+(?:\.\d+)?(?:\s*[~～\-–]\s*(?:제|第)?\s*\d+(?:\.\d+)?)?\s*(?:권|화|회|巻|話)\s*$/iu,
  /\s*(?:vol(?:ume)?|v|ch(?:apter)?|ep(?:isode)?)\.?\s*#?\s*\d+(?:\.\d+)?(?:\s*[~\-–]\s*\d+(?:\.\d+)?)?\s*$/iu,
];
const API_SERIES_TRAILING_QUALIFIER_PATTERN = /\s*(?:[\[(（【]\s*)?(?:완결|完結|complete(?:d)?|전자책|e-?book)\s*(?:[\])）】])?\s*$/iu;
const API_LEADING_PREFIX_PATTERN = /^\s*(?:\[[^\]]*\]|\([^)]*\)|【[^】]*】|（[^）]*）|〈[^〉]*〉)\s*/u;

function cleanApiDecorativePrefix(value = '') {
  let text = String(value || '').normalize('NFC').trim();
  if (!text) return '';

  let previous;
  do {
    previous = text;
    text = text.replace(API_LEADING_PREFIX_PATTERN, '').trim();
  } while (text && previous !== text);

  return text;
}

function comparableApiSeriesName(value = '') {
  return String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function cleanApiSeriesName(value = '', options = {}) {
  const original = String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!original) return '';

  let cleaned = original.replace(API_SERIES_TRAILING_QUALIFIER_PATTERN, '').trim();
  let suffixRemoved = false;
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = cleaned;
    for (const pattern of API_SERIES_VOLUME_SUFFIX_PATTERNS) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
    if (cleaned === previous) break;
    suffixRemoved = true;
  }
  if (suffixRemoved && cleaned) {
    return cleaned.replace(/(?:\s+[-–—:·]|[,;])\s*$/, '').trim() || original;
  }

  const bareNumberMatch = cleaned.match(/^(.*\S)\s+\d+(?:\.\d+)?$/u);
  const querySeries = cleanApiSeriesName(options.query);
  if (
    bareNumberMatch
    && querySeries
    && comparableApiSeriesName(bareNumberMatch[1]) === comparableApiSeriesName(querySeries)
  ) {
    return bareNumberMatch[1].trim();
  }
  return original;
}

export function metadataFromApiResult(result = {}, options = {}) {
  const metadata = result.metadata || {};
  const normalized = {
    ...metadata,
    Summary: cleanMetadataSummary(metadata.Summary || result.summary || ''),
  };
  if (metadata.Title) {
    normalized.Title = cleanApiDecorativePrefix(metadata.Title);
  }
  if (metadata.Series) {
    normalized.Series = cleanApiSeriesName(
      cleanApiDecorativePrefix(metadata.Series),
      { query: options.query },
    );
  }
  if (options.bookType === 'comic' || !options.bookType) {
    normalized.Manga = metadata.Manga || 'YesAndRightToLeft';
  } else if (metadata.Manga) {
    normalized.Manga = metadata.Manga;
  }
  return normalized;
}
