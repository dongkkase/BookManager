import { Fragment, Slice } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { createChapter, newId, paragraph, projectError, textContent, walkDocument } from '../../../../electron/epubEditor/model.js';
import { remapCssIds } from '../../../../electron/epubEditor/css.js';
import { splitTextImportDocument } from '../../../../electron/epubEditor/textImportLimits.js';

export function hasChapterContent(doc) {
    let found = false;
    walkDocument(doc, node => { if ((node.type === 'text' && node.text.trim()) || ['image', 'audio', 'footnote', 'table', 'horizontalRule'].includes(node.type)) found = true; });
    return found;
}

export function splitChapterDocument(state) {
    if (!(state.selection instanceof TextSelection) || !state.selection.empty) throw projectError('SPLIT_CURSOR_REQUIRED');
    let position = state.selection.from;
    const { $from } = state.selection;
    for (let depth = 1; depth <= $from.depth; depth += 1) {
        if (['table', 'columns'].includes($from.node(depth).type.name)) throw projectError('SPLIT_CONTAINER');
    }
    if ($from.parent.isTextblock && [$from.parent.content.size, 0].includes($from.parentOffset)) {
        const atStart = $from.parentOffset === 0;
        position = atStart ? $from.before() : $from.after();
        for (let depth = $from.depth - 1; depth >= 1; depth -= 1) {
            if ($from.index(depth) !== (atStart ? 0 : $from.node(depth).childCount - 1)) break;
            position = atStart ? $from.before(depth) : $from.after(depth);
        }
    }
    const before = structuredClone(state.doc.cut(0, position).toJSON());
    const after = structuredClone(state.doc.cut(position).toJSON());
    let node = after;
    const $cut = state.doc.resolve(position);
    for (let depth = 1; depth <= $cut.depth; depth += 1) {
        node = node.content?.[0];
        if (!node || node.type !== $cut.node(depth).type.name) break;
        if (node.type === 'orderedList') node.attrs = { ...node.attrs, start: (node.attrs?.start || 1) + $cut.index(depth) };
    }
    for (const doc of [before, after]) walkDocument(doc, item => {
        if (item.type === 'listItem' && item.content?.[0]?.type !== 'paragraph') item.content = [{ ...paragraph(), attrs: { id: newId() } }, ...(item.content || [])];
    });
    if (!hasChapterContent(before) || !hasChapterContent(after)) throw projectError('SPLIT_EMPTY');
    const leftIds = new Set();
    const movedIds = new Set();
    walkDocument(before, item => { if (item.attrs?.id) leftIds.add(item.attrs.id); });
    walkDocument(after, item => {
        if (!item.attrs?.id) return;
        if (leftIds.has(item.attrs.id)) item.attrs.id = newId();
        else movedIds.add(item.attrs.id);
    });
    try { state.schema.nodeFromJSON(before).check(); state.schema.nodeFromJSON(after).check(); }
    catch { throw projectError('SPLIT_CONTAINER'); }
    return { before, after, movedIds };
}

export function splitProjectChapter(chapters, chapterId, state) {
    if (chapters.length >= 1000) throw projectError('CHAPTER_LIMIT');
    const source = chapters.find(item => item.id === chapterId);
    if (!source) throw projectError('INVALID_PROJECT');
    const { before, after, movedIds } = splitChapterDocument(state);
    const heading = after.content?.[0]?.type === 'heading' ? textContent(after.content[0]).trim() : '';
    let title = heading.slice(0, 1980) || `${source.title.slice(0, 1980)} (2)`;
    let suffix = 3;
    while (chapters.some(item => item.title === title)) title = `${(heading || source.title).slice(0, 1980)} (${suffix++})`;
    const next = { ...createChapter(title), css: source.css || '', inToc: source.inToc, content: after };
    const result = chapters.flatMap(item => item.id === chapterId ? [{ ...item, content: before }, next] : [item]);
    const updated = result.map(item => {
        let changed = false;
        const content = structuredClone(item.content);
        walkDocument(content, node => {
            for (const mark of node.marks || []) {
                if (mark.type !== 'link') continue;
                const [target, anchor] = mark.attrs.href.split('#');
                if (target === `epub:${chapterId}` && movedIds.has(anchor)) { mark.attrs.href = `epub:${next.id}#${anchor}`; changed = true; }
            }
        });
        return changed ? { ...item, content } : item;
    });
    return { chapters: updated, selectedId: next.id };
}

