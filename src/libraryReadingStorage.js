const READING_STATE_PREFIX = 'bookmanager-viewer-state:';

function normalizeAbsolutePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0')) return null;
    const windows = /^[a-z]:[\\/]/i.test(value) || /^(?:\\\\|\/\/)/.test(value);
    let normalized = (windows ? value.replace(/\\/g, '/') : value).normalize('NFC');
    if (windows) {
        normalized = normalized.replace(/^\/\/\?\/UNC\//i, '//').replace(/^\/\/\?\/(?=[a-z]:\/)/i, '');
        normalized = normalized.toLowerCase();
    }
    let root;
    let remainder;
    const drive = windows && normalized.match(/^[a-z]:\//);
    const share = windows && normalized.match(/^\/\/[^/]+\/[^/]+(?:\/|$)/);
    if (drive || share) {
        root = (drive || share)[0].replace(/\/$/, '') + '/';
        remainder = normalized.slice((drive || share)[0].length);
    } else if (!windows && normalized.startsWith('/')) {
        root = '/';
        remainder = normalized.slice(1);
    } else {
        return null;
    }
    const parts = [];
    for (const part of remainder.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return root + parts.join('/');
}

function normalizeLibraryPaths(libraryPaths) {
    if (!Array.isArray(libraryPaths)) return null;
    const roots = libraryPaths.map(normalizeAbsolutePath);
    return roots.some(root => root === null) ? null : [...new Set(roots)];
}

export function libraryReadingStorageScopeKey(libraryPaths) {
    const roots = normalizeLibraryPaths(libraryPaths);
    return roots === null ? null : JSON.stringify(roots.sort());
}

function isAllowedWithRoots(key, roots) {
    if (roots === null || typeof key !== 'string' || !key.startsWith(READING_STATE_PREFIX)) return true;
    const target = normalizeAbsolutePath(key.slice(READING_STATE_PREFIX.length));
    return target !== null && roots.some(root => target !== root && target.startsWith(root.endsWith('/') ? root : `${root}/`));
}

export function isLibraryReadingStorageAllowed(key, libraryPaths) {
    return isAllowedWithRoots(key, normalizeLibraryPaths(libraryPaths));
}

export function pruneLibraryReadingStorage(storage, libraryPaths) {
    const roots = normalizeLibraryPaths(libraryPaths);
    if (!storage || roots === null) return 0;
    const keys = [];
    try {
        for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
    } catch {
        return 0;
    }
    let removed = 0;
    for (const key of keys) {
        if (isAllowedWithRoots(key, roots)) continue;
        try {
            storage.removeItem(key);
            removed += 1;
        } catch {
            // Storage restrictions must not prevent opening the app or viewer.
        }
    }
    return removed;
}
