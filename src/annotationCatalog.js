import { ANNOTATION_COLORS, annotationStyle, normalizeHighlightColor } from './highlightColors.js';

export const ANNOTATION_STORAGE_PREFIX = 'bookmanager-viewer-highlights:';
export { ANNOTATION_COLORS };

function textValue(value) {
    return Array.isArray(value) ? value.map(textValue).filter(Boolean).join(', ') : typeof value === 'string' ? value.trim() : '';
}

export function annotationBookTitle(file = {}) {
    return textValue(file.title) || textValue(file.name) || textValue(file.filename)
        || textValue(file.path || file.full_path).split(/[\\/]/).pop() || '';
}

export function annotationBookAuthor(file = {}) {
    return Object.hasOwn(file, 'writer') ? textValue(file.writer) : textValue(file.author);
}

function validTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : null;
}

function localTimestamp(year, month, day, hour = 0, minute = 0, second = 0, period = '') {
    let hours = Number(hour);
    if (period) {
        if (hours < 1 || hours > 12) return null;
        hours = hours % 12 + (/pm|오후|午後/i.test(period) ? 12 : 0);
    }
    const values = [year, month, day, hours, minute, second].map(Number);
    const result = new Date(values[0], values[1] - 1, values[2], values[3], values[4], values[5]);
    if (result.getFullYear() !== values[0] || result.getMonth() !== values[1] - 1 || result.getDate() !== values[2]
        || result.getHours() !== values[3] || result.getMinutes() !== values[4] || result.getSeconds() !== values[5]) return null;
    return validTimestamp(result.getTime());
}

export function annotationTimestamp(highlight = {}) {
    const createdAt = highlight.createdAt;
    if (typeof createdAt === 'number' || /^\d{13}$/.test(String(createdAt || ''))) {
        const timestamp = validTimestamp(createdAt);
        if (timestamp !== null) return timestamp;
    }
    const value = typeof createdAt === 'string' ? createdAt.trim().replace(/[\u200e\u200f\u202f\u00a0]/g, ' ') : '';
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        const timestamp = validTimestamp(Date.parse(value));
        if (timestamp !== null) return timestamp;
    }
    // Timestamp IDs keep locale-dependent dates unambiguous across language changes.
    const idTimestamp = String(highlight.id || '').match(/^(\d{13})(?:-|$)/);
    if (idTimestamp && validTimestamp(idTimestamp[1]) !== null) return validTimestamp(idTimestamp[1]);
    const yearFirst = value.match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})\.?\s*,?\s*(?:(AM|PM|오전|오후|午前|午後)\s*)?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|오전|오후|午前|午後)?)?$/i);
    if (yearFirst) return localTimestamp(yearFirst[1], yearFirst[2], yearFirst[3], yearFirst[5], yearFirst[6], yearFirst[7], yearFirst[4] || yearFirst[8]);
    const monthFirst = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}),?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (monthFirst) {
        const dayFirst = Number(monthFirst[1]) > 12;
        return localTimestamp(monthFirst[3], monthFirst[dayFirst ? 2 : 1], monthFirst[dayFirst ? 1 : 2], monthFirst[4], monthFirst[5], monthFirst[6], monthFirst[7]);
    }
    return null;
}

function currentPlatform() {
    return typeof navigator === 'undefined' ? '' : navigator.platform || '';
}

export function annotationPathKey(path, platform = currentPlatform()) {
    const platformName = String(platform).toLowerCase();
    if (platformName === 'darwin' || platformName.startsWith('mac')) return path.normalize('NFC');
    if (platformName.startsWith('win')) return path.replace(/\\/g, '/').toLowerCase();
    return path;
}

function annotationStorageKeys(storage, platform) {
    const keysByPath = new Map();
    try {
        const length = storage?.length;
        if (typeof storage?.key !== 'function' || typeof storage?.getItem !== 'function' || !Number.isInteger(length) || length < 0) {
            return { keysByPath, complete: false };
        }
        for (let index = 0; index < length; index += 1) {
            const key = storage.key(index);
            if (typeof key !== 'string' || !key.startsWith(ANNOTATION_STORAGE_PREFIX)) continue;
            const path = annotationPathKey(key.slice(ANNOTATION_STORAGE_PREFIX.length), platform);
            if (!keysByPath.has(path)) keysByPath.set(path, []);
            keysByPath.get(path).push(key);
        }
        return { keysByPath, complete: true };
    } catch {
        // Exact keys remain readable even when storage key enumeration is unavailable.
    }
    return { keysByPath, complete: false };
}

