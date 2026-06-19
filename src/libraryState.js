export function resolveLastSelectedLibrary(libraries = [], savedLibrary = '') {
    const normalized = libraries.filter(Boolean);
    return normalized.includes(savedLibrary) ? savedLibrary : normalized[0] || '';
}

export function isLibraryContext(contextMenu) {
    return contextMenu?.type === 'library' && Boolean(contextMenu.folderPath);
}
