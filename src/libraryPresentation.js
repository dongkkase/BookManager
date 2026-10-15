import { libraryPathKey } from './settingsPolicy.js';

export function libraryDisplayName(path, alias = '') {
    return alias || String(path || '').split(/[\\/]/).filter(Boolean).pop() || path;
}

export function buildLibraryItems(libraries = [], libraryEntries = []) {
    const metaByPath = new Map((libraryEntries || [])
        .filter(entry => entry?.path)
        .map(entry => [libraryPathKey(entry.path), entry]));
    return (libraries || []).map((libraryPath, index) => {
        const meta = metaByPath.get(libraryPathKey(libraryPath)) || {};
        return {
            path: libraryPath,
            index,
            name: libraryDisplayName(libraryPath, meta.alias),
            group: meta.group || '',
        };
    });
}

export function groupLibraryItems(items = []) {
    const groups = [];
    const groupMap = new Map();
    for (const item of items) {
        const groupKey = item.group || '';
        if (!groupMap.has(groupKey)) {
            const group = { key: groupKey, label: item.group, items: [] };
            groupMap.set(groupKey, group);
            groups.push(group);
        }
        groupMap.get(groupKey).items.push(item);
    }
    return groups;
}
