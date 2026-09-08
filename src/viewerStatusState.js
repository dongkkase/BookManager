import { resolveBookType } from './metadata/metadataTypes.js';

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

function readingTimestamp(value) {
    const timestamp = typeof value === 'number' ? value : Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function matchesLocalReadingPosition(file, localState, databaseState) {
    const localStatus = buildViewerFileStatus(file, localState, [], true);
    const readStatus = databaseState.status || databaseState.readStatus;
    if (readStatus && readStatus !== (localStatus.isCompleted ? 'completed' : 'reading')) return false;
    const fields = localStatus.isAudio
        ? ['positionSeconds', 'durationSeconds']
        : ['pageIndex', 'pageCount', 'scrollPercent'];
    return fields.every(key => numericValue(localState[key]) === numericValue(databaseState[key]));
}

function selectReadingState(file, localState, hasLocalState) {
    const databaseState = file?.readingState;
    if (!databaseState || typeof databaseState !== 'object' || databaseState.deletedAt
        || (hasLocalState && (readingTimestamp(localState.updatedAt) > readingTimestamp(databaseState.updatedAt)
            || matchesLocalReadingPosition(file, localState, databaseState)))) {
        return { state: localState, hasState: hasLocalState };
    }
    return { state: databaseState, hasState: true };
}

function buildViewerFileStatus(file = {}, state = {}, bookmarkValue = [], hasStoredState = false) {
    const filePath = viewerStatusFilePath(file);
    const isNormalized = state?.locator?.kind === 'normalized';
    const isAudio = resolveBookType(file) === 'audio'
        || state?.format === 'audio'
        || state?.locator?.kind === 'audio-time'
        || (!state?.locator?.kind && (numericValue(state?.positionSeconds) > 0 || numericValue(state?.durationSeconds) > 0));
    const positionSeconds = Math.max(0, numericValue(state?.positionSeconds, 0));
    const durationSeconds = Math.max(0, numericValue(
        firstMetadataValue(file, ['duration_seconds', 'durationSeconds', 'DurationSeconds'])
        || state?.durationSeconds,
        0,
    ));
    const audioPercent = durationSeconds > 0
        ? Math.max(0, Math.min(100, Math.round((positionSeconds / durationSeconds) * 100)))
        : 0;
    const pageCount = viewerStatusPageCount(file, state);
    const pageIndex = Math.max(0, Math.floor(numericValue(state?.pageIndex, 0)));
    const scrollPercent = Math.max(0, Math.min(100, isNormalized
        ? numericValue(state?.locator?.normalizedPosition, numericValue(state?.scrollPercent) / 100) * 100
        : numericValue(state?.scrollPercent, 0)));
    const bookmarkCount = normalizeBookmarkCount(bookmarkValue);
    const readStatus = state?.status || state?.readStatus;
    const hasReadingProgress = readStatus !== 'unread'
        && (hasStoredState || (isAudio ? positionSeconds > 0 : pageIndex > 0 || scrollPercent > 0));
    const isCompleted = hasReadingProgress && (
        readStatus === 'completed' || (!readStatus && (isAudio
            ? durationSeconds > 0 && (positionSeconds >= durationSeconds - 1 || audioPercent >= 100)
            : (!isNormalized && pageCount > 0 && pageIndex >= pageCount - 1) || scrollPercent >= 99.5))
    );
    const pagePercent = pageCount > 0 ? ((pageIndex + 1) / pageCount) * 100 : 0;
    const percent = isCompleted ? 100 : isAudio
        ? audioPercent
        : Math.max(0, Math.min(100, Math.round(isNormalized ? scrollPercent : Math.max(pagePercent, scrollPercent))));

    return {
        filePath,
        isAudio,
        isNormalized,
        positionSeconds,
        durationSeconds,
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
    const { state, hasState } = selectReadingState(file, readStoredJson(targetStorage, stateKey, {}), hasStoredKey(targetStorage, stateKey));
    const bookmarks = readStoredJson(targetStorage, `${VIEWER_BOOKMARKS_PREFIX}${filePath}`, []);
    return buildViewerFileStatus(file, state, bookmarks, hasState);
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
        const { state, hasState } = selectReadingState(file, stateByPath.get(filePath) || {}, stateByPath.has(filePath));
        return buildViewerFileStatus(
            file,
            state,
            bookmarkCountByPath.get(filePath) || 0,
            hasState,
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
    if (status.isNormalized) {
        return { percentText: `${Math.max(0, Math.min(100, Math.round(numericValue(status.percent))))}%`, pageText: '' };
    }
    if (status.isAudio) {
        const positionText = formatAudioStatusTime(status.positionSeconds);
        const durationText = formatAudioStatusTime(status.durationSeconds);
        return {
            percentText: `${Math.max(0, Math.min(100, Math.round(numericValue(status.percent, 0))))}%`,
            pageText: durationText ? `${positionText} / ${durationText}` : positionText,
        };
    }
    const pageIndex = Math.max(0, Math.floor(numericValue(status.pageIndex, 0)));
    const pageCount = Math.max(0, Math.floor(numericValue(status.pageCount, 0)));
    const currentPage = pageIndex + 1;
    const percent = Math.max(0, Math.min(100, Math.round(numericValue(status.percent, status.scrollPercent || 0))));
    return {
        percentText: `${percent}%`,
        pageText: pageCount > 0 ? `${currentPage} / ${pageCount}p` : `${currentPage}p`,
    };
}

function formatAudioStatusTime(value) {
    const totalSeconds = Math.max(0, Math.floor(numericValue(value, 0)));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function viewerReadingProgressText(status = {}) {
    const { percentText, pageText } = viewerReadingProgressParts(status);
    return [percentText, pageText].filter(Boolean).join(' · ');
}

export function viewerBookmarkStatusText(status = {}, t) {
    if (!status.hasBookmarks) return '';
    return t?.('viewer_status_bookmarks', [status.bookmarkCount]) || `책갈피 ${status.bookmarkCount}개`;
}
