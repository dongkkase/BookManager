import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { history } from '@tiptap/pm/history';
import { QUOTE_CHARACTERS, QUOTE_PAIRS, canInsertQuotes, createQuotePairPlugin, insertQuote, insertQuotePair, wrapWithQuotes } from './quotes.js';
import { createProject, paragraph, validateProject, renderChapterBody } from '../../../../electron/epubEditor/model.js';
import { BRACKET_PAIRS } from '../../../editorTextPairs.js';

const typedPairs = [{ open: "'", close: "'" }, { open: '"', close: '"' }, ...BRACKET_PAIRS];

function fixture(t, content = [paragraph('앞 선택 뒤')]) {
    const editor = new Editor({ element: null, extensions: [StarterKit, Table, TableRow, TableCell, TableHeader], content: { type: 'doc', content } });
    editor.registerPlugin(history());
    editor.registerPlugin(createQuotePairPlugin(editor));
    t.after(() => editor.destroy());
    return editor;
}

function typeQuote(editor, key, event = {}, view = {}) {
    const plugin = editor.state.plugins.find(item => item.key.startsWith('quotePairs$'));
    return plugin.props.handleKeyDown({ state: editor.state, editable: editor.isEditable, composing: false, dom: null, ...view }, { key, ...event });
}

test('typing quotes and brackets wraps a selected range, retaining marks and backward selection', t => {
    for (const { open, close } of typedPairs) {
        const editor = fixture(t, [{ type: 'paragraph', content: [
            { type: 'text', text: '앞 ' },
            { type: 'text', text: '굵게', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' 링크', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'text', text: ' 뒤' },
        ] }]);
        editor.commands.setTextSelection({ from: 8, to: 3 });
        const before = editor.state.doc;
        const selected = before.slice(3, 8).toJSON();
        assert.equal(typeQuote(editor, open), true);
        assert.equal(editor.state.doc.textContent, `앞 ${open}굵게 링크${close} 뒤`);
        assert.deepEqual(editor.state.doc.slice(4, 9).toJSON(), selected);
        assert.deepEqual(editor.state.selection.toJSON(), { type: 'text', anchor: 9, head: 4 });
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.state.doc.toJSON(), before.toJSON());
        assert.equal(editor.commands.redo(), true);
        assert.equal(editor.state.doc.textContent, `앞 ${open}굵게 링크${close} 뒤`);
    }
});

test('quote and bracket typing wraps all selected paragraphs and lists without flattening their structure', t => {
    for (const { open, close } of typedPairs) {
        const editor = fixture(t, [paragraph('첫 문단'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('마지막 문단')] }] }]);
        editor.commands.selectAll();
        const before = editor.getJSON();
        assert.equal(typeQuote(editor, open), true);
        assert.equal(editor.state.doc.firstChild.textContent, open + '첫 문단');
        assert.equal(editor.state.doc.lastChild.type.name, 'bulletList');
        assert.equal(editor.state.doc.lastChild.textContent, '마지막 문단' + close);
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.getJSON(), before);
    }
});

test('bracket input preserves caret typing, closing symbols, composition and table selection boundaries', t => {
    for (const pair of BRACKET_PAIRS) {
        const cell = { type: 'tableCell', content: [paragraph('내용')] };
        const editor = fixture(t, [{ type: 'table', content: [{ type: 'tableRow', content: [cell, cell] }] }]);
        const before = editor.state.doc;
        for (const selection of [new CellSelection(before.resolve(2)), NodeSelection.create(before, 0), TextSelection.create(before, 4)]) {
            editor.view.dispatch(editor.state.tr.setSelection(selection));
            assert.equal(typeQuote(editor, pair.open), false);
            assert.equal(editor.state.doc, before);
        }
        editor.commands.setTextSelection({ from: 4, to: 6 });
        assert.equal(typeQuote(editor, pair.close), false);
        for (const event of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 },
            { getModifierState: key => key === 'AltGraph' }, { target: { closest: () => ({}) } }]) {
            assert.equal(typeQuote(editor, pair.open, event), false);
            assert.equal(editor.state.doc, before);
        }
        editor.setEditable(false);
        assert.equal(typeQuote(editor, pair.open), false);
        editor.setEditable(true);
        assert.equal(typeQuote(editor, pair.open), true);
        assert.equal(editor.state.doc.firstChild.firstChild.firstChild.textContent, pair.open + '내용' + pair.close);
        const plugin = editor.state.plugins.find(item => item.key.startsWith('quotePairs$'));
        assert.deepEqual(plugin.getState(editor.state), []);
    }
});

