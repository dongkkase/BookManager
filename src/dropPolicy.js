export const SUPPORTED_ARCHIVE_EXTENSIONS = Object.freeze([
    '.zip',
    '.cbz',
    '.cbr',
    '.7z',
    '.rar',
]);

const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_ARCHIVE_EXTENSIONS);

export function isSupportedArchivePath(filePath) {
    const normalized = String(filePath || '')
        .normalize('NFC')
        .replace(/[\s"'“”‘’\u200b-\u200f\u202a-\u202e\u2060\ufeff]+$/giu, '')
        .toLowerCase();
    const match = normalized.match(/\.[^./\\]+$/);
    return Boolean(match && SUPPORTED_EXTENSION_SET.has(match[0].trim()));
}

export function classifyDroppedEntries(entries = []) {
    const folders = [];
    const files = [];
    const unsupported = [];

    for (const entry of entries) {
        const filePath = String(entry?.path || '');
        if (!filePath) continue;
        if (entry.isDirectory) {
            folders.push(filePath);
        } else if (entry.isFile && isSupportedArchivePath(filePath)) {
            files.push(filePath);
        } else {
            unsupported.push(filePath);
        }
    }

    return { folders, files, unsupported };
}

function parentPath(filePath) {
    const value = String(filePath || '');
    const splitAt = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return splitAt > 0 ? value.slice(0, splitAt) : '';
}

function uniquePaths(paths) {
    return [...new Set(paths.filter(Boolean))];
}

export function resolveMetadataDropPaths(classified, choice) {
    if (choice === 'cancel') return [];
    if (choice === 'yes') {
        return uniquePaths([
            ...(classified.folders || []),
            ...(classified.files || []).map(parentPath),
        ]);
    }
    return uniquePaths([
        ...(classified.files || []),
        ...(classified.folders || []),
    ]);
}
