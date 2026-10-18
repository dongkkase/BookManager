import { cleanMetadataSummary } from './metadataPolicy.js';
import { isMetadataApiSourceEnabled } from '../electron/metadataProviderSettings.js';

export const UNIFIED_METADATA_API_SOURCE = '통합검색';

const ADDITIONAL_BOOK_METADATA_API_SOURCES = [
    { value: 'Goodreads', labelKey: 'api_source_goodreads' },
    { value: 'Hardcover', labelKey: 'api_source_hardcover' },
    { value: 'Open Library', labelKey: 'api_source_openlibrary' },
    { value: 'iTunes', labelKey: 'api_source_itunes' },
    { value: 'Kobo', labelKey: 'api_source_kobo' },
    { value: 'LubimyCzytac', labelKey: 'api_source_lubimyczytac' },
    { value: 'RanobeDB', labelKey: 'api_source_ranobedb' },
];

export const COMIC_METADATA_API_SOURCES = [
  { value: '리디북스', labelKey: 'api_source_ridi' },
    { value: '문피아', labelKey: 'api_source_munpia' },
    { value: '한국웹툰', labelKey: 'api_source_kmas' },
    { value: 'YES24', labelKey: 'api_source_yes24' },
  { value: '알라딘', labelKey: 'api_source_aladin' },
  { value: 'Google Books', labelKey: 'api_source_google' },
  { value: 'Anilist', labelKey: 'api_source_anilist' },
  { value: 'Vine', labelKey: 'api_source_vine' },
    ...ADDITIONAL_BOOK_METADATA_API_SOURCES,
];

export const BOOK_METADATA_API_SOURCES = [
  { value: '리디북스', labelKey: 'api_source_ridi' },
    { value: '문피아', labelKey: 'api_source_munpia' },
    { value: 'YES24', labelKey: 'api_source_yes24' },
  { value: '알라딘', labelKey: 'api_source_aladin' },
  { value: 'Google Books', labelKey: 'api_source_google' },
  { value: 'Amazon', labelKey: 'api_source_amazon' },
    ...ADDITIONAL_BOOK_METADATA_API_SOURCES,
];

export const PDF_METADATA_API_SOURCES = [
  ...BOOK_METADATA_API_SOURCES,
];

export const AUDIO_METADATA_API_SOURCES = [
    ...BOOK_METADATA_API_SOURCES,
    { value: 'Audible', labelKey: 'api_source_audible' },
    { value: 'AudNexus', labelKey: 'api_source_audnexus' },
    { value: 'Libro.fm', labelKey: 'api_source_librofm' },
];

export const ALL_METADATA_API_SOURCES = [
  ...COMIC_METADATA_API_SOURCES,
  ...AUDIO_METADATA_API_SOURCES.filter(source => (
    !COMIC_METADATA_API_SOURCES.some(comicSource => comicSource.value === source.value)
  )),
];

export function requiredApiKeyForSource(source = '') {
  return {
    YES24: 'yes24',
    '알라딘': 'aladin',
    'Google Books': 'google',
    Vine: 'vine',
    Hardcover: 'hardcover',
  }[source] || '';
}

export function apiSourceHasRequiredKey(source, apiKeys = {}) {
  const requiredKey = requiredApiKeyForSource(source);
  const value = String(apiKeys?.[requiredKey] || '').trim();
    return !requiredKey || (requiredKey === 'hardcover' ? value.replace(/^Bearer(?:\s+|$)/i, '').trim() : value).length > 0;
}

export function metadataApiSourcesForBookType(bookType = 'comic') {
  if (bookType === 'pdf') return PDF_METADATA_API_SOURCES;
    if (bookType === 'audio') return AUDIO_METADATA_API_SOURCES;
  return bookType === 'book'
    ? BOOK_METADATA_API_SOURCES
    : COMIC_METADATA_API_SOURCES;
}

export function metadataSearchSourcesForBookType(bookType = 'comic', enabledMap = {}) {
    return [
        { value: UNIFIED_METADATA_API_SOURCE, labelKey: 'api_source_unified' },
        ...metadataApiSourcesForBookType(bookType).filter(source => isMetadataApiSourceEnabled(source.value, enabledMap)),
    ];
}