test('straight quotes wrap table text while cell and node selections and read-only content use default input', t => {
    const cell = { type: 'tableCell', content: [paragraph('내용')] };
    const editor = fixture(t, [{ type: 'table', content: [{ type: 'tableRow', content: [cell, cell] }] }]);
    const before = editor.state.doc;
    for (const selection of [new CellSelection(before.resolve(2)), NodeSelection.create(before, 0)]) {
        editor.view.dispatch(editor.state.tr.setSelection(selection));
        assert.equal(typeQuote(editor, '"'), false);
        assert.equal(editor.state.doc, before);
    }
    editor.commands.setTextSelection({ from: 4, to: 6 });
    editor.setEditable(false);
    assert.equal(typeQuote(editor, '"'), false);
    editor.setEditable(true);
    assert.equal(typeQuote(editor, '"'), true);
    assert.equal(editor.state.doc.firstChild.firstChild.firstChild.textContent, '"내용"');
});

test('quote typing leaves ordinary caret input, modifiers, composition and nested controls to their normal handlers', t => {
    const editor = fixture(t);
    assert.equal(typeQuote(editor, "'"), false);
    assert.equal(typeQuote(editor, '"'), false);
    editor.commands.setTextSelection({ from: 3, to: 5 });
    const before = editor.getJSON();
    for (const event of [
        { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true },
        { keyCode: 229 }, { defaultPrevented: true }, { getModifierState: key => key === 'AltGraph' },
        { target: { closest: () => ({}) } },
    ]) {
        assert.equal(typeQuote(editor, "'", event), false);
    }
    assert.equal(typeQuote(editor, 'Dead'), false);
    assert.equal(typeQuote(editor, 'a', { code: 'Quote' }), false);
    assert.equal(typeQuote(editor, "'", {}, { composing: true }), false);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(typeQuote(editor, '"', { code: 'Digit2', shiftKey: true }), true);
    assert.equal(editor.state.doc.textContent, '앞 "선택" 뒤');
});

test('direct quotation marks at a caret preserve formatting, advance the cursor and undo independently', t => {
    const editor = fixture(t);
    for (const quote of QUOTE_CHARACTERS) {
        editor.commands.setTextSelection(3);
        editor.commands.setBold();
        const before = editor.getJSON();
        const position = editor.state.selection.from;
        assert.equal(insertQuote(editor, quote.command), true);
        assert.equal(editor.state.selection.from, position + 1);
        assert.equal(editor.state.doc.nodeAt(position).text[0], quote.value);
        assert.equal(editor.isActive('bold'), true);
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.getJSON(), before);
    }
});

test('opening quotation marks wrap selected text, preserve its marks and selection, and undo as one edit', t => {
    for (const [command, open, close] of [['openDoubleQuote', '“', '”'], ['openSingleQuote', '‘', '’']]) {
        const editor = fixture(t);
        editor.commands.setTextSelection({ from: 5, to: 3 });
        editor.commands.setBold();
        const before = editor.getJSON();
        assert.equal(insertQuote(editor, command), true);
        assert.equal(editor.state.doc.textContent, `앞 ${open}선택${close} 뒤`);
        assert.equal(editor.isActive('bold'), true);
        assert.deepEqual(editor.state.selection.toJSON(), { type: 'text', anchor: 6, head: 4 });
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.getJSON(), before);
        assert.equal(editor.commands.redo(), true);
        assert.equal(editor.state.doc.textContent, `앞 ${open}선택${close} 뒤`);
    }
});