export function readAnnotationCatalog(files, storage, { platform = currentPlatform() } = {}) {
    const entries = [];
    const errors = [];
    const seenPaths = new Set();
    const { keysByPath, complete } = annotationStorageKeys(storage, platform);
    if (complete && keysByPath.size === 0) return { entries, errors };
    for (const file of Array.isArray(files) ? files : []) {
        const path = file?.path || file?.full_path;
        if (typeof path !== 'string' || !path || file.isDirectory) continue;
        const canonicalPath = annotationPathKey(path, platform);
        const matchingKeys = keysByPath.get(canonicalPath);
        if (complete && !matchingKeys) continue;
        if (seenPaths.has(canonicalPath)) continue;
        seenPaths.add(canonicalPath);
        const exactKey = `${ANNOTATION_STORAGE_PREFIX}${path}`;
        // Prefer the exact path when aliases contain the same highlight ID.
        const storageKeys = new Set(!complete || matchingKeys.includes(exactKey)
            ? [exactKey, ...(matchingKeys || [])] : matchingKeys);
        const title = annotationBookTitle(file);
        const author = annotationBookAuthor(file);
        const seenIds = new Set();
        let failed = false;
        for (const storageKey of storageKeys) {
            let highlights;
            try {
                if (!storage?.getItem) throw new Error('Storage unavailable');
                const raw = storage.getItem(storageKey);
                if (!raw) continue;
                highlights = JSON.parse(raw);
                if (!Array.isArray(highlights)) throw new Error('Invalid highlights');
            } catch {
                failed = true;
                continue;
            }
            highlights.forEach((highlight, index) => {
                if (!highlight || typeof highlight.text !== 'string' || !highlight.text.trim()) return;
                const id = String(highlight.id || JSON.stringify(['legacy', storageKey, index]));
                if (seenIds.has(id)) return;
                seenIds.add(id);
                const pageIndex = highlight.pageIndex == null || highlight.pageIndex === '' ? NaN : Number(highlight.pageIndex);
                entries.push({
                    id: JSON.stringify([path, id]),
                    file,
                    path,
                    title,
                    author,
                    text: highlight.text.trim(),
                    snippet: textValue(highlight.snippet),
                    color: normalizeHighlightColor(highlight.color),
                    timestamp: annotationTimestamp(highlight),
                    pageIndex: Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null,
                    source: {
                        storageKey,
                        highlightId: highlight.id ? String(highlight.id) : null,
                        index,
                        value: JSON.stringify(highlight),
                    },
                });
            });
        }
        if (failed) errors.push(path);
    }
    return { entries, errors };
}

export function deleteCatalogAnnotation(entry, storage, { platform = currentPlatform() } = {}) {
    const source = entry?.source;
    if (typeof entry?.path !== 'string' || !entry.path || typeof source?.storageKey !== 'string'
        || !source.storageKey.startsWith(ANNOTATION_STORAGE_PREFIX)
        || annotationPathKey(source.storageKey.slice(ANNOTATION_STORAGE_PREFIX.length), platform) !== annotationPathKey(entry.path, platform)) {
        throw new Error('Invalid annotation source');
    }
    if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function') throw new Error('Storage unavailable');
    const hasId = typeof source.highlightId === 'string' && source.highlightId.length > 0;
    let storageKeys = [source.storageKey];
    if (hasId) {
        const { keysByPath, complete } = annotationStorageKeys(storage, platform);
        if (!complete) throw new Error('Unable to enumerate annotation storage');
        storageKeys = [...new Set([source.storageKey, ...(keysByPath.get(annotationPathKey(entry.path, platform)) || [])])];
    } else if (!Number.isInteger(source.index) || source.index < 0 || typeof source.value !== 'string') {
        throw new Error('Invalid legacy annotation source');
    }
    const updates = [];
    for (const storageKey of storageKeys) {
        const raw = storage.getItem(storageKey);
        if (raw === null) continue;
        const highlights = JSON.parse(raw);
        if (!Array.isArray(highlights)) throw new Error('Invalid highlights');
        let remaining;
        if (hasId) {
            remaining = highlights.filter(highlight => !highlight?.id || String(highlight.id) !== source.highlightId);
        } else {
            const matchesSource = highlight => !highlight?.id && JSON.stringify(highlight) === source.value;
            let index = source.index;
            if (!matchesSource(highlights[index])) {
                const matches = highlights.flatMap((highlight, itemIndex) => matchesSource(highlight) ? [itemIndex] : []);
                if (matches.length > 1) throw new Error('Legacy annotation changed');
                if (!matches.length) continue;
                [index] = matches;
            }
            remaining = highlights.filter((_, itemIndex) => itemIndex !== index);
        }
        if (remaining.length !== highlights.length) updates.push({ storageKey, raw, value: JSON.stringify(remaining) });
    }
    const applied = [];
    try {
        for (const update of updates) {
            storage.setItem(update.storageKey, update.value);
            applied.push(update);
        }
    } catch (error) {
        let rollbackFailed = false;
        for (const update of applied.reverse()) {
            try {
                storage.setItem(update.storageKey, update.raw);
            } catch {
                rollbackFailed = true;
            }
        }
        if (rollbackFailed) throw new Error('Annotation deletion could not be fully restored', { cause: error });
        throw error;
    }
    return updates.length > 0;
}

