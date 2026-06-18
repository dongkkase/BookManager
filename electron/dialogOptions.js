export const ARCHIVE_FILTER = Object.freeze({
    name: 'Archive files',
    extensions: Object.freeze(['zip', 'cbz', 'cbr', '7z', 'rar']),
});

export function createFolderDialogOptions(title) {
    return {
        title: title || '폴더 선택',
        properties: ['openDirectory'],
    };
}

export function createArchiveDialogOptions(title) {
    return {
        title: title || '파일 선택',
        properties: ['openFile', 'multiSelections'],
        filters: [ARCHIVE_FILTER],
    };
}

export function normalizeFolderDialogResult(result = {}) {
    if (result.canceled) return null;
    return result.filePaths?.[0] || null;
}

export function normalizeArchiveDialogResult(result = {}) {
    if (result.canceled) return [];
    return Array.isArray(result.filePaths) ? result.filePaths.filter(Boolean) : [];
}
