export const APP_NAME = 'BookManager';
export const ISSUE_URL = 'https://github.com/dongkkase/ComicZIP_Optimizer/issues';
export const RELEASES_URL = 'https://github.com/dongkkase/ComicZIP_Optimizer/releases';

export const TABS = Object.freeze([
    { id: 'folder', labelKey: 'tab_folders' },
    { id: 'organizer', labelKey: 'tab1' },
    { id: 'renamer', labelKey: 'tab2' },
    { id: 'metadata', labelKey: 'tab3' },
    { id: 'sharing', labelKey: 'tab_sharing' },
    { id: 'releases', labelKey: 'tab_releases' },
]);

const FILE_TOOLBAR_TABS = new Set(['organizer', 'renamer', 'metadata']);

export function isFileToolbarEnabled(tabId, isWorking = false) {
    return !isWorking && FILE_TOOLBAR_TABS.has(tabId);
}

export function canAcceptGlobalDrop(tabId, isWorking = false) {
    return !isWorking && !['sharing', 'releases'].includes(tabId);
}

export function normalizeDroppedPaths(paths = []) {
    const seen = new Set();
    const normalized = [];

    for (const filePath of paths) {
        const value = String(filePath || '').replace(/\0/g, '').normalize('NFC');
        if (!value) continue;
        const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
        const normalizedPath = isWindowsPath ? value.replace(/\//g, '\\') : value;
        const comparisonKey = isWindowsPath ? normalizedPath.toLocaleLowerCase() : normalizedPath;
        if (seen.has(comparisonKey)) continue;
        seen.add(comparisonKey);
        normalized.push(normalizedPath);
    }

    return normalized;
}

export function resolveTabId(savedTab, fallbackIndex) {
    if (typeof savedTab === 'string' && TABS.some(tab => tab.id === savedTab)) return savedTab;
    const index = Number(savedTab);
    if (Number.isInteger(index) && TABS[index]) return TABS[index].id;
    if (fallbackIndex !== undefined) return resolveTabId(fallbackIndex);
    return TABS[0].id;
}

export function formatAppTitle(version) {
    return APP_NAME;
}
