export const CHAPTER_DRAG = 'application/x-bookmanager-epub-chapter';

export function chapterDropTarget(rows, sourceId, y) {
    const source = rows.findIndex(row => row.id === sourceId);
    if (source < 0 || !Number.isFinite(y)) return null;
    let boundary = rows.findIndex(row => y < (row.top + row.bottom) / 2);
    if (boundary < 0) boundary = rows.length;
    if (boundary === source || boundary === source + 1) return null;
    return boundary < rows.length ? { id: rows[boundary].id, edge: 'before' } : { id: rows.at(-1).id, edge: 'after' };
}

export function reorderChapters(chapters, sourceId, target) {
    const from = chapters.findIndex(chapter => chapter.id === sourceId);
    if (from < 0 || !target || target.id === sourceId || !['before', 'after'].includes(target.edge)) return chapters;
    const next = chapters.filter(chapter => chapter.id !== sourceId);
    const anchor = next.findIndex(chapter => chapter.id === target.id);
    if (anchor < 0) return chapters;
    const to = anchor + (target.edge === 'after' ? 1 : 0);
    if (to === from) return chapters;
    next.splice(to, 0, chapters[from]);
    return next;
}

export function chapterDragScroll(y, top, bottom) {
    if (y < top || y > bottom || bottom <= top) return 0;
    const edge = Math.min(40, (bottom - top) / 3);
    if (y < top + edge) return -14 * (1 - (y - top) / edge);
    if (y > bottom - edge) return 14 * (1 - (bottom - y) / edge);
    return 0;
}
