export function buildFlipBookStructureKey(entries = []) {
    return entries
        .map(entry => `${entry?.sourceIndex ?? 'blank'}:${entry?.side || 'single'}`)
        .join('|');
}
