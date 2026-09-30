export const TEXT_CLEANER_RECENT_KEY = 'bookmanager.text-cleaner.recent-files';
export const TEXT_CLEANER_RECENT_LIMIT = 20;

function pathKey(filePath) {
    return /^(?:[a-z]:[\\/]|\\\\)/i.test(filePath)
        ? filePath.replace(/\\/g, '/').toLowerCase() : filePath;
}

export function normalizeRecentTextFiles(entries) {
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    return entries.filter(entry => entry && typeof entry.filePath === 'string'
        && /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(entry.filePath)
        && /\.txt$/i.test(entry.filePath) && !entry.filePath.includes('\0')
        && Number.isFinite(entry.updatedAt) && entry.updatedAt > 0 && entry.updatedAt <= 8640000000000000)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .filter(entry => {
            const key = pathKey(entry.filePath);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, TEXT_CLEANER_RECENT_LIMIT)
        .map(({ filePath, updatedAt }) => ({ filePath, fileName: filePath.split(/[\\/]/).pop(), updatedAt }));
}

export function readRecentTextFiles() {
    try {
        return normalizeRecentTextFiles(JSON.parse(localStorage.getItem(TEXT_CLEANER_RECENT_KEY)));
    } catch {
        return [];
    }
}

export function writeRecentTextFiles(entries) {
    const recent = normalizeRecentTextFiles(entries);
    try {
        localStorage.setItem(TEXT_CLEANER_RECENT_KEY, JSON.stringify(recent));
    } catch {
        // A history storage failure must not interrupt opening or saving text.
    }
    return recent;
}

export function rememberTextCleanerFile(file, updatedAt = Date.now()) {
    return writeRecentTextFiles([{ filePath: file.filePath, updatedAt }, ...readRecentTextFiles()]);
}
