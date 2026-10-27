import { extensionFromFile, resolveBookType } from './metadata/metadataTypes.js';

export const RECOMMENDATION_PREFERENCES_STORAGE_KEY = 'bookmanager.dashboard.recommendationPreferences';
export const RECOMMENDATION_FORMATS = ['epub', 'pdf', 'text', 'comic', 'audio'];

function text(value) {
    return String(value ?? '').normalize('NFKC').trim();
}

function textKey(value) {
    return text(value).toLocaleLowerCase();
}

function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))];
}

export function normalizeRecommendationPreferences(value = {}) {
    const books = new Map();
    const series = new Map();
    for (const item of Array.isArray(value?.excludedBooks) ? value.excludedBooks : []) {
        if (typeof item?.path === 'string' && item.path) books.set(item.path, { path: item.path, title: text(item.title) || item.path.split(/[\\/]/).pop() });
    }
    for (const item of Array.isArray(value?.excludedSeries) ? value.excludedSeries : []) {
        const key = textKey(item?.key || item?.title);
        if (key) series.set(key, { key, title: text(item.title) || key });
    }
    return {
        version: 1,
        revision: typeof value?.revision === 'string' ? value.revision.slice(0, 100) : '',
        libraries: uniqueStrings(value?.libraries),
        genres: uniqueStrings(value?.genres).map(textKey).filter((value, index, values) => values.indexOf(value) === index),
        formats: uniqueStrings(value?.formats).filter(value => RECOMMENDATION_FORMATS.includes(value)),
        excludedBooks: [...books.values()],
        excludedSeries: [...series.values()],
    };
}

export function readRecommendationPreferences(storage) {
    try {
        return normalizeRecommendationPreferences(JSON.parse(storage?.getItem(RECOMMENDATION_PREFERENCES_STORAGE_KEY) || '{}'));
    } catch {
        return normalizeRecommendationPreferences();
    }
}

export function recommendationPreferencesKey(preferences) {
    const value = normalizeRecommendationPreferences(preferences);
    return JSON.stringify([
        [...value.libraries].sort(), [...value.genres].sort(), [...value.formats].sort(),
        value.excludedBooks.map(item => item.path).sort(), value.excludedSeries.map(item => item.key).sort(),
        value.revision,
    ]);
}

export const DEFAULT_RECOMMENDATION_PREFERENCES_KEY = recommendationPreferencesKey();

function metadataField(file, key, legacyKey) {
    return [file, file?.metadata, file?.full_meta].map(source => source?.[key] || source?.[legacyKey]).find(Boolean);
}

export function recommendationSeries(file) {
    const title = text(metadataField(file, 'series', 'Series'));
    return title ? { key: textKey(title), title } : null;
}

export function recommendationGenres(file) {
    const value = metadataField(file, 'genre', 'Genre');
    return uniqueStrings((Array.isArray(value) ? value : [value]).flatMap(item => String(item || '').split(/[,;|\n]/u)));
}

export function recommendationFormat(file) {
    const ext = extensionFromFile(file);
    if (ext === '.epub') return 'epub';
    if (ext === '.txt') return 'text';
    const type = resolveBookType(file);
    return type === 'book' ? 'text' : type;
}

function pathKey(path, platform) {
    const normalized = String(path || '').normalize('NFC').replace(/\\/g, '/').replace(/\/+$/u, '');
    return /^win/i.test(platform) ? normalized.toLocaleLowerCase() : normalized;
}

export function createRecommendationPreferenceMatcher(preferences, platform = '') {
    const value = normalizeRecommendationPreferences(preferences);
    const libraries = value.libraries.map(path => pathKey(path, platform));
    const genres = new Set(value.genres);
    const formats = new Set(value.formats);
    const books = new Set(value.excludedBooks.map(item => pathKey(item.path, platform)));
    const series = new Set(value.excludedSeries.map(item => item.key));
    return file => {
        const path = pathKey(file?.full_path || file?.path, platform);
        if (books.has(path)) return false;
        if (libraries.length && !libraries.some(root => path === root || path.startsWith(`${root}/`))) return false;
        if (formats.size && !formats.has(recommendationFormat(file))) return false;
        if (genres.size && !recommendationGenres(file).some(genre => genres.has(textKey(genre)))) return false;
        return !series.size || !series.has(recommendationSeries(file)?.key);
    };
}

export function recommendationPreferenceOptions(files = []) {
    const genres = new Map();
    const formatCounts = Object.fromEntries(RECOMMENDATION_FORMATS.map(format => [format, 0]));
    for (const file of Array.isArray(files) ? files : []) {
        if (!file || file.isDirectory || file.is_folder || file.exists === false) continue;
        const format = recommendationFormat(file);
        formatCounts[format] = (formatCounts[format] || 0) + 1;
        const fileGenres = new Set();
        for (const title of recommendationGenres(file)) {
            const key = textKey(title);
            if (fileGenres.has(key)) continue;
            fileGenres.add(key);
            const entry = genres.get(key);
            if (entry) entry.count += 1;
            else genres.set(key, { key, title, count: 1 });
        }
    }
    return { genres: [...genres.values()].sort((left, right) => left.title.localeCompare(right.title)), formatCounts };
}
