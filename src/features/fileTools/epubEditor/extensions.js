import { Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import UniqueID from '@tiptap/extension-unique-id';
import { ParagraphIndent } from './paragraphIndent';
import { ParagraphFormat } from './paragraphFormats';
import { EditorTab } from './editorTab';
import { BlockStyle, InlineStyle, Highlight, Superscript, Subscript } from './richFormatting';
import { Media } from './media';
import { editorText as l } from './labels';
import { newId, safeLink } from '../../../../electron/epubEditor/model';
import { createImageExtension } from './imageNode';
import './imageNodes.css';

export function editorExtensions(getAssetUrl) {
    const Image = createImageExtension(getAssetUrl, l);
    const CellStyle = Extension.create({
        name: 'cellStyle',
        addGlobalAttributes() {
            return [{ types: ['tableCell', 'tableHeader'], attributes: {
                backgroundColor: { default: null, parseHTML: element => /^#[0-9a-f]{6}$/i.test(element.getAttribute('data-cell-background') || '') ? element.getAttribute('data-cell-background') : null, renderHTML: attrs => attrs.backgroundColor ? { 'data-cell-background': attrs.backgroundColor, style: `background-color:${attrs.backgroundColor}` } : {} },
                verticalAlign: { default: 'top', parseHTML: element => ['top', 'middle', 'bottom'].includes(element.getAttribute('data-cell-align')) ? element.getAttribute('data-cell-align') : 'top', renderHTML: attrs => ({ 'data-cell-align': attrs.verticalAlign, style: `vertical-align:${attrs.verticalAlign}` }) },
                cellPadding: { default: null, parseHTML: element => { const value = element.getAttribute('data-cell-padding'); return value != null && Number(value) >= 0 && Number(value) <= 32 ? Number(value) : null; }, renderHTML: attrs => attrs.cellPadding != null ? { 'data-cell-padding': attrs.cellPadding, style: `padding:${attrs.cellPadding}px` } : {} },
            } }];
        },
    });
    const Footnote = Node.create({
        name: 'footnote', group: 'inline', inline: true, atom: true,
        addAttributes() { return { id: { default: null }, text: { default: '' } }; },
        parseHTML() { return [{ tag: 'span[data-footnote]', getAttrs: element => ({ text: element.getAttribute('data-footnote') || '', id: newId() }) }]; },
        renderHTML({ node }) { return ['span', { 'data-footnote': node.attrs.text, class: 'ee-footnote-ref' }, '※']; },
        addNodeView() {
            return ({ node, editor, getPos }) => {
                const dom = document.createElement('sup');
                dom.className = 'ee-footnote-ref';
                const draw = () => {
                    const position = getPos();
                    let number = 0;
                    editor.state.doc.descendants((item, pos) => { if (item.type.name === 'footnote' && pos <= position) number += 1; });
                    dom.textContent = `[${number}]`;
                    dom.title = node.attrs.text || l('footnote');
                };
                editor.on('transaction', draw);
                draw();
                return { dom, update(next) { if (next.type.name !== 'footnote') return false; node = next; draw(); return true; }, destroy() { editor.off('transaction', draw); } };
            };
        },
    });
    const Audio = Node.create({
        name: 'audio', group: 'block', atom: true, draggable: true,
        addAttributes() { return { assetId: { default: '' }, title: { default: '' }, kind: { default: 'effect' }, loop: { default: false } }; },
        parseHTML() { return [{ tag: 'figure[data-audio-asset]', getAttrs: element => {
            const assetId = element.getAttribute('data-audio-asset');
            return getAssetUrl(assetId) ? { assetId, title: element.getAttribute('data-title') || '', kind: element.getAttribute('data-kind') === 'background' ? 'background' : 'effect', loop: element.getAttribute('data-loop') === 'true' } : false;
        } }]; },
        renderHTML({ node }) { return ['figure', { 'data-audio-asset': node.attrs.assetId, 'data-title': node.attrs.title, 'data-kind': node.attrs.kind, 'data-loop': String(node.attrs.loop), class: 'ee-audio-node' }, ['figcaption', {}, node.attrs.title || l('audio')], ['audio', { src: getAssetUrl(node.attrs.assetId), controls: 'controls', preload: 'none', ...(node.attrs.loop ? { loop: 'loop' } : {}) }]]; },
        addNodeView() {
            return ({ node }) => {
                const dom = document.createElement('figure');
                dom.className = 'ee-audio-node';
                const caption = document.createElement('figcaption');
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.preload = 'none';
                const draw = () => { caption.textContent = `${l(node.attrs.kind === 'background' ? 'backgroundAudio' : 'effect')} · ${node.attrs.title || l('audio')}`; const url = getAssetUrl(node.attrs.assetId); if (audio.getAttribute('src') !== url) audio.src = url; audio.loop = node.attrs.loop; };
                dom.append(caption, audio);
                draw();
                return { dom, update(next) { if (next.type.name !== 'audio') return false; node = next; draw(); return true; }, stopEvent(event) { return event.target === audio; }, ignoreMutation() { return true; }, destroy() { audio.pause(); audio.removeAttribute('src'); audio.load(); } };
            };
        },
    });
    const Columns = Node.create({
        name: 'columns', group: 'block', content: 'column{2,3}', isolating: true,
        parseHTML() { return [{ tag: 'div.ee-columns' }]; },
        renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'ee-columns' }), 0]; },
    });
    const Column = Node.create({
        name: 'column', content: 'block+', isolating: true,
        parseHTML() { return [{ tag: 'div.ee-column' }]; },
        renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'ee-column' }), 0]; },
    });
    return [
        StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: { openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['epub'], isAllowedUri: url => safeLink(url) } }),
        TableKit.configure({ table: { resizable: true, lastColumnResizable: true } }), TextStyle, Color, BackgroundColor, FontFamily, FontSize,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        UniqueID.configure({ types: ['paragraph', 'heading', 'image', 'table', 'columns', 'blockquote', 'footnote', 'audio', 'media'], generateID: () => newId() }),
        Image, Footnote, Audio, Media, Columns, Column, CellStyle, ParagraphIndent, ParagraphFormat, EditorTab,
        BlockStyle, InlineStyle, Highlight, Superscript, Subscript,
    ];
}

export function findEditorMatches(editor, query) {
    const matches = [];
    if (!query) return matches;
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    editor.state.doc.descendants((node, position) => {
        if (!node.isTextblock) return;
        const text = node.textBetween(0, node.content.size, '\n', '\ufffc');
        expression.lastIndex = 0;
        let match;
        while ((match = expression.exec(text))) {
            matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
        }
        return false;
    });
    return matches;
}
