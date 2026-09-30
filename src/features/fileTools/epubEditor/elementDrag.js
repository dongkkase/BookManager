import { Fragment, Slice } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

export const ELEMENT_DRAG = 'application/x-bookmanager-epub-element';
export const MOVABLE_ELEMENTS = new Set(['horizontalRule', 'image', 'audio', 'media', 'table', 'columns']);

export function movableElement(state, from) {
    if (!Number.isInteger(from) || from < 0 || from >= state.doc.content.size) return null;
    const node = state.doc.nodeAt(from);
    return node && MOVABLE_ELEMENTS.has(node.type.name) ? { from, to: from + node.nodeSize, node, doc: state.doc } : null;
}

export function elementAtTarget(view, target) {
    let element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!view.dom.contains(element)) return null;
    while (element && element !== view.dom) {
        try {
            const index = Array.prototype.indexOf.call(element.parentNode.childNodes, element);
            const from = view.posAtDOM(element.parentNode, index);
            const source = movableElement(view.state, from);
            if (source && view.nodeDOM(from)?.contains(target)) return source;
        } catch { /* Editor decorations may not have a document position. */ }
        element = element.parentElement;
    }
    return null;
}

export function validElementDestination(state, source, position) {
    return !!source && source.doc === state.doc && Number.isInteger(position) && position >= 0 && position <= state.doc.content.size
        && (position < source.from || position > source.to);
}

export function moveElementTransaction(state, source, position) {
    if (!validElementDestination(state, source, position)) return null;
    try {
        const tr = closeHistory(state.tr).delete(source.from, source.to);
        const destination = tr.mapping.map(position);
        const insertMap = tr.mapping.maps.length;
        tr.replaceRange(destination, destination, new Slice(Fragment.from(source.node), 0, 0));
        let inserted = null;
        for (const map of tr.mapping.maps.slice(insertMap)) map.forEach((_from, _to, start, end) => {
            tr.doc.nodesBetween(start, end, (node, pos) => {
                if (inserted == null && node.eq(source.node)) { inserted = pos; return false; }
            });
        });
        if (inserted == null || tr.doc.eq(state.doc)) return null;
        return tr.setSelection(NodeSelection.create(tr.doc, inserted)).scrollIntoView();
    } catch {
        return null;
    }
}

export function adjacentElementPosition(state, from, direction) {
    const source = movableElement(state, from);
    if (!source || ![-1, 1].includes(direction)) return null;
    const $from = state.doc.resolve(from);
    const index = $from.index();
    const sibling = $from.parent.maybeChild(index + direction);
    return sibling ? direction < 0 ? from - sibling.nodeSize : source.to + sibling.nodeSize : null;
}