test('closing quotation marks still replace selected text without adding another pair', t => {
    for (const [command, value] of [['closeDoubleQuote', '”'], ['closeSingleQuote', '’']]) {
        const editor = fixture(t);
        editor.commands.setTextSelection({ from: 3, to: 5 });
        assert.equal(insertQuote(editor, command), true);
        assert.equal(editor.state.doc.textContent, `앞 ${value} 뒤`);
        assert.equal(editor.state.selection.empty, true);
        assert.equal(editor.state.selection.from, 4);
    }
});

test('empty pairs put the cursor inside and keep stored marks for subsequent typing', t => {
    for (const pair of QUOTE_PAIRS) {
        const editor = fixture(t, [paragraph('앞뒤')]);
        editor.commands.setTextSelection(2);
        editor.commands.setItalic();
        assert.equal(wrapWithQuotes(editor, pair.command), true);
        assert.equal(editor.state.doc.textContent, `앞${pair.open}${pair.close}뒤`);
        assert.equal(editor.state.selection.empty, true);
        assert.equal(editor.state.selection.from, 3);
        assert.equal(editor.isActive('italic'), true);
        assert.equal(editor.commands.undo(), true);
        assert.equal(editor.state.doc.textContent, '앞뒤');
        assert.equal(editor.commands.redo(), true);
        editor.view.dispatch(editor.state.tr.insertText('내용'));
        assert.equal(editor.state.doc.textContent, `앞${pair.open}내용${pair.close}뒤`);
    }
});

test('pair shortcuts insert, preserve typing marks and skip the generated closer without an undo step', t => {
    for (const pair of QUOTE_PAIRS) {
        const editor = fixture(t, [paragraph('앞뒤')]);
        editor.commands.setTextSelection(2);
        editor.commands.setItalic();
        assert.equal(insertQuotePair(editor, pair.shortcutCommand), true);
        assert.equal(editor.state.selection.from, 3);
        editor.view.dispatch(editor.state.tr.insertText('내용'));
        const before = editor.state.doc;
        assert.equal(editor.isActive('italic'), true);
        assert.equal(insertQuotePair(editor, pair.shortcutCommand), true);
        assert.equal(editor.state.doc, before);
        assert.equal(editor.state.selection.from, 6);
        editor.view.dispatch(editor.state.tr.insertText('밖'));
        assert.equal(editor.state.doc.textContent, `앞${pair.open}내용${pair.close}밖뒤`);
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.state.doc.toJSON(), before.toJSON());
        assert.equal(editor.commands.undo(), true);
        assert.equal(editor.state.doc.textContent, '앞뒤');
    }
});

test('pair shortcuts wrap backward and all-text selections instead of skipping or replacing text', t => {
    for (const pair of QUOTE_PAIRS) {
        const editor = fixture(t);
        editor.commands.setTextSelection({ from: 5, to: 3 });
        editor.commands.setBold();
        assert.equal(insertQuotePair(editor, pair.shortcutCommand), true);
        assert.equal(editor.state.doc.textContent, `앞 ${pair.open}선택${pair.close} 뒤`);
        assert.deepEqual(editor.state.selection.toJSON(), { type: 'text', anchor: 6, head: 4 });
        assert.equal(editor.isActive('bold'), true);
        editor.commands.selectAll();
        assert.equal(insertQuotePair(editor, pair.shortcutCommand), true);
        assert.equal(editor.state.doc.textContent, `${pair.open}앞 ${pair.open}선택${pair.close} 뒤${pair.close}`);
    }
});

test('nested single and double quotes skip only their matching generated closer', t => {
    const editor = fixture(t, [paragraph('')]);
    insertQuotePair(editor, 'doubleQuotes');
    insertQuotePair(editor, 'singleQuotes');
    editor.view.dispatch(editor.state.tr.insertText('내용'));
    assert.equal(editor.state.doc.textContent, '“‘내용’”');
    insertQuotePair(editor, 'singleQuotes');
    assert.equal(editor.state.selection.from, 6);
    insertQuotePair(editor, 'doubleQuotes');
    assert.equal(editor.state.selection.from, 7);
    assert.equal(editor.state.doc.textContent, '“‘내용’”');
});

