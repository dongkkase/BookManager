import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { history, undo, redo } from '@tiptap/pm/history';
import { EditorTab, editorTabCommand, handleEditorTab } from './editorTab.js';
import { ParagraphIndent } from './paragraphIndent.js';

const schema = getSchema([StarterKit, TableKit, ParagraphIndent, EditorTab]);
const p = (text, attrs) => schema.node('paragraph', attrs, text ? schema.text(text) : null);
const code = text => schema.node('codeBlock', { language: 'javascript' }, text ? schema.text(text) : null);
const item = (...blocks) => schema.node('listItem', null, blocks);
const list = (...items) => schema.node('bulletList', null, items);
const cell = (...blocks) => schema.node('tableCell', null, blocks);
const row = (...cells) => schema.node('tableRow', null, cells);
const table = (...rows) => schema.node('table', null, rows);
const doc = (...nodes) => schema.node('doc', null, nodes);
const at = (document, from, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to), plugins: [history()] });
function textPosition(document, text) {
    let position;
    document.descendants((node, pos) => { if (node.isText && node.text === text) position = pos; });
    assert.notEqual(position, undefined, text);
    return position;
}
function run(state, backwards = false) {
    let next = state;
    const handled = editorTabCommand(state, tr => { next = state.apply(tr); }, backwards);
    next.doc.check();
    return { state: next, handled };
}
function nodePositions(document, type) {
    const positions = [];
    document.descendants((node, pos) => { if (node.type.name === type) positions.push(pos); });
    return positions;
}

test('Tab indents paragraphs and headings at any caret position; Shift+Tab restores them', () => {
    const document = doc(list(item(p('item'))), p('body'), schema.node('heading', { level: 2 }, schema.text('title')));
    for (const text of ['body', 'title']) {
        for (const offset of [0, 2, text.length]) {
            const state = at(document, textPosition(document, text) + offset);
            const indented = run(state);
            assert.equal(indented.handled, true);
            assert.equal(indented.state.selection.$from.parent.attrs.indentLevel, 1);
            assert.ok(indented.state.selection.eq(state.selection));
            assert.equal(indented.state.doc.textContent, document.textContent);
            assert.ok(run(indented.state, true).state.doc.eq(document));
        }
    }
});

test('paragraph range indentation preserves selection direction and excludes the next paragraph start', () => {
    const document = doc(p('first'), schema.node('heading', { level: 2 }, schema.text('title')), p('last'));
    for (const [from, to] of [[2, 15], [15, 2]]) {
        const state = at(document, from, to);
        const next = run(state).state;
        assert.deepEqual(next.doc.content.content.map(node => node.attrs.indentLevel), [1, 1, 0]);
        assert.ok(next.selection.eq(state.selection));
        assert.ok(run(next, true).state.doc.eq(document));
    }
    const all = EditorState.create({ doc: document, selection: new AllSelection(document) });
    assert.deepEqual(run(all).state.doc.content.content.map(node => node.attrs.indentLevel), [1, 1, 1]);
});

test('paragraph limits keep the caret, text marks and first-line indentation without empty undo steps', () => {
    const paragraph = schema.node('paragraph', { indentLevel: 0, firstLineIndent: -1 }, schema.text('body', [schema.mark('bold')]));
    const original = at(doc(paragraph), 2);
    assert.equal(run(original, true).handled, true);
    assert.equal(run(original, true).state, original);
    let state = original;
    for (let i = 0; i < 8; i += 1) state = run(state).state;
    assert.equal(state.doc.firstChild.attrs.indentLevel, 8);
    assert.equal(state.doc.firstChild.attrs.firstLineIndent, -1);
    assert.ok(state.doc.firstChild.content.eq(paragraph.content));
    assert.equal(run(state).handled, true);
    assert.equal(run(state).state, state);
    assert.equal(undo(state, tr => { state = state.apply(tr); }), true);
    assert.equal(state.doc.firstChild.attrs.indentLevel, 7);
    assert.equal(redo(state, tr => { state = state.apply(tr); }), true);
    assert.equal(state.doc.firstChild.attrs.indentLevel, 8);
    assert.equal(state.selection.from, 2);
});

