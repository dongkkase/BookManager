export const FOLDER_GROUP_KEYS = [
    'none',
    'folder_path',
    'ext',
    'series',
    'author_series',
    'title',
    'author',
    'publisher',
    'genre',
];

export const FOLDER_SORT_KEYS = [
    'name',
    'size',
    'modified',
    'ext',
    'series',
    'title',
    'author',
];

const FOLDER_SEARCH_FIELDS = [
    'name',
    'path',
    'full_path',
    'folder_path',
    'series',
    'title',
    'author',
    'writer',
    'publisher',
    'genre',
];
const normalizedSearchValuesByFile = new WeakMap();

function normalizedSearchValues(file) {
    if (!file || typeof file !== 'object') return [];
    const sourceValues = FOLDER_SEARCH_FIELDS.map(key => String(file[key] || ''));
    const cached = normalizedSearchValuesByFile.get(file);
    if (
        cached
        && sourceValues.every((value, index) => value === cached.sourceValues[index])
    ) return cached.normalizedValues;
    const normalizedValues = sourceValues.map(value => value.toLowerCase());
    normalizedSearchValuesByFile.set(file, { sourceValues, normalizedValues });
    return normalizedValues;
}

export function hasArchiveMetadata(file = {}) {
    if (typeof file.has_metadata === 'boolean') return file.has_metadata;
    return Boolean(
        file.metadata_exists
        || file.comicinfo_exists
        || file.author
        || file.writer
        || file.publisher
        || file.genre
        || file.description,
    );
}

export function filterFolderFiles(files = [], options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    const metadataMissingOnly = options.metadataMissingOnly === true;
    if (!query && !metadataMissingOnly) return files;
    return files.filter(file => {
        if (metadataMissingOnly && hasArchiveMetadata(file)) return false;
        if (!query) return true;
        return normalizedSearchValues(file).some(value => value.includes(query));
    });
}

export function normalizeSavedLayouts(layouts) {
    if (Array.isArray(layouts)) {
        return layouts.map(layout => typeof layout === 'string' ? layout : layout?.name).filter(Boolean);
    }
    if (layouts && typeof layouts === 'object') {
        return Object.keys(layouts);
    }
    return [];
}
