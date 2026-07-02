import path from 'path';

export function folderDisplayName(folderPath) {
    const base = path.basename(folderPath);
    return base || folderPath;
}

function isPathInsideOrEqual(childPath, parentPath) {
    const relativePath = path.relative(parentPath, childPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function addLibraryFolderIndexRecord(folderMap, libraryPath, folderPath, lastSeenAt) {
    const normalizedLibraryPath = path.resolve(libraryPath);
    const normalizedFolderPath = path.resolve(folderPath);
    if (!isPathInsideOrEqual(normalizedFolderPath, normalizedLibraryPath)) return null;

    const isRoot = normalizedFolderPath === normalizedLibraryPath;
    const parentPath = isRoot ? '' : path.dirname(normalizedFolderPath);
    if (!isRoot && parentPath && parentPath !== normalizedFolderPath) {
        addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, parentPath, lastSeenAt);
    }
    if (!folderMap.has(normalizedFolderPath)) {
        folderMap.set(normalizedFolderPath, {
            library_path: normalizedLibraryPath,
            folder_path: normalizedFolderPath,
            parent_path: isRoot ? '' : parentPath,
            name: folderDisplayName(normalizedFolderPath),
            child_folder_count: 0,
            direct_file_count: 0,
            recursive_file_count: 0,
            last_seen_at: lastSeenAt,
        });
    }
    return folderMap.get(normalizedFolderPath);
}

export function buildLibraryFolderIndexRecords(libraryPath, directoryPaths = [], filePaths = []) {
    const normalizedLibraryPath = path.resolve(libraryPath);
    const lastSeenAt = new Date().toISOString();
    const folderMap = new Map();
    addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, normalizedLibraryPath, lastSeenAt);

    for (const folderPath of directoryPaths || []) {
        if (!folderPath) continue;
        addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, folderPath, lastSeenAt);
    }

    for (const filePath of filePaths || []) {
        if (!filePath) continue;
        let currentPath = path.dirname(path.resolve(filePath));
        const directFolder = addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, currentPath, lastSeenAt);
        if (directFolder) directFolder.direct_file_count += 1;
        while (currentPath && isPathInsideOrEqual(currentPath, normalizedLibraryPath)) {
            const record = addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, currentPath, lastSeenAt);
            if (record) record.recursive_file_count += 1;
            if (currentPath === normalizedLibraryPath) break;
            const parentPath = path.dirname(currentPath);
            if (!parentPath || parentPath === currentPath) break;
            currentPath = parentPath;
        }
    }

    for (const record of folderMap.values()) {
        if (!record.parent_path) continue;
        const parent = folderMap.get(record.parent_path);
        if (parent) parent.child_folder_count += 1;
    }

    return [...folderMap.values()].sort((left, right) => (
        left.folder_path.localeCompare(right.folder_path, 'ko', { numeric: true, sensitivity: 'base' })
    ));
}

export function normalizeLibraryFolderForRenderer(row = {}) {
    const folderPath = row.folder_path || row.folderPath || row.path || '';
    return {
        name: row.name || folderDisplayName(folderPath),
        path: folderPath,
        isFolder: true,
        childFolderCount: Number(row.child_folder_count ?? row.childFolderCount) || 0,
        directFileCount: Number(row.direct_file_count ?? row.directFileCount) || 0,
        recursiveFileCount: Number(row.recursive_file_count ?? row.recursiveFileCount) || 0,
        lastSeenAt: row.last_seen_at || row.lastSeenAt || '',
    };
}