test('empty and quoted paragraphs indent; mixed list and table ranges retain native navigation', () => {
    const quote = doc(schema.node('blockquote', null, p('quoted')));
    for (const state of [at(doc(p('')), 1), at(quote, textPosition(quote, 'quoted'))]) {
        assert.equal(run(state).state.selection.$from.parent.attrs.indentLevel, 1);
    }
    for (const block of [list(item(p('nested'))), table(row(cell(p('nested'))))]) {
        const document = doc(p('body'), block);
        const state = at(document, 1, textPosition(document, 'nested') + 3);
        assert.equal(run(state).handled, false);
        assert.equal(run(state).state, state);
    }
});

for (const type of ['bulletList', 'orderedList']) {
    test(`${type}: Tab nests an item, Shift+Tab lifts it, retaining text and selection`, () => {
        const document = doc(schema.node(type, null, [item(p('first')), item(p('second')), item(p('last'))]));
        const state = at(document, textPosition(document, 'second') + 2);
        const nested = run(state);
        assert.equal(nested.handled, true);
        assert.equal(nested.state.doc.firstChild.childCount, 2);
        assert.equal(nested.state.doc.firstChild.firstChild.child(1).type.name, type);
        assert.equal(nested.state.selection.$from.parent.textContent, 'second');
        assert.equal(nested.state.selection.$from.parentOffset, 2);
        const lifted = run(nested.state, true);
        assert.equal(lifted.handled, true);
        assert.ok(lifted.state.doc.eq(document));
        assert.equal(lifted.state.selection.from, state.selection.from);
    });
}

test('multiple selected list items nest together and top-level Shift+Tab removes the list', () => {
    const document = doc(list(item(p('one')), item(p('two')), item(p('three'))));
    const state = at(document, textPosition(document, 'two'), textPosition(document, 'three') + 5);
    const nested = run(state).state;
    assert.equal(nested.doc.firstChild.firstChild.child(1).childCount, 2);
    assert.ok(run(nested, true).state.doc.eq(document));
    const only = doc(list(item(p('body'))));
    const lifted = run(at(only, textPosition(only, 'body')), true);
    assert.equal(lifted.handled, true);
    assert.ok(lifted.state.doc.eq(doc(p('body'))));
});

test('Tab on the first list item neither changes a parent list nor inserts whitespace', () => {
    const document = doc(list(item(p('one')), item(p('two'), list(item(p('nested'))))));
    for (const text of ['one', 'nested']) {
        const state = at(document, textPosition(document, text));
        assert.equal(run(state).handled, false);
        assert.equal(run(state).state, state);
    }
});

test('code Tab indents a complete current line, retains the caret and undoes as one step', () => {
    const document = doc(code('alpha\nbeta'));
    const original = at(document, 4);
    const indented = run(original);
    assert.equal(indented.handled, true);
    assert.equal(indented.state.doc.textContent, '    alpha\nbeta');
    assert.equal(indented.state.selection.from, 8);
    assert.equal(indented.state.doc.firstChild.attrs.language, 'javascript');
    const twice = run(indented.state).state;
    assert.equal(twice.doc.textContent, '        alpha\nbeta');
    let undone = twice;
    assert.equal(undo(undone, tr => { undone = undone.apply(tr); }), true);
    assert.ok(undone.doc.eq(indented.state.doc));
    assert.equal(redo(undone, tr => { undone = undone.apply(tr); }), true);
    assert.ok(undone.doc.eq(twice.doc));
    assert.ok(run(indented.state, true).state.doc.eq(document));
});

test('partial and backwards code selections indent whole lines without replacing selected text', () => {
    const document = doc(code('alpha\nbeta\ngamma'));
    for (const [from, to] of [[3, 9], [9, 3]]) {
        const original = at(document, from, to);
        const indented = run(original).state;
        assert.equal(indented.doc.textContent, '    alpha\n    beta\ngamma');
        assert.equal(indented.selection.anchor, from + (from < 7 ? 4 : 8));
        assert.equal(indented.selection.head, to + (to < 7 ? 4 : 8));
        const restored = run(indented, true).state;
        assert.ok(restored.doc.eq(document));
        assert.equal(restored.selection.anchor, from);
        assert.equal(restored.selection.head, to);
    }
});

