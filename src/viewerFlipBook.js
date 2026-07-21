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

export function finishAndTurnFlipBookToPage(pageFlip, targetBookIndex = 0) {
    if (!pageFlip || typeof pageFlip.turnToPage !== 'function') return false;
    const normalizedBookIndex = Math.max(0, Number(targetBookIndex) || 0);
    const render = typeof pageFlip.getRender === 'function' ? pageFlip.getRender() : null;
    render?.finishAnimation?.();
    pageFlip.turnToPage(normalizedBookIndex);
    return true;
}
