import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { DecorationSet } from '@tiptap/pm/view';
import {
    adjacentSearchIndex, configureEditorSearch, createSearchPlugin, findDocumentMatches,
    moveEditorSearch, replaceEditorSearch, replaceSearchMatches, searchPluginKey,
} from './search.js';

const Atom = Node.create({ name: 'footnote', group: 'inline', inline: true, atom: true, addAttributes: () => ({ text: { default: '' } }) });
const schema = getSchema([StarterKit, Atom]);
const text = (value, marks = []) => schema.text(value, marks.map(mark => schema.mark(mark)));
const paragraph = (...content) => schema.node('paragraph', null, content);
const document = (...content) => schema.node('doc', null, content);
function mockEditor(doc, from = 1, to = from) {
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, from, to), plugins: [history(), createSearchPlugin()] });
    let dispatchCount = 0;
    return {
        get state() { return state; },
        get dispatchCount() { return dispatchCount; },
        isDestroyed: false,
        isEditable: true,
        view: {
            composing: false,
            dispatch(transaction) { dispatchCount += 1; state = state.applyTransaction(transaction).state; },
        },
    };
}

test('literal search crosses text marks and keeps UTF-16 document positions', () => {
    const doc = document(paragraph(text('앞😀 ['), text('a.*', ['bold']), text('] 뒤 [A.*]')));
    const matches = findDocumentMatches(doc, '[a.*]');
    assert.equal(matches.length, 2);
    assert.deepEqual(matches[0], { from: 5, to: 10 });
    for (const match of matches) assert.equal(doc.textBetween(match.from, match.to).toLowerCase(), '[a.*]');
    assert.equal(findDocumentMatches(doc, '[a.*]', { caseSensitive: true }).length, 1);
    assert.deepEqual(findDocumentMatches(doc, ''), []);
    assert.deepEqual(findDocumentMatches(doc, '[missing]'), []);
    assert.equal(findDocumentMatches(doc, '😀')[0].to - findDocumentMatches(doc, '😀')[0].from, 2);
});

test('paragraphs, hard breaks and inline atoms form search boundaries without offset drift', () => {
    const doc = document(
        paragraph(text('one'), schema.node('hardBreak'), text('two'), schema.node('footnote', { text: 'hidden words' }), text('three')),
        paragraph(text('four')),
    );
    for (const query of ['onetwo', 'one\ntwo', 'twothree', 'two\ufffcthree', 'threefour', 'hidden']) {
        assert.deepEqual(findDocumentMatches(doc, query), [], query);
    }
    assert.deepEqual(findDocumentMatches(doc, 'three'), [{ from: 9, to: 14 }]);
    assert.equal(doc.textBetween(...Object.values(findDocumentMatches(doc, 'four')[0])), 'four');
    const nested = document(schema.node('blockquote', null, paragraph(text('quoted'))), schema.node('bulletList', null, schema.node('listItem', null, paragraph(text('list')))));
    for (const query of ['quoted', 'list']) {
        const [match] = findDocumentMatches(nested, query);
        assert.equal(nested.textBetween(match.from, match.to), query);
    }
});

test('case-sensitive and Unicode searches preserve original offsets and non-overlapping matches', () => {
    const doc = document(paragraph(text('İ test TEST 가나다 가나 aaa')));
    assert.equal(findDocumentMatches(doc, 'test').length, 2);
    assert.equal(findDocumentMatches(doc, 'test', { caseSensitive: true }).length, 1);
    assert.equal(findDocumentMatches(doc, '가나').length, 2);
    assert.equal(findDocumentMatches(doc, 'aa').length, 1);
    for (const match of findDocumentMatches(doc, 'test')) assert.equal(doc.textBetween(match.from, match.to).toLowerCase(), 'test');
});

test('next and previous wrap around and choose the nearest match from a caret', () => {
    const matches = [{ from: 2, to: 5 }, { from: 9, to: 12 }, { from: 16, to: 19 }];
    assert.equal(adjacentSearchIndex(matches, matches[0], -1), 2);
    assert.equal(adjacentSearchIndex(matches, matches[2], 1), 0);
    assert.equal(adjacentSearchIndex(matches, { from: 7, to: 7 }, -1), 0);
    assert.equal(adjacentSearchIndex(matches, { from: 7, to: 7 }, 1), 1);
    assert.equal(adjacentSearchIndex(matches, { from: 1, to: 1 }, -1), 2);
    assert.equal(adjacentSearchIndex(matches, { from: 20, to: 20 }, 1), 0);
    assert.equal(adjacentSearchIndex([], { from: 1, to: 1 }), -1);
});

