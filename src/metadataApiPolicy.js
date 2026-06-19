import { cleanMetadataSummary } from './metadataPolicy.js';

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

export function metadataFromApiResult(result = {}) {
  const metadata = result.metadata || {};
  return {
    ...metadata,
    Summary: cleanMetadataSummary(metadata.Summary || result.summary || ''),
    Manga: metadata.Manga || 'YesAndRightToLeft',
  };
}
