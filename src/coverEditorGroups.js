export function coverEditorFolder(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/').normalize('NFC');
    const separator = normalized.lastIndexOf('/');
    const path = separator < 0 ? '' : normalized.slice(0, separator) || '/';
    const key = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? path.toLowerCase() : path;
    return { key, path, name: path.split('/').filter(Boolean).at(-1) || path };
}

export function groupCoverEditorEntries(entries) {
    const groups = new Map();
    entries.forEach((entry, index) => {
        const folder = coverEditorFolder(entry.filePath);
        if (!groups.has(folder.key)) groups.set(folder.key, { ...folder, entries: [] });
        groups.get(folder.key).entries.push({ entry, index });
    });
    return [...groups.values()];
}
