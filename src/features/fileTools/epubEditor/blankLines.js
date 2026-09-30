import { projectError, walkDocument } from '../../../../electron/epubEditor/model.js';

const containers = new Set(['doc', 'blockquote', 'column', 'columns', 'bulletList', 'orderedList', 'listItem']);

function blankInline(node) {
    if (node.marks?.some(mark => ['link', 'code', 'tts'].includes(mark.type))) return false;
    return node.type === 'hardBreak' || (node.type === 'text' && !node.text.trim());
}

function cleanDocument(document, linkedIds) {
    let count = 0;
    const removable = node => node.type === 'paragraph' && !linkedIds.has(node.attrs?.id)
        && removableContent(node);
    const cleanParagraph = node => {
        if (linkedIds.has(node.attrs?.id) && removableContent(node)) return node;
        const original = node.content || [];
        if (!original.length) return node;
        const content = [];
        let line = [];
        let changed = false;
        const emit = newline => {
            if (line.some(child => !blankInline(child)) || (newline && !blankInline(newline))) {
                for (const child of line) content.push(child);
                if (newline) content.push(newline);
            } else if (line.length || newline) {
                changed = true;
                count += 1;
            }
            line = [];
        };
        for (const child of original) {
            if (child.type === 'hardBreak') emit(child);
            else line.push(child);
        }
        emit(null);
        return changed ? { ...node, content } : node;
    };
    const visit = node => {
        if (node.type === 'paragraph') return cleanParagraph(node);
        if (!containers.has(node.type) || !node.content?.length) return node;
        // Keep a paragraph when the container or list-item schema requires one.
        const keepFirst = node.content.every(removable) || (node.type === 'listItem'
            && node.content.find(child => !removable(child))?.type !== 'paragraph');
        const content = [];
        let changed = false;
        node.content.forEach((child, index) => {
            if (removable(child) && !(keepFirst && index === 0)) {
                count += 1;
                changed = true;
                return;
            }
            const next = visit(child);
            changed ||= next !== child;
            content.push(next);
        });
        return changed ? { ...node, content } : node;
    };
    const content = visit(document);
    return { content, count };
}

function removableContent(node) {
    return (node.content || []).every(blankInline);
}

export function removeProjectBlankLines(chapters, chapterId, scope = 'chapter') {
    if (!['chapter', 'book'].includes(scope) || !chapters.some(chapter => chapter.id === chapterId)) {
        throw projectError('INVALID_PROJECT');
    }
    const references = new Map();
    for (const chapter of chapters) {
        walkDocument(chapter.content, node => {
            for (const mark of node.marks || []) {
                const href = mark.type === 'link' && mark.attrs?.href;
                if (typeof href !== 'string' || !href.startsWith('epub:')) continue;
                const [target, id] = href.slice(5).split('#');
                if (!id) continue;
                if (!references.has(target)) references.set(target, new Set());
                references.get(target).add(id);
            }
        });
    }
    const updates = [];
    let count = 0;
    for (const chapter of chapters) {
        if (scope === 'chapter' && chapter.id !== chapterId) continue;
        const result = cleanDocument(chapter.content, references.get(chapter.id) || new Set());
        if (!result.count) continue;
        updates.push({ id: chapter.id, content: result.content });
        count += result.count;
    }
    return { updates, count };
}

export function applyBlankLineUpdates(chapters, updates) {
    const byId = new Map(updates.map(update => [update.id, update.content]));
    return chapters.map(chapter => byId.has(chapter.id) ? { ...chapter, content: byId.get(chapter.id) } : chapter);
}
