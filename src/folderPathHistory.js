export const GOTO_PATH_HISTORY_LIMIT = 15;

function normalizeHistoryPath(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function pathComparisonKey(path, platform) {
    const normalizedPath = path.normalize('NFC');
    if (String(platform || '').toLowerCase() === 'win32') {
        const windowsPath = normalizedPath.replace(/\//g, '\\');
        const withoutTrailingSeparator = /^[a-z]:\\$/i.test(windowsPath)
            ? windowsPath
            : windowsPath.replace(/\\+$/, '') || windowsPath;
        return withoutTrailingSeparator.toLowerCase();
    }
    return normalizedPath === '/'
        ? normalizedPath
        : normalizedPath.replace(/\/+$/, '') || normalizedPath;
}

export function normalizeGotoPathHistory(values, platform = '') {
    if (!Array.isArray(values)) return [];

    const normalized = [];
    const seen = new Set();
    for (const value of values) {
        const path = normalizeHistoryPath(value);
        if (!path) continue;

        const comparisonKey = pathComparisonKey(path, platform);
        if (seen.has(comparisonKey)) continue;

        seen.add(comparisonKey);
        normalized.push(path);
        if (normalized.length >= GOTO_PATH_HISTORY_LIMIT) break;
    }
    return normalized;
}

export function addGotoPathHistory(history, path, platform = '') {
    return normalizeGotoPathHistory([path, ...(Array.isArray(history) ? history : [])], platform);
}