export function enabledMetadataApiSourcesForBookType(bookType = 'comic', apiKeys = {}, enabledMap = {}) {
    return metadataApiSourcesForBookType(bookType).filter(source => (
        isMetadataApiSourceEnabled(source.value, enabledMap) && apiSourceHasRequiredKey(source.value, apiKeys)
    ));
}

export function metadataApiPreferenceKey(bookType = 'comic') {
  if (bookType === 'pdf') return 'preferred_meta_api_pdf';
    if (bookType === 'audio') return 'preferred_meta_api_audio';
  return bookType === 'book'
    ? 'preferred_meta_api_book'
    : 'preferred_meta_api_comic';
}

export function normalizeMetadataApiSourceForBookType(source = '', bookType = 'comic', apiKeys = {}, enabledMap = {}) {
    if (source === UNIFIED_METADATA_API_SOURCE) return source;
    const sources = metadataApiSourcesForBookType(bookType);
    if (sources.some(item => item.value === source) && isMetadataApiSourceEnabled(source, enabledMap)) return source;
    return enabledMetadataApiSourcesForBookType(bookType, apiKeys, enabledMap)[0]?.value || UNIFIED_METADATA_API_SOURCE;
}

export function preferredMetadataApiSource(config = {}, bookType = 'comic') {
  const preferenceKey = metadataApiPreferenceKey(bookType);
  return normalizeMetadataApiSourceForBookType(
    config?.[preferenceKey] || (bookType === 'audio' ? config?.preferred_meta_api_book : '') || config?.last_meta_api || '',
    bookType,
    config?.api_keys || {},
    config?.metadata_api_enabled || {},
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

const SEARCH_COMPLETION_SUFFIX_PATTERN = /(?:\s+|\s*[\[(（【]\s*)(?:완결|완|完結|完|complete(?:d)?)\s*[\])）】]?\s*$/iu;
const SEARCH_NUMBER_PATTERN = '(?:제|第)?\\s*\\d+(?:\\.\\d+)?';
const SEARCH_UNIT_PATTERN = '(?:권|화|회|편|巻|話)';
const SEARCH_SEQUENCE_SUFFIX_PATTERN = new RegExp(
    `(?:\\s+|\\s*[\\[(（【]\\s*)(?:${SEARCH_NUMBER_PATTERN}\\s*${SEARCH_UNIT_PATTERN}?\\s*[~～–—-]\\s*${SEARCH_NUMBER_PATTERN}\\s*${SEARCH_UNIT_PATTERN}?|${SEARCH_NUMBER_PATTERN}\\s*${SEARCH_UNIT_PATTERN}|(?:vol(?:ume)?|ch(?:apter)?|ep(?:isode)?)\\.?\\s*#?\\s*\\d+(?:\\.\\d+)?)(?:\\s*[\\])）】])?\\s*$`,
    'iu',
);

export function metadataSearchQueryForItem(item = {}) {
    const filename = String(item.name || item.filepath || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const value = [item.metadata?.Series, item.metadata?.Title, filename]
        .find(candidate => typeof candidate === 'string' && candidate.trim()) || '';
    const original = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    const titleWithStoryMarkers = original.replace(
        /[\[(（【]\s*(외전|번외편?|스핀오프|특별편?|단편)\s*[\])）】]/gu,
        ' $1 ',
    ).replace(/\s+/g, ' ').trim();
    let query = cleanApiDecorativePrefix(titleWithStoryMarkers) || original;
    for (let pass = 0; pass < 4; pass += 1) {
        const next = query.replace(SEARCH_COMPLETION_SUFFIX_PATTERN, '')
            .replace(SEARCH_SEQUENCE_SUFFIX_PATTERN, '').trim();
        if (!next || next === query) break;
        query = next;
    }
    return query;
}

export function metadataFromApiResult(result = {}, options = {}) {
  const metadata = result.metadata || {};
  const normalized = {
    ...metadata,
    Summary: cleanMetadataSummary(metadata.Summary || result.summary || ''),
  };
    if (options.isTextMetadata && !String(metadata.Number ?? '').trim()) {
        const count = String(metadata.Count ?? '').trim();
        if (count) normalized.Number = count;
    }
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
