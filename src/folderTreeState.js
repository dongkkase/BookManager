export function joinTreePath(parentPath, childName) {
    const parent = String(parentPath || '');
    const child = String(childName || '').replace(/^[\\/]+/, '');
    if (!parent) return child;
    const separator = parent.includes('\\') ? '\\' : '/';
    return `${parent.replace(/[\\/]+$/, '')}${separator}${child}`;
}

export function isSameOrDescendantPath(candidatePath, parentPath) {
    const rawCandidate = String(candidatePath || '').replace(/\\/g, '/');
    const rawParent = String(parentPath || '').replace(/\\/g, '/');
    const candidate = rawCandidate === '/' ? '/' : rawCandidate.replace(/\/+$/, '');
    const parent = rawParent === '/' ? '/' : rawParent.replace(/\/+$/, '');
    if (!candidate || !parent) return false;
    const caseInsensitive = /^[a-z]:/i.test(candidate) || candidate.startsWith('//');
    const normalizedCandidate = caseInsensitive ? candidate.toLowerCase() : candidate;
    const normalizedParent = caseInsensitive ? parent.toLowerCase() : parent;
    if (normalizedParent === '/') return normalizedCandidate.startsWith('/');
    return normalizedCandidate === normalizedParent
        || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

export function parentTreePath(folderPath) {
    if (!folderPath) return '';
    const separator = String(folderPath).includes('\\') ? '\\' : '/';
    const normalized = String(folderPath).replace(/[\\/]+$/, '');
    const lastSeparatorIndex = Math.max(
        normalized.lastIndexOf('/'),
        normalized.lastIndexOf('\\'),
    );
    if (lastSeparatorIndex < 0) return '';
    if (lastSeparatorIndex === 0) return separator;
    if (/^[A-Za-z]:$/.test(normalized.slice(0, lastSeparatorIndex))) {
        return `${normalized.slice(0, lastSeparatorIndex)}${separator}`;
    }
    return normalized.slice(0, lastSeparatorIndex);
}

export function resolveSelectionAfterDelete(deletedPath, siblingPaths = []) {
    const normalizedDeletedPath = String(deletedPath || '').replace(/\\/g, '/').toLowerCase();
    const deletedIndex = siblingPaths.findIndex(path => (
        String(path || '').replace(/\\/g, '/').toLowerCase() === normalizedDeletedPath
    ));
    if (deletedIndex < 0) return parentTreePath(deletedPath);
    return siblingPaths[deletedIndex + 1]
        || siblingPaths[deletedIndex - 1]
        || parentTreePath(deletedPath);
}

export function ancestorPathsBetween(rootPath, targetPath) {
    if (!isSameOrDescendantPath(targetPath, rootPath)) return [];
    const separator = String(rootPath).includes('\\') ? '\\' : '/';
    const root = String(rootPath).replace(/[\\/]+$/, '');
    const target = String(targetPath).replace(/[\\/]+$/, '');
    const relative = target.slice(root.length).replace(/^[\\/]+/, '');
    if (!relative) return [rootPath];

    const paths = [rootPath];
    let current = root;
    for (const segment of relative.split(/[\\/]/).filter(Boolean)) {
        current = `${current}${separator}${segment}`;
        paths.push(current);
    }
    return paths;
}

export function chooseTreeRoot(roots = [], targetPath = '') {
    return roots
        .filter(root => isSameOrDescendantPath(targetPath, root.path))
        .sort((a, b) => String(b.path).length - String(a.path).length)[0] || null;
}
