import { epubTtsAnnotation, epubTtsSegments, epubTtsTextLength, sliceEpubTtsEdits } from '../electron/epubTts.js';
import { renderTtsSegments } from '../electron/epubEditor/tts.js';

function domAnnotation(node) {
    return epubTtsAnnotation({
        'data-bm-tts': node.getAttribute('data-bm-tts'),
        'data-bm-tts-id': node.getAttribute('data-bm-tts-id'),
        'data-bm-tts-text': node.getAttribute('data-bm-tts-text'),
    });
}

export function epubDomTtsSlice(node, start, end, state = {}) {
    const text = node.textContent.slice(start, end);
    let annotated = null;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (domAnnotation(parent)) annotated = parent;
    }
    if (annotated) {
        const annotation = domAnnotation(annotated);
        state.replacements ||= new Set();
        const key = annotation.id || annotated;
        const replacement = annotation.mode === 'replace' && !state.replacements.has(key);
        if (annotation.mode === 'replace') state.replacements.add(key);
        return [{ text: annotation.mode === 'read' ? text : replacement ? annotation.text : '', protected: true }];
    }
    const block = node.parentElement?.closest('[data-bm-tts-edits]');
    if (block) {
        try {
            const range = node.ownerDocument.createRange();
            range.selectNodeContents(block);
            range.setEnd(node, start);
            const offset = epubTtsTextLength(range.toString());
            range.detach();
            return epubTtsSegments(text, sliceEpubTtsEdits(JSON.parse(block.getAttribute('data-bm-tts-edits')), text, offset));
        } catch {}
    }
    return [{ text }];
}

export function selectionEpubTtsText(selection) {
    if (!selection?.rangeCount) return '';
    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer;
    const document = root.ownerDocument;
    const nodes = [];
    if (root.nodeType === 3) nodes.push(root);
    else {
        const walker = document.createTreeWalker(root, 4);
        while (walker.nextNode()) nodes.push(walker.currentNode);
    }
    const segments = [];
    const state = {};
    let previousBlock;
    for (const node of nodes) {
        if (!range.intersectsNode(node) || node.parentElement?.closest('style, script, [hidden], [data-epub-audio-id]')) continue;
        const start = range.startContainer === node ? range.startOffset : 0;
        const end = range.endContainer === node ? range.endOffset : node.textContent.length;
        if (end <= start) continue;
        const block = node.parentElement?.closest('p, div, li, td, th, h1, h2, h3, h4, h5, h6, blockquote');
        if (previousBlock && block !== previousBlock) segments.push({ text: '\n' });
        segments.push(...epubDomTtsSlice(node, start, end, state));
        previousBlock = block;
    }
    return renderTtsSegments(segments, { preserveDialogue: true });
}
