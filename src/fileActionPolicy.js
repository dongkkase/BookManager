export function protectedRenameName(oldName, inputName) {
    const oldValue = String(oldName || '');
    const nextValue = String(inputName || '').trim();
    if (!nextValue) return { valid: false, reason: 'empty', name: oldValue };

    const oldDot = oldValue.lastIndexOf('.');
    const oldExtension = oldDot > 0 ? oldValue.slice(oldDot) : '';
    const nextDot = nextValue.lastIndexOf('.');
    const nextExtension = nextDot > 0 ? nextValue.slice(nextDot) : '';

    if (oldExtension && !nextExtension) {
        return { valid: true, protected: true, name: `${nextValue}${oldExtension}` };
    }
    if (oldExtension && nextExtension.toLowerCase() !== oldExtension.toLowerCase()) {
        return { valid: false, reason: 'extension', name: oldValue };
    }
    return { valid: nextValue !== oldValue, reason: nextValue === oldValue ? 'same' : '', name: nextValue };
}

export function fileOperationErrorKind(error = {}) {
    const code = String(error.code || '');
    const message = String(error.message || '');
    if (code === 'EACCES' || code === 'EPERM' || /permission|access denied|권한/i.test(message)) {
        return 'permission';
    }
    if (code === 'EEXIST' || /already exists|이미 존재|동일한 이름/i.test(message)) {
        return 'duplicate';
    }
    return 'general';
}

export function folderEntryOperationTargets(entries = []) {
    const normalizePath = value => {
        const path = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
        return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
    };
    const uniqueEntries = new Map();
    for (const entry of entries) {
        const key = normalizePath(entry?.full_path || entry?.path);
        if (key && !uniqueEntries.has(key)) uniqueEntries.set(key, entry);
    }
    const folders = [...uniqueEntries.entries()]
        .filter(([, entry]) => entry.isDirectory)
        .map(([key]) => key);
    return [...uniqueEntries.entries()]
        .filter(([key]) => !folders.some(folder => key !== folder && key.startsWith(`${folder}/`)))
        .map(([, entry]) => entry);
}

export function createSeriesMovePlans(files = [], getSeriesName) {
    return files.flatMap(file => {
        const source = file.full_path || file.path;
        const series = getSeriesName(file);
        if (!source || !series) return [];
        const separatorIndex = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
        const parent = source.slice(0, separatorIndex);
        const separator = source.includes('\\') ? '\\' : '/';
        return [{
            src: source,
            dest: `${parent}${separator}${series}${separator}${source.slice(separatorIndex + 1)}`,
        }];
    });
}
