import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { history } from '@tiptap/pm/history';
import { BASIC_TEXT_COLORS, CUSTOM_COLOR_LIMIT, CUSTOM_COLORS_KEY, normalizeHexColor, normalizeCustomColors, readCustomColors, saveCustomColor, deleteCustomColor, applyTextColor } from './textColors.js';
import { createProject, validateProject, renderChapterBody } from '../../../../electron/epubEditor/model.js';

function storage(initial) {
    const entries = new Map(initial == null ? [] : [[CUSTOM_COLORS_KEY, initial]]);
    return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('HEX input accepts shorthand and case variations but rejects non-color values', () => {
    for (const [value, expected] of [['#369', '#336699'], ['ABCDEF', '#abcdef'], [' #F0A ', '#ff00aa'], ['000000', '#000000']]) assert.equal(normalizeHexColor(value), expected);
    for (const value of ['', null, undefined, 123, '#12', '#1234', '#12345678', '#gggggg', 'red', 'url(x)', '#000000;']) assert.equal(normalizeHexColor(value), null);
    assert.equal(BASIC_TEXT_COLORS.length, new Set(BASIC_TEXT_COLORS).size);
    for (const color of BASIC_TEXT_COLORS) assert.equal(normalizeHexColor(color), color);
});

test('missing, corrupt or unavailable stored palettes fall back to ten empty slots', () => {
    for (const saved of [null, 'not json', '{}', 'null', '42']) assert.deepEqual(readCustomColors(storage(saved)), Array(CUSTOM_COLOR_LIMIT).fill(null));
    assert.deepEqual(readCustomColors({ getItem: () => { throw new Error('blocked'); } }), Array(10).fill(null));
    const sanitized = normalizeCustomColors(['#abc', 'ABC', 'invalid', '#fff', ...Array(20).fill('#000000')]);
    assert.equal(sanitized.length, 10);
    assert.deepEqual(sanitized.slice(0, 5), ['#aabbcc', null, null, '#ffffff', '#000000']);
    assert.equal(sanitized.filter(Boolean).length, 3);
});

test('custom colors fill ten slots, persist across reads and preserve existing colors at capacity', () => {
    const saved = storage();
    let colors = readCustomColors(saved);
    for (let i = 0; i < 10; i += 1) {
        const next = saveCustomColor(saved, colors, `#${String(i + 1).padStart(6, '0')}`);
        assert.equal(next.slot, i);
        colors = next.colors;
    }
    assert.deepEqual(readCustomColors(saved), colors);
    assert.throws(() => saveCustomColor(saved, colors, '#123456'), /COLOR_LIMIT/);
    assert.deepEqual(readCustomColors(saved), colors);
    const duplicate = saveCustomColor(saved, colors, colors[4].toUpperCase());
    assert.equal(duplicate.slot, 4);
    assert.equal(duplicate.existing, true);
    assert.deepEqual(duplicate.colors, colors);
});

test('selected slots can be replaced or deleted without reordering other colors or mutating input', () => {
    const saved = storage();
    const original = normalizeCustomColors(['#112233', null, '#445566']);
    const replaced = saveCustomColor(saved, original, '#ABC', 2);
    assert.equal(original[2], '#445566');
    assert.deepEqual(replaced.colors.slice(0, 3), ['#112233', null, '#aabbcc']);
    const removed = deleteCustomColor(saved, replaced.colors, 0);
    assert.deepEqual(removed.slice(0, 3), [null, null, '#aabbcc']);
    assert.deepEqual(readCustomColors(saved), removed);
    const next = saveCustomColor(saved, removed, '#778899');
    assert.equal(next.slot, 0);
    assert.equal(next.colors[2], '#aabbcc');
    for (const slot of [-1, 10, 1.5, '2']) assert.throws(() => saveCustomColor(saved, original, '#aabbcc', slot), /COLOR_LIMIT/);
    assert.throws(() => saveCustomColor(saved, original, 'not a color'), /COLOR_INVALID/);
});

test('palette write failures are reported and keep the displayed palette intact', () => {
    const colors = normalizeCustomColors(['#112233']);
    const blocked = { setItem: () => { throw new Error('quota'); } };
    assert.throws(() => saveCustomColor(blocked, colors, '#445566'), /quota/);
    assert.throws(() => deleteCustomColor(blocked, colors, 0), /quota/);
    assert.deepEqual(colors, normalizeCustomColors(['#112233']));
});

function editorFixture(t) {
    const editor = new Editor({ element: null, extensions: [StarterKit, TextStyle, Color, FontFamily, FontSize], content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before selected after' }] }] } });
    t.after(() => editor.destroy());
    editor.registerPlugin(history());
    editor.commands.setTextSelection({ from: 8, to: 16 });
    return editor;
}

test('applying and clearing color preserves selected text, selection, bold and other text styles', t => {
    const editor = editorFixture(t);
    editor.chain().setBold().setFontFamily('serif').setFontSize('24px').run();
    assert.equal(applyTextColor(editor, 'C24'), true);
    assert.equal(editor.state.doc.textContent, 'before selected after');
    assert.equal(editor.state.selection.from, 8);
    assert.equal(editor.state.selection.to, 16);
    const nodes = editor.getJSON().content[0].content;
    assert.deepEqual(nodes.map(node => node.text), ['before ', 'selected', ' after']);
    assert.equal(nodes[0].marks, undefined);
    assert.equal(nodes[2].marks, undefined);
    assert.equal(editor.getAttributes('textStyle').color, '#cc2244');
    assert.equal(editor.isActive('bold'), true);
    assert.equal(applyTextColor(editor, null), true);
    assert.equal(editor.getAttributes('textStyle').color, null);
    assert.equal(editor.getAttributes('textStyle').fontFamily, 'serif');
    assert.equal(editor.getAttributes('textStyle').fontSize, '24px');
    assert.equal(editor.isActive('bold'), true);
});

test('each color application has its own undo step and exports a valid inline EPUB color', t => {
    const editor = editorFixture(t);
    applyTextColor(editor, '#123456');
    const first = editor.getJSON();
    applyTextColor(editor, '#abcdef');
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), first);
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.getAttributes('textStyle').color, '#abcdef');
    const project = createProject();
    project.chapters[0].content = editor.getJSON();
    validateProject(project);
    assert.match(renderChapterBody(project.chapters[0], project), /color:#abcdef/);
    assert.equal(applyTextColor(editor, 'invalid'), false);
    assert.equal(editor.getAttributes('textStyle').color, '#abcdef');
    applyTextColor(editor, null);
    assert.equal(editor.getJSON().content[0].content.some(node => node.marks?.some(mark => mark.type === 'textStyle')), false);
});

test('color at a caret applies only to subsequently typed text', t => {
    const editor = editorFixture(t);
    editor.commands.setTextSelection(8);
    const before = editor.getJSON();
    assert.equal(applyTextColor(editor, '#123456'), true);
    assert.deepEqual(editor.getJSON(), before);
    editor.commands.command(({ tr }) => { tr.insertText('new'); return true; });
    const colored = editor.getJSON().content[0].content.find(node => node.marks?.some(mark => mark.attrs?.color === '#123456'));
    assert.equal(colored.text, 'new');
});
