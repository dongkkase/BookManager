import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { MAX_PARAGRAPH_INDENT, paragraphIndentCss, validIndentLevel, validFirstLineIndent } from '../../../../electron/epubEditor/paragraphIndent.js';

export function selectedIndentBlocks(state) {
    const found = new Map();
    const { selection, doc } = state;
    if (selection.empty) {
        for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
            const node = selection.$from.node(depth);
            if (['paragraph', 'heading'].includes(node.type.name)) { found.set(selection.$from.before(depth), node); break; }
        }
    } else {
        for (const { $from, $to } of selection.ranges) doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (!['paragraph', 'heading'].includes(node.type.name)) return;
            if ($to.pos === pos + 1) return false;
            found.set(pos, node);
            return false;
        });
    }
    return [...found].map(([pos, node]) => ({ pos, node }));
}

export function indentSelectionState(state) {
    const blocks = selectedIndentBlocks(state);
    const values = blocks.map(({ node }) => node.attrs.firstLineIndent ?? null);
    return {
        enabled: blocks.length > 0,
        canIncrease: blocks.some(({ node }) => (node.attrs.indentLevel || 0) < MAX_PARAGRAPH_INDENT),
        canDecrease: blocks.some(({ node }) => (node.attrs.indentLevel || 0) > 0),
        firstLine: values.every(value => value === values[0]) ? values[0] ?? null : 'mixed',
    };
}

export function updateParagraphIndent({ tr, dispatch }, change) {
    const changes = selectedIndentBlocks({ doc: tr.doc, selection: tr.selection }).map(({ node, pos }) => ({ node, pos, attrs: change(node.attrs) }))
        .filter(({ node, attrs }) => Object.entries(attrs).some(([key, value]) => (node.attrs[key] ?? (key === 'indentLevel' ? 0 : null)) !== value));
    if (!changes.length) return false;
    if (dispatch) {
        closeHistory(tr);
        for (const { pos, node, attrs } of changes) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    }
    return true;
}

export const ParagraphIndent = Extension.create({
    name: 'paragraphIndent',
    addGlobalAttributes() {
        return [{ types: ['paragraph', 'heading'], attributes: {
            indentLevel: {
                default: 0,
                parseHTML: element => { const value = Number(element.getAttribute('data-indent-level')); return validIndentLevel(value) ? value : 0; },
                renderHTML: attrs => ({ ...(attrs.indentLevel ? { 'data-indent-level': attrs.indentLevel } : {}), ...(paragraphIndentCss(attrs) ? { style: paragraphIndentCss(attrs) } : {}) }),
            },
            firstLineIndent: {
                default: null,
                parseHTML: element => { const raw = element.getAttribute('data-first-line-indent'); const value = raw === null ? null : Number(raw); return validFirstLineIndent(value) ? value : null; },
                renderHTML: attrs => attrs.firstLineIndent === null ? {} : { 'data-first-line-indent': attrs.firstLineIndent },
            },
        } }];
    },
    addCommands() {
        return {
            increaseParagraphIndent: () => props => updateParagraphIndent(props, attrs => ({ indentLevel: Math.min(MAX_PARAGRAPH_INDENT, (attrs.indentLevel || 0) + 1) })),
            decreaseParagraphIndent: () => props => updateParagraphIndent(props, attrs => ({ indentLevel: Math.max(0, (attrs.indentLevel || 0) - 1) })),
            setFirstLineIndent: value => props => validFirstLineIndent(value) && updateParagraphIndent(props, () => ({ firstLineIndent: value })),
            resetParagraphIndent: () => props => updateParagraphIndent(props, () => ({ indentLevel: 0, firstLineIndent: null })),
        };
    },
});