test('generated pairs follow edits before and inside them, including nested pairs of the same type', t => {
    const editor = fixture(t, [paragraph('')]);
    insertQuotePair(editor, 'doubleQuotes');
    editor.view.dispatch(editor.state.tr.insertText('뒤'));
    editor.commands.setTextSelection(2);
    insertQuotePair(editor, 'doubleQuotes');
    editor.view.dispatch(editor.state.tr.insertText('안'));
    editor.view.dispatch(editor.state.tr.insertText('앞', 1, 1));
    assert.equal(editor.state.doc.textContent, '앞““안”뒤”');
    editor.view.dispatch(editor.state.tr.delete(6, 7));
    editor.commands.setTextSelection({ from: 1, to: 7 });
    editor.commands.setBold();
    editor.commands.setTextSelection(5);
    insertQuotePair(editor, 'doubleQuotes');
    assert.equal(editor.state.selection.from, 6);
    insertQuotePair(editor, 'doubleQuotes');
    assert.equal(editor.state.selection.from, 7);
    assert.equal(editor.state.doc.textContent, '앞““안””');
});

test('manual, replaced and previously skipped quotation marks do not count as pending closers', t => {
    const manual = fixture(t, [paragraph('‘’')]);
    manual.commands.setTextSelection(2);
    insertQuotePair(manual, 'singleQuotes');
    assert.equal(manual.state.doc.textContent, '‘‘’’');
    for (const [position, value] of [[1, '‘'], [2, '’']]) {
        const editor = fixture(t, [paragraph('')]);
        insertQuotePair(editor, 'singleQuotes');
        editor.view.dispatch(editor.state.tr.insertText(value, position, position + 1));
        editor.commands.setTextSelection(2);
        insertQuotePair(editor, 'singleQuotes');
        assert.equal(editor.state.doc.textContent, '‘‘’’');
    }
    const consumed = fixture(t, [paragraph('')]);
    insertQuotePair(consumed, 'singleQuotes');
    insertQuotePair(consumed, 'singleQuotes');
    consumed.commands.setTextSelection(2);
    insertQuotePair(consumed, 'singleQuotes');
    assert.equal(consumed.state.doc.textContent, '‘‘’’');
});

test('undo and document replacement remove stale pairs even when identical text returns', t => {
    for (const reset of [
        editor => { editor.commands.undo(); editor.commands.redo(); },
        editor => editor.commands.setContent(editor.getJSON()),
    ]) {
        const editor = fixture(t, [paragraph('')]);
        insertQuotePair(editor, 'singleQuotes');
        reset(editor);
        editor.commands.setTextSelection(2);
        insertQuotePair(editor, 'singleQuotes');
        assert.equal(editor.state.doc.textContent, '‘‘’’');
    }
});

test('pending pairs belong to each chapter state and are absent from saved document JSON', t => {
    const editor = fixture(t, [paragraph('')]);
    insertQuotePair(editor, 'doubleQuotes');
    const original = editor.state;
    const plugin = original.plugins.find(item => item.key.startsWith('quotePairs$'));
    const other = EditorState.create({ schema: editor.schema, doc: original.doc, plugins: original.plugins });
    assert.equal(plugin.getState(original).length, 1);
    assert.deepEqual(plugin.getState(other), []);
    assert.deepEqual(editor.getJSON(), { type: 'doc', content: [paragraph('“”')] });
    const editor2 = fixture(t, [paragraph('“”')]);
    editor2.commands.setTextSelection(2);
    insertQuotePair(editor2, 'doubleQuotes');
    assert.equal(editor2.state.doc.textContent, '““””');
    insertQuotePair(editor, 'doubleQuotes');
    assert.equal(editor.state.doc.textContent, '“”');
    assert.equal(editor.state.selection.from, 3);
});