test('code selection ending at the next line start excludes that line', () => {
    const document = doc(code('alpha\nbeta'));
    assert.equal(run(at(document, 1, 7)).state.doc.textContent, '    alpha\nbeta');
    assert.equal(run(at(document, 7)).state.doc.textContent, 'alpha\n    beta');
});

test('empty code and blank first/last lines accept four spaces at the correct line', () => {
    for (const [text, position, expected] of [['', 1, '    '], ['\na', 1, '    \na'], ['a\n', 3, 'a\n    ']]) {
        assert.equal(run(at(doc(code(text)), position)).state.doc.textContent, expected);
    }
});

test('code outdent removes up to four leading spaces or a tab; unindented lines stay unchanged', () => {
    const text = '  a\n\tb\n    c\nd';
    const document = doc(code(text));
    const changed = run(at(document, 1, text.length + 1), true);
    assert.equal(changed.state.doc.textContent, 'a\nb\nc\nd');
    assert.equal(run(at(doc(code('a')), 1), true).handled, false);
});

test('cross-block code selections, whole-document and node selections never flatten content', () => {
    const document = doc(code('code'), p('body'));
    const selections = [TextSelection.create(document, 2, 9), TextSelection.create(document, 9, 2), new AllSelection(document), NodeSelection.create(document, 0)];
    for (const selection of selections) {
        const state = EditorState.create({ doc: document, selection });
        for (const backwards of [false, true]) {
            assert.equal(run(state, backwards).handled, false);
            assert.equal(run(state, backwards).state, state);
        }
    }
});

test('table Tab and Shift+Tab move between cells and leave the first cell backwards without edits', () => {
    const document = doc(table(row(cell(p('a')), cell(p('b'))), row(cell(p('c')), cell(p('d')))));
    const original = at(document, textPosition(document, 'a'));
    let state = original;
    for (const text of ['b', 'c', 'd']) {
        state = run(state).state;
        assert.equal(state.selection.$from.parent.textContent, text);
        assert.ok(state.doc.eq(document));
    }
    for (const text of ['c', 'b', 'a']) {
        state = run(state, true).state;
        assert.equal(state.selection.$from.parent.textContent, text);
    }
    assert.equal(run(state, true).handled, false);
});

test('last-cell Tab adds one row, focuses its first cell and can be undone in one step', () => {
    const document = doc(table(row(cell(p('a')), cell(p('b')))));
    const original = at(document, textPosition(document, 'b'));
    let state = original;
    let count = 0;
    assert.equal(editorTabCommand(state, tr => { count += 1; state = state.apply(tr); }), true);
    assert.equal(count, 1);
    assert.equal(state.doc.firstChild.childCount, 2);
    assert.equal(state.selection.$from.before(3), nodePositions(state.doc, 'tableCell')[2]);
    assert.equal(undo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(document));
    assert.equal(state.selection.from, original.selection.from);
});

test('merged cells are traversed once and new rows retain valid table dimensions', () => {
    const merged = schema.node('tableCell', { colspan: 2 }, p('merged'));
    const document = doc(table(row(merged), row(cell(p('c')), cell(p('d')))));
    let state = at(document, textPosition(document, 'merged'));
    state = run(state).state;
    assert.equal(state.selection.$from.parent.textContent, 'c');
    state = run(state).state;
    state = run(state).state;
    assert.equal(state.doc.firstChild.childCount, 3);
    assert.equal(TableMap.get(state.doc.firstChild).width, 2);
    assert.equal(TableMap.get(state.doc.firstChild).problems, null);
    const spanned = doc(table(row(schema.node('tableCell', { rowspan: 2 }, p('span')), cell(p('top'))), row(cell(p('bottom')))));
    let next = at(spanned, textPosition(spanned, 'top'));
    next = run(next).state;
    assert.equal(next.selection.$from.parent.textContent, 'bottom');
    next = run(next).state;
    assert.equal(TableMap.get(next.doc.firstChild).problems, null);
});

test('rectangular cell selections navigate without destroying cell contents', () => {
    const document = doc(table(row(cell(p('a')), cell(p('b'))), row(cell(p('c')), cell(p('d')))));
    const cells = nodePositions(document, 'tableCell');
    const original = EditorState.create({ doc: document, selection: CellSelection.create(document, cells[0], cells[2]) });
    const next = run(original).state;
    assert.equal(next.selection.$from.parent.textContent, 'd');
    assert.ok(next.doc.eq(document));
});

