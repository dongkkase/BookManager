export const SEARCH_HISTORY_LIMIT = 20;

export function normalizeSearchHistory(values) {
    if (!Array.isArray(values)) return [];

    const history = [];
    const seen = new Set();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const query = value.trim();
        if (!query || seen.has(query)) continue;
        seen.add(query);
        history.push(query);
        if (history.length === SEARCH_HISTORY_LIMIT) break;
    }
    return history;
}

export function addSearchHistory(history, query) {
    return normalizeSearchHistory([query, ...(Array.isArray(history) ? history : [])]);
}

export function removeSearchHistory(history, query) {
    const removedQuery = typeof query === 'string' ? query.trim() : '';
    return normalizeSearchHistory(history).filter(value => value !== removedQuery);
}
