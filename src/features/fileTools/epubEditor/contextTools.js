import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';

export function selectionContext(state) {
    const selection = state.selection;
    const { from, to, $from } = selection;
    if (selection instanceof NodeSelection && ['image', 'audio', 'media', 'footnote', 'table'].includes(selection.node.type.name)) {
        return { kind: selection.node.type.name, anchor: from, from, to, before: from, after: to };
    }
    if (selection instanceof TextSelection && !selection.empty && state.doc.textBetween(from, to).trim()) return { kind: 'text', from, to };
    const link = selection.empty && $from.marks().find(mark => mark.type.name === 'link');
    if (link) return { kind: 'link', href: link.attrs.href, from, to };
    let cell = selection instanceof CellSelection ? selection.$headCell.pos : null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) cell ??= $from.before(depth);
        if ($from.node(depth).type.name === 'table') {
            return { kind: 'table', anchor: cell ?? $from.before(depth), from, to, before: $from.before(depth), after: $from.after(depth) };
        }
    }
    if (selection.empty && $from.parent.isTextblock) return { kind: 'block', from, to, anchor: $from.before() };
    return null;
}

export function placeContextToolbar(anchor, bounds, size) {
    if (anchor.bottom < bounds.top || anchor.top > bounds.bottom || anchor.right < bounds.left || anchor.left > bounds.right) return null;
    const gap = 8;
    const width = Math.min(size.width, bounds.right - bounds.left);
    const height = Math.min(size.height, bounds.bottom - bounds.top);
    const left = Math.max(bounds.left, Math.min(bounds.right - width, (Math.max(anchor.left, bounds.left) + Math.min(anchor.right, bounds.right) - width) / 2));
    const above = anchor.top - height - gap;
    const below = anchor.bottom + gap;
    const top = above >= bounds.top ? above : below + height <= bounds.bottom ? below : Math.max(bounds.top, Math.min(bounds.bottom - height, above));
    return { left, top };
}

export function toolbarFocusIndex(current, key, count) {
    if (!count) return -1;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowRight') return (current + 1 + count) % count;
    if (key === 'ArrowLeft') return (current - 1 + count) % count;
    return -1;
}
