const MAX_RENAME_PAIRS = 128;
const MAX_COMMAND_BYTES = 16 * 1024;

function commandArgumentSize(value) {
    // 인용과 이스케이프에 필요한 공간도 보수적으로 포함합니다.
    return Buffer.byteLength(String(value), 'utf8') * 2 + 3;
}

function entryKey(value) {
    return String(value).replace(/\\/g, '/').normalize('NFC').toLowerCase();
}

function needsLegacyBatches(pairs, entries) {
    const occupiedPaths = new Set(entries.map(entry => entryKey(entry.name)));
    const sourcePaths = new Set(pairs.map(pair => entryKey(pair.oldPath)));
    const targetPaths = new Set();
    if (sourcePaths.size !== pairs.length) return true;

    for (const pair of pairs) {
        const target = entryKey(pair.newPath);
        if (sourcePaths.has(target) || occupiedPaths.has(target) || targetPaths.has(target)
            || /[*?]/.test(pair.oldPath) || /[*?]/.test(pair.newPath)) return true;
        targetPaths.add(target);
    }
    return false;
}

export function createOrganizerRenameBatches(pairs, command, archivePath, entries = []) {
    if (needsLegacyBatches(pairs, entries)) {
        // 이름이 서로 영향을 줄 수 있으면 기존 순서와 20개 경계를 보존합니다.
        const batches = [];
        for (let index = 0; index < pairs.length; index += 20) batches.push(pairs.slice(index, index + 20));
        return batches;
    }

    const baseSize = [command, 'rn', archivePath].reduce((sum, arg) => sum + commandArgumentSize(arg), 0);
    const batches = [];
    let batch = [];
    let commandSize = baseSize;
    for (const pair of pairs) {
        const pairSize = commandArgumentSize(pair.oldPath) + commandArgumentSize(pair.newPath);
        if (batch.length > 0 && (batch.length >= MAX_RENAME_PAIRS || commandSize + pairSize > MAX_COMMAND_BYTES)) {
            batches.push(batch);
            batch = [];
            commandSize = baseSize;
        }
        batch.push(pair);
        commandSize += pairSize;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
}
