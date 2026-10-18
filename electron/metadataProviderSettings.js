export const ITUNES_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'NZ', 'KR', 'JP', 'DE', 'FR', 'IT', 'ES', 'NL', 'PT', 'BR', 'IN', 'MX'];
export const KOBO_COUNTRIES = ['us', 'ca', 'gb', 'au', 'nz', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'br', 'jp'];
export const KOBO_LANGUAGES = ['en', 'fr', 'de', 'it', 'es', 'nl', 'pt', 'ja', 'all'];
export const AUDIBLE_REGIONS = ['us', 'uk', 'de', 'fr', 'it', 'es', 'ca', 'au', 'jp', 'in'];

export const METADATA_API_SOURCE_NAMES = [
    '리디북스', '문피아', '한국웹툰', 'YES24', '알라딘', 'Google Books', 'Anilist', 'Vine',
    'Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB',
    'Amazon', 'Audible', 'AudNexus', 'Libro.fm',
];

export function normalizeMetadataApiEnabled(value = {}) {
    const settings = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(METADATA_API_SOURCE_NAMES.map(source => [
        source,
        !Object.prototype.hasOwnProperty.call(settings, source) || settings[source] !== false,
    ]));
}

export function isMetadataApiSourceEnabled(source, enabledMap = {}) {
    if (!METADATA_API_SOURCE_NAMES.includes(source)) return false;
    if (!enabledMap || typeof enabledMap !== 'object' || Array.isArray(enabledMap)) return true;
    return !Object.prototype.hasOwnProperty.call(enabledMap, source) || enabledMap[source] !== false;
}

export function normalizeHardcoverToken(value = '') {
    return String(value || '').trim().replace(/^Bearer(?:\s+|$)/i, '').trim();
}

export function normalizeMetadataProviderSettings(settings = {}) {
    const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    const itunesCountry = String(value.itunes_country || '').trim().toUpperCase();
    const koboCountry = String(value.kobo_country || '').trim().toLowerCase();
    const koboLanguage = String(value.kobo_language || '').trim().toLowerCase();
    const audibleRegion = String(value.audible_region || '').trim().toLowerCase();
    return {
        itunes_country: /^[A-Z]{2}$/.test(itunesCountry) ? itunesCountry : 'US',
        itunes_cover_resolution: value.itunes_cover_resolution === 'standard' ? 'standard' : 'high',
        kobo_country: KOBO_COUNTRIES.includes(koboCountry) ? koboCountry : 'us',
        kobo_language: KOBO_LANGUAGES.includes(koboLanguage) ? koboLanguage : 'en',
        audible_region: AUDIBLE_REGIONS.includes(audibleRegion) ? audibleRegion : 'us',
    };
}
