import { Extension, Mark } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { BLOCK_STYLES, INLINE_STYLES, HIGHLIGHTS } from '../../../../electron/epubEditor/authoring.js';

export const BlockStyle = Extension.create({
    name: 'blockStyle',
    addGlobalAttributes() {
        return [{ types: ['paragraph', 'heading'], attributes: { blockStyle: {
            default: null,
            parseHTML: element => Object.keys(BLOCK_STYLES).find(key => element.classList.contains(`bm-style-${key}`)) || null,
            renderHTML: attrs => Object.hasOwn(BLOCK_STYLES, attrs.blockStyle) ? { class: `bm-style-${attrs.blockStyle}` } : {},
        } } }];
    },
});

function presetMark(name, tag, presets, prefix) {
    return Mark.create({
        name,
        addAttributes() { return { preset: { default: Object.keys(presets)[0], rendered: false } }; },
        parseHTML() { return Object.keys(presets).map(preset => ({ tag: `${tag}.${prefix}${preset}`, attrs: { preset } })); },
        renderHTML({ mark }) { return [tag, { class: `${prefix}${mark.attrs.preset}` }, 0]; },
    });
}
export const InlineStyle = presetMark('inlineStyle', 'span', INLINE_STYLES, 'bm-style-');
export const Highlight = presetMark('highlight', 'mark', HIGHLIGHTS, 'bm-highlight-');
export const Superscript = Mark.create({ name: 'superscript', excludes: 'subscript', parseHTML: () => [{ tag: 'sup' }], renderHTML: () => ['sup', {}, 0] });
export const Subscript = Mark.create({ name: 'subscript', excludes: 'superscript', parseHTML: () => [{ tag: 'sub' }], renderHTML: () => ['sub', {}, 0] });

export function canApplyScript(editor, type) {
    const mark = editor.schema.marks[type];
    if (!mark) return false;
    const { selection, doc, storedMarks } = editor.state;
    if (selection.empty) return selection.$from.parent.inlineContent && selection.$from.parent.type.allowsMarkType(mark) && !(storedMarks || selection.$from.marks()).some(item => item.type.name === 'code');
    let allowed = false;
    doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => {
        if (node.isText && parent.type.allowsMarkType(mark) && !node.marks.some(item => item.type.name === 'code')) allowed = true;
    });
    return allowed;
}

export function toggleScript(editor, type) {
    if (!['superscript', 'subscript'].includes(type) || !canApplyScript(editor, type)) return false;
    return editor.chain().command(({ tr }) => { closeHistory(tr); return true; }).unsetMark(type === 'superscript' ? 'subscript' : 'superscript').toggleMark(type).run();
}

export function styledBlockPositions(state) {
    const positions = new Set();
    for (const { $from, $to } of state.selection.ranges) {
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (['paragraph', 'heading'].includes(node.type.name)) positions.add(pos);
        });
    }
    return positions;
}

export function applyBlockStyle(editor, preset) {
    if (preset != null && !Object.hasOwn(BLOCK_STYLES, preset)) return false;
    return editor.commands.command(({ state, tr, dispatch }) => {
        const positions = styledBlockPositions(state);
        if (!positions.size) return false;
        if (dispatch) {
            closeHistory(tr);
            for (const pos of positions) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos).attrs, blockStyle: preset });
        }
        return true;
    });
}

export function clearAuthorFormatting(editor) {
    return editor.chain().command(({ state, tr }) => {
        closeHistory(tr);
        for (const pos of styledBlockPositions(state)) tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos).attrs, blockStyle: null, paragraphFormat: null });
        return true;
    }).unsetAllMarks().unsetTextAlign().command(({ commands }) => { commands.resetParagraphIndent(); return true; }).run();
}

export function applyPresetMark(editor, type, preset) {
    const presets = type === 'highlight' ? HIGHLIGHTS : type === 'inlineStyle' ? INLINE_STYLES : null;
    if (!presets || (preset != null && !Object.hasOwn(presets, preset))) return false;
    const chain = editor.chain().command(({ tr }) => { closeHistory(tr); return true; });
    return preset == null ? chain.unsetMark(type).run() : chain.setMark(type, { preset }).run();
}

export function insertCharacter(editor, text) {
    if (typeof text !== 'string' || !text || text.length > 32) return false;
    return editor.commands.command(({ tr }) => { closeHistory(tr); tr.insertText(text); return true; });
}
