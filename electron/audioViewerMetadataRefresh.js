import path from 'path';

export function normalizeAudioViewerMetadataPath(filePath = '', platform = process.platform) {
    const value = String(filePath || '').trim();
    if (!value) return '';
    const pathApi = platform === 'win32' ? path.win32 : path;
    const normalized = pathApi.resolve(value)
        .replace(/\\/g, '/')
        .normalize('NFC');
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function audioSessionMatchesSuccessfulPath(session, successfulPaths = [], platform = process.platform) {
    if (session?.type !== 'audio') return false;
    const sessionPath = normalizeAudioViewerMetadataPath(session.filePath, platform);
    if (!sessionPath) return false;
    return (Array.isArray(successfulPaths) ? successfulPaths : [])
        .some(filePath => normalizeAudioViewerMetadataPath(filePath, platform) === sessionPath);
}
