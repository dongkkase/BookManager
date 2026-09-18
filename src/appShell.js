export const APP_NAME = 'BookManager';
export const DISCORD_URL = 'https://discord.gg/DRVUbPewaV';
export const READIVE_URL = 'https://dongkkase.github.io/BookManager/readive/';
export const ISSUE_URL = 'https://github.com/dongkkase/BookManager/issues';
export const MANUAL_URL = 'https://github.com/dongkkase/BookManager/wiki';
export const RELEASES_URL = 'https://github.com/dongkkase/BookManager/releases';
export const BOOKMANAGER_PATHS_MIME = 'application/x-bookmanager-paths';

export const TABS = Object.freeze([
    { id: 'folder', labelKey: 'tab_folders' },
    { id: 'organizer', labelKey: 'tab1' },
    { id: 'renamer', labelKey: 'tab2' },
    { id: 'metadata', labelKey: 'tab3' },
    { id: 'tools', labelKey: 'tools.tab' },
    { id: 'sharing', labelKey: 'tab_sharing' },
    { id: 'releases', labelKey: 'tab_releases' },
]);

const LEGACY_TAB_IDS = Object.freeze([
    'folder',
    'organizer',
    'renamer',
    'metadata',
    'sharing',
    'releases',
]);

const FILE_TOOLBAR_TABS = new Set(['organizer', 'renamer', 'metadata']);

export function isFileToolbarEnabled(tabId, isWorking = false) {
    return !isWorking && FILE_TOOLBAR_TABS.has(tabId);
}

export function canAcceptGlobalDrop(tabId, isWorking = false) {
    return !isWorking && !['tools', 'sharing', 'releases'].includes(tabId);
}

export function isExternalFileDrag(dataTransfer) {
    const types = dataTransfer?.types;
    if (!types) return false;
    if (typeof types.contains === 'function' && types.contains('Files')) return true;
    return Array.from(types).includes('Files');
}

export function isFilePathDrag(dataTransfer) {
    if (isExternalFileDrag(dataTransfer)) return true;
    const types = dataTransfer?.types;
    if (!types) return false;
    if (typeof types.contains === 'function' && types.contains(BOOKMANAGER_PATHS_MIME)) return true;
    return Array.from(types).includes(BOOKMANAGER_PATHS_MIME);
}

export function droppedPathsFromDataTransfer(dataTransfer) {
    const paths = Array.from(dataTransfer?.files || []).map(file => file?.path);
    try {
        const internalValue = dataTransfer?.getData?.(BOOKMANAGER_PATHS_MIME);
        if (internalValue) {
            const internalPaths = JSON.parse(internalValue);
            if (Array.isArray(internalPaths)) paths.push(...internalPaths);
        }
    } catch {
        // 잘못된 내부 드래그 데이터는 외부 파일 목록만 사용합니다.
    }
    return normalizeDroppedPaths(paths);
}

export function canAcceptTabDrop(tabId, isWorking = false) {
    return !isWorking && ['folder', 'organizer', 'renamer', 'metadata', 'tools'].includes(tabId);
}

export function normalizeDroppedPaths(paths = []) {
    const seen = new Set();
    const normalized = [];

    for (const filePath of paths) {
        const value = String(filePath || '').replace(/\0/g, '');
        if (!value) continue;
        const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
        const normalizedPath = isWindowsPath
            ? value.normalize('NFC').replace(/\//g, '\\')
            : value;
        const comparisonPath = normalizedPath.normalize('NFC');
        const comparisonKey = isWindowsPath
            ? comparisonPath.replace(/\\/g, '/').toLocaleLowerCase()
            : comparisonPath;
        if (seen.has(comparisonKey)) continue;
        seen.add(comparisonKey);
        normalized.push(normalizedPath);
    }

    return normalized;
}

export function resolveTabId(savedTab, fallbackIndex) {
    if (typeof savedTab === 'string' && TABS.some(tab => tab.id === savedTab)) return savedTab;
    const index = Number(savedTab);
    if (Number.isInteger(index) && LEGACY_TAB_IDS[index]) return LEGACY_TAB_IDS[index];
    if (fallbackIndex !== undefined) return resolveTabId(fallbackIndex);
    return TABS[0].id;
}

export function formatAppTitle(version) {
    return APP_NAME;
}
