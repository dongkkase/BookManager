import { Mark } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { newId, projectError } from '../../../../electron/epubEditor/model.js';
import { contentHistoryEntry } from './chapterOperations.js';

export const TtsMark = Mark.create({
    name: 'tts',
    inclusive: false,
    clearable: false,
    addAttributes() {
        return { id: { default: null, rendered: false }, mode: { default: 'read', rendered: false }, text: { default: '', rendered: false } };
    },
    parseHTML() {
        return [{ tag: 'span[data-bm-tts]', getAttrs: element => {
            const mode = element.getAttribute('data-bm-tts');
            const text = element.getAttribute('data-bm-tts-text') || '';
            const id = element.getAttribute('data-bm-tts-id');
            if (!['read', 'replace', 'skip'].includes(mode) || text.length > 2000 || (mode === 'replace' && !text.trim())) return false;
            return { id: /^[a-z][a-z0-9_-]{0,79}$/i.test(id || '') ? id : newId('tts'), mode, text: mode === 'replace' ? text : '' };
        } }];
    },
    renderHTML({ mark }) {
        return ['span', { 'data-bm-tts': mark.attrs.mode, 'data-bm-tts-id': mark.attrs.id, ...(mark.attrs.mode === 'replace' ? { 'data-bm-tts-text': mark.attrs.text } : {}) }, 0];
    },
    addProseMirrorPlugins() {
        return [new Plugin({ props: { transformPasted(slice) {
            const ids = new Map();
            const remap = fragment => Fragment.fromArray(Array.from({ length: fragment.childCount }, (_, index) => {
                const node = fragment.child(index);
                const marks = node.marks.map(mark => {
                    if (mark.type.name !== 'tts') return mark;
                    if (!ids.has(mark.attrs.id)) ids.set(mark.attrs.id, newId('tts'));
                    return mark.type.create({ ...mark.attrs, id: ids.get(mark.attrs.id) });
                });
                return (node.isLeaf ? node : node.copy(remap(node.content))).mark(marks);
            }));
            return new slice.constructor(remap(slice.content), slice.openStart, slice.openEnd);
        } } })];
    },
});

export function ttsAnnotationTransaction(state, annotation) {
    const tr = state.tr;
    if (!annotation) return tr;
    const { from, to, mode, text = '' } = annotation;
    const mark = state.schema.marks.tts;
    if (!mark || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to <= from || to >= state.doc.content.size || !['auto', 'read', 'replace', 'skip'].includes(mode)) throw projectError('INVALID_DOCUMENT');
    const start = state.doc.resolve(from);
    const end = state.doc.resolve(to);
    if (!start.sameParent(end) || !start.parent.isTextblock || !start.parent.type.allowsMarkType(mark)) throw projectError('INVALID_DOCUMENT');
    let allowed = true;
    state.doc.nodesBetween(from, to, node => {
        if ((node.isInline && !node.isText && node.type.name !== 'hardBreak') || node.marks.some(item => item.type.name === 'code')) allowed = false;
    });
    if (!allowed || typeof text !== 'string' || text.length > 2000 || (mode === 'replace' && !text.trim())) throw projectError('INVALID_DOCUMENT');
    tr.removeMark(from, to, mark);
    if (mode !== 'auto') tr.addMark(from, to, mark.create({ id: newId('tts'), mode, text: mode === 'replace' ? text : '' }));
    return tr.setSelection(TextSelection.create(tr.doc, from, to)).removeStoredMark(mark);
}

export function ttsHistoryEntry(before, after, focusId, editorStates) {
    const entry = contentHistoryEntry(before.chapters, after.chapters, focusId, editorStates);
    if (!entry.ids.includes(focusId)) entry.ids.push(focusId);
    return { ...entry, ttsSnapshot: { value: before.tts ?? null, expected: after.tts ?? null } };
}

export function restoreTtsSettings(project, entry) {
    if (!entry.ttsSnapshot) return project;
    if (JSON.stringify(project.tts ?? null) !== JSON.stringify(entry.ttsSnapshot.expected)) throw projectError('CHAPTER_HISTORY_CHANGED');
    const next = { ...project };
    if (entry.ttsSnapshot.value === null) delete next.tts;
    else next.tts = entry.ttsSnapshot.value;
    return next;
}
