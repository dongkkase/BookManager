import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { DEFAULT_PARAGRAPH_FORMAT, normalizeParagraphFormat, paragraphFormatCss } from '../../../../electron/epubEditor/paragraphFormats.js';
import { selectedIndentBlocks } from './paragraphIndent.js';

export const ParagraphFormat = Extension.create({
    name: 'paragraphFormat',
    addGlobalAttributes() {
        return [{ types: ['paragraph', 'heading'], attributes: { paragraphFormat: {
            default: null,
            parseHTML: element => {
                try { return normalizeParagraphFormat(JSON.parse(element.getAttribute('data-paragraph-format')), true); }
                catch { return null; }
            },
            renderHTML: attrs => attrs.paragraphFormat ? { 'data-paragraph-format': JSON.stringify(attrs.paragraphFormat), style: paragraphFormatCss(attrs.paragraphFormat) } : {},
        } } }];
    },
    addCommands() {
        return { clearParagraphFormat: () => ({ tr, dispatch }) => {
            const blocks = selectedIndentBlocks({ doc: tr.doc, selection: tr.selection }).filter(({ node }) => node.attrs.paragraphFormat);
            if (dispatch && blocks.length) {
                closeHistory(tr);
                for (const { pos, node } of blocks) tr.setNodeMarkup(pos, undefined, { ...node.attrs, paragraphFormat: null });
            }
            return true;
        } };
    },
});

function formatTargets(state, format) {
    const blocks = selectedIndentBlocks(state);
    const type = state.schema.nodes[format.base === 'paragraph' ? 'paragraph' : 'heading'];
    if (!type || !blocks.length) return null;
    for (const { pos } of blocks) {
        const resolved = state.doc.resolve(pos);
        if (!resolved.parent.canReplaceWith(resolved.index(), resolved.index() + 1, type)) return null;
    }
    return { blocks, type };
}

export function canApplyParagraphFormat(editor, format) {
    try { return !!formatTargets(editor.state, normalizeParagraphFormat(format, true)); }
    catch { return false; }
}

export function applyParagraphFormat(editor, value) {
    let format;
    try { format = normalizeParagraphFormat(value, true); } catch { return false; }
    return editor.commands.command(({ tr, state, dispatch }) => {
        const targets = formatTargets({ ...state, schema: state.schema, doc: tr.doc, selection: tr.selection }, format);
        if (!targets) return false;
        if (dispatch) {
            closeHistory(tr);
            for (const { pos, node } of targets.blocks) tr.setNodeMarkup(pos, targets.type, {
                ...node.attrs, ...(format.base === 'paragraph' ? {} : { level: Number(format.base.slice(-1)) }),
                paragraphFormat: structuredClone(format), blockStyle: null, textAlign: format.alignment,
                indentLevel: format.indentLevel, firstLineIndent: format.firstLineIndent,
            });
        }
        return true;
    });
}

export function selectedParagraphFormat(editor) {
    const blocks = selectedIndentBlocks(editor.state);
    const first = blocks[0]?.node.attrs.paragraphFormat;
    return first && blocks.every(({ node }) => node.attrs.paragraphFormat?.id === first.id) ? first : null;
}

export function paragraphFormatFromSelection(editor) {
    const block = selectedIndentBlocks(editor.state)[0]?.node;
    const previous = block?.attrs.paragraphFormat;
    const text = editor.getAttributes('textStyle');
    const font = text.fontFamily || previous?.font;
    const value = {
        ...DEFAULT_PARAGRAPH_FORMAT, ...previous, name: '', description: '',
        base: block?.type.name === 'heading' ? `heading${block.attrs.level}` : 'paragraph',
        font: ['serif', 'sans-serif', 'monospace'].includes(font) ? font : 'inherit',
        fontSize: text.fontSize ? Number.parseInt(text.fontSize, 10) : previous?.fontSize ?? null,
        color: text.color || previous?.color || null, backgroundColor: text.backgroundColor || previous?.backgroundColor || null,
        bold: editor.isActive('bold') ? true : previous?.bold ?? null,
        italic: editor.isActive('italic') ? true : previous?.italic ?? null,
        alignment: block?.attrs.textAlign || null, indentLevel: block?.attrs.indentLevel || 0,
        firstLineIndent: block?.attrs.firstLineIndent ?? null,
    };
    delete value.id;
    return value;
}
