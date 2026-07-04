const VIEWER_STATE_PREFIX = 'bookmanager-viewer-state:';
const VIEWER_BOOKMARKS_PREFIX = 'bookmanager-viewer-bookmarks:';

function safeStorage(storage) {
    if (storage) return storage;
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function readJsonValue(raw, fallback) {
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function readStoredJson(storage, key, fallback) {
    if (!storage || !key) return fallback;
    try {
        return readJsonValue(storage.getItem(key), fallback);
    } catch {
        return fallback;
    }
}

function hasStoredKey(storage, key) {
    if (!storage || !key) return false;
    try {
        return storage.getItem(key) !== null;
    } catch {
        return false;
    }
}

function numericValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function firstMetadataValue(file, keys) {
    const sources = [file, file?.metadata, file?.full_meta];
    for (const source of sources) {
        if (!source) continue;
        for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return value;
            }
        }
    }
    return '';
}

export function viewerStatusFilePath(file = {}) {
    return file?.full_path || file?.path || '';
}

export function viewerStatusPageCount(file = {}, state = {}) {
    return Math.max(0, Math.floor(numericValue(
        firstMetadataValue(file, ['page_count', 'pages', 'pageCount', 'PageCount', 'total_pages'])
        || state?.pageCount,
        0,
    )));
}

export function isViewerStatusStorageKey(key = '') {
    return String(key || '').startsWith(VIEWER_STATE_PREFIX)
        || String(key || '').startsWith(VIEWER_BOOKMARKS_PREFIX);
}

function normalizeBookmarkCount(bookmarkValue) {
    if (Array.isArray(bookmarkValue)) return bookmarkValue.length;
    return Math.max(0, Math.floor(numericValue(bookmarkValue, 0)));
}

function buildViewerFileStatus(file = {}, state = {}, bookmarkValue = [], hasStoredState = false) {
    const filePath = viewerStatusFilePath(file);
    const pageCount = viewerStatusPageCount(file, state);
    const pageIndex = Math.max(0, Math.floor(numericValue(state?.pageIndex, 0)));
    const scrollPercent = Math.max(0, Math.min(100, numericValue(state?.scrollPercent, 0)));
    const bookmarkCount = normalizeBookmarkCount(bookmarkValue);
    const hasReadingProgress = hasStoredState || pageIndex > 0 || scrollPercent > 0;
    const isCompleted = hasReadingProgress && (
        (pageCount > 0 && pageIndex >= pageCount - 1)
        || scrollPercent >= 99.5
    );
    const pagePercent = pageCount > 0 ? ((pageIndex + 1) / pageCount) * 100 : 0;
    const percent = Math.max(0, Math.min(100, Math.round(Math.max(pagePercent, scrollPercent))));

    return {
        filePath,
        pageCount,
        pageIndex,
        scrollPercent,
        percent,
        hasReadingProgress,
        isCompleted,
        hasBookmarks: bookmarkCount > 0,
        bookmarkCount,
    };
}

export function readViewerFileStatus(file = {}, storage = null) {
    const targetStorage = safeStorage(storage);
    const filePath = viewerStatusFilePath(file);
    if (!filePath) return buildViewerFileStatus(file);
    const stateKey = `${VIEWER_STATE_PREFIX}${filePath}`;
    const state = readStoredJson(targetStorage, stateKey, {});
    const bookmarks = readStoredJson(targetStorage, `${VIEWER_BOOKMARKS_PREFIX}${filePath}`, []);
    return buildViewerFileStatus(file, state, bookmarks, hasStoredKey(targetStorage, stateKey));
}

export function createViewerStatusReader(storage = null) {
    const targetStorage = safeStorage(storage);
    const stateByPath = new Map();
    const bookmarkCountByPath = new Map();

    if (!targetStorage) return file => readViewerFileStatus(file, null);

    try {
        for (let index = 0; index < targetStorage.length; index += 1) {
            const key = targetStorage.key(index);
            if (!key) continue;
            if (key.startsWith(VIEWER_STATE_PREFIX)) {
                stateByPath.set(
                    key.slice(VIEWER_STATE_PREFIX.length),
                    readJsonValue(targetStorage.getItem(key), {}),
                );
            } else if (key.startsWith(VIEWER_BOOKMARKS_PREFIX)) {
                bookmarkCountByPath.set(
                    key.slice(VIEWER_BOOKMARKS_PREFIX.length),
                    normalizeBookmarkCount(readJsonValue(targetStorage.getItem(key), [])),
                );
            }
        }
    } catch {
        return file => readViewerFileStatus(file, targetStorage);
    }

    return file => {
        const filePath = viewerStatusFilePath(file);
        return buildViewerFileStatus(
            file,
            stateByPath.get(filePath) || {},
            bookmarkCountByPath.get(filePath) || 0,
            stateByPath.has(filePath),
        );
    };
}

export function attachViewerStatus(file, reader) {
    const statusReader = typeof reader === 'function' ? reader : createViewerStatusReader();
    return {
        ...file,
        viewerStatus: statusReader(file),
    };
}

export function viewerReadingStatusText(status = {}, t) {
    if (status.isCompleted) return t?.('viewer_status_completed') || '모두 읽음';
    if (status.hasReadingProgress) return t?.('viewer_status_reading') || '읽는 중';
    return '';
}

export function viewerReadingProgressParts(status = {}) {
    if (!status.hasReadingProgress) return { percentText: '', pageText: '' };
    const pageIndex = Math.max(0, Math.floor(numericValue(status.pageIndex, 0)));
    const pageCount = Math.max(0, Math.floor(numericValue(status.pageCount, 0)));
    const currentPage = pageIndex + 1;
    const percent = Math.max(0, Math.min(100, Math.round(numericValue(status.percent, status.scrollPercent || 0))));
    return {
        percentText: `${percent}%`,
        pageText: pageCount > 0 ? `${currentPage} / ${pageCount}p` : `${currentPage}p`,
    };
}

export function viewerReadingProgressText(status = {}) {
    const { percentText, pageText } = viewerReadingProgressParts(status);
    return [percentText, pageText].filter(Boolean).join(' · ');
}

export function viewerBookmarkStatusText(status = {}, t) {
    if (!status.hasBookmarks) return '';
    return t?.('viewer_status_bookmarks', [status.bookmarkCount]) || `책갈피 ${status.bookmarkCount}개`;
}