test('search highlights all matches, updates the active result, and never changes document JSON', () => {
    const editor = mockEditor(document(paragraph(text('one ONE one'))));
    const original = editor.state.doc.toJSON();
    configureEditorSearch(editor, 'one');
    let search = searchPluginKey.getState(editor.state);
    assert.equal(search.matches.length, 3);
    assert.equal(search.activeIndex, 0);
    assert.equal(search.decorations.find().length, 3);
    assert.equal(search.decorations.find().filter(item => item.type.attrs.class.includes('is-active')).length, 1);
    moveEditorSearch(editor, -1);
    assert.equal(searchPluginKey.getState(editor.state).activeIndex, 2);
    moveEditorSearch(editor, 1);
    assert.equal(searchPluginKey.getState(editor.state).activeIndex, 0);
    configureEditorSearch(editor, 'one', true);
    search = searchPluginKey.getState(editor.state);
    assert.equal(search.matches.length, 2);
    configureEditorSearch(editor, '');
    assert.equal(searchPluginKey.getState(editor.state).decorations.find().length, 0);
    assert.deepEqual(editor.state.doc.toJSON(), original);
    assert.equal(undo(editor.state), false);
});

test('external text edits recompute matches and unrelated selection changes retain match data', () => {
    const editor = mockEditor(document(paragraph(text('word word'))));
    configureEditorSearch(editor, 'word');
    const matches = searchPluginKey.getState(editor.state).matches;
    moveEditorSearch(editor);
    assert.equal(searchPluginKey.getState(editor.state).matches, matches);
    editor.view.dispatch(editor.state.tr.insertText('!', 2));
    assert.equal(searchPluginKey.getState(editor.state).matches.length, 1);
    assert.equal(searchPluginKey.getState(editor.state).decorations.find().length, 1);
});

test('closed search does not dispatch redundant transactions or allocate decorations during selection changes', () => {
    const editor = mockEditor(document(paragraph(text('word word'))));
    const search = searchPluginKey.getState(editor.state);
    assert.equal(search.decorations, DecorationSet.empty);
    configureEditorSearch(editor, '');
    assert.equal(editor.dispatchCount, 0);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    assert.equal(searchPluginKey.getState(editor.state), search);
    configureEditorSearch(editor, 'word');
    moveEditorSearch(editor);
    const highlighted = searchPluginKey.getState(editor.state);
    assert.equal(highlighted.activeIndex, 0);
    assert.equal(highlighted.decorations.find().length, 2);
    assert.deepEqual(highlighted.decorations.find().filter(item => item.type.attrs.class.includes('is-active')).map(item => item.from), [1]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    const between = searchPluginKey.getState(editor.state);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5)));
    assert.equal(searchPluginKey.getState(editor.state), between);
    configureEditorSearch(editor, '');
    assert.equal(searchPluginKey.getState(editor.state).decorations, DecorationSet.empty);
});

test('replace all spans marks, inherits the first matched character style and preserves surrounding content', () => {
    const doc = document(paragraph(text('before ', ['italic']), text('hel', ['bold']), text('lo'), text(' after ', ['italic']), text('hello', ['italic'])));
    const editor = mockEditor(doc);
    configureEditorSearch(editor, 'hello');
    const before = editor.dispatchCount;
    assert.equal(replaceEditorSearch(editor, '<new>', true), 2);
    assert.equal(editor.dispatchCount - before, 1);
    assert.equal(editor.state.doc.textContent, 'before <new> after <new>');
    assert.equal(editor.state.doc.nodeAt(8).marks[0].type.name, 'bold');
    assert.equal(editor.state.doc.nodeAt(1).marks[0].type.name, 'italic');
    assert.equal(editor.state.doc.nodeAt(13).marks[0].type.name, 'italic');
    assert.equal(editor.state.doc.nodeAt(20).marks[0].type.name, 'italic');
    editor.state.doc.check();
});

