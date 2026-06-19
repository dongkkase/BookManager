export function splitMetadataValues(...values) {
    return [...new Set(values
        .filter(Boolean)
        .flatMap(value => Array.isArray(value) ? value : String(value).split(/[;,]/))
        .map(value => String(value).trim())
        .filter(Boolean))];
}

export function formatDetailValue(value, fallback = '-') {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
}

export function visibleDetailTags(file = {}, removedTags = []) {
    const removed = new Set(removedTags);
    return splitMetadataValues(file.tags, file.genre)
        .filter(tag => !removed.has(tag));
}

export function duplicateDetailRows(file = {}) {
    return (file.duplicate_matches || []).map(match => ({
        path: match.path || match.folder || '',
        ratio: Number(match.ratio) || 0,
        name: match.name || '',
    }));
}
