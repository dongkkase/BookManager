export function resolveReadivePaths(menu, selectedEntries = []) {
    if (!menu) return [];
    if (menu.type === 'library' || (menu.type === 'folder' && menu.source !== 'list')) {
        return menu.folderPath ? [menu.folderPath] : [];
    }
    const selected = selectedEntries.map(entry => entry.full_path || entry.path).filter(Boolean);
    const fallback = menu.file?.full_path || menu.file?.path || menu.folderPath;
    return [...new Set(selected.length ? selected : fallback ? [fallback] : [])];
}

export function selectReadiveEntries(entries = [], excludedIds = []) {
    const excluded = new Set(excludedIds);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    return entries.filter(entry => {
        const visited = new Set();
        let current = entry;
        while (current) {
            if (excluded.has(current.id) || visited.has(current.id)) return false;
            visited.add(current.id);
            current = byId.get(current.parentId);
        }
        return !entry.unsupported && !entry.skippedReason;
    });
}

export function summarizeReadiveEntries(entries = []) {
    let files = 0;
    let folders = 0;
    let bytes = 0;
    let metadataBytes = 0;
    let coverBytes = 0;
    let unknownSize = false;
    for (const entry of entries) {
        if (entry.unsupported || entry.skippedReason) continue;
        if (entry.kind === 'directory') {
            folders += 1;
        } else if (!entry.unsupported) {
            files += 1;
            const sizes = [entry.size, entry.metadataBytes ?? 0, entry.coverBytes ?? 0];
            if (sizes.some(size => !Number.isSafeInteger(size) || size < 0)) unknownSize = true;
            else {
                bytes += sizes.reduce((sum, size) => sum + size, 0);
                metadataBytes += sizes[1];
                coverBytes += sizes[2];
            }
        }
    }
    return {
        files,
        folders,
        bytes,
        metadataBytes,
        coverBytes,
        large: files > 100 || folders > 30 || bytes > 2 * 1024 ** 3,
        blocked: unknownSize || files > 1000 || folders > 300 || bytes > 10 * 1024 ** 3,
    };
}

export function canEnqueueReadiveTransfer({ snapshot, summary, deviceId, destination, running, busy, largeConfirmed }) {
    return Boolean(snapshot?.id && !snapshot.blocked && summary && !summary.blocked
        && summary.files > 0 && deviceId && running && !busy
        && destination?.deviceId === deviceId && destination.name && destination.revision
        && (destination.collectionId === null || typeof destination.collectionId === 'string')
        && (!summary.large || largeConfirmed));
}

export function formatReadiveBytes(bytes = 0) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let value = bytes / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    return `${value.toFixed(1)} ${units[index]}`;
}
