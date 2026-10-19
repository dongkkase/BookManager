export function nextSelectionIndex(length, currentIndex, direction) {
    if (length <= 0) return -1;
    return Math.max(0, Math.min(length - 1, currentIndex + direction));
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
