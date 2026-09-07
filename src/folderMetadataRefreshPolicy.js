import { normalizeLibraryKey } from './folderLibraryStatus.js';
import { parentPath } from './utils/folderPath.js';

const FOLDER_PREVIEW_MAX_DEPTH = 3;

export function hasMetadataSavedPathForFolder({
    paths = [],
    selectedFolderPath = '',
    includeSubfolders = false,
    includeFolderPreviews = false,
    platform,
} = {}) {
    if (!selectedFolderPath || !Array.isArray(paths) || paths.length === 0) return false;
    const folderKey = normalizeLibraryKey(selectedFolderPath, platform);
    if (!folderKey) return false;

    return paths.some(filePath => {
        const fileKey = normalizeLibraryKey(filePath, platform);
        if (!fileKey) return false;
        if (includeSubfolders) return fileKey === folderKey || fileKey.startsWith(`${folderKey}/`);
        const parent = parentPath(filePath);
        if (normalizeLibraryKey(parent, platform) === folderKey) return true;
        if (!includeFolderPreviews || !fileKey.startsWith(`${folderKey}/`)) return false;
        const relativeSegments = fileKey.slice(folderKey.length + 1).split('/');
        return relativeSegments.length <= FOLDER_PREVIEW_MAX_DEPTH + 2;
    });
}
