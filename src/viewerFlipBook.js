function clampFlipBookValue(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export function buildFlipBookGroups({
    pageCount = 0,
    spread = false,
    getStepSizeForIndex,
} = {}) {
    if (!spread) {
        return Array.from({ length: Math.max(0, pageCount) }, (_, index) => ({
            startIndex: index,
            indexes: [index],
        }));
    }

    const groups = [];
    let index = 0;

    while (index < pageCount) {
        const rawStepSize = typeof getStepSizeForIndex === 'function'
            ? getStepSizeForIndex(index)
            : 2;
        const stepSize = clampFlipBookValue(
            Math.max(1, Number(rawStepSize) || 1),
            1,
            Math.max(1, pageCount - index),
        );
        const indexes = Array.from({ length: stepSize }, (_, offset) => index + offset)
            .filter(pageIndex => pageIndex >= 0 && pageIndex < pageCount);

        groups.push({ startIndex: index, indexes });
        index += stepSize;
    }

    return groups;
}

export function flipBookLeafSourcesForGroup(group, {
    spread = false,
    readingDirection = 'ltr',
    shouldSplitSinglePage,
} = {}) {
    const indexes = Array.isArray(group?.indexes)
        ? group.indexes.filter(Number.isInteger)
        : [];

    if (!spread) return [indexes[0] ?? null];
    if (indexes.length > 1) {
        const pair = indexes.slice(0, 2);
        return readingDirection === 'rtl' ? [pair[1], pair[0]] : pair;
    }

    const single = indexes[0] ?? null;
    if (
        single !== null
        && typeof shouldSplitSinglePage === 'function'
        && shouldSplitSinglePage(single, group)
    ) {
        return [single, single];
    }
    if (group?.startIndex === 0) {
        return readingDirection === 'rtl' ? [single, null] : [null, single];
    }
    return readingDirection === 'rtl' ? [null, single] : [single, null];
}

export function buildFlipBookPageModel({
    pageCount = 0,
    spread = false,
    readingDirection = 'ltr',
    getStepSizeForIndex,
    shouldSplitSinglePage,
} = {}) {
    const groups = buildFlipBookGroups({ pageCount, spread, getStepSizeForIndex });
    const orderedGroups = spread && readingDirection === 'rtl'
        ? [...groups].reverse()
        : groups;
    const pageToBookIndex = new Map();
    const bookToPageIndex = new Map();
    const entries = [];

    orderedGroups.forEach(group => {
        const firstBookIndex = entries.length;
        const groupStartIndex = clampFlipBookValue(
            Number(group.startIndex) || 0,
            0,
            Math.max(0, pageCount - 1),
        );

        group.indexes.forEach(pageIndex => {
            pageToBookIndex.set(pageIndex, firstBookIndex);
        });

        const leafSources = flipBookLeafSourcesForGroup(group, {
            spread,
            readingDirection,
            shouldSplitSinglePage,
        });
        const splitSpread = Boolean(
            spread
            && group.indexes.length === 1
            && leafSources.length === 2
            && leafSources[0] !== null
            && leafSources[0] === leafSources[1],
        );

        leafSources.forEach((sourceIndex, leafOffset) => {
            const bookIndex = entries.length;
            bookToPageIndex.set(bookIndex, groupStartIndex);
            entries.push({
                bookIndex,
                groupStartIndex,
                sourceIndex,
                leafOffset,
                blank: sourceIndex == null,
                side: spread ? (leafOffset === 0 ? 'left' : 'right') : 'single',
                splitSpread,
            });
        });
    });

    return { entries, pageToBookIndex, bookToPageIndex };
}

export function buildFlipBookStructureKey(entries = []) {
    return entries
        .map(entry => `${entry?.sourceIndex ?? 'blank'}:${entry?.side || 'single'}`)
        .join('|');
}

export function getFlipBookAmbientEntries(entries = []) {
    const splitSpreadKeys = new Set();

    return entries.filter(entry => {
        if (!entry?.splitSpread) return true;
        const key = `${entry.groupStartIndex}:${entry.sourceIndex}`;
        if (splitSpreadKeys.has(key)) return false;
        splitSpreadKeys.add(key);
        return true;
    });
}

export function getSplitSpreadFrameStyle(frameStyle, side = 'left') {
    const baseStyle = frameStyle || {
        width: '200%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        flex: '0 0 auto',
    };

    return {
        ...baseStyle,
        position: 'absolute',
        top: '50%',
        left: side === 'right' ? '0' : '100%',
        margin: 0,
        transform: 'translate(-50%, -50%)',
    };
}

export function getFlipBookCurrentGroupEntries(entries = [], currentBookIndex = 0) {
    const currentEntry = entries.find(entry => entry?.bookIndex === currentBookIndex);
    if (!currentEntry) return [];
    return entries.filter(entry => entry?.groupStartIndex === currentEntry.groupStartIndex);
}

export function getFlipBookNearbyGroupEntries(entries = [], currentBookIndex = 0, groupRadius = 1) {
    const currentEntry = entries.find(entry => entry?.bookIndex === currentBookIndex);
    if (!currentEntry) return [];

    const groupKeys = [...new Set(entries.map(entry => entry?.groupStartIndex))];
    const currentGroupIndex = groupKeys.indexOf(currentEntry.groupStartIndex);
    if (currentGroupIndex < 0) return [];

    const radius = Math.max(0, Math.floor(Number(groupRadius) || 0));
    const nearbyGroupKeys = new Set(groupKeys.slice(
        Math.max(0, currentGroupIndex - radius),
        currentGroupIndex + radius + 1,
    ));
    return entries.filter(entry => nearbyGroupKeys.has(entry?.groupStartIndex));
}

export function finishAndTurnFlipBookToPage(pageFlip, targetBookIndex = 0) {
    if (!pageFlip || typeof pageFlip.turnToPage !== 'function') return false;
    const normalizedBookIndex = Math.max(0, Number(targetBookIndex) || 0);
    const render = typeof pageFlip.getRender === 'function' ? pageFlip.getRender() : null;
    render?.finishAnimation?.();
    pageFlip.turnToPage(normalizedBookIndex);
    return true;
}
