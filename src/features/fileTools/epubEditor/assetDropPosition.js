const LINE_WIDTH = 3;

function readRect(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect || !['left', 'right', 'top', 'bottom'].every(key => Number.isFinite(rect[key]))) return null;
    return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

function acceptsAssets(parent, index, schema) {
    return ['image', 'audio'].every(name => schema.nodes[name] && parent.canReplaceWith(index, index, schema.nodes[name]));
}

function nearestContainerPosition(view, node, start, point) {
    const { schema } = view.state;
    const rect = readRect(view.nodeDOM(start - 1));
    if (!rect) return null;
    const atEnd = point.top >= (rect.top + rect.bottom) / 2;
    const index = atEnd ? node.childCount : 0;
    if (acceptsAssets(node, index, schema)) return start + (atEnd ? node.content.size : 0);
    let nearest = null;
    node.forEach((child, offset) => {
        if (child.isLeaf) return;
        const childRect = readRect(view.nodeDOM(start + offset));
        if (!childRect) return;
        const dx = Math.max(childRect.left - point.left, 0, point.left - childRect.right);
        const dy = Math.max(childRect.top - point.top, 0, point.top - childRect.bottom);
        const distance = dx * dx + dy * dy;
        if (!nearest || distance < nearest.distance) nearest = { child, start: start + offset + 1, distance };
    });
    return nearest ? nearestContainerPosition(view, nearest.child, nearest.start, point) : null;
}

function blockRect(view, $position, editorRect) {
    const { nodeBefore, nodeAfter } = $position;
    const beforeRect = nodeBefore && readRect(view.nodeDOM($position.pos - nodeBefore.nodeSize));
    const afterRect = nodeAfter && readRect(view.nodeDOM($position.pos));
    const parentRect = $position.depth ? readRect(view.nodeDOM($position.before())) : editorRect;
    if (!parentRect || (!beforeRect && !afterRect)) return null;
    const left = Math.max(parentRect.left, Math.min(beforeRect?.left ?? Infinity, afterRect?.left ?? Infinity));
    const right = Math.min(parentRect.right, Math.max(beforeRect?.right ?? -Infinity, afterRect?.right ?? -Infinity));
    const top = beforeRect && afterRect ? (beforeRect.bottom + afterRect.top) / 2 : beforeRect?.bottom ?? afterRect.top;
    if (right <= left) return null;
    return { left, top: top - LINE_WIDTH / 2, width: right - left, height: LINE_WIDTH };
}

export function resolveAssetDropPosition(view, point) {
    if (!view || view.isDestroyed || view.editable === false || !Number.isFinite(point?.left) || !Number.isFinite(point?.top)) return null;
    try {
        const { doc } = view.state;
        const editorRect = readRect(view.dom);
        if (!editorRect) return null;
        const viewport = view.dom.ownerDocument?.defaultView;
        const left = Math.max(editorRect.left, 0);
        const right = Math.min(editorRect.right, viewport?.innerWidth ?? Infinity);
        const top = Math.max(editorRect.top, 0);
        const bottom = Math.min(editorRect.bottom, viewport?.innerHeight ?? Infinity);
        if (right <= left || bottom <= top) return null;
        const insetX = Math.min(1, (right - left) / 2);
        const insetY = Math.min(1, (bottom - top) / 2);
        const coords = {
            left: Math.max(left + insetX, Math.min(right - insetX, point.left)),
            top: Math.max(top + insetY, Math.min(bottom - insetY, point.top)),
        };
        const hit = view.posAtCoords(coords);
        if (!hit || !Number.isInteger(hit.pos) || hit.pos < 0 || hit.pos > doc.content.size) return null;
        let position = hit.pos;
        const firstRect = doc.firstChild && readRect(view.nodeDOM(0));
        const lastRect = doc.lastChild && readRect(view.nodeDOM(doc.content.size - doc.lastChild.nodeSize));
        if (firstRect && coords.top < firstRect.top) position = 0;
        else if (lastRect && coords.top > lastRect.bottom) position = doc.content.size;
        else if (Number.isInteger(hit.inside) && hit.inside >= 0 && hit.inside < doc.content.size) {
            const node = doc.nodeAt(hit.inside);
            const nodeRect = node?.isBlock && node.isAtom && readRect(view.nodeDOM(hit.inside));
            if (nodeRect && coords.top >= nodeRect.top && coords.top <= nodeRect.bottom) {
                position = hit.inside + (coords.top < (nodeRect.top + nodeRect.bottom) / 2 ? 0 : node.nodeSize);
            }
        }
        let $position = doc.resolve(position);
        if (!$position.parent.inlineContent && !acceptsAssets($position.parent, $position.index(), view.state.schema)) {
            if (!$position.depth) return null;
            position = nearestContainerPosition(view, $position.parent, $position.start(), coords);
            if (position === null) return null;
            $position = doc.resolve(position);
        }
        const inline = $position.parent.inlineContent;
        let rect;
        if (inline) {
            const caret = view.coordsAtPos(position);
            if (!caret || !['left', 'top', 'bottom'].every(key => Number.isFinite(caret[key])) || caret.bottom <= caret.top) return null;
            rect = { left: caret.left - LINE_WIDTH / 2, top: caret.top, width: LINE_WIDTH, height: caret.bottom - caret.top };
        } else {
            rect = blockRect(view, $position, editorRect);
        }
        return rect ? { position, rect, inline } : null;
    } catch {
        return null;
    }
}
