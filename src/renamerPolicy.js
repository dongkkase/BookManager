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
    const sourceEntries = item?.entries || [];
    const activeCount = sourceEntries.filter(entry => !entry.deleteChecked).length;
    let activeIndex = 0;
    const entries = sourceEntries.map((entry) => {
        if (entry.deleteChecked) {
            return { ...entry, newName: '' };
        }

        const nextEntry = {
            ...entry,
            newName: generateRenamerName(entry, activeIndex, activeCount, {
                ...options,
                archiveStem,
            }),
        };
        activeIndex += 1;
        return nextEntry;
    });
    return { ...item, entries, count: activeCount };
}

export function toggleRenamerEntryDelete(entries = [], entryId) {
    return entries.map(entry => (
        entry.id === entryId
            ? { ...entry, deleteChecked: !entry.deleteChecked }
            : entry
    ));
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

function clampPatternIndex(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(4, parsed));
}

export function normalizeRenamerOptionsFromConfig(config = {}) {
    return {
        patternIndex: clampPatternIndex(config?.patternIndex ?? config?.rename_pattern_idx),
        customText: String(config?.customText ?? config?.custom_text ?? ''),
        keepName: Boolean(config?.keepName ?? config?.keep_internal_name),
        startNum: clampStartNumber(config?.startNum ?? config?.start_num),
    };
}

export function serializeRenamerOptions(options = {}) {
    return {
        rename_pattern_idx: clampPatternIndex(options.patternIndex),
        custom_text: String(options.customText || ''),
        keep_internal_name: Boolean(options.keepName),
        start_num: clampStartNumber(options.startNum),
    };
}

export function renamerOptionsEqual(left = {}, right = {}) {
    const normalizedLeft = normalizeRenamerOptionsFromConfig(left);
    const normalizedRight = normalizeRenamerOptionsFromConfig(right);
    return normalizedLeft.patternIndex === normalizedRight.patternIndex
        && normalizedLeft.customText === normalizedRight.customText
        && normalizedLeft.keepName === normalizedRight.keepName
        && normalizedLeft.startNum === normalizedRight.startNum;
}

export function normalizeRenamerBatchOptionsFromConfig(config = {}) {
    return {
        capOpt: Boolean(config?.capOpt ?? config?.renamer_default_cap_opt),
        exifOpt: Boolean(config?.exifOpt ?? config?.renamer_default_exif_opt),
    };
}

export function serializeRenamerBatchOptions(options = {}) {
    return {
        renamer_default_cap_opt: Boolean(options.capOpt),
        renamer_default_exif_opt: Boolean(options.exifOpt),
    };
}
