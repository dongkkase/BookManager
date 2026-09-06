import { normalizeMetadataFilePath } from './audiobookCoverPolicy.js';
import { extractCoreTitle, extractVolNumbers } from './utils/folderUtils.js';

export function isTxtMetadataItem(item = {}) {
    return item?.metadataStorage === 'database'
        || /\.txt$/i.test(String(item?.filepath || item?.path || item?.name || '').trim());
}

export function shouldAutoUseTxtSearchCover(item) {
    return isTxtMetadataItem(item)
        && (item.hasTextMetadata === false || !hasTxtMetadataDetails(item))
        && !item.txtCoverChange
        && !item.textCoverPath
        && !item.coverOverridePath
        && !item.coverDataUrl;
}

function hasTxtMetadataDetails(item) {
    const metadata = item.originalMetadata || item.metadata || {};
    const filename = String(item.name || item.filepath || item.path || '')
        .split(/[\\/]/).pop().normalize('NFC');
    const title = filename.replace(/\.[^.]+$/, '').trim();
    const series = extractCoreTitle(title);
    const volumes = extractVolNumbers(title, series);
    const volume = volumes.length > 1 ? `${volumes[0]}~${volumes[volumes.length - 1]}` : String(volumes[0] ?? '');
    const inferred = { Title: [title], Series: [series, title], Volume: [volume], Number: [volume] };
    for (const field of Object.keys(inferred)) {
        const value = item.textInferredMetadata?.[field];
        if (value) inferred[field].push(String(value).normalize('NFC').trim());
    }
    // The shared library index also maps Series to Album for TXT records.
    inferred.Album = inferred.Series;
    const defaultFields = new Set(['LanguageISO', 'Format', 'PageCount', 'Manga']);
    return Object.entries(metadata).some(([field, rawValue]) => {
        const value = String(rawValue ?? '').normalize('NFC').trim();
        if (!value || defaultFields.has(field)) return false;
        if (inferred[field]) {
            return !inferred[field].some(candidate => value === candidate
                || (['Volume', 'Number'].includes(field) && candidate !== '' && Number(value) === Number(candidate)));
        }
        return true;
    });
}

export function withTxtCoverChange(item, coverChange, coverDataUrl = '') {
    const next = { ...item, textCoverRevision: (item.textCoverRevision || 0) + 1 };
    delete next.txtCoverChange;
    delete next.coverDataUrl;
    delete next.coverLoadedAt;
    if (coverChange) next.txtCoverChange = coverChange;
    if (coverDataUrl) {
        next.coverDataUrl = coverDataUrl;
        next.coverLoadedAt = Date.now();
    }
    return next;
}

export function txtMetadataCoverForSeries(item) {
    if (!isTxtMetadataItem(item) || item.txtCoverChange?.type === 'reset') return null;
    if (item.txtCoverChange?.type === 'file') {
        return item.txtCoverChange.filePath ? { ...item.txtCoverChange } : null;
    }
    const filePath = item.textCoverPath || item.coverOverridePath;
    return filePath ? {
        type: 'file',
        filePath,
        label: item.metadata?.Title || item.name || String(filePath).split(/[\\/]/).pop(),
    } : null;
}

export function applyTxtSeriesCover(items, source) {
    const coverChange = txtMetadataCoverForSeries(source);
    if (!coverChange) return items;
    return items.map(item => {
        if (item === source || (source.id && item.id === source.id)
            || item.group !== source.group || !isTxtMetadataItem(item)) return item;
        return withTxtCoverChange(item, { ...coverChange }, source.coverDataUrl || '');
    });
}

export function resetTxtMetadataDraft(item) {
    return {
        ...withTxtCoverChange(item, null),
        metadata: { ...(item.originalMetadata || {}) },
    };
}

export function successfulTxtMetadataTargets(saveTargets = [], successPaths = []) {
    const successfulPaths = new Set(successPaths.map(normalizeMetadataFilePath).filter(Boolean));
    return saveTargets.filter(item => isTxtMetadataItem(item)
        && successfulPaths.has(normalizeMetadataFilePath(item.filepath || item.path)));
}

export function applySuccessfulTxtMetadataSave(item, savedTarget, update = {}) {
    const next = item.txtCoverChange === savedTarget.txtCoverChange
        ? withTxtCoverChange(item, null)
        : { ...item };
    return {
        ...next,
        hasTextMetadata: true,
        originalMetadata: { ...(savedTarget.metadata || {}) },
        textContentHash: update.textContentHash || item.textContentHash || '',
        textCoverPath: update.textCoverPath ?? item.textCoverPath ?? '',
        coverOverridePath: update.coverOverridePath ?? item.coverOverridePath ?? '',
    };
}
