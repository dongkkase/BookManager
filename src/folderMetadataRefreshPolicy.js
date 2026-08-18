import { normalizeLibraryKey } from './folderLibraryStatus.js';
import { parentPath } from './utils/folderPath.js';

export function hasMetadataSavedPathForFolder({
    paths = [],
    selectedFolderPath = '',
    includeSubfolders = false,
    platform,
} = {}) {
    if (!selectedFolderPath || !Array.isArray(paths) || paths.length === 0) return false;
    const folderKey = normalizeLibraryKey(selectedFolderPath, platform);
    if (!folderKey) return false;

    return paths.some(filePath => {
        const fileKey = normalizeLibraryKey(filePath, platform);
        if (!fileKey) return false;
        if (includeSubfolders) return fileKey === folderKey || fileKey.startsWith(`${folderKey}/`);
        return normalizeLibraryKey(parentPath(filePath), platform) === folderKey;
    });
}
