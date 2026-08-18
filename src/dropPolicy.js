export const SUPPORTED_ARCHIVE_EXTENSIONS = Object.freeze([
    '.zip',
    '.cbz',
    '.cbr',
    '.7z',
    '.rar',
]);

export const SUPPORTED_DOCUMENT_DROP_EXTENSIONS = Object.freeze([
    '.epub',
    '.pdf',
]);

export const SUPPORTED_AUDIO_DROP_EXTENSIONS = Object.freeze([
    '.3gp',
    '.aac',
    '.aif',
    '.aiff',
    '.amr',
    '.caf',
    '.flac',
    '.m4a',
    '.m4b',
    '.mp3',
    '.oga',
    '.ogg',
    '.opus',
    '.wav',
    '.wave',
    '.webm',
]);

const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_ARCHIVE_EXTENSIONS);
const SUPPORTED_DOCUMENT_DROP_EXTENSION_SET = new Set(SUPPORTED_DOCUMENT_DROP_EXTENSIONS);
const SUPPORTED_AUDIO_DROP_EXTENSION_SET = new Set(SUPPORTED_AUDIO_DROP_EXTENSIONS);

function normalizedFileExtension(filePath) {
    const normalized = String(filePath || '')
        .normalize('NFC')
        .replace(/[\s"'“”‘’\u200b-\u200f\u202a-\u202e\u2060\ufeff]+$/giu, '')
        .toLowerCase();
    const match = normalized.match(/\.[^./\\]+$/);
    return match?.[0]?.trim() || '';
}

export function isSupportedArchivePath(filePath) {
    return SUPPORTED_EXTENSION_SET.has(normalizedFileExtension(filePath));
}

export function isSupportedDocumentDropPath(filePath) {
    return SUPPORTED_DOCUMENT_DROP_EXTENSION_SET.has(normalizedFileExtension(filePath));
}

export function isSupportedAudioDropPath(filePath) {
    return SUPPORTED_AUDIO_DROP_EXTENSION_SET.has(normalizedFileExtension(filePath));
}

export function isSupportedDroppedFilePath(filePath, options = {}) {
    return isSupportedArchivePath(filePath)
        || Boolean(options.includeDocuments && (
            isSupportedDocumentDropPath(filePath)
            || isSupportedAudioDropPath(filePath)
        ));
}

export function classifyDroppedEntries(entries = [], options = {}) {
    const folders = [];
    const files = [];
    const unsupported = [];

    for (const entry of entries) {
        const filePath = String(entry?.path || '');
        if (!filePath) continue;
        if (entry.isDirectory) {
            folders.push(filePath);
        } else if (entry.isFile && isSupportedDroppedFilePath(filePath, options)) {
            files.push(filePath);
        } else {
            unsupported.push(filePath);
        }
    }

    return { folders, files, unsupported };
}

function parentPath(filePath) {
    const value = String(filePath || '');
    const splitAt = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return splitAt > 0 ? value.slice(0, splitAt) : '';
}

function uniquePaths(paths) {
    return [...new Set(paths.filter(Boolean))];
}

export function resolveMetadataDropPaths(classified, choice) {
    if (choice === 'cancel') return [];
    if (choice === 'yes') {
        return uniquePaths([
            ...(classified.folders || []),
            ...(classified.files || []).map(parentPath),
        ]);
    }
    return uniquePaths([
        ...(classified.files || []),
        ...(classified.folders || []),
    ]);
}
