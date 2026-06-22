export const COMIC_INFO_FIELDS = Object.freeze([
    'Series',
    'SeriesGroup',
    'Title',
    'Number',
    'Count',
    'Volume',
    'AlternateSeries',
    'AlternateNumber',
    'AlternateCount',
    'Summary',
    'Notes',
    'Web',
    'Writer',
    'Penciller',
    'Inker',
    'Colorist',
    'Letterer',
    'CoverArtist',
    'Editor',
    'Translator',
    'Publisher',
    'Imprint',
    'Genre',
    'Tags',
    'Characters',
    'Teams',
    'Locations',
    'PageCount',
    'LanguageISO',
    'Format',
    'BlackAndWhite',
    'Manga',
    'AgeRating',
    'CommunityRating',
    'Year',
    'Month',
    'Day',
]);

export function inferMetadataFromArchiveName(name = '', language = 'ko') {
    const stem = String(name).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    const cleanTitle = stem.replace(/^\[.*?\]\s*|^\(.*?\)\s*/, '').trim();
    const chapterMatch = cleanTitle.match(/(?:^|[\s_-])(?:ch\.?|chapter|c)\s*(\d+(?:\.\d+)?)/i)
        || cleanTitle.match(/제?\s*(\d+(?:\.\d+)?)\s*화/i);
    const volumeMatch = cleanTitle.match(/(?:^|[\s_-])(?:vol\.?|v\.?)\s*(\d+(?:\.\d+)?)/i)
        || cleanTitle.match(/제?\s*(\d+(?:\.\d+)?)\s*권/i)
        || (!chapterMatch && cleanTitle.match(/\b(\d+(?:\.\d+)?)\s*$/));
    const series = cleanTitle
        .replace(/\s*제?\d+(?:\.\d+)?\s*(?:권|화|편).*$/i, '')
        .replace(/(?:[\s_-])*(?:vol\.?|v\.?|ch\.?|chapter|c)\s*\d+(?:\.\d+)?.*$/i, '')
        .replace(/\s*-\s*\d+(?:\.\d+)?\s*$/, '')
        .trim() || cleanTitle;

    let title = cleanTitle;
    if (volumeMatch) {
        title = language === 'en'
            ? `${series} Vol. ${volumeMatch[1]}`
            : `${series} ${volumeMatch[1]}권`;
    } else if (chapterMatch) {
        title = language === 'en'
            ? `${series} Ch. ${chapterMatch[1]}`
            : `${series} ${chapterMatch[1]}화`;
    }

    return {
        Title: title,
        Series: series,
        Volume: normalizeMetadataAutoNumber(volumeMatch?.[1]),
        Number: normalizeMetadataAutoNumber(chapterMatch?.[1]),
    };
}

export function normalizeMetadataAutoNumber(value = '') {
    return normalizeMetadataDecimal(value);
}

export function normalizeMetadataDecimal(value = '') {
    const text = String(value ?? '').trim();
    if (!text) return '';
    const match = text.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/);
    if (!match) return text;
    const integer = String(Number.parseInt(match[2] || '0', 10));
    const sign = match[1] === '-' ? '-' : '';
    const decimal = match[3] || match[4] ? `.${match[3] || match[4]}` : '';
    return `${sign}${integer}${decimal}`;
}

export function isDecimalMetadataField(field) {
    return field === 'Volume' || field === 'Number';
}

export function applyInferredMetadataField(metadata = {}, inferred = {}, field = '') {
    const targetFields = field === 'Title' ? ['Title', 'Volume', 'Number'] : [field];
    const next = { ...(metadata || {}) };
    for (const targetField of targetFields) {
        next[targetField] = inferred?.[targetField] || next[targetField] || '';
    }
    return next;
}

export function shouldApplyBatchMetadataValue(value, applyEmpty = false) {
    return applyEmpty || (value !== undefined && value !== null && String(value).trim() !== '');
}

export function applyBatchMetadataFields(metadata = {}, batchMetadata = {}, fieldIds = [], applyEmpty = false) {
    const next = { ...(metadata || {}) };
    for (const fieldId of fieldIds) {
        const value = batchMetadata?.[fieldId];
        if (shouldApplyBatchMetadataValue(value, applyEmpty)) {
            next[fieldId] = value ?? '';
        }
    }
    return next;
}

export function applySeriesAutoMetadata(metadata = {}, inferred = {}) {
    return ['Title', 'Volume', 'Number', 'PageCount'].reduce(
        (next, field) => applyInferredMetadataField(next, inferred, field),
        metadata,
    );
}

export function clampMetadataNumber(field, value) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return '';
    if (field === 'Year') return String(Math.max(1800, Math.min(2100, number)));
    if (field === 'Month') return String(Math.max(1, Math.min(12, number)));
    if (field === 'Day') return String(Math.max(1, Math.min(31, number)));
    return String(Math.max(0, number));
}

export function cleanMetadataSummary(value = '') {
    return String(value)
        .replace(/^\s*<책소개>\s*/i, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function adjacentSelectionAfterRemoval(items, removedIds, selectedId) {
    const removed = new Set(removedIds);
    const selectedIndex = items.findIndex(item => item.id === selectedId);
    const remaining = items.filter(item => !removed.has(item.id));
    if (remaining.length === 0) return null;
    if (!removed.has(selectedId)) return selectedId;
    return remaining[Math.min(Math.max(selectedIndex, 0), remaining.length - 1)]?.id || null;
}
