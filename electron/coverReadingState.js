function pageNumber(value) {
    return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function mappedPageIndex(value, adjustment) {
    const index = pageNumber(value);
    if (Array.isArray(adjustment.pageIndexMap) && adjustment.pageIndexMap.length) {
        return adjustment.pageIndexMap[Math.min(index, adjustment.pageIndexMap.length - 1)];
    }
    return index + pageNumber(adjustment.pageOffset);
}

export function remapCoverReadingState(state, adjustment, updatedAt = Date.now()) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
    const pageIndex = mappedPageIndex(state.pageIndex, adjustment);
    const pageCount = adjustment.format === 'comic'
        ? adjustment.pageCount : pageNumber(state.pageCount) + pageNumber(adjustment.pageOffset);
    const next = { ...state, pageIndex, pageCount, updatedAt, coverEditPageIndex: pageIndex };
    for (const key of ['locator', 'readiveLocator']) {
        const locator = state[key];
        if (locator?.kind === 'page') {
            next[key] = { ...locator, pageIndex: mappedPageIndex(locator.pageIndex, adjustment), pageCount };
        } else if (adjustment.format === 'epub' && locator?.kind === 'normalized' && pageNumber(state.pageCount) > 1) {
            const position = Math.max(0, Math.min(1, Number(locator.normalizedPosition) || 0));
            next[key] = { ...locator, normalizedPosition: (position * (pageNumber(state.pageCount) - 1) + adjustment.pageOffset) / Math.max(1, pageCount - 1) };
        }
    }
    return next;
}

export function remapCoverBookmarks(bookmarks, adjustment) {
    if (!Array.isArray(bookmarks)) return bookmarks;
    return bookmarks.map(bookmark => {
        if (!bookmark || typeof bookmark !== 'object' || !Number.isFinite(Number(bookmark.pageIndex))) return bookmark;
        const pageIndex = mappedPageIndex(bookmark.pageIndex, adjustment);
        return {
            ...bookmark,
            pageIndex,
            coverEditPageIndex: pageIndex,
            ...(adjustment.format === 'comic' && typeof bookmark.label === 'string'
                ? { label: bookmark.label.replace(/^\d+p(?=\s*-)/, `${pageIndex + 1}p`) } : {}),
        };
    });
}

function storedJson(storage, key) {
    const value = storage.getItem(key);
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}

function timestamp(value) {
    return typeof value === 'number' ? value : Date.parse(value || '') || 0;
}

export function applyCoverReadingAdjustment(storage, adjustment) {
    if (!storage || !adjustment || !['comic', 'epub'].includes(adjustment.format)) return;
    const { sourcePath, filePath } = adjustment;
    if (!sourcePath || !filePath) return;
    const updates = [];
    const stateKey = `bookmanager-viewer-state:${sourcePath}`;
    const state = storedJson(storage, stateKey);
    const databaseState = adjustment.readingState;
    if (databaseState && (!state || timestamp(state.updatedAt) <= timestamp(adjustment.previousUpdatedAt))) {
        updates.push([`bookmanager-viewer-state:${filePath}`, {
            ...(state || {}),
            ...databaseState,
            coverEditPageIndex: databaseState.pageIndex,
            readiveLocator: databaseState.locator,
        }]);
    } else if (state && typeof state === 'object' && !Array.isArray(state)) {
        updates.push([`bookmanager-viewer-state:${filePath}`, remapCoverReadingState(state, adjustment)]);
    }
    const bookmarks = storedJson(storage, `bookmanager-viewer-bookmarks:${sourcePath}`);
    if (Array.isArray(bookmarks)) {
        updates.push([`bookmanager-viewer-bookmarks:${filePath}`, remapCoverBookmarks(bookmarks, adjustment)]);
    }
    if (adjustment.format === 'epub') {
        const highlights = storedJson(storage, `bookmanager-viewer-highlights:${sourcePath}`);
        if (Array.isArray(highlights)) updates.push([`bookmanager-viewer-highlights:${filePath}`, remapCoverBookmarks(highlights, adjustment)]);
    }
    if (adjustment.format === 'comic') {
        const pages = storedJson(storage, `bookmanager-viewer-comic-flow:${sourcePath}`);
        if (Array.isArray(pages)) {
            updates.push([`bookmanager-viewer-comic-flow:${filePath}`, pages.map(name => adjustment.entryMap?.[name] ?? name)]);
        }
    }
    const originals = updates.map(([key]) => [key, storage.getItem(key)]);
    try {
        for (const [key, value] of updates) storage.setItem(key, JSON.stringify(value));
    } catch (error) {
        for (const [key, value] of originals) {
            if (value === null) storage.removeItem(key);
            else storage.setItem(key, value);
        }
        throw error;
    }
}