test('replace all is one undo step isolated from edits both before and after it', () => {
    const original = document(paragraph(text('abc abc')));
    const editor = mockEditor(original);
    editor.view.dispatch(editor.state.tr.insertText('x', 1));
    configureEditorSearch(editor, 'abc');
    replaceEditorSearch(editor, 'XY', true);
    assert.equal(editor.state.doc.textContent, 'xXY XY');
    editor.view.dispatch(editor.state.tr.insertText('z', editor.state.doc.content.size - 1));
    assert.equal(editor.state.doc.textContent, 'xXY XYz');
    assert.equal(undo(editor.state, editor.view.dispatch), true);
    assert.equal(editor.state.doc.textContent, 'xXY XY');
    assert.equal(undo(editor.state, editor.view.dispatch), true);
    assert.equal(editor.state.doc.textContent, 'xabc abc');
    assert.equal(undo(editor.state, editor.view.dispatch), true);
    assert.ok(editor.state.doc.eq(original));
    assert.equal(redo(editor.state, editor.view.dispatch), true);
    assert.equal(redo(editor.state, editor.view.dispatch), true);
    assert.equal(editor.state.doc.textContent, 'xXY XY');
});

test('single replacement selects the next original occurrence even when replacement contains the query', () => {
    const editor = mockEditor(document(paragraph(text('cat cat'))));
    configureEditorSearch(editor, 'cat');
    assert.equal(replaceEditorSearch(editor, 'catcat'), 1);
    assert.equal(editor.state.doc.textContent, 'catcat cat');
    assert.deepEqual({ from: editor.state.selection.from, to: editor.state.selection.to }, { from: 8, to: 11 });
    assert.equal(replaceEditorSearch(editor, ''), 1);
    assert.equal(editor.state.doc.textContent, 'catcat ');
    assert.equal(editor.state.selection.from, 1);
    assert.equal(replaceEditorSearch(editor, '', true), 2);
    assert.equal(editor.state.doc.textContent, ' ');
    assert.equal(searchPluginKey.getState(editor.state).matches.length, 0);
    editor.state.doc.check();
});

test('replace selects a matching result before editing when the caret is outside a match', () => {
    const editor = mockEditor(document(paragraph(text('a word b'))));
    configureEditorSearch(editor, 'word');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const original = editor.state.doc;
    assert.equal(replaceEditorSearch(editor, 'changed'), 0);
    assert.equal(editor.state.doc, original);
    assert.equal(editor.state.selection.from, 3);
    assert.equal(replaceEditorSearch(editor, 'changed'), 1);
    assert.equal(editor.state.doc.textContent, 'a changed b');
});

test('identical replacements preserve mixed formatting without adding undo entries', () => {
    const original = document(paragraph(text('ab', ['bold']), text('cd', ['italic'])));
    const editor = mockEditor(original);
    configureEditorSearch(editor, 'abcd');
    assert.equal(replaceEditorSearch(editor, 'abcd', true), 0);
    assert.ok(editor.state.doc.eq(original));
    assert.equal(undo(editor.state), false);
    const matches = findDocumentMatches(original, 'abcd');
    const result = replaceSearchMatches(editor.state, matches, 'abcd');
    assert.equal(result.count, 0);
    assert.equal(result.transaction.docChanged, false);
    assert.equal(matches.length, 1);
});

test('single identical replacements advance and wrap the current index without document changes', () => {
    const editor = mockEditor(document(paragraph(text('word word'))));
    const original = editor.state.doc;
    configureEditorSearch(editor, 'word');
    assert.equal(replaceEditorSearch(editor, 'word'), 0);
    assert.equal(searchPluginKey.getState(editor.state).activeIndex, 1);
    assert.equal(replaceEditorSearch(editor, 'word'), 0);
    assert.equal(searchPluginKey.getState(editor.state).activeIndex, 0);
    assert.equal(editor.state.doc, original);
    assert.equal(undo(editor.state), false);
});

test('replacement is blocked for read-only, composing and destroyed editors', () => {
    const editor = mockEditor(document(paragraph(text('word'))));
    configureEditorSearch(editor, 'word');
    const original = editor.state.doc;
    editor.isEditable = false;
    assert.equal(replaceEditorSearch(editor, 'new', true), 0);
    editor.isEditable = true;
    editor.view.composing = true;
    assert.equal(replaceEditorSearch(editor, 'new', true), 0);
    editor.view.composing = false;
    editor.isDestroyed = true;
    assert.equal(replaceEditorSearch(editor, 'new', true), 0);
    assert.equal(editor.state.doc, original);
});