test('inner code and list editing takes precedence over table navigation, without lifting an outer list', () => {
    const document = doc(table(row(cell(list(item(p('first')), item(p('second'))), code('snippet')), cell(p('next')))));
    const nested = run(at(document, textPosition(document, 'second'))).state;
    assert.equal(nested.selection.$from.parent.textContent, 'second');
    assert.equal(nested.doc.firstChild.firstChild.firstChild.firstChild.firstChild.child(1).type.name, 'bulletList');
    const indented = run(at(document, textPosition(document, 'snippet'))).state;
    assert.equal(indented.selection.$from.parent.textContent, '    snippet');
    const next = run(at(document, textPosition(document, 'first'))).state;
    assert.equal(next.selection.$from.parent.textContent, 'next');
    const outer = doc(list(item(p('before')), item(p('container'), table(row(cell(p('inside')), cell(p('after')))))));
    const state = at(outer, textPosition(outer, 'inside'));
    assert.equal(run(state, true).handled, false);
    assert.ok(run(state).state.doc.eq(outer));
});

test('dry runs report available actions without changing document or selection', () => {
    for (const document of [doc(p('body')), doc(code('body')), doc(list(item(p('first')), item(p('body')))), doc(table(row(cell(p('body')))))]) {
        const state = at(document, textPosition(document, 'body'));
        const selection = state.selection;
        assert.equal(editorTabCommand(state), true);
        assert.equal(state.doc, document);
        assert.equal(state.selection, selection);
    }
});

test('DOM Tab indents plain text but preserves native focus for controls, modifiers, IME and read-only views', () => {
    const document = doc(code('body'));
    let state = at(document, 1);
    const dom = {};
    const view = { get state() { return state; }, dom, editable: true, composing: false, dispatch: tr => { state = state.apply(tr); } };
    let prevented = 0;
    const event = { key: 'Tab', target: dom, preventDefault: () => { prevented += 1; } };
    for (const fields of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }]) {
        assert.equal(handleEditorTab(view, { ...event, ...fields }), true);
        assert.equal(state.doc, document);
    }
    for (const fields of [{ editable: false }, { composing: true }]) {
        assert.equal(handleEditorTab({ ...view, ...fields }, event), true);
        assert.equal(state.doc, document);
    }
    assert.equal(prevented, 0);
    assert.equal(handleEditorTab(view, { ...event, key: 'Enter' }), false);
    assert.equal(handleEditorTab(view, event), true);
    assert.equal(prevented, 1);
    assert.equal(state.doc.textContent, '    body');
    state = at(doc(p('plain')), 1);
    assert.equal(handleEditorTab(view, event), true);
    assert.equal(prevented, 2);
    assert.equal(state.doc.firstChild.attrs.indentLevel, 1);
});

test('Esc then Tab releases native focus once, including Shift+Tab; input, clicks and blur reset it', () => {
    const handlers = () => EditorTab.config.addProseMirrorPlugins()[0].props.handleDOMEvents;
    const events = handlers();
    let state = at(doc(p('body')), 2);
    const dom = {};
    const view = { get state() { return state; }, dom, editable: true, composing: false, dispatch: tr => { state = state.apply(tr); } };
    let prevented = 0;
    const event = key => ({ key, target: dom, preventDefault: () => { prevented += 1; } });
    for (const shiftKey of [false, true]) {
        events.keydown(view, event('Escape'));
        if (shiftKey) events.keydown(view, event('Shift'));
        assert.equal(events.keydown(view, { ...event('Tab'), shiftKey }), true);
        assert.equal(prevented, 0);
        assert.equal(state.doc.firstChild.attrs.indentLevel, 0);
    }
    events.keydown(view, event('Tab'));
    assert.equal(prevented, 1);
    for (const reset of [() => events.keydown(view, event('ArrowRight')), () => events.mousedown(), () => events.blur()]) {
        events.keydown(view, event('Escape'));
        reset();
        const before = prevented;
        events.keydown(view, event('Tab'));
        assert.equal(prevented, before + 1);
    }
    events.keydown(view, event('Escape'));
    const before = prevented;
    handlers().keydown(view, event('Tab'));
    assert.equal(prevented, before + 1);
});
