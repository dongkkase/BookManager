export function nextSelectionIndex(length, currentIndex, direction) {
    if (length <= 0) return -1;
    return Math.max(0, Math.min(length - 1, currentIndex + direction));
}

export function folderSelectionTarget(groups, currentIndex, key, columnCount = 1) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return -1;
    const groupSizes = (Array.isArray(groups) ? groups : [])
        .map(group => Array.isArray(group?.files) ? group.files.length : 0)
        .filter(size => size > 0);
    const length = groupSizes.reduce((total, size) => total + size, 0);
    if (length === 0) return -1;
    if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= length) return 0;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
        return nextSelectionIndex(length, currentIndex, key === 'ArrowLeft' ? -1 : 1);
    }

    const requestedColumns = Number(columnCount);
    const columns = Number.isFinite(requestedColumns) ? Math.max(1, Math.floor(requestedColumns)) : 1;
    let groupIndex = 0;
    let groupStart = 0;
    while (currentIndex >= groupStart + groupSizes[groupIndex]) {
        groupStart += groupSizes[groupIndex];
        groupIndex += 1;
    }
    const groupSize = groupSizes[groupIndex];
    const localIndex = currentIndex - groupStart;
    const column = localIndex % columns;
    const rowStart = localIndex - column;

    if (key === 'ArrowUp') {
        if (rowStart > 0) return groupStart + rowStart - columns + column;
        if (groupIndex === 0) return currentIndex;
        const previousSize = groupSizes[groupIndex - 1];
        const previousRowStart = Math.floor((previousSize - 1) / columns) * columns;
        return groupStart - previousSize + Math.min(previousRowStart + column, previousSize - 1);
    }

    const nextRowStart = rowStart + columns;
    if (nextRowStart < groupSize) return groupStart + Math.min(nextRowStart + column, groupSize - 1);
    if (groupIndex === groupSizes.length - 1) return currentIndex;
    return groupStart + groupSize + Math.min(column, groupSizes[groupIndex + 1] - 1);
}

export function createFileSelectionLookup(files = []) {
    let indexByPath = null;
    const getIndex = filePath => {
        if (!indexByPath) {
            indexByPath = new Map();
            files.forEach((file, index) => {
                const filePath = file?.path;
                if (filePath) indexByPath.set(filePath, index);
            });
        }
        return indexByPath.get(filePath);
    };
    return {
        getIndex,
        getFile: filePath => files[getIndex(filePath)],
    };
}

export function selectedFilesSize(files = [], selectedPaths = []) {
    const selected = new Set(selectedPaths);
    return files.reduce((sum, file) => (
        selected.has(file.path) ? sum + (Number(file.size) || 0) : sum
    ), 0);
}
