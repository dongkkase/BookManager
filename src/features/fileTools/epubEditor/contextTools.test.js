import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, tableNodes } from '@tiptap/pm/tables';
import { selectionContext, placeContextToolbar, toolbarFocusIndex } from './contextTools.js';

const tables = tableNodes({ tableGroup: 'block', cellContent: 'paragraph+' });
const schema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*' },
        text: { group: 'inline' },
        image: { group: 'block', atom: true },
        audio: { group: 'block', atom: true },
        footnote: { group: 'inline', inline: true, atom: true },
        table: { ...tables.table, content: 'tableRow+' },
        tableRow: { ...tables.table_row, content: '(tableCell | tableHeader)+' },
        tableCell: tables.table_cell,
        tableHeader: tables.table_header,
    },
    marks: { link: { attrs: { href: {} }, inclusive: false } },
});
const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const context = (doc, selection) => selectionContext(EditorState.create({ doc, selection }));

test('selection tools distinguish a text range, linked caret, paragraph and selected media', () => {
    const doc = schema.node('doc', null, [paragraph('문단'), schema.node('paragraph', null, [schema.text('링크', [schema.mark('link', { href: 'https://example.com' })]), schema.node('footnote')]), schema.node('image'), schema.node('audio')]);
    assert.equal(context(doc, TextSelection.create(doc, 1)).kind, 'block');
    assert.equal(context(doc, TextSelection.create(doc, 1, 3)).kind, 'text');
    assert.equal(context(doc, TextSelection.create(doc, 5, 7)).kind, 'text');
    assert.deepEqual(context(doc, TextSelection.create(doc, 6)), { kind: 'link', href: 'https://example.com', from: 6, to: 6 });
    for (const [position, kind] of [[7, 'footnote'], [9, 'image'], [10, 'audio']]) {
        const result = context(doc, NodeSelection.create(doc, position));
        assert.equal(result.kind, kind);
        assert.equal(result.before, position);
        assert.equal(result.after, position + 1);
    }
});

test('table toolbar anchors to the active cell, keeps table boundaries and permits formatting within a cell', () => {
    const cell = text => schema.node('tableCell', null, paragraph(text));
    const doc = schema.node('doc', null, [paragraph('앞'), schema.node('table', null, [schema.node('tableRow', null, [cell('하나'), cell('둘')]), schema.node('tableRow', null, [cell('셋'), cell('넷')])]), paragraph('뒤')]);
    const cells = [];
    doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
    const caret = context(doc, TextSelection.create(doc, cells[1] + 2));
    assert.equal(caret.kind, 'table');
    assert.equal(caret.anchor, cells[1]);
    assert.equal(caret.before, 3);
    assert.equal(caret.after, 3 + doc.child(1).nodeSize);
    const range = context(doc, CellSelection.create(doc, cells[0], cells[3]));
    assert.equal(range.kind, 'table');
    assert.equal(range.anchor, cells[3]);
    assert.equal(context(doc, TextSelection.create(doc, cells[0] + 2, cells[0] + 4)).kind, 'text');
    assert.equal(context(doc, NodeSelection.create(doc, 3)).kind, 'table');
});

test('floating tools remain inside the visible stage at edges and hide for offscreen selections', () => {
    const bounds = { left: 210, right: 850, top: 250, bottom: 700 };
    const size = { width: 280, height: 46 };
    assert.deepEqual(placeContextToolbar({ left: 400, right: 500, top: 400, bottom: 425 }, bounds, size), { left: 310, top: 346 });
    assert.deepEqual(placeContextToolbar({ left: 800, right: 840, top: 255, bottom: 280 }, bounds, size), { left: 570, top: 288 });
    assert.deepEqual(placeContextToolbar({ left: 180, right: 250, top: 260, bottom: 650 }, bounds, { width: 900, height: 600 }), { left: 210, top: 250 });
    for (const anchor of [{ left: 300, right: 450, top: 20, bottom: 240 }, { left: 900, right: 950, top: 400, bottom: 500 }, { left: 300, right: 450, top: 710, bottom: 750 }]) assert.equal(placeContextToolbar(anchor, bounds, size), null);
});

test('toolbar keyboard navigation wraps, supports Home/End and leaves typing keys alone', () => {
    assert.equal(toolbarFocusIndex(0, 'ArrowLeft', 4), 3);
    assert.equal(toolbarFocusIndex(3, 'ArrowRight', 4), 0);
    assert.equal(toolbarFocusIndex(2, 'Home', 4), 0);
    assert.equal(toolbarFocusIndex(2, 'End', 4), 3);
    assert.equal(toolbarFocusIndex(2, 'b', 4), -1);
    assert.equal(toolbarFocusIndex(0, 'ArrowRight', 0), -1);
});
