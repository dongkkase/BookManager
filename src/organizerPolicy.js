const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const ORGANIZER_INCOMPLETE_MARKERS = ['(미완)', '(미완)'.normalize('NFD')];

export function defaultOutputPath(filePath) {
    const value = String(filePath || '');
    const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return index >= 0 ? value.slice(0, index) : '';
}

function organizerPathKey(value, platform) {
    const normalized = /^win/i.test(platform) ? String(value).replace(/\\/g, '/').toLowerCase() : String(value);
    return /^(mac|darwin)/i.test(platform) ? normalized.normalize('NFC') : normalized;
}

export function groupOrganizerItems(items = [], platform = '') {
    const isWindows = /^win/i.test(platform);
    const canonicalPath = value => organizerPathKey(value, platform);
    const groups = new Map();

    items.forEach((item, index) => {
        const filePath = String(item.filepath || '');
        const separatorIndex = isWindows
            ? Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
            : filePath.lastIndexOf('/');
        const isDriveRoot = isWindows && separatorIndex === 2 && /^[a-z]:/i.test(filePath);
        const directoryPath = separatorIndex < 0
            ? ''
            : separatorIndex === 0 || isDriveRoot
                ? filePath.slice(0, separatorIndex + 1)
                : filePath.slice(0, separatorIndex);
        const directoryKey = directoryPath
            ? canonicalPath(directoryPath)
            : `item:${index}:${String(item.id || '')}`;
        const seriesTitle = String(item.series_title || item.core_title || item.clean_title || '').normalize('NFC').trim();
        const seriesKey = seriesTitle.replace(/\s+/g, '').toLowerCase();
        const id = seriesKey
            ? `organizer-series:${JSON.stringify([directoryKey, seriesKey])}`
            : `organizer-directory:${directoryKey}`;

        if (!groups.has(id)) {
            const directoryParts = directoryPath.split(isWindows ? /[\\/]/ : /\//).filter(Boolean);
            const basename = directoryParts.at(-1) || '';
            groups.set(id, {
                id,
                directoryPath,
                directoryKey,
                seriesTitle,
                name: seriesTitle || ((!basename || (isWindows && /^[a-z]:$/i.test(basename)))
                    ? directoryPath || item.name || filePath || String(item.id || '')
                    : basename),
                items: [],
                volumes: [],
            });
        }
        const group = groups.get(id);
        group.items.push(item);
        for (const volume of item.volumes || []) group.volumes.push({ item, volume });
    });

    return [...groups.values()].map(group => {
        const outPath = String(group.items[0].out_path || '');
        const mixedOutPaths = group.items.some(item => canonicalPath(String(item.out_path || '')) !== canonicalPath(outPath));
        const checked = group.items.every(item => item.checked !== false);
        return {
            ...group,
            out_path: mixedOutPaths ? '' : outPath,
            mixedOutPaths,
            checked,
            partiallyChecked: !checked && group.items.some(item => item.checked !== false),
            size_mb: group.items.reduce((sum, item) => {
                const size = Number(item.size_mb);
                return sum + (Number.isFinite(size) ? size : 0);
            }, 0),
        };
    });
}

export function assignOrganizerSeriesOutputPaths(items = [], platform = '') {
    const groups = groupOrganizerItems(items, platform);
    const directoryCounts = new Map();
    for (const group of groups) {
        directoryCounts.set(group.directoryKey, (directoryCounts.get(group.directoryKey) || 0) + 1);
    }
    const outputPaths = new Map();
    const usedFolderNames = new Map();
    for (const group of groups) {
        if (!group.directoryPath || !group.seriesTitle || directoryCounts.get(group.directoryKey) < 2) continue;
        if (!usedFolderNames.has(group.directoryKey)) usedFolderNames.set(group.directoryKey, new Set());
        const usedNames = usedFolderNames.get(group.directoryKey);
        const baseName = sanitizeOrganizerName(group.seriesTitle) || '제목없음_수정필요';
        let folderName = baseName;
        let suffix = 2;
        while (usedNames.has(folderName.normalize('NFC').toLowerCase())) {
            folderName = `${baseName} (${suffix})`;
            suffix += 1;
        }
        usedNames.add(folderName.normalize('NFC').toLowerCase());
        const separator = /^win/i.test(platform) && group.directoryPath.includes('\\') ? '\\' : '/';
        const outputPath = `${group.directoryPath.replace(/[\\/]$/, '')}${separator}${folderName}`;
        for (const item of group.items) {
            const isDefaultPath = !item.out_path || organizerPathKey(item.out_path, platform)
                === organizerPathKey(group.directoryPath, platform);
            if (!item.out_path_user_set && (item.out_path_auto || isDefaultPath)) outputPaths.set(item, outputPath);
        }
    }
    return items.map(item => {
        const outputPath = outputPaths.get(item);
        return outputPath && (item.out_path !== outputPath || !item.out_path_auto)
            ? { ...item, out_path: outputPath, out_path_auto: true }
            : item;
    });
}

export function titleOutputPath(item, seriesTitle = '') {
    const base = defaultOutputPath(item?.filepath);
    const title = String(seriesTitle || item?.series_title || item?.clean_title || '').trim();
    const folderName = !title || title === '제목없음' ? '제목없음_수정필요' : title;
    const separator = base.includes('\\') ? '\\' : '/';
    return `${base}${separator}${folderName}`;
}

export function filenameOutputPath(item) {
    const filePath = String(item?.filepath || '');
    const base = defaultOutputPath(filePath);
    const separator = base.includes('\\') ? '\\' : '/';
    const filename = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
    const dotIndex = filename.lastIndexOf('.');
    const folderName = (dotIndex > 0 ? filename.slice(0, dotIndex) : filename).trim() || '파일명_수정필요';
    return `${base}${separator}${folderName}`;
}

export function sanitizeOrganizerName(name) {
    return String(name || '')
        .replace(INVALID_FILENAME_CHARS, '_')
        .replace(/^[._\-\s]+/, '')
        .trim();
}

export function targetExtension(item, targetFormat) {
    if (targetFormat && targetFormat !== 'none') return `.${String(targetFormat).replace(/^\./, '').toLowerCase()}`;
    if (item?.type === 'archive' && item?.source_ext) return String(item.source_ext).toLowerCase();
    if (item?.type === 'archive') {
        const match = String(item?.inner_path || item?.original_path || '').match(/\.[^.\\/]+$/);
        if (match) return match[0].toLowerCase();
    }
    return '.zip';
}

export function changeOrganizerUnit(name, unit, lang = 'ko') {
    const match = String(name || '').match(/^(.*?)\s*(?:v|c)?([\d.\-~]+)\s*(?:권|화|巻|話|vol\.?|ch\.?|volume|chapter)?(?:\s*(외전|번외|side\s*story|spin[\s-]*off|special|특별편|한정판|limited(?:\s+edition)?))?\s*$/i);
    if (!match) return String(name || '').trim();
    let base = match[1].trim();
    const number = match[2].trim();
    const tail = (match[3] || '').trim();
    if (tail) base = `${base} ${tail}`.trim();
    const suffix = lang === 'en'
        ? (unit === 'chapter' ? 'c' : 'v')
        : lang === 'ja'
            ? (unit === 'chapter' ? '話' : '巻')
            : (unit === 'chapter' ? '화' : '권');
    if (lang === 'en') return base ? `${base} ${suffix}${number}` : `${suffix}${number}`;
    return base ? `${base} ${number}${suffix}` : `${number}${suffix}`;
}

export function organizerOriginalFilenameName(volume, item) {
    const isRootFiles = !volume?.inner_path && volume?.type !== 'folder'
        && (volume?.original_path || volume?.original_basename) === 'Root_Files';
    if (isRootFiles) {
        const sourcePath = String(item?.filepath || item?.name || '').replace(/\\/g, '/');
        const filename = sourcePath.split('/').at(-1) || '';
        const extensionIndex = filename.lastIndexOf('.');
        const originalName = (extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename).trim();
        return originalName || String(volume?.extracted_name || volume?.new_name || '').trim();
    }
    return String(volume?.original_basename || volume?.original_path || volume?.new_name || '').trim();
}

export function organizerExtractedTitleName(volume) {
    return String(volume?.extracted_name || volume?.new_name || '').trim();
}

function organizerVolumeToken(value) {
    const text = String(value || '').normalize('NFC');
    const volumeMatches = [...text.matchAll(/(?:(?:제\s*)?\d+(?:\.\d+)?(?:\s*권)?\s*[~～\-–—]\s*(?:제\s*)?\d+(?:\.\d+)?\s*권|(?:제\s*)?\d+(?:\.\d+)?\s*권)(?![가-힣A-Za-z0-9])/gu)];
    return volumeMatches.at(-1)?.[0].trim() || '';
}

function organizerVolumeTokenKey(value) {
    const numbers = organizerVolumeToken(value).match(/\d+(?:\.\d+)?/g) || [];
    return numbers.map(number => String(Number(number))).join('~');
}

function stripOrganizerIncompleteMarkers(value) {
    return ORGANIZER_INCOMPLETE_MARKERS.reduce(
        (text, marker) => text.split(marker).join(''),
        String(value || ''),
    );
}

export function organizerFolderName(item, volume) {
    const parentPath = defaultOutputPath(item?.filepath).replace(/\\/g, '/');
    const pathParts = parentPath.split('/').filter(Boolean);
    const folderName = pathParts.at(-1) || '';
    if (!folderName || /^[a-z]:$/i.test(folderName)) return '';
    const withoutIncompleteMarker = stripOrganizerIncompleteMarkers(folderName);
    if (!withoutIncompleteMarker.trim()) return '';

    const filePath = String(item?.filepath || '').replace(/\\/g, '/');
    const fileName = filePath.split('/').filter(Boolean).at(-1) || item?.name || '';
    const originalPath = String(volume?.original_path || '').replace(/\\/g, '/');
    const originalPathLeaf = originalPath.split('/').filter(Boolean).at(-1) || '';
    let volumeToken = [
        volume?.original_basename,
        volume?.original_path,
    ].map(organizerVolumeToken).find(Boolean);
    const canUseFileName = volume?.original_basename === 'Root_Files'
        || originalPathLeaf === 'Root_Files'
        || item?.volumes?.length === 1;
    if (!volumeToken && canUseFileName) volumeToken = organizerVolumeToken(fileName);
    if (!volumeToken) return withoutIncompleteMarker;
    const folderVolumeKey = organizerVolumeTokenKey(withoutIncompleteMarker);
    if (folderVolumeKey && folderVolumeKey === organizerVolumeTokenKey(volumeToken)) {
        return withoutIncompleteMarker;
    }
    const separator = /\s$/u.test(withoutIncompleteMarker) ? '' : ' ';
    return `${withoutIncompleteMarker}${separator}${volumeToken}`;
}

export function preserveOrganizerExtractedTitle(volume) {
    const extractedName = organizerExtractedTitleName(volume);
    if (!extractedName || volume?.extracted_name === extractedName) return volume;
    return { ...volume, extracted_name: extractedName };
}

export function removeOrganizerItems(items, ids) {
    const removeIds = new Set(ids || []);
    const firstIndex = items.findIndex(item => removeIds.has(item.id));
    const nextItems = items.filter(item => !removeIds.has(item.id));
    const nextSelectedId = nextItems.length === 0 || firstIndex < 0
        ? ''
        : nextItems[Math.min(firstIndex, nextItems.length - 1)].id;
    return { items: nextItems, nextSelectedId };
}
