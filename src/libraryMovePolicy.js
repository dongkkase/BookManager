function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).pop() || '';
}

function parentPath(filePath) {
    const value = String(filePath || '');
    const separatorIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return separatorIndex >= 0 ? value.slice(0, separatorIndex) : '';
}

function joinPath(base, ...parts) {
    const separator = String(base || '').includes('\\') ? '\\' : '/';
    const normalizedBase = String(base || '').replace(/[\\/]+$/, '');
    return [normalizedBase, ...parts.map(part => String(part || '').replace(/^[\\/]+|[\\/]+$/g, ''))]
        .filter(Boolean)
        .join(separator);
}

export function createLibraryMovePlans(sources, targetLibrary, options = {}) {
    const { createCurrentFolder = true, folderMode = false } = options;
    return (sources || []).map(source => {
        const sourcePath = source?.full_path || source?.path || source?.src || source;
        const sourceName = basename(sourcePath);
        const currentFolder = basename(parentPath(sourcePath));
        const destination = folderMode
            ? joinPath(targetLibrary, sourceName)
            : joinPath(targetLibrary, ...(createCurrentFolder ? [currentFolder] : []), sourceName);
        return {
            src: sourcePath,
            dest: destination,
            targetLibrary,
            folderMode,
            cleanupRoot: folderMode ? '' : parentPath(sourcePath),
        };
    }).filter(plan => plan.src && plan.dest);
}

export function applyConflictChoice(plan, choice) {
    if (!['overwrite', 'rename', 'skip'].includes(choice)) return plan;
    return { ...plan, conflictAction: choice };
}
