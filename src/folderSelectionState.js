export function nextSelectionIndex(length, currentIndex, direction) {
    if (length <= 0) return -1;
    return Math.max(0, Math.min(length - 1, currentIndex + direction));
}

export function selectedFilesSize(files = [], selectedPaths = []) {
    const selected = new Set(selectedPaths);
    return files.reduce((sum, file) => (
        selected.has(file.path) ? sum + (Number(file.size) || 0) : sum
    ), 0);
}
