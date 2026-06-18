export const APP_NAME = 'BookManager';
export const ISSUE_URL = 'https://github.com/dongkkase/ComicZIP_Optimizer/issues';

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

    for (const path of paths) {
        const value = String(path || '').trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        normalized.push(value);
    }

    return normalized;
}

export function formatAppTitle(version) {
    const normalizedVersion = String(version || '').trim();
    return normalizedVersion ? `${APP_NAME} v${normalizedVersion}` : APP_NAME;
}