test('wrapping mixed marks retains text, link attributes and backward selection in one undo step', t => {
    const editor = fixture(t, [{ type: 'paragraph', content: [
        { type: 'text', text: '앞 ' },
        { type: 'text', text: '굵게', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' 기울임', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' 링크', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: ' 뒤' },
    ] }]);
    editor.commands.setTextSelection({ from: 12, to: 3 });
    const before = editor.state.doc;
    const { from, to, anchor, head } = editor.state.selection;
    const original = before.slice(from, to).toJSON();
    assert.equal(wrapWithQuotes(editor, 'wrapDoubleQuotes'), true);
    assert.deepEqual(editor.state.doc.slice(from + 1, to + 1).toJSON(), original);
    assert.deepEqual(editor.state.selection.toJSON(), { type: 'text', anchor: anchor + 1, head: head + 1 });
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.state.doc.toJSON(), before.toJSON());
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(editor.state.doc.slice(from + 1, to + 1).toJSON(), original);
});

test('multiblock wrapping preserves structure and Unicode through project and XHTML serialization', t => {
    const editor = fixture(t, [paragraph('첫 문단'), { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('둘째 🧑‍💻 문단')] }] }]);
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 3 });
    const before = editor.state.doc;
    const { from, to } = editor.state.selection;
    assert.equal(wrapWithQuotes(editor, 'wrapSingleQuotes'), true);
    assert.deepEqual(editor.state.doc.slice(from + 1, to + 1).toJSON(), before.slice(from, to).toJSON());
    const project = createProject();
    project.chapters[0].content = editor.getJSON();
    const restored = JSON.parse(JSON.stringify(project));
    validateProject(restored);
    const xhtml = renderChapterBody(restored.chapters[0], restored);
    assert.ok(xhtml.includes('‘첫 문단'));
    assert.ok(xhtml.includes('둘째 🧑‍💻 문단’'));
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.state.doc.toJSON(), before.toJSON());
});

test('select-all wraps the document text without replacing its paragraphs', t => {
    const editor = fixture(t, [paragraph('첫 문단'), paragraph('마지막 문단')]);
    editor.commands.selectAll();
    assert.ok(editor.state.selection instanceof AllSelection);
    const before = editor.getJSON();
    assert.equal(wrapWithQuotes(editor, 'wrapDoubleQuotes'), true);
    assert.equal(editor.state.doc.child(0).textContent, '“첫 문단');
    assert.equal(editor.state.doc.child(1).textContent, '마지막 문단”');
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(insertQuote(editor, 'openDoubleQuote'), true);
    assert.equal(editor.state.doc.child(0).textContent, '“첫 문단');
    assert.equal(editor.state.doc.child(1).textContent, '마지막 문단”');
});

test('table text is supported, while whole-cell, node and read-only selections stay intact', t => {
    const cell = { type: 'tableCell', content: [paragraph('내용')] };
    const editor = fixture(t, [{ type: 'table', content: [{ type: 'tableRow', content: [cell, cell] }] }]);
    const before = editor.state.doc;
    for (const selection of [new CellSelection(before.resolve(2)), NodeSelection.create(before, 0)]) {
        editor.view.dispatch(editor.state.tr.setSelection(selection));
        assert.equal(canInsertQuotes(editor), false);
        assert.equal(wrapWithQuotes(editor, 'wrapDoubleQuotes'), false);
        assert.equal(insertQuote(editor, 'openDoubleQuote'), false);
        assert.equal(insertQuotePair(editor, 'doubleQuotes'), false);
        assert.deepEqual(editor.state.doc.toJSON(), before.toJSON());
    }
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(before, 4, 6)));
    assert.equal(wrapWithQuotes(editor, 'wrapDoubleQuotes'), true);
    assert.equal(editor.state.doc.firstChild.firstChild.firstChild.textContent, '“내용”');
    editor.setEditable(false);
    assert.equal(canInsertQuotes(editor), false);
    assert.equal(wrapWithQuotes(editor, 'wrapSingleQuotes'), false);
    assert.equal(insertQuote(editor, 'closeSingleQuote'), false);
    assert.equal(insertQuotePair(editor, 'singleQuotes'), false);
    editor.setEditable(true);
    assert.equal(wrapWithQuotes(editor, 'unknown'), false);
    assert.equal(insertQuote(editor, 'unknown'), false);
    assert.equal(insertQuotePair(editor, 'unknown'), false);
});
