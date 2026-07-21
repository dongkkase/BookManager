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
