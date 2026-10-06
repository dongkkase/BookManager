import { folderEntryOperationTargets } from './fileActionPolicy.js';
import { readingStatePathKey } from './folderReadingStates.js';

export function resolveReadingActionPaths(menu, selectedEntries = [], { preserveNestedEntries = false } = {}) {
    if (!menu) return [];
    if (menu.type === 'library' || (menu.type === 'folder' && menu.source !== 'list')) {
        return menu.folderPath ? [menu.folderPath] : [];
    }
    const target = menu.file?.full_path || menu.file?.path || menu.folderPath;
    const entries = selectedEntries.some(entry => (entry.full_path || entry.path) === target)
        ? selectedEntries : target ? [{ ...menu.file, path: target }] : [];
    return preserveNestedEntries
        ? [...new Set(entries.map(entry => entry.full_path || entry.path).filter(Boolean))]
        : folderEntryOperationTargets(entries).map(entry => entry.full_path || entry.path);
}

export function applyReadingActionStates(storage, states, platform = '') {
    const prefix = 'bookmanager-viewer-state:';
    const keysByPath = new Map();
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const pathKey = readingStatePathKey(key.slice(prefix.length), platform);
        if (!keysByPath.has(pathKey)) keysByPath.set(pathKey, []);
        keysByPath.get(pathKey).push(key);
    }
    for (const state of states) {
        const pathKey = readingStatePathKey(state.filePath, platform);
        const keys = new Set([`${prefix}${state.filePath}`, ...(keysByPath.get(pathKey) || [])]);
        for (const key of keys) {
            let previous = {};
            try { previous = JSON.parse(storage.getItem(key) || '{}') || {}; } catch { /* Replace invalid reading state. */ }
            const next = { ...previous, ...state, readiveLocator: state.locator };
            next.pageCount = state.pageCount || Number(previous.pageCount) || 0;
            next.durationSeconds = state.durationSeconds || Number(previous.durationSeconds) || 0;
            if (state.status === 'completed') {
                next.pageIndex = Math.max(0, next.pageCount - 1);
                next.positionSeconds = next.durationSeconds;
                if (state.format === 'audio') next.readiveLocator = { kind: 'audio-time', positionSeconds: next.positionSeconds };
            }
            delete next.epubPosition;
            delete next.coverEditPageIndex;
            storage.setItem(key, JSON.stringify(next));
        }
    }
}
