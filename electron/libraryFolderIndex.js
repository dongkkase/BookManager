import path from 'path';

const folderPathCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

export function folderDisplayName(folderPath) {
    const base = path.basename(folderPath);
    return base || folderPath;
}

function isPathInsideOrEqual(childPath, parentPath) {
    const relativePath = path.relative(parentPath, childPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function addLibraryFolderIndexRecord(folderMap, libraryPath, folderPath, lastSeenAt) {
    const normalizedFolderPath = path.resolve(folderPath);
    const existingRecord = folderMap.get(normalizedFolderPath);
    if (existingRecord) return existingRecord;
    if (!isPathInsideOrEqual(normalizedFolderPath, libraryPath)) return null;

    const missingFolders = [];
    let currentPath = normalizedFolderPath;
    while (!folderMap.has(currentPath)) {
        missingFolders.push(currentPath);
        if (currentPath === libraryPath) break;
        currentPath = path.dirname(currentPath);
    }
    for (let index = missingFolders.length - 1; index >= 0; index -= 1) {
        const missingPath = missingFolders[index];
        const isRoot = missingPath === libraryPath;
        folderMap.set(missingPath, {
            library_path: libraryPath,
            folder_path: missingPath,
            parent_path: isRoot ? '' : path.dirname(missingPath),
            name: folderDisplayName(missingPath),
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
        const currentPath = path.dirname(path.resolve(filePath));
        const directFolder = addLibraryFolderIndexRecord(folderMap, normalizedLibraryPath, currentPath, lastSeenAt);
        if (directFolder) directFolder.direct_file_count += 1;
    }

    const records = [...folderMap.values()];
    // Parents are inserted first, so reverse traversal aggregates each subtree once.
    for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        record.recursive_file_count += record.direct_file_count;
        if (!record.parent_path) continue;
        const parent = folderMap.get(record.parent_path);
        if (parent) {
            parent.child_folder_count += 1;
            parent.recursive_file_count += record.recursive_file_count;
        }
    }

    return records.sort((left, right) => (
        folderPathCollator.compare(left.folder_path, right.folder_path)
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