function searchValue(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase();
}

export function filterAnnotations(entries, { query = '', color = '', bookPath = '', style = '', month = '', sort = 'newest' } = {}) {
    const words = searchValue(query).split(/\s+/).filter(Boolean);
    return entries.filter(entry => {
        if (color && entry.color !== color) return false;
        if (bookPath && entry.path !== bookPath) return false;
        if (style && annotationStyle(entry.color) !== style) return false;
        if (month && annotationMonthKey(entry.timestamp) !== month) return false;
        if (!words.length) return true;
        const content = searchValue([entry.text, entry.snippet, entry.title, entry.author].join(' '));
        return words.every(word => content.includes(word));
    }).sort((a, b) => {
        if (a.timestamp === null || b.timestamp === null) {
            if (a.timestamp !== b.timestamp) return a.timestamp === null ? 1 : -1;
        }
        const dateOrder = (a.timestamp || 0) - (b.timestamp || 0);
        return (sort === 'oldest' ? dateOrder : -dateOrder) || a.id.localeCompare(b.id);
    });
}

export function annotationMonthKey(timestamp) {
    if (timestamp === null || !Number.isFinite(timestamp)) return 'unknown';
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function groupAnnotationsByMonth(entries) {
    const groups = new Map();
    for (const entry of entries) {
        const key = annotationMonthKey(entry.timestamp);
        if (!groups.has(key)) groups.set(key, { key, timestamp: entry.timestamp, entries: [] });
        groups.get(key).entries.push(entry);
    }
    return [...groups.values()];
}

export function groupAnnotationsByBook(entries, locale = 'ko-KR') {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.path)) {
            groups.set(entry.path, { key: entry.path, title: entry.title, author: entry.author, file: entry.file, entries: [] });
        }
        groups.get(entry.path).entries.push(entry);
    }
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    return [...groups.values()].sort((a, b) => collator.compare(a.title, b.title));
}

