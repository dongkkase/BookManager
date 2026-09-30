import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { history, closeHistory, undo, redo } from '@tiptap/pm/history';
import { movableElement, moveElementTransaction, adjacentElementPosition } from './elementDrag.js';

const schema = new Schema({ nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    horizontalRule: { group: 'block', attrs: { dividerStyle: { default: null } } },
    image: { group: 'block', atom: true, attrs: { id: {}, assetId: {}, caption: {}, width: {}, align: {}, textWrap: {} } },
    audio: { group: 'block', atom: true, attrs: { assetId: {}, loop: {}, kind: {} } },
    media: { group: 'block', atom: true, attrs: { url: {}, title: {} } },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'block+', isolating: true },
    columns: { group: 'block', content: 'column{2,3}', isolating: true },
    column: { content: 'block+', isolating: true },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*' },
} });
const p = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const rule = schema.node('horizontalRule', { dividerStyle: 'stars' });
const image = schema.node('image', { id: 'n_image', assetId: 'a_image', caption: '한글 설명', width: 45, align: 'right', textWrap: 'left' });
const table = content => schema.node('table', null, schema.node('tableRow', null, schema.node('tableCell', null, content)));
const columns = content => schema.node('columns', null, [schema.node('column', null, content), schema.node('column', null, p('other column'))]);
const stateFor = content => EditorState.create({ doc: schema.node('doc', null, content), plugins: [history()] });
const allElements = [rule, image, schema.node('audio', { assetId: 'a_audio', loop: true, kind: 'background' }), schema.node('media', { url: 'https://youtu.be/abcdefghijk', title: 'video' }), table([p('cell'), image]), columns([p('column'), rule])];

test('all supported elements move up and down as one node with attributes and contents intact', () => {
    for (const node of allElements) {
        let state = stateFor([p('before'), node, p('after')]);
        const original = state.doc;
        const source = movableElement(state, 8);
        const tr = moveElementTransaction(state, source, state.doc.content.size);
        assert.ok(tr, node.type.name);
        state = state.apply(tr);
        state.doc.check();
        assert.ok(state.doc.lastChild.eq(node));
        assert.equal(state.doc.childCount, 3);
        assert.ok(state.selection instanceof NodeSelection);
        assert.ok(state.selection.node.eq(node));
        assert.ok(undo(state, change => { state = state.apply(change); }));
        assert.ok(state.doc.eq(original));
        assert.ok(redo(state, change => { state = state.apply(change); }));
        const back = moveElementTransaction(state, movableElement(state, state.selection.from), 0);
        state = state.apply(back);
        assert.ok(state.doc.firstChild.eq(node));
        assert.equal(state.doc.childCount, 3);
    }
});

test('moving inside a paragraph splits at the indicated caret and preserves the text', () => {
    let state = stateFor([image, p('abcdef'), rule]);
    state = state.apply(moveElementTransaction(state, movableElement(state, 0), 5));
    assert.deepEqual(state.doc.content.content.map(node => node.type.name), ['paragraph', 'image', 'paragraph', 'horizontalRule']);
    assert.equal(state.doc.child(0).textContent, 'abc');
    assert.equal(state.doc.child(2).textContent, 'def');
    assert.ok(state.doc.child(1).eq(image));
    state.doc.check();
});

test('moving into and out of a table cell or column retains a valid source container', () => {
    for (const container of [table, columns]) {
        let state = stateFor([image, container([p('target')]), p('end')]);
        let target;
        state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'target') target = pos; });
        state = state.apply(moveElementTransaction(state, movableElement(state, 0), target));
        state.doc.check();
        assert.ok(state.selection.node.eq(image));
        assert.ok(state.selection.$from.depth > 0);
        state = state.apply(moveElementTransaction(state, movableElement(state, state.selection.from), state.doc.content.size));
        state.doc.check();
        assert.ok(state.doc.lastChild.eq(image));
        assert.equal(state.doc.textContent, container === table ? 'targetend' : 'targetother columnend');
    }
    let state = stateFor([table([image]), p('end')]);
    state = state.apply(moveElementTransaction(state, movableElement(state, 3), state.doc.content.size));
    state.doc.check();
    assert.ok(state.doc.lastChild.eq(image));
    assert.equal(state.doc.firstChild.firstChild.firstChild.firstChild.type.name, 'paragraph');
});

test('a divider can move into a list item and back without losing the item text', () => {
    let state = stateFor([rule, schema.node('bulletList', null, schema.node('listItem', null, p('item')))]);
    state = state.apply(moveElementTransaction(state, movableElement(state, 0), 8));
    state.doc.check();
    assert.ok(state.selection.node.eq(rule));
    assert.equal(state.doc.textContent, 'item');
    state = state.apply(moveElementTransaction(state, movableElement(state, state.selection.from), 0));
    state.doc.check();
    assert.ok(state.doc.firstChild.eq(rule));
    assert.equal(state.doc.lastChild.type.name, 'bulletList');
});

test('self drops, invalid positions and stale source snapshots leave the document unchanged', () => {
    const state = stateFor([p('before'), table([p('cell'), rule]), p('after')]);
    const source = movableElement(state, 8);
    for (const position of [-1, null, NaN, 999, source.from, source.from + 3, source.to]) {
        assert.equal(moveElementTransaction(state, source, position), null);
    }
    assert.equal(movableElement(state, 0), null);
    assert.equal(movableElement(state, -1), null);
    const edited = state.apply(state.tr.insertText('changed', 1));
    assert.equal(moveElementTransaction(edited, source, 0), null);
    const otherChapter = stateFor([p('other'), rule]);
    assert.equal(moveElementTransaction(otherChapter, source, 0), null);
});

test('keyboard movement uses adjacent siblings and stays inside a cell or column', () => {
    const state = stateFor([p('before'), image, p('after')]);
    assert.equal(adjacentElementPosition(state, 8, -1), 0);
    assert.equal(adjacentElementPosition(state, 8, 1), state.doc.content.size);
    const nested = stateFor([table([image, p('cell')])]);
    assert.equal(adjacentElementPosition(nested, 3, -1), null);
    const result = nested.apply(moveElementTransaction(nested, movableElement(nested, 3), adjacentElementPosition(nested, 3, 1)));
    result.doc.check();
    assert.ok(result.doc.firstChild.firstChild.firstChild.lastChild.eq(image));
});

test('a move is a separate undo step from preceding and following typing', () => {
    let state = stateFor([p('before'), image, p('after')]);
    state = state.apply(state.tr.insertText('!', 2));
    const typed = state.doc;
    state = state.apply(moveElementTransaction(state, movableElement(state, 9), state.doc.content.size));
    const moved = state.doc;
    state = state.apply(closeHistory(state.tr));
    state = state.apply(state.tr.insertText('?', 2));
    undo(state, tr => { state = state.apply(tr); });
    assert.ok(state.doc.eq(moved));
    undo(state, tr => { state = state.apply(tr); });
    assert.ok(state.doc.eq(typed));
});
