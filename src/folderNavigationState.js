export const FOLDER_NAVIGATION_HISTORY_LIMIT = 100;

function isWindowsPath(path) {
    return /^[a-z]:[\\/]/i.test(path) || /^[\\/]{2}/.test(path);
}

function pathComparisonKey(path) {
    const normalized = path.normalize('NFC');
    if (isWindowsPath(normalized)) {
        return `windows:${normalized.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`;
    }
    return `posix:${normalized.replace(/\/+$/, '') || '/'}`;
}

export function rememberFolderLocation(locations, folderPath, location) {
    if (!folderPath) return;
    const key = pathComparisonKey(folderPath);
    locations.delete(key);
    locations.set(key, {
        ...location,
        selectedPaths: [...(location.selectedPaths || [])],
        scrollTops: { ...location.scrollTops },
    });
    while (locations.size > FOLDER_NAVIGATION_HISTORY_LIMIT) {
        locations.delete(locations.keys().next().value);
    }
}

export function getFolderLocation(locations, folderPath) {
    return folderPath ? locations.get(pathComparisonKey(folderPath)) : undefined;
}

export function resolveFolderLocation(location = {}, files = [], { viewMode, layoutKey, revealPath = '' } = {}) {
    const pathsByKey = new Map(files.filter(file => file?.path)
        .map(file => [pathComparisonKey(file.path), file.path]));
    const currentPath = value => value ? pathsByKey.get(pathComparisonKey(value)) || '' : '';
    const selectedPaths = revealPath
        ? [currentPath(revealPath)].filter(Boolean)
        : (location.selectedPaths || []).map(currentPath).filter(Boolean);
    const activePath = revealPath
        ? selectedPaths[0] || ''
        : currentPath(location.activePath) || selectedPaths[selectedPaths.length - 1] || '';
    const sameView = location.viewMode === viewMode;
    const sameLayout = sameView && (!location.layoutKey || location.layoutKey === layoutKey);

    return {
        selectedPaths,
        activePath,
        scrollTop: sameView ? location.scrollTop || 0 : location.scrollTops?.[viewMode] || 0,
        scrollLeft: sameView ? location.scrollLeft || 0 : 0,
        revealPath: currentPath(revealPath) || (!sameLayout ? activePath : ''),
    };
}

export function pushFolderNavigation(state, path) {
    if (typeof path !== 'string' || !path.trim()) return state;

    const currentPath = state.entries[state.index];
    if (currentPath && pathComparisonKey(currentPath) === pathComparisonKey(path)) return state;

    const entries = [...state.entries.slice(0, state.index + 1), path]
        .slice(-FOLDER_NAVIGATION_HISTORY_LIMIT);
    return { entries, index: entries.length - 1 };
}

export function moveFolderNavigation(state, delta) {
    if (!state.entries.length || !Number.isFinite(delta)) return state;

    const index = Math.max(0, Math.min(state.entries.length - 1, state.index + Math.trunc(delta)));
    return index === state.index ? state : { entries: state.entries, index };
}

export function parentFolderPath(path) {
    if (typeof path !== 'string' || !path) return '';

    const windowsPath = isWindowsPath(path);
    const separatorPattern = windowsPath ? /[\\/]+$/ : /\/+$/;
    const trimmedPath = path.replace(separatorPattern, '');
    if (!trimmedPath || /^[a-z]:$/i.test(trimmedPath)) return '';

    if (/^[\\/]{2}/.test(trimmedPath)) {
        const parts = trimmedPath.slice(2).split(/[\\/]+/);
        if (parts.length <= 2) return '';
    }

    const separatorIndex = windowsPath
        ? Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'))
        : trimmedPath.lastIndexOf('/');
    if (separatorIndex < 0) return '';
    if (separatorIndex === 0) return '/';
    if (windowsPath && separatorIndex === 2 && /^[a-z]:/i.test(trimmedPath)) {
        return trimmedPath.slice(0, 3);
    }
    return trimmedPath.slice(0, separatorIndex);
}