export function summarizeAnnotations(entries, now = new Date()) {
    const colors = new Map(ANNOTATION_COLORS.map(color => [color, 0]));
    const styles = [{ style: 'highlight', count: 0 }, { style: 'underline', count: 0 }, { style: 'strikethrough', count: 0 }];
    const styleLookup = new Map(styles.map(style => [style.style, style]));
    const books = new Map();
    const months = Array.from({ length: 12 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
        return { key: annotationMonthKey(date.getTime()), timestamp: date.getTime(), count: 0 };
    });
    const monthLookup = new Map(months.map(month => [month.key, month]));
    for (const entry of entries) {
        colors.set(entry.color, (colors.get(entry.color) || 0) + 1);
        styleLookup.get(annotationStyle(entry.color)).count += 1;
        if (!books.has(entry.path)) books.set(entry.path, { path: entry.path, file: entry.file, title: entry.title, author: entry.author, count: 0 });
        books.get(entry.path).count += 1;
        const month = monthLookup.get(annotationMonthKey(entry.timestamp));
        if (month) month.count += 1;
    }
    return {
        total: entries.length,
        bookCount: books.size,
        colors: [...colors].map(([color, count]) => ({ color, count })).filter(item => item.count),
        styles,
        books: [...books.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
        months,
    };
}

const ANNOTATION_EXPORT_LABELS = {
    ko: {
        heading: '주석', title: '도서', author: '저자', text: '인용문', color: '색상', style: '표시 방식', page: '페이지', createdAt: '날짜',
        highlight: '하이라이트', underline: '밑줄', strikethrough: '취소선', yellow: '노랑', green: '초록', blue: '파랑', pink: '분홍', purple: '보라', unknown: '미상',
        orange: '주황', red: '빨강', olive: '올리브', cyan: '청록', gray: '회색',
    },
    en: {
        heading: 'Annotations', title: 'Book', author: 'Author', text: 'Quote', color: 'Color', style: 'Style', page: 'Page', createdAt: 'Date',
        highlight: 'Highlight', underline: 'Underline', strikethrough: 'Strikethrough', yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', purple: 'Purple', unknown: 'Unknown',
        orange: 'Orange', red: 'Red', olive: 'Olive', cyan: 'Cyan', gray: 'Gray',
    },
    ja: {
        heading: '注釈', title: '書籍', author: '著者', text: '引用文', color: '色', style: '表示形式', page: 'ページ', createdAt: '日付',
        highlight: 'ハイライト', underline: '下線', strikethrough: '取り消し線', yellow: '黄', green: '緑', blue: '青', pink: 'ピンク', purple: '紫', unknown: '不明',
        orange: 'オレンジ', red: '赤', olive: 'オリーブ', cyan: 'シアン', gray: 'グレー',
    },
};

function exportAnnotation(entry) {
    const timestamp = typeof entry.timestamp === 'number' ? validTimestamp(entry.timestamp) : null;
    return {
        title: String(entry.title ?? ''),
        author: String(entry.author ?? ''),
        text: String(entry.text ?? ''),
        color: entry.color,
        style: annotationStyle(entry.color),
        page: Number.isInteger(entry.pageIndex) && entry.pageIndex >= 0 ? entry.pageIndex + 1 : null,
        createdAt: timestamp === null ? null : new Date(timestamp).toISOString(),
    };
}

function markdownLabel(value) {
    return String(value).replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1');
}

function csvCell(value) {
    const text = String(value ?? '');
    const safeText = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
}

export function createAnnotationExport(entries, { format = 'markdown', language = 'ko' } = {}) {
    if (!['markdown', 'csv', 'json'].includes(format)) throw new RangeError(`Unsupported annotation export format: ${format}`);
    const records = entries.map(exportAnnotation);
    if (format === 'json') {
        return { text: `${JSON.stringify(records, null, 4)}\n`, mimeType: 'application/json;charset=utf-8', extension: 'json' };
    }
    const labels = ANNOTATION_EXPORT_LABELS[language] || ANNOTATION_EXPORT_LABELS.ko;
    const keys = ['title', 'author', 'text', 'color', 'style', 'page', 'createdAt'];
    const labelValue = (record, key) => key === 'color' || key === 'style' ? labels[record[key]] || record[key] : record[key];
    if (format === 'csv') {
        const rows = [keys.map(key => csvCell(labels[key])).join(',')];
        for (const record of records) rows.push(keys.map(key => csvCell(labelValue(record, key))).join(','));
        return { text: `\uFEFF${rows.join('\r\n')}\r\n`, mimeType: 'text/csv;charset=utf-8', extension: 'csv' };
    }
    const sections = records.map(record => {
        const metadata = ['author', 'color', 'style', 'page', 'createdAt'].map(key => (
            `- ${labels[key]}: ${markdownLabel(labelValue(record, key) ?? labels.unknown)}`
        )).join('\n');
        const quote = record.text.replace(/\r\n?/g, '\n').split('\n').map(line => `> ${line}`).join('\n');
        return `## ${markdownLabel(record.title)}\n\n${metadata}\n\n${quote}`;
    });
    return { text: `# ${labels.heading}\n${sections.length ? `\n${sections.join('\n\n---\n\n')}\n` : ''}`, mimeType: 'text/markdown;charset=utf-8', extension: 'md' };
}
