import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { history } from '@tiptap/pm/history';
import { BlockStyle, InlineStyle, Highlight, Superscript, Subscript, applyBlockStyle, applyPresetMark, clearAuthorFormatting, insertCharacter, canApplyScript, toggleScript } from './richFormatting.js';
import { ParagraphIndent } from './paragraphIndent.js';
import { applyTextColor, normalizePastedColor } from './textColors.js';
import { createProject, paragraph, validateProject, renderChapterBody, bookCss } from '../../../../electron/epubEditor/model.js';
import { EMOJI_CHARACTERS, SPECIAL_CHARACTERS, characterValue, filterCharacters } from './characters.js';
import { matchesShortcut, shortcuts } from './shortcuts.js';

function fixture(t, content = [paragraph('before selected after')]) {
    const editor = new Editor({ element: null, extensions: [StarterKit, TextStyle, Color, BackgroundColor, TextAlign.configure({ types: ['paragraph', 'heading'] }), ParagraphIndent, BlockStyle, InlineStyle, Highlight, Superscript, Subscript], content: { type: 'doc', content } });
    editor.registerPlugin(history());
    t.after(() => editor.destroy());
    editor.commands.setTextSelection({ from: 8, to: 16 });
    return editor;
}

test('block styles apply to the caret and multiple blocks while retaining headings and other attributes', t => {
    const editor = fixture(t, [paragraph('first'), { type: 'heading', attrs: { level: 6, textAlign: 'center', id: 'n_heading' }, content: [{ type: 'text', text: 'second' }] }]);
    editor.commands.setTextSelection(2);
    assert.equal(applyBlockStyle(editor, 'note'), true);
    assert.equal(editor.getJSON().content[0].attrs.blockStyle, 'note');
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    applyBlockStyle(editor, 'lead');
    assert.deepEqual(editor.getJSON().content.map(node => node.attrs.blockStyle), ['lead', 'lead']);
    assert.equal(editor.getJSON().content[1].attrs.level, 6);
    assert.equal(editor.getJSON().content[1].attrs.textAlign, 'center');
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.getJSON().content[0].attrs.blockStyle, 'note');
    assert.equal(editor.getJSON().content[1].attrs.blockStyle, null);
    assert.equal(applyBlockStyle(editor, 'unknown'), false);
});

