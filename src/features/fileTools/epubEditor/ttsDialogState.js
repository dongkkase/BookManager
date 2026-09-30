import { getMarkRange } from '@tiptap/core';
import { documentTtsPreview, TTS_LIMITS } from '../../../../electron/epubEditor/tts.js';

export function captureTtsSelection(state) {
    const { doc, schema, selection } = state;
    const markType = schema.marks.tts;
    let { from, to } = selection;
    const initialFrom = from;
    const initialTo = to;
    if (markType && selection.empty) {
        const range = getMarkRange(doc.resolve(from), markType);
        if (range) ({ from, to } = range);
    }
    if (markType && from < to) {
        let changed = true;
        while (changed) {
            changed = false;
            doc.nodesBetween(from, to, (node, position) => {
                const mark = node.marks.find(item => item.type === markType);
                if (!mark) return;
                const range = getMarkRange(doc.resolve(Math.max(from, position)), markType, mark.attrs);
                if (!range) return;
                if (range.from < from) { from = range.from; changed = true; }
                if (range.to > to) { to = range.to; changed = true; }
            });
        }
    }
    const selected = from < to;
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    let canAnnotate = Boolean(selected && markType && $from.sameParent($to)
        && $from.parent.isTextblock && $from.parent.type.allowsMarkType(markType));
    let firstMark;
    let sameMark = true;
    if (selected) doc.nodesBetween(from, to, node => {
        if (!node.isInline) return;
        if ((!node.isText && node.type.name !== 'hardBreak') || node.marks.some(mark => mark.type.name === 'code')) canAnnotate = false;
        const mark = node.marks.find(item => item.type === markType)?.attrs || null;
        if (firstMark === undefined) firstMark = mark;
        else if (JSON.stringify(firstMark) !== JSON.stringify(mark)) sameMark = false;
    });
    return {
        from, to, selected, canAnnotate,
        expanded: selected && (from !== initialFrom || to !== initialTo),
        content: selected ? doc.slice(from, to).content.toJSON() || [] : doc.toJSON(),
        annotation: sameMark && firstMark ? { ...firstMark } : null,
        mixed: !sameMark,
    };
}

export function draftTtsPreview(snapshot, dictionary, annotation = null, options = {}) {
    const visit = node => {
        const next = { ...node };
        if (node.content) next.content = node.content.map(visit);
        if (node.type === 'text' || node.type === 'hardBreak') {
            next.marks = (node.marks || []).filter(mark => mark.type !== 'tts');
            if (annotation.mode !== 'auto') next.marks.push({
                type: 'tts',
                attrs: { id: annotation.id, mode: annotation.mode, text: annotation.mode === 'replace' ? annotation.text : '' },
            });
        }
        return next;
    };
    const content = annotation && snapshot.canAnnotate
        ? (Array.isArray(snapshot.content) ? snapshot.content.map(visit) : visit(snapshot.content))
        : snapshot.content;
    return documentTtsPreview(content, dictionary, options);
}

export function ttsDraftError(dictionary, annotation) {
    if (dictionary.length > TTS_LIMITS.dictionary) return 'dictionaryLimit';
    const sources = new Set();
    const ids = new Set();
    for (const item of dictionary) {
        if (!item.source.trim() || !item.replacement.trim()) return 'dictionaryEmpty';
        if (item.source.length > TTS_LIMITS.source || item.replacement.length > TTS_LIMITS.replacement) return 'dictionaryLength';
        if (sources.has(item.source) || ids.has(item.id)) return 'dictionaryDuplicate';
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(item.source + item.replacement)) return 'invalidText';
        sources.add(item.source);
        ids.add(item.id);
    }
    if (annotation?.mode === 'replace') {
        if (!annotation.text.trim()) return 'replacementEmpty';
        if (annotation.text.length > TTS_LIMITS.replacement) return 'replacementLength';
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(annotation.text)) return 'invalidText';
    }
    return null;
}
