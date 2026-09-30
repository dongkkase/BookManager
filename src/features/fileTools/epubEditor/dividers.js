import { canInsertNode, isNodeSelection, mergeAttributes } from '@tiptap/core';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { DIVIDER_STYLES, validDividerStyle } from '../../../../electron/epubEditor/dividers.js';

export const StyledDivider = HorizontalRule.extend({
    draggable: true,
    addAttributes() {
        return { dividerStyle: {
            default: null,
            rendered: false,
            parseHTML: element => Object.keys(DIVIDER_STYLES).find(key => element.classList.contains(`bm-divider-${key}`)) || null,
        } };
    },
    parseHTML() {
        return [{ tag: 'hr' }, ...Object.entries(DIVIDER_STYLES).filter(([, preset]) => preset.symbol).map(([key]) => ({ tag: `div.bm-divider-${key}` }))];
    },
    renderHTML({ node, HTMLAttributes }) {
        const style = node.attrs.dividerStyle;
        if (!validDividerStyle(style)) return ['hr', HTMLAttributes];
        const attrs = mergeAttributes(HTMLAttributes, { class: `bm-divider bm-divider-${style}` });
        const symbol = DIVIDER_STYLES[style].symbol;
        return symbol ? ['div', { ...attrs, role: 'separator' }, ['span', { 'aria-hidden': 'true' }, symbol]] : ['hr', attrs];
    },
});

export function applyDivider(editor, style) {
    if (!editor.isEditable || !validDividerStyle(style)) return false;
    const { selection } = editor.state;
    const chain = editor.chain().command(({ tr }) => { closeHistory(tr); return true; });
    if (isNodeSelection(selection) && selection.node.type.name === 'horizontalRule') {
        return chain.updateAttributes('horizontalRule', { dividerStyle: style }).run();
    }
    if (!canInsertNode(editor.state, editor.schema.nodes.horizontalRule)) return false;
    const node = { type: 'horizontalRule', attrs: { dividerStyle: style } };
    if (isNodeSelection(selection)) chain.insertContentAt(selection.to, node);
    else chain.insertContent(node);
    return chain.command(({ tr, dispatch }) => {
        if (!dispatch) return true;
        const { $to } = tr.selection;
        if ($to.nodeAfter) {
            tr.setSelection($to.nodeAfter.isTextblock ? TextSelection.create(tr.doc, $to.pos + 1) : NodeSelection.create(tr.doc, $to.pos));
        } else {
            const paragraph = editor.schema.nodes.paragraph.create();
            tr.insert($to.end(), paragraph);
            tr.setSelection(TextSelection.create(tr.doc, $to.end() + 1));
        }
        tr.scrollIntoView();
        return true;
    }).run();
}
