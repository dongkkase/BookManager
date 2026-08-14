export function buildFlipBookStructureKey(entries = []) {
    return entries
        .map(entry => `${entry?.sourceIndex ?? 'blank'}:${entry?.side || 'single'}`)
        .join('|');
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
