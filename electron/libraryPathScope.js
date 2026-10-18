import path from 'node:path';

export function normalizeLibraryRoots(library, libraryPaths) {
    const paths = library.platform === 'win32' ? path.win32 : path.posix;
    return [...new Set((Array.isArray(libraryPaths) ? libraryPaths : [])
        .filter(value => typeof value === 'string' && paths.isAbsolute(value) && !value.includes('\0'))
        .map(value => library.normalizeFilePath(paths.resolve(value))))];
}

export function createLibraryPathScope(library, libraryPaths, column) {
    const windows = library.platform === 'win32';
    const paths = windows ? path.win32 : path.posix;
    const patterns = normalizeLibraryRoots(library, libraryPaths).map(root => {
        const prefix = root.endsWith(paths.sep) ? root : `${root}${paths.sep}`;
        return windows ? `${prefix.replace(/[\\%_]/g, '\\$&')}%` : `${prefix.replace(/[[*?]/g, '[$&]')}*`;
    });
    return {
        where: patterns.length ? patterns.map(() => windows ? `${column} LIKE ? ESCAPE '\\'` : `${column} GLOB ?`).join(' OR ') : '0',
        params: patterns,
    };
}

export function isRegisteredLibraryFile(filePath, libraryPaths, platform = process.platform) {
    const paths = platform === 'win32' ? path.win32 : path.posix;
    if (typeof filePath !== 'string' || !paths.isAbsolute(filePath)) return false;
    const normalize = value => {
        const normalized = paths.resolve(value).normalize(platform === 'darwin' ? 'NFD' : 'NFC');
        return platform === 'win32' ? normalized.toLowerCase() : normalized;
    };
    const target = normalize(filePath);
    return (Array.isArray(libraryPaths) ? libraryPaths : []).some(root => {
        if (typeof root !== 'string' || !paths.isAbsolute(root)) return false;
        const normalized = normalize(root);
        return target.startsWith(normalized.endsWith(paths.sep) ? normalized : `${normalized}${paths.sep}`);
    });
}
