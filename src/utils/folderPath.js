export function parentPath(filePath) {
    const parts = String(filePath || '').split(/[\\/]/);
    parts.pop();
    return parts.join('/') || '';
}

export function replaceBasename(filePath, nextName) {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return separatorIndex >= 0 ? `${value.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

export function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).pop() || '';
}

export function joinPath(base, ...parts) {
    const separator = String(base || '').includes('\\') ? '\\' : '/';
    return [String(base || '').replace(/[\\/]+$/, ''), ...parts.map(part => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
        .filter(Boolean)
        .join(separator);
}
