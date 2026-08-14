const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const ORGANIZER_INCOMPLETE_MARKERS = ['(미완)', '(미완)'.normalize('NFD')];

export function defaultOutputPath(filePath) {
    const value = String(filePath || '');
    const index = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return index >= 0 ? value.slice(0, index) : '';
}

export function titleOutputPath(item) {
    const base = defaultOutputPath(item?.filepath);
    const title = String(item?.clean_title || '').trim();
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

export function organizerOriginalFilenameName(volume) {
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
