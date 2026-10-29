export function dashboardFilePath(file) {
    const value = file?.full_path || file?.path;
    return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
    if (value === undefined || value === null || value === '') return 0;
    const result = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(result) && result > 0 && result <= 8640000000000000 ? result : 0;
}

export function dashboardAddedTimestamp(file) {
    return timestamp(file?.readingListAddedAt) || timestamp(file?.created) || timestamp(file?.mtime);
}

function usableBook(file) {
    return Boolean(dashboardFilePath(file)) && !file.isDirectory && !file.is_folder && file.exists !== false;
}

function insertLatest(items, file, limit) {
    const date = dashboardAddedTimestamp(file);
    const index = items.findIndex(item => item.date < date);
    if (index === -1) {
        if (items.length < limit) items.push({ file, date });
    } else {
        items.splice(index, 0, { file, date });
        if (items.length > limit) items.pop();
    }
}

export function summarizeDashboardCatalog(files = [], limit = 6) {
    const latest = [];
    const paths = new Set();
    const maxItems = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 6;
    for (const file of Array.isArray(files) ? files : []) {
        if (!usableBook(file)) continue;
        const path = dashboardFilePath(file);
        if (paths.has(path)) continue;
        paths.add(path);
        if (maxItems > 0) insertLatest(latest, file, maxItems);
    }
    return { bookCount: paths.size, latest: latest.map(item => item.file) };
}

export function selectDashboardRecent(files = [], limit = 3) {
    const paths = new Set();
    return (Array.isArray(files) ? files : []).filter(file => {
        if (!usableBook(file)) return false;
        const path = dashboardFilePath(file);
        if (paths.has(path)) return false;
        paths.add(path);
        return true;
    }).sort((left, right) => (
        Number(Boolean(left.viewerStatus?.isCompleted)) - Number(Boolean(right.viewerStatus?.isCompleted))
        || timestamp(right.lastReadAt || right.readingState?.lastReadAt) - timestamp(left.lastReadAt || left.readingState?.lastReadAt)
    )).slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3);
}
