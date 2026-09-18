import path from 'path';

export function normalizeNativePath(filePath, platform = process.platform) {
    const value = String(filePath || '').replace(/\0/g, '');
    if (!value) return '';

    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    return pathApi.normalize(value);
}

export function normalizeNativePaths(filePaths, platform = process.platform) {
    if (!Array.isArray(filePaths)) return [];

    const seen = new Set();
    const normalizedPaths = [];

    for (const filePath of filePaths) {
        const normalized = normalizeNativePath(filePath, platform);
        if (!normalized) continue;
        const comparisonKey = platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
        if (seen.has(comparisonKey)) continue;
        seen.add(comparisonKey);
        normalizedPaths.push(normalized);
    }

    return normalizedPaths;
}
