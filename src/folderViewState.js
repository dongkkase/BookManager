const KO_NUMERIC_COLLATOR = new Intl.Collator('ko', { numeric: true });

export function sortFolderFiles(files = [], sortKey = 'name', sortOrder = 'asc') {
    return [...files].sort((a, b) => {
        const valueA = a?.[sortKey] ?? '';
        const valueB = b?.[sortKey] ?? '';
        const result = typeof valueA === 'number' && typeof valueB === 'number'
            ? valueA - valueB
            : KO_NUMERIC_COLLATOR.compare(String(valueA), String(valueB));
        return sortOrder === 'desc' ? -result : result;
    });
}

export function groupFolderFiles(files = [], groupKey = 'none', sortKey = 'name', sortOrder = 'asc') {
    const sorted = sortFolderFiles(files, sortKey, sortOrder);
    if (!groupKey || groupKey === 'none') return [{ name: '', files: sorted }];

    const groups = new Map();
    sorted.forEach(file => {
        const name = String(file?.[groupKey] || '미분류');
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(file);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => KO_NUMERIC_COLLATOR.compare(a, b))
        .map(([name, groupedFiles]) => ({ name, files: groupedFiles }));
}

export function normalizeViewScales(scales = {}) {
    return {
        table: Math.max(10, Math.min(100, Number(scales.table) || 50)),
        tile: Math.max(10, Math.min(100, Number(scales.tile) || 50)),
        thumbnail: Math.max(10, Math.min(100, Number(scales.thumbnail) || 50)),
    };
}

export function normalizeViewMode(mode) {
    return ['table', 'tile', 'thumbnail'].includes(mode) ? mode : 'table';
}
