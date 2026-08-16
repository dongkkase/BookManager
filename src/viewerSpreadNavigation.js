function clampPageIndex(pageIndex, pageCount) {
    const normalizedPageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
    if (normalizedPageCount < 1) return 0;
    return Math.max(0, Math.min(normalizedPageCount - 1, Math.floor(Number(pageIndex) || 0)));
}

function spreadStepSize(pageIndex, pageCount, getStepSizeForIndex) {
    const remainingPageCount = Math.max(1, pageCount - pageIndex);
    const requestedStepSize = typeof getStepSizeForIndex === 'function'
        ? getStepSizeForIndex(pageIndex)
        : 2;
    return Math.min(remainingPageCount, Math.max(1, Math.floor(Number(requestedStepSize) || 1)));
}

export function resolveSpreadPageStartIndex(targetPageIndex, pageCount, getStepSizeForIndex) {
    const normalizedPageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
    if (normalizedPageCount < 1) return 0;
    const targetIndex = clampPageIndex(targetPageIndex, normalizedPageCount);
    let startIndex = 0;

    while (startIndex < targetIndex) {
        const nextStartIndex = startIndex + spreadStepSize(
            startIndex,
            normalizedPageCount,
            getStepSizeForIndex,
        );
        if (targetIndex < nextStartIndex) return startIndex;
        if (nextStartIndex <= startIndex || nextStartIndex >= normalizedPageCount) break;
        startIndex = nextStartIndex;
    }

    return startIndex;
}

export function adjacentSpreadPageStartIndex(
    currentPageIndex,
    direction,
    pageCount,
    getStepSizeForIndex,
) {
    const normalizedPageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
    if (normalizedPageCount < 1) return 0;
    const currentStartIndex = resolveSpreadPageStartIndex(
        currentPageIndex,
        normalizedPageCount,
        getStepSizeForIndex,
    );

    if (Number(direction) < 0) {
        if (currentStartIndex <= 0) return 0;
        return resolveSpreadPageStartIndex(
            currentStartIndex - 1,
            normalizedPageCount,
            getStepSizeForIndex,
        );
    }

    const nextStartIndex = currentStartIndex + spreadStepSize(
        currentStartIndex,
        normalizedPageCount,
        getStepSizeForIndex,
    );
    return nextStartIndex < normalizedPageCount ? nextStartIndex : currentStartIndex;
}

export function adjacentSpreadSelectionIndex(
    currentPageIndex,
    direction,
    pageCount,
    getStepSizeForIndex,
) {
    const normalizedPageCount = Math.max(0, Math.floor(Number(pageCount) || 0));
    if (normalizedPageCount < 1) return 0;
    const currentStartIndex = resolveSpreadPageStartIndex(
        currentPageIndex,
        normalizedPageCount,
        getStepSizeForIndex,
    );

    if (Number(direction) < 0) return Math.max(0, currentStartIndex - 1);
    return adjacentSpreadPageStartIndex(
        currentStartIndex,
        direction,
        normalizedPageCount,
        getStepSizeForIndex,
    );
}
