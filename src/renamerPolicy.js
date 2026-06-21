function basename(filePath) {
    return String(filePath || '').split(/[\\/]/).pop() || '';
}

function extensionWithoutDot(filePath) {
    const match = basename(filePath).match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
}

function stem(filePath) {
    return basename(filePath).replace(/\.[^.]+$/, '');
}

function safeName(name, fallback = 'Page') {
    return String(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/^[._\-\s]+/, '')
        .trim() || fallback;
}

function paddingFor(totalCount) {
    if (totalCount < 100) return 2;
    if (totalCount < 1000) return 3;
    return 4;
}

export function generateRenamerName(entry, index, totalCount, options = {}) {
    const originalName = entry?.oldName || basename(entry?.originalPath);
    const originalExtension = originalName.match(/\.[^.]+$/)?.[0] || '.jpg';
    const extension = options.webpConversion ? '.webp' : originalExtension;
    if (options.keepName) return `${stem(originalName)}${extension}`;

    const number = Math.max(0, Number(options.startNum) || 0) + index;
    const padded = String(number).padStart(paddingFor(totalCount), '0');
    const archiveStem = safeName(options.archiveStem, 'Archive').replace(/\s+/g, '_');
    const customText = safeName(options.customText, 'Custom');

    if (options.patternIndex === 1) return index === 0 ? `Cover${extension}` : `Page_${padded}${extension}`;
    if (options.patternIndex === 2) return `${archiveStem}_${padded}${extension}`;
    if (options.patternIndex === 3) {
        return index === 0
            ? `${archiveStem}_Cover${extension}`
            : `${archiveStem}_Page_${padded}${extension}`;
    }
    if (options.patternIndex === 4) return `${customText}_${padded}${extension}`;
    return `${padded}${extension}`;
}

export function refreshRenamerItem(item, options = {}) {
    const archiveStem = stem(item?.filepath || item?.name);
    const entries = (item?.entries || []).map((entry, index, source) => ({
        ...entry,
        newName: generateRenamerName(entry, index, source.length, {
            ...options,
            archiveStem,
        }),
    }));
    return { ...item, entries, count: entries.length };
}

export function archiveChangeBadges(item, config = {}) {
    const badges = [];
    const currentExtension = extensionWithoutDot(item?.filepath || item?.name);
    const targetFormat = String(config?.target_format || config?.targetFormat || 'none')
        .replace(/^\./, '')
        .toLowerCase();

    if (targetFormat && targetFormat !== 'none' && currentExtension !== targetFormat) {
        badges.push({ key: 'format', label: targetFormat.toUpperCase() });
    }
    if (config?.webp_conversion || config?.webpConversion) {
        badges.push({ key: 'webp', label: 'WEBP' });
    }
    return badges;
}

export function moveRenamerEntry(entries, sourceIndex, targetIndex) {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return entries;
    if (sourceIndex >= entries.length || targetIndex >= entries.length) return entries;
    const next = [...entries];
    const [entry] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, entry);
    return next;
}

export function clampStartNumber(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(999999, parsed));
}
