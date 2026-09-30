import { renderTtsSegments } from './epubEditor/tts.js';

export function epubTtsAnnotation(attributes = {}) {
    const mode = attributes['data-bm-tts'];
    if (!['read', 'replace', 'skip'].includes(mode)) return null;
    return { mode, id: String(attributes['data-bm-tts-id'] || ''), text: String(attributes['data-bm-tts-text'] || '') };
}

export function epubTtsTextLength(text = '') {
    return String(text).replace(/\s/gu, '').length;
}

export function collectEpubTtsEdits(nodes = []) {
    const edits = [];
    let offset = 0;
    const visit = (node, inherited = null) => {
        if (!node || node.hiddenText || node.tagName === 'img') return;
        const annotation = inherited || epubTtsAnnotation(node.attributes);
        if (node.type === 'text') {
            const end = offset + epubTtsTextLength(node.text || '');
            if (annotation && end > offset) {
                const previous = edits.at(-1);
                if (previous && previous.end === offset && previous.group === annotation) previous.end = end;
                else edits.push({ ...annotation, start: offset, end, group: annotation });
            }
            offset = end;
            return;
        }
        for (const child of node.children || []) visit(child, annotation);
    };
    for (const node of nodes) visit(node);
    const merged = [];
    for (const { group: _group, ...edit } of edits) {
        const previous = merged.at(-1);
        if (previous && edit.id && previous.id === edit.id && previous.mode === edit.mode && previous.text === edit.text && previous.end === edit.start) previous.end = edit.end;
        else merged.push(edit);
    }
    return merged;
}

export function sliceEpubTtsEdits(edits = [], text = '', offset = 0) {
    const end = offset + epubTtsTextLength(text);
    return edits.filter(edit => edit.end > offset && edit.start < end).map(edit => ({
        ...edit,
        start: Math.max(0, edit.start - offset),
        end: Math.min(end, edit.end) - offset,
        ...(edit.mode === 'replace' && edit.start < offset ? { mode: 'skip', text: '' } : {}),
    }));
}

export function epubTtsSegments(text = '', edits = []) {
    const source = String(text);
    const positions = [];
    for (let index = 0; index < source.length; index += 1) {
        if (!/\s/u.test(source[index])) positions.push(index);
    }
    const segments = [];
    let cursor = 0;
    for (const edit of edits) {
        const start = positions[edit.start];
        const end = positions[edit.end - 1] + 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < cursor) continue;
        if (start > cursor) segments.push({ text: source.slice(cursor, start) });
        segments.push({ text: edit.mode === 'read' ? source.slice(start, end) : edit.mode === 'replace' ? edit.text : '', protected: true });
        cursor = end;
    }
    if (cursor < source.length) segments.push({ text: source.slice(cursor) });
    return segments;
}

export function epubTtsText(text = '', edits = [], preserveDialogue = true) {
    return renderTtsSegments(epubTtsSegments(text, edits), { preserveDialogue });
}
