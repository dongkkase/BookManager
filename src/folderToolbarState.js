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
    return files.filter(file => {
        if (metadataMissingOnly && hasArchiveMetadata(file)) return false;
        if (!query) return true;
        return [
            file.name,
            file.path,
            file.full_path,
            file.folder_path,
            file.series,
            file.title,
            file.author,
            file.writer,
            file.publisher,
            file.genre,
        ].some(value => String(value || '').toLowerCase().includes(query));
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
