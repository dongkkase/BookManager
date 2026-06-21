import { normalizeNativePath, normalizeNativePaths } from './pathPolicy.js';
import { getCurrentLanguage, translate } from '../src/utils/i18n.js';

export const ARCHIVE_FILTER = Object.freeze({
    name: 'Archive files',
    extensions: Object.freeze(['zip', 'cbz', 'cbr', '7z', 'rar']),
});

export function createFolderDialogOptions(title) {
    return {
        title: title || translate('dialog_select_folder', getCurrentLanguage()),
        properties: ['openDirectory'],
    };
}

export function createArchiveDialogOptions(title) {
    return {
        title: title || translate('dialog_select_file', getCurrentLanguage()),
        properties: ['openFile', 'multiSelections'],
        filters: [ARCHIVE_FILTER],
    };
}

export function normalizeFolderDialogResult(result = {}, platform = process.platform) {
    if (result.canceled) return null;
    return normalizeNativePath(result.filePaths?.[0], platform) || null;
}

export function normalizeArchiveDialogResult(result = {}, platform = process.platform) {
    if (result.canceled) return [];
    return normalizeNativePaths(result.filePaths, platform);
}

export function normalizeFileDialogResult(result = {}, platform = process.platform) {
    if (result.canceled) return null;
    return normalizeNativePath(result.filePaths?.[0], platform) || null;
}

export function normalizeFilesDialogResult(result = {}, platform = process.platform) {
    if (result.canceled) return [];
    return normalizeNativePaths(result.filePaths, platform);
}

export function normalizeSaveDialogResult(result = {}, platform = process.platform) {
    if (result.canceled) return null;
    return normalizeNativePath(result.filePath, platform) || null;
}