export function importTextChapters(chapters, chapterId, state, document, title, placement, position) {
    const index = chapters.findIndex(item => item.id === chapterId);
    if (index < 0 || !hasChapterContent(document)) throw projectError('TEXT_EMPTY');
    const documents = splitTextImportDocument(document);
    if (placement === 'cursor') {
        if (documents.length > 1) throw projectError('TEXT_IMPORT_CHAPTERS_REQUIRED');
        const nodes = state.schema.nodeFromJSON(document);
        nodes.check();
        if (!Number.isInteger(position) || position < 0 || position > state.doc.content.size) throw projectError('SPLIT_CURSOR_REQUIRED');
        const tr = state.tr.replaceRange(position, position, new Slice(Fragment.from(nodes.content), 0, 0));
        tr.doc.check();
        const content = structuredClone(tr.doc.toJSON());
        const ids = new Set();
        walkDocument(content, node => {
            if (!node.attrs?.id) return;
            if (ids.has(node.attrs.id)) node.attrs.id = newId();
            ids.add(node.attrs.id);
        });
        return { chapters: chapters.map(item => item.id === chapterId ? { ...item, content } : item), selectedId: chapterId };
    }
    if (placement !== 'chapter') throw projectError('INVALID_OPERATION');
    const fillEmpty = chapters.length === 1 && !hasChapterContent(chapters[0].content);
    if (chapters.length - (fillEmpty ? 1 : 0) + documents.length > 1000) throw projectError('CHAPTER_LIMIT');
    const imported = documents.map((part, partIndex) => {
        const nodes = state.schema.nodeFromJSON(part);
        nodes.check();
        const nextTitle = documents.length > 1 ? `${title.slice(0, 1980)} (${partIndex + 1})` : title;
        return { ...(fillEmpty && partIndex === 0 ? chapters[0] : createChapter()), title: nextTitle, content: nodes.toJSON() };
    });
    return { chapters: fillEmpty ? imported : [...chapters.slice(0, index + 1), ...imported, ...chapters.slice(index + 1)], selectedId: imported[0].id };
}

