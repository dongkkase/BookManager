const NUMBER_PATTERN = String.raw`[0-9０-９]+(?:[.．][0-9０-９]+)?`;
const RANGE_SEPARATOR_PATTERN = String.raw`(?:~|〜|～|-|–|—)`;
const NUMBER_RANGE_PATTERN = String.raw`${NUMBER_PATTERN}(?:\s*${RANGE_SEPARATOR_PATTERN}\s*${NUMBER_PATTERN})?`;
const LOCALIZED_UNIT_PATTERN = String.raw`(?:권|화|회|巻|話)`;
const LOCALIZED_MARKER_PATTERN = String.raw`(?:(?:제|第)?\s*${NUMBER_PATTERN}\s*${LOCALIZED_UNIT_PATTERN}\s*${RANGE_SEPARATOR_PATTERN}\s*(?:제|第)?\s*${NUMBER_PATTERN}\s*${LOCALIZED_UNIT_PATTERN}|(?:제|第)?\s*${NUMBER_RANGE_PATTERN}\s*${LOCALIZED_UNIT_PATTERN})`;
const OPEN_WRAPPER_PATTERN = String.raw`(?:\(|\[|（|【)`;
const CLOSE_WRAPPER_PATTERN = String.raw`(?:\)|\]|）|】)`;
const COMPLETION_PATTERN = String.raw`(?:\s*[-–—_:,]?\s*(?:(?:${OPEN_WRAPPER_PATTERN})\s*(?:완결|完結|complete)\s*(?:${CLOSE_WRAPPER_PATTERN})|(?:완결|完結|complete)))?`;

const VOLUME_CHAPTER_PATTERNS = [
    new RegExp(`(?:\\s*[-–—_:,]?\\s*)(?:${OPEN_WRAPPER_PATTERN}\\s*)?${LOCALIZED_MARKER_PATTERN}(?:\\s*${CLOSE_WRAPPER_PATTERN})?${COMPLETION_PATTERN}$`, 'iu'),
    new RegExp(`(?:\\s*[-–—_:,]?\\s*)(?:${OPEN_WRAPPER_PATTERN}\\s*)?(?:vol(?:ume)?|v|ch(?:apter)?|episode|ep)\\.?\\s*#?\\s*${NUMBER_RANGE_PATTERN}(?:\\s*${CLOSE_WRAPPER_PATTERN})?${COMPLETION_PATTERN}$`, 'iu'),
];

function cleanTitleBoundary(value = '') {
    return String(value || '')
        .replace(/^[\s\-–—_:|/·.,)\]}]+/, '')
        .replace(/^[）】]+/, '')
        .replace(/[\s\-–—_:|/·.,([{（【]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeLatestMetadataTitle(value = '') {
    const title = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!title) return '';

    let normalized = title;
    let changed = true;
    while (changed) {
        changed = false;
        for (const pattern of VOLUME_CHAPTER_PATTERNS) {
            const next = cleanTitleBoundary(normalized.replace(pattern, ''));
            if (next === normalized) continue;
            normalized = next;
            changed = true;
            break;
        }
    }
    return normalized;
}

export function latestMetadataTitleKey(value = '') {
    return normalizeLatestMetadataTitle(value).toLowerCase();
}
