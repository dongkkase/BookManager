export function buildSlideThumbGroups({
    items = [],
    spread = false,
    readingDirection = 'ltr',
    getStepSizeForIndex,
} = {}) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const groups = [];
    let groupStartIndex = 0;

    while (groupStartIndex < normalizedItems.length) {
        const remainingPageCount = normalizedItems.length - groupStartIndex;
        const requestedStepSize = spread
            ? (typeof getStepSizeForIndex === 'function' ? getStepSizeForIndex(groupStartIndex) : 2)
            : 1;
        const stepSize = spread
            ? Math.min(2, remainingPageCount, Math.max(1, Math.floor(Number(requestedStepSize) || 1)))
            : 1;
        const logicalPageIndexes = Array.from(
            { length: stepSize },
            (_, offset) => groupStartIndex + offset,
        );
        const pageIndexes = spread && readingDirection === 'rtl'
            ? [...logicalPageIndexes].reverse()
            : logicalPageIndexes;

        groups.push({
            groupStartIndex,
            pageIndexes,
            items: pageIndexes.map(pageIndex => normalizedItems[pageIndex]),
        });
        groupStartIndex += stepSize;
    }

    return groups;
}

export function buildComicSlideThumbGroups({ pages = [], ...options } = {}) {
    return buildSlideThumbGroups({
        ...options,
        items: pages,
    }).map(group => ({
        groupStartIndex: group.groupStartIndex,
        pageIndexes: group.pageIndexes,
        pages: group.items,
    }));
}
