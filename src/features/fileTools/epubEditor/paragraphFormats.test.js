import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { CellSelection } from '@tiptap/pm/tables';
import { history } from '@tiptap/pm/history';
import { ParagraphFormat, applyParagraphFormat, canApplyParagraphFormat, selectedParagraphFormat, paragraphFormatFromSelection } from './paragraphFormats.js';
import { ParagraphIndent } from './paragraphIndent.js';
import { BlockStyle, clearAuthorFormatting } from './richFormatting.js';
import { normalizeParagraphFormat } from '../../../../electron/epubEditor/paragraphFormats.js';
import { createProject, paragraph, validateProject, renderChapterBody } from '../../../../electron/epubEditor/model.js';

const format = normalizeParagraphFormat({ id: 'pf_00000000-0000-0000-0000-000000000001', name: '장 제목', base: 'heading2', font: 'serif', fontSize: 28, color: '#123456', lineHeight: 1.5, alignment: 'center', indentLevel: 2, firstLineIndent: -1, spaceBefore: 1, bold: true }, true);
function fixture(t, content = [paragraph('first'), paragraph('second'), paragraph('last')]) {
    const editor = new Editor({ element: null, extensions: [StarterKit, TextStyle, Color, BackgroundColor, TextAlign.configure({ types: ['paragraph', 'heading'] }), TableKit, ParagraphIndent, ParagraphFormat, BlockStyle], content: { type: 'doc', content } });
    editor.registerPlugin(history());
    t.after(() => editor.destroy());
    return editor;
}

test('applying formats changes selected paragraphs together, preserves inline content and has one undo step', t => {
    const editor = fixture(t);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.commands.setBold();
    editor.commands.setLink({ href: 'https://example.com/' });
    editor.commands.setTextSelection({ from: 2, to: 10 });
    const before = editor.getJSON();
    const selection = editor.state.selection.toJSON();
    assert.equal(canApplyParagraphFormat(editor, format), true);
    assert.equal(applyParagraphFormat(editor, format), true);
    const applied = editor.getJSON();
    assert.deepEqual(applied.content.map(node => node.type), ['heading', 'heading', 'paragraph']);
    for (const node of applied.content.slice(0, 2)) {
        assert.equal(node.attrs.level, 2);
        assert.deepEqual(node.attrs.paragraphFormat, format);
        assert.equal(node.attrs.textAlign, 'center');
        assert.equal(node.attrs.indentLevel, 2);
        assert.equal(node.attrs.firstLineIndent, -1);
    }
    assert.deepEqual(applied.content[0].content, before.content[0].content);
    assert.deepEqual(editor.state.selection.toJSON(), selection);
    assert.equal(selectedParagraphFormat(editor).id, format.id);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(editor.getJSON(), applied);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    assert.equal(selectedParagraphFormat(editor), null);
});

test('applying a saved snapshot, returning to a built-in and clearing formatting are reversible', t => {
    const editor = fixture(t);
    editor.commands.setTextSelection(2);
    const value = structuredClone(format);
    applyParagraphFormat(editor, value);
    const applied = editor.getJSON();
    value.color = '#ffffff';
    value.name = 'Renamed in library';
    assert.equal(editor.getJSON().content[0].attrs.paragraphFormat.color, '#123456');
    const seed = paragraphFormatFromSelection(editor);
    assert.equal(seed.id, undefined);
    assert.equal(seed.name, '');
    assert.equal(seed.fontSize, 28);
    assert.equal(seed.base, 'heading2');
    assert.equal(editor.chain().clearParagraphFormat().setParagraph().run(), true);
    assert.equal(selectedParagraphFormat(editor), null);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), applied);
    clearAuthorFormatting(editor);
    assert.equal(selectedParagraphFormat(editor), null);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), applied);
    const project = createProject();
    project.chapters[0].content = applied;
    validateProject(JSON.parse(JSON.stringify(project)));
    const html = renderChapterBody(project.chapters[0], project);
    assert.match(html, /<h2[^>]*font-size:1.75rem/);
    assert.match(html, /color:#123456/);
    assert.match(html, /margin-left:5em;text-indent:-1em/);
    assert.match(html, /data-paragraph-format="\{&quot;name&quot;/);
});

test('heading formats reject list-first paragraphs without partially changing a mixed selection', t => {
    const editor = fixture(t, [paragraph('outside'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('item')] }] }, { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }]);
    editor.commands.setTextSelection({ from: 2, to: 14 });
    const before = editor.getJSON();
    assert.equal(canApplyParagraphFormat(editor, format), false);
    assert.equal(applyParagraphFormat(editor, format), false);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(applyParagraphFormat(editor, { ...format, base: 'paragraph' }), true);
    assert.equal(editor.getJSON().content[1].type, 'bulletList');
    assert.equal(editor.getJSON().content[1].content[0].content[0].attrs.paragraphFormat.id, format.id);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    assert.equal(canApplyParagraphFormat(editor, format), false);
    assert.equal(applyParagraphFormat(editor, { ...format, color: 'url(file:///tmp/x)' }), false);
});

test('table column selection formats only selected cells', t => {
    const cell = text => ({ type: 'tableCell', content: [paragraph(text)] });
    const row = (...cells) => ({ type: 'tableRow', content: cells });
    const editor = fixture(t, [{ type: 'table', content: [row(cell('a'), cell('b')), row(cell('c'), cell('d'))] }]);
    const cells = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[2])));
    assert.equal(applyParagraphFormat(editor, format), true);
    const values = [];
    editor.state.doc.descendants(node => { if (node.isTextblock) values.push([node.textContent, node.attrs.paragraphFormat?.id || null]); });
    assert.deepEqual(values, [['a', format.id], ['b', null], ['c', format.id], ['d', null]]);
    assert.ok(editor.state.selection instanceof CellSelection);
});