export function mergeProjectChapters(chapters, startId, endId, { title, keepTitles = false } = {}) {
    const start = chapters.findIndex(item => item.id === startId);
    const end = chapters.findIndex(item => item.id === endId);
    if (start < 0 || end <= start) throw projectError('MERGE_RANGE_REQUIRED');
    const selected = chapters.slice(start, end + 1);
    const first = selected[0];
    const mergedTitle = title === undefined ? first.title : title.trim();
    if (!mergedTitle || mergedTitle.length > 2000) throw projectError('CHAPTER_TITLE_REQUIRED');
    const usedIds = new Set();
    const targets = new Map();
    const content = [];
    const styles = [];
    for (const [index, chapter] of selected.entries()) {
        const document = structuredClone(chapter.content);
        const replacements = new Map();
        const localIds = new Set();
        walkDocument(document, node => {
            const oldId = node.attrs?.id;
            if (!oldId) return;
            const ids = node.type === 'footnote' ? [oldId, `note-${oldId}`] : [oldId];
            if (ids.some(id => localIds.has(id))) throw projectError('DUPLICATE_ID');
            for (const id of ids) localIds.add(id);
            if (ids.some(id => usedIds.has(id))) {
                node.attrs.id = newId();
                replacements.set(oldId, node.attrs.id);
                if (node.type === 'footnote') replacements.set(`note-${oldId}`, `note-${node.attrs.id}`);
            }
            usedIds.add(node.attrs.id);
            if (node.type === 'footnote') usedIds.add(`note-${node.attrs.id}`);
        });
        if (index > 0 && keepTitles && !(document.content[0]?.type === 'heading' && textContent(document.content[0]).trim() === chapter.title.trim())) {
            document.content.unshift({ type: 'heading', attrs: { id: newId(), level: 1 }, content: [{ type: 'text', text: chapter.title || mergedTitle }] });
        }
        let boundary;
        const top = document.content[0];
        if (['paragraph', 'heading', 'blockquote', 'image', 'audio', 'table', 'columns'].includes(top?.type)) {
            top.attrs = { ...top.attrs, id: top.attrs?.id || newId() };
            boundary = top.attrs.id;
        } else if (['orderedList', 'bulletList'].includes(top?.type)) {
            const leadingParagraph = top.content?.[0]?.content?.[0];
            if (leadingParagraph?.type === 'paragraph') {
                leadingParagraph.attrs = { ...leadingParagraph.attrs, id: leadingParagraph.attrs?.id || newId() };
                boundary = leadingParagraph.attrs.id;
            }
        }
        if (index > 0 && !boundary) {
            boundary = newId();
            document.content.unshift({ ...paragraph(), attrs: { id: boundary } });
        }
        if (boundary) usedIds.add(boundary);
        targets.set(chapter.id, { boundary, replacements });
        content.push(...document.content);
        styles.push(remapCssIds(chapter.css || '', replacements));
    }
    const css = styles.filter((value, index) => value.trim() && styles.lastIndexOf(value) === index).join('\n\n');
    if (css.length > 100000) throw projectError('MERGE_CSS_TOO_LARGE');
    const merged = { ...first, title: mergedTitle, content: { type: 'doc', content }, css };
    const result = [...chapters.slice(0, start), merged, ...chapters.slice(end + 1)];
    const updated = result.map(chapter => {
        let changed = false;
        const document = structuredClone(chapter.content);
        walkDocument(document, node => {
            for (const mark of node.marks || []) {
                if (mark.type !== 'link' || !mark.attrs?.href?.startsWith('epub:')) continue;
                const [chapterId, anchor] = mark.attrs.href.slice(5).split('#');
                const target = targets.get(chapterId);
                if (!target) continue;
                const destination = anchor ? target.replacements.get(anchor) || anchor : chapterId === first.id ? null : target.boundary;
                const href = `epub:${first.id}${destination ? `#${destination}` : ''}`;
                if (mark.attrs.href !== href) { mark.attrs.href = href; changed = true; }
            }
        });
        return changed ? { ...chapter, content: document } : chapter;
    });
    return { chapters: updated, selectedId: first.id };
}

const body = chapter => chapter ? JSON.stringify([chapter.content, chapter.css || '']) : null;
export function contentHistoryEntry(before, after, focusId, editorStates) {
    const ids = [...new Set([...before, ...after].map(item => item.id))].filter(id => body(before.find(item => item.id === id)) !== body(after.find(item => item.id === id)));
    return { chapters: before, ids, expected: after, focusId, editorStates };
}

export function restoredChapters(current, entry) {
    if (Array.isArray(entry)) return entry.map(item => current.find(existing => existing.id === item.id) || item);
    if (entry.ids.some(id => body(current.find(item => item.id === id)) !== body(entry.expected.find(item => item.id === id)))) throw projectError('CHAPTER_HISTORY_CHANGED');
    return entry.chapters.map(item => {
        const existing = current.find(value => value.id === item.id);
        return existing ? entry.ids.includes(item.id) ? { ...existing, title: existing.title === entry.expected.find(value => value.id === item.id)?.title ? item.title : existing.title, content: item.content, css: item.css } : existing : item;
    });
}
