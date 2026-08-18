export function normalizeMetadataFilePath(filePath = '') {
    const normalized = String(filePath || '')
        .trim()
        .replace(/\\/g, '/')
        .normalize('NFC');
    if (!normalized) return '';
    return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
        ? normalized.toLocaleLowerCase()
        : normalized;
}

export function successfulAudioCoverTargets(saveTargets = [], successPaths = []) {
    const successfulPathKeys = new Set(
        successPaths.map(normalizeMetadataFilePath).filter(Boolean),
    );
    return saveTargets.filter(item => (
        item?.bookType === 'audio'
        && item.audioCoverChange
        && successfulPathKeys.has(normalizeMetadataFilePath(item.filepath || item.path))
    ));
}