test('background, highlight and named text style remain independent and export correctly', t => {
    const editor = fixture(t);
    editor.commands.setBold();
    applyTextColor(editor, '#123456');
    applyTextColor(editor, '#cde', true);
    applyPresetMark(editor, 'highlight', 'yellowMarker');
    applyPresetMark(editor, 'inlineStyle', 'keyboard');
    const saved = editor.getJSON();
    const project = createProject();
    project.chapters[0].content = saved;
    validateProject(project);
    const output = renderChapterBody(project.chapters[0], project);
    assert.match(output, /background-color:#ccddee/);
    assert.match(output, /bm-highlight-yellowMarker/);
    assert.match(output, /bm-style-keyboard/);
    assert.match(bookCss(project), /mark\.bm-highlight-yellowMarker\{background-color:#fff176/);
    applyPresetMark(editor, 'highlight', null);
    assert.equal(editor.isActive('highlight'), false);
    assert.equal(editor.getAttributes('textStyle').backgroundColor, '#ccddee');
    assert.equal(editor.isActive('inlineStyle'), true);
    applyTextColor(editor, null, true);
    assert.equal(editor.getAttributes('textStyle').color, '#123456');
    assert.equal(editor.isActive('bold'), true);
    assert.deepEqual(editor.state.selection.toJSON(), { type: 'text', anchor: 8, head: 16 });
    editor.commands.setContent(saved);
    assert.equal(editor.isActive('highlight'), false);
    assert.deepEqual(editor.getJSON(), saved);
});

test('superscript and subscript toggle exclusively, preserve other marks and undo', t => {
    const editor = fixture(t);
    editor.commands.setBold();
    toggleScript(editor, 'superscript');
    assert.equal(editor.isActive('superscript'), true);
    assert.equal(canApplyScript(editor, 'subscript'), true);
    toggleScript(editor, 'subscript');
    assert.equal(editor.isActive('superscript'), false);
    assert.equal(editor.isActive('subscript'), true);
    assert.equal(editor.isActive('bold'), true);
    editor.commands.toggleMark('subscript');
    assert.equal(editor.isActive('subscript'), false);
    editor.commands.toggleMark('superscript');
    const project = createProject();
    project.chapters[0].content = editor.getJSON();
    validateProject(project);
    assert.match(renderChapterBody(project.chapters[0], project), /<sup>/);
    editor.commands.setTextSelection(10);
    assert.equal(canApplyScript(editor, 'subscript'), true);
    assert.equal(toggleScript(editor, 'subscript'), true);
    assert.equal(editor.isActive('subscript'), true);
    assert.equal(editor.isActive('superscript'), false);
    editor.commands.setCodeBlock();
    assert.equal(canApplyScript(editor, 'superscript'), false);
});

test('clear formatting removes named styles and marks as one undo operation', t => {
    const editor = fixture(t);
    applyBlockStyle(editor, 'note');
    applyPresetMark(editor, 'highlight', 'pinkMarker');
    applyPresetMark(editor, 'inlineStyle', 'emphasis');
    const before = editor.getJSON();
    assert.equal(clearAuthorFormatting(editor), true);
    assert.equal(editor.getJSON().content[0].attrs.blockStyle, null);
    assert.equal(editor.isActive('highlight'), false);
    assert.equal(editor.isActive('inlineStyle'), false);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
});

test('character insertion replaces selection, advances cursor, preserves marks and keeps Unicode intact', t => {
    const editor = fixture(t);
    editor.commands.setBold();
    insertCharacter(editor, '🧑‍💻');
    insertCharacter(editor, '※');
    assert.equal(editor.state.doc.textContent, 'before 🧑‍💻※ after');
    assert.equal(editor.state.selection.empty, true);
    assert.equal(editor.isActive('bold'), true);
    editor.commands.undo();
    assert.equal(editor.state.doc.textContent, 'before 🧑‍💻 after');
    editor.commands.undo();
    assert.equal(editor.state.doc.textContent, 'before selected after');
    const thumb = EMOJI_CHARACTERS.find(entry => entry.value === '👍');
    assert.equal(characterValue(thumb, '🏽'), '👍🏽');
    assert.equal(filterCharacters(EMOJI_CHARACTERS, '고양이')[0].value, '🐱');
    assert.equal(filterCharacters(SPECIAL_CHARACTERS, 'infinity', 'math')[0].value, '∞');
    assert.equal(new Set(EMOJI_CHARACTERS.map(entry => entry.value)).size, EMOJI_CHARACTERS.length);
    assert.equal(new Set(SPECIAL_CHARACTERS.map(entry => entry.value)).size, SPECIAL_CHARACTERS.length);
});

test('IME symbols preserve Unicode, selection replacement and undo through project and XHTML serialization', t => {
    const editor = fixture(t);
    const text = '①㈜㎡─㉠ㅿæあアЯ\u3000\u00ad';
    assert.equal(insertCharacter(editor, text), true);
    assert.equal(editor.state.doc.textContent, `before ${text} after`);
    const project = createProject();
    project.chapters[0].content = editor.getJSON();
    const restored = JSON.parse(JSON.stringify(project));
    validateProject(restored);
    assert.ok(renderChapterBody(restored.chapters[0], restored).includes(text));
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.textContent, 'before selected after');
});

test('flags and skin-tone ZWJ emoji survive editing, project serialization, XHTML and undo', t => {
    for (const value of ['🇰🇷', '🧑🏽‍💻', '👩🏽‍🦽‍➡️', '🫱🏻‍🫲🏿', '🧑🏻‍❤️‍💋‍🧑🏿', '\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}']) {
        const editor = fixture(t);
        editor.commands.setBold();
        assert.equal(insertCharacter(editor, value), true);
        assert.equal(editor.state.doc.textContent, `before ${value} after`);
        assert.equal(editor.state.selection.from, 8 + value.length);
        const project = createProject();
        project.chapters[0].content = editor.getJSON();
        const restored = JSON.parse(JSON.stringify(project));
        validateProject(restored);
        assert.ok(renderChapterBody(restored.chapters[0], restored).includes(`<strong>${value}</strong>`));
        assert.equal(editor.commands.undo(), true);
        assert.equal(editor.state.doc.textContent, 'before selected after');
    }
});

test('new shortcuts recognize macOS and Windows Korean physical keys without collisions', () => {
    assert.equal(new Set(Object.values(shortcuts)).size, Object.values(shortcuts).length);
    for (const platform of ['metaKey', 'ctrlKey']) {
        for (const [command, code] of [['paragraphFormat', 'KeyP'], ['textStyles', 'KeyT'], ['textBackground', 'KeyB'], ['highlight', 'KeyF'], ['media', 'KeyY'], ['superscript', 'Digit6'], ['subscript', 'Digit5'], ['specialCharacters', 'Digit7'], ['emoji', 'Digit8']]) {
            assert.equal(matchesShortcut({ key: 'ㅁ', code, metaKey: false, ctrlKey: false, [platform]: true, altKey: true, shiftKey: true }, shortcuts[command]), true);
        }
    }
});

test('pasted text colors preserve browser RGB values without accepting unsafe CSS', () => {
    assert.equal(normalizePastedColor('rgb(204, 221, 238)'), '#ccddee');
    assert.equal(normalizePastedColor('#CDE'), '#ccddee');
    for (const value of ['rgb(256, 0, 0)', 'rgba(1,2,3,.5)', 'url(javascript:x)', '#000000;position:fixed', 'transparent']) assert.equal(normalizePastedColor(value), null);
});
