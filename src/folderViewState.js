const KO_NUMERIC_COLLATOR = new Intl.Collator('ko', { numeric: true });
export const FOLDER_VIEW_VIRTUALIZE_THRESHOLD = 300;
const UNCATEGORIZED_GROUP_NAME = '미분류';
export const MAX_VIEW_SCALE_BY_MODE = {
    table: 100,
    tile: 150,
    thumbnail: 150,
};
const MIN_VIEW_SCALE = 10;
const DEFAULT_VIEW_SCALE = 50;

function normalizeViewScale(scale, mode = 'table') {
    const maxScale = MAX_VIEW_SCALE_BY_MODE[mode] || MAX_VIEW_SCALE_BY_MODE.table;
    return Math.max(MIN_VIEW_SCALE, Math.min(maxScale, Number(scale) || DEFAULT_VIEW_SCALE));
}

function firstGroupValue(...values) {
    for (const value of values) {
        if (Array.isArray(value)) {
            const joined = value.map(item => String(item || '').trim()).filter(Boolean).join(', ');
            if (joined) return joined;
            continue;
        }
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function folderFileGroupValue(file = {}, groupKey = '', fallbackGroupName = UNCATEGORIZED_GROUP_NAME) {
    if (groupKey === 'author') {
        return firstGroupValue(file.author, file.writer, file.creators);
    }
    if (groupKey === 'author_series') {
        const author = firstGroupValue(file.author, file.writer, file.creators) || fallbackGroupName;
        const series = firstGroupValue(file.series) || fallbackGroupName;
        return `${author} / ${series}`;
    }
    return firstGroupValue(file?.[groupKey]);
}

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

export function groupFolderFiles(files = [], groupKey = 'none', sortKey = 'name', sortOrder = 'asc', options = {}) {
    const sorted = sortFolderFiles(files, sortKey, sortOrder);
    if (!groupKey || groupKey === 'none') return [{ name: '', files: sorted }];
    const fallbackGroupName = String(options.fallbackGroupName || UNCATEGORIZED_GROUP_NAME);

    const groups = new Map();
    sorted.forEach(file => {
        const name = folderFileGroupValue(file, groupKey, fallbackGroupName) || fallbackGroupName;
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(file);
    });
    return [...groups.entries()]
        .sort(([a], [b]) => KO_NUMERIC_COLLATOR.compare(a, b))
        .map(([name, groupedFiles]) => ({ name, files: groupedFiles }));
}

export function countGroupedFiles(groups = []) {
    return groups.reduce((total, group) => total + (Array.isArray(group?.files) ? group.files.length : 0), 0);
}

export function shouldVirtualizeFolderItems(groups = [], threshold = FOLDER_VIEW_VIRTUALIZE_THRESHOLD) {
    return countGroupedFiles(groups) > threshold;
}

export function buildVirtualTableRows(groups = []) {
    const rows = [];
    let fileIndex = 0;
    for (const group of groups) {
        const files = Array.isArray(group?.files) ? group.files : [];
        if (group?.name) {
            rows.push({
                type: 'group',
                key: `group:${group.name}:${rows.length}`,
                group,
            });
        }
        for (const file of files) {
            rows.push({
                type: 'file',
                key: file?.path || `file:${fileIndex}`,
                file,
                fileIndex,
            });
            fileIndex += 1;
        }
    }
    return rows;
}

export function buildVirtualGridLayout(groups = [], options = {}) {
    const columnCount = Math.max(1, Number(options.columnCount) || 1);
    const rowHeight = Math.max(1, Number(options.rowHeight) || 1);
    const columnWidth = Math.max(1, Number(options.columnWidth) || 1);
    const horizontalGap = Math.max(0, Number(options.horizontalGap) || 0);
    const padding = Math.max(0, Number(options.padding) || 0);
    const headerHeight = Math.max(1, Number(options.headerHeight) || 34);
    const itemWidth = Math.max(1, Number(options.itemWidth) || columnWidth);
    const rows = [];
    let top = padding;
    let fileIndex = 0;

    for (const group of groups) {
        const files = Array.isArray(group?.files) ? group.files : [];
        if (group?.name) {
            rows.push({
                type: 'group',
                key: `group:${group.name}:${rows.length}`,
                group,
                top,
                left: padding,
                height: headerHeight,
            });
            top += headerHeight;
        }

        for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            const row = Math.floor(index / columnCount);
            const column = index % columnCount;
            rows.push({
                type: 'file',
                key: file?.path || `file:${fileIndex}`,
                file,
                fileIndex,
                top: top + row * rowHeight,
                left: padding + column * (columnWidth + horizontalGap),
                width: itemWidth,
                height: rowHeight,
            });
            fileIndex += 1;
        }
        top += Math.ceil(files.length / columnCount) * rowHeight;
    }

    return {
        rows,
        height: Math.max(1, top + padding),
    };
}

export function visibleVirtualRows(rows = [], scrollTop = 0, viewportHeight = 0, bufferSize = 0) {
    const start = Math.max(0, Number(scrollTop) || 0) - Math.max(0, Number(bufferSize) || 0);
    const end = Math.max(0, Number(scrollTop) || 0)
        + Math.max(1, Number(viewportHeight) || 600)
        + Math.max(0, Number(bufferSize) || 0);
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const row = rows[mid] || {};
        const bottom = (Number(row.top) || 0) + (Number(row.height) || 0);
        if (bottom < start) low = mid + 1;
        else high = mid;
    }

    const visible = [];
    for (let index = low; index < rows.length; index += 1) {
        const row = rows[index] || {};
        const top = Number(row.top) || 0;
        if (top > end) break;
        const height = Number(row.height) || 0;
        if (top + height >= start) visible.push(rows[index]);
    }
    return visible;
}

export function normalizeViewScales(scales = {}) {
    return {
        table: normalizeViewScale(scales.table, 'table'),
        tile: normalizeViewScale(scales.tile, 'tile'),
        thumbnail: normalizeViewScale(scales.thumbnail, 'thumbnail'),
    };
}

export function normalizeViewMode(mode) {
    return ['table', 'tile', 'thumbnail'].includes(mode) ? mode : 'table';
}
