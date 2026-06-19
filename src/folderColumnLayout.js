export const FOLDER_COLUMNS = [
    { key: 'cover', labelKey: 'col_cover', width: 60, visible: true, sortable: false },
    { key: 'dup_count', labelKey: 'folder_dup_check_off', width: 80, visible: true },
    { key: 'resolution', labelKey: 'col_res', width: 100, visible: true },
    { key: 'size', labelKey: 'col_size', width: 100, visible: true },
    { key: 'created', labelKey: 'col_ctime', width: 150, visible: true },
    { key: 'series', labelKey: 'col_series', width: 200, visible: true },
    { key: 'name', labelKey: 'col_name', width: 240, visible: true },
    { key: 'title', labelKey: 'col_title', width: 160, visible: true },
    { key: 'volume', labelKey: 'col_vol', width: 70, visible: true },
    { key: 'chapter', labelKey: 'col_num', width: 60, visible: true },
    { key: 'author', labelKey: 'col_writer', width: 120, visible: true },
    { key: 'modified', labelKey: 'col_mtime', width: 150, visible: true },
    { key: 'series_group', labelKey: 'col_series_group', width: 120, visible: true },
    { key: 'producer', labelKey: 'col_creators', width: 120, visible: true },
    { key: 'publisher', labelKey: 'col_publisher', width: 120, visible: true },
    { key: 'folder_path', labelKey: 'col_path', width: 240, visible: false },
    { key: 'ext', labelKey: 'col_ext', width: 80, visible: false },
    { key: 'imprint', labelKey: 'col_imprint', width: 120, visible: false },
    { key: 'genre', labelKey: 'col_genre', width: 140, visible: false },
    { key: 'total_volume', labelKey: 'col_vol_count', width: 90, visible: false },
    { key: 'page_count', labelKey: 'col_page_count', width: 90, visible: false },
    { key: 'format', labelKey: 'col_format', width: 80, visible: false },
];

export function createDefaultColumnLayout() {
    return FOLDER_COLUMNS.map(column => ({ ...column }));
}

export function normalizeColumnLayout(layout) {
    const defaults = createDefaultColumnLayout();
    if (!Array.isArray(layout)) return defaults;
    const incoming = new Map(layout.map(column => [column?.key, column]));
    const orderedKeys = layout.map(column => column?.key).filter(key => defaults.some(column => column.key === key));
    const missingKeys = defaults.map(column => column.key).filter(key => !orderedKeys.includes(key));
    return [...orderedKeys, ...missingKeys].map(key => {
        const fallback = defaults.find(column => column.key === key);
        const saved = incoming.get(key) || {};
        return {
            ...fallback,
            visible: saved.visible === undefined ? fallback.visible : Boolean(saved.visible),
            width: Math.max(40, Math.min(600, Number(saved.width) || fallback.width)),
        };
    });
}

export function moveColumn(layout, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= layout.length) return layout;
    const next = [...layout];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export function serializeColumnLayout(layout) {
    return normalizeColumnLayout(layout).map(({ key, visible, width }) => ({ key, visible, width }));
}
