export function clampContextMenuPosition(x, y, menuWidth, menuHeight, viewportWidth, viewportHeight, margin = 8) {
    const maxX = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxY = Math.max(margin, viewportHeight - menuHeight - margin);
    return {
        x: Math.min(Math.max(margin, x), maxX),
        y: Math.min(Math.max(margin, y), maxY),
    };
}

export function replaceTreePath(selectedPath, oldPath, newPath) {
    const selected = String(selectedPath || '');
    const oldValue = String(oldPath || '');
    if (!selected || !oldValue) return selected;

    const selectedNormalized = selected.replace(/\\/g, '/');
    const oldNormalized = oldValue.replace(/\\/g, '/').replace(/\/+$/, '');
    const caseInsensitive = /^[A-Za-z]:/.test(selectedNormalized) || selectedNormalized.startsWith('//');
    const comparableSelected = caseInsensitive ? selectedNormalized.toLowerCase() : selectedNormalized;
    const comparableOld = caseInsensitive ? oldNormalized.toLowerCase() : oldNormalized;
    if (comparableSelected !== comparableOld && !comparableSelected.startsWith(`${comparableOld}/`)) {
        return selected;
    }

    const suffix = selectedNormalized.slice(oldNormalized.length);
    const separator = String(newPath).includes('\\') ? '\\' : '/';
    return `${String(newPath).replace(/[\\/]+$/, '')}${suffix.replace(/\//g, separator)}`;
}

export function isFavoriteFolder(favorites = [], folderPath = '') {
    const target = String(folderPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return favorites.some(entry => {
        const path = typeof entry === 'string' ? entry : entry?.path;
        return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === target;
    });
}
