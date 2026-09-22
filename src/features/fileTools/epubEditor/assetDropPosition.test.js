import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { assetDropTransaction } from './assetDrop.js';
import { resolveAssetDropPosition } from './assetDropPosition.js';

const schema = new Schema({ nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    image: { group: 'block', atom: true, attrs: { assetId: { default: '' }, width: { default: 100 }, align: { default: 'center' }, alt: { default: '' } } },
    audio: { group: 'block', atom: true, attrs: { assetId: { default: '' }, title: { default: '' }, kind: { default: 'effect' }, loop: { default: false } } },
    table: { group: 'block', content: 'tableRow+' },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'block+', isolating: true },
    columns: { group: 'block', content: 'column{2,3}', isolating: true },
    column: { content: 'block+', isolating: true },
} });
const paragraph = text => schema.node('paragraph', null, text ? schema.text(text) : null);
const image = { id: 'a_image', kind: 'image', name: '그림.png' };
const audio = { id: 'a_audio', kind: 'audio', name: '소리.mp3' };
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });

function createView(doc, { hit = { pos: 3, inside: 0 }, nodes = { 0: rect(120, 100, 680, 140) }, caret = rect(180, 104, 180, 132), bounds = rect(100, 50, 700, 700), viewport = { innerWidth: 1000, innerHeight: 800 } } = {}) {
    const calls = [];
    return {
        state: EditorState.create({ doc, plugins: [history()] }),
        dom: { getBoundingClientRect: () => bounds, ownerDocument: { defaultView: viewport } },
        posAtCoords(point) { calls.push(point); return typeof hit === 'function' ? hit(point) : hit; },
        nodeDOM(position) { return nodes[position] ? { getBoundingClientRect: () => nodes[position] } : null; },
        coordsAtPos: () => caret,
        calls,
    };
}

test('the text caret previews the exact split used by image and audio insertion', () => {
    const doc = schema.node('doc', null, paragraph('abcd'));
    const view = createView(doc);
    view.state = view.state.apply(view.state.tr.setSelection(TextSelection.create(doc, 1, 5)));
    const result = resolveAssetDropPosition(view, { left: 180, top: 120 });
    assert.deepEqual(result, { position: 3, inline: true, rect: { left: 178.5, top: 104, width: 3, height: 28 } });
    let state = view.state.apply(assetDropTransaction(view.state, [image, audio], result.position));
    assert.deepEqual(state.doc.content.content.map(node => node.type.name), ['paragraph', 'image', 'audio', 'paragraph']);
    assert.equal(state.doc.child(0).textContent, 'ab');
    assert.equal(state.doc.child(3).textContent, 'cd');
    assert.equal(undo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(doc));
});

test('wrapped text and zoomed editor geometry remain in viewport pixels', () => {
    const view = createView(schema.node('doc', null, paragraph('abcd')), {
        nodes: { 0: rect(120.5, 100.25, 680.5, 190.25) },
        caret: rect(211.75, 152.25, 211.75, 185.25),
    });
    assert.deepEqual(resolveAssetDropPosition(view, { left: 212, top: 170 }).rect, { left: 210.25, top: 152.25, width: 3, height: 33 });
});

test('a gap between paragraphs shows a horizontal line at the actual block insertion position', () => {
    const doc = schema.node('doc', null, [paragraph('abcd'), paragraph('efgh')]);
    const view = createView(doc, {
        hit: { pos: 6, inside: -1 },
        nodes: { 0: rect(120, 100, 680, 140), 6: rect(120, 180, 680, 220) },
    });
    const result = resolveAssetDropPosition(view, { left: 400, top: 160 });
    assert.deepEqual(result, { position: 6, inline: false, rect: { left: 120, top: 158.5, width: 560, height: 3 } });
    assert.deepEqual(view.state.apply(assetDropTransaction(view.state, [image], result.position)).doc.content.content.map(node => node.type.name), ['paragraph', 'image', 'paragraph']);
});

for (const kind of ['image', 'audio']) {
    test(`hovering the two halves of an existing ${kind} previews insertion before and after it`, () => {
        const doc = schema.node('doc', null, [paragraph('abcd'), schema.node(kind), paragraph('efgh')]);
        const view = createView(doc, {
            hit: { pos: 6, inside: 6 },
            nodes: { 0: rect(120, 100, 680, 140), 6: rect(200, 180, 600, 280), 7: rect(120, 320, 680, 360) },
        });
        const before = resolveAssetDropPosition(view, { left: 400, top: 200 });
        const after = resolveAssetDropPosition(view, { left: 400, top: 260 });
        assert.equal(before.position, 6);
        assert.equal(before.inline, false);
        assert.equal(before.rect.top, 158.5);
        assert.equal(after.position, 7);
        assert.equal(after.inline, false);
        assert.equal(after.rect.top, 298.5);
        assert.equal(view.state.apply(assetDropTransaction(view.state, [image], after.position)).doc.child(2).attrs.assetId, image.id);
    });
}

test('paper gutters clamp to visible editor bounds and trailing blank space inserts at document end', () => {
    const doc = schema.node('doc', null, paragraph('abcd'));
    const view = createView(doc, { bounds: rect(-50, -20, 700, 1000), viewport: { innerWidth: 600, innerHeight: 500 } });
    const before = resolveAssetDropPosition(view, { left: -100, top: -100 });
    assert.deepEqual(view.calls[0], { left: 1, top: 1 });
    assert.equal(before.position, 0);
    assert.equal(before.inline, false);
    assert.equal(before.rect.top, 98.5);
    const after = resolveAssetDropPosition(view, { left: 900, top: 900 });
    assert.deepEqual(view.calls[1], { left: 599, top: 499 });
    assert.equal(after.position, doc.content.size);
    assert.equal(after.rect.top, 138.5);
    assert.equal(view.state.apply(assetDropTransaction(view.state, [audio], after.position)).doc.lastChild.attrs.assetId, audio.id);
});

test('an empty paragraph has a visible caret and supports the same insertion position', () => {
    const view = createView(schema.node('doc', null, paragraph('')), { hit: { pos: 1, inside: 0 } });
    const result = resolveAssetDropPosition(view, { left: 120, top: 120 });
    assert.equal(result.position, 1);
    assert.equal(result.inline, true);
    assert.equal(view.state.apply(assetDropTransaction(view.state, [image], result.position)).doc.firstChild.attrs.assetId, image.id);
});

test('table cell block boundaries stay within the target cell', () => {
    const doc = schema.node('doc', null, schema.node('table', null, schema.node('tableRow', null, [
        schema.node('tableCell', null, [paragraph('ab'), schema.node('image')]),
        schema.node('tableCell', null, paragraph('cd')),
    ])));
    const view = createView(doc, {
        hit: { pos: 7, inside: 2 },
        nodes: { 0: rect(120, 100, 680, 300), 1: rect(120, 100, 680, 300), 2: rect(120, 100, 390, 300), 3: rect(135, 115, 375, 145), 7: rect(150, 180, 360, 260), 9: rect(390, 100, 680, 300), 10: rect(405, 115, 665, 145) },
    });
    const result = resolveAssetDropPosition(view, { left: 250, top: 160 });
    assert.deepEqual(result, { position: 7, inline: false, rect: { left: 135, top: 161, width: 240, height: 3 } });
    const inserted = view.state.apply(assetDropTransaction(view.state, [audio], result.position)).doc.firstChild.firstChild;
    assert.equal(inserted.child(0).child(1).type.name, 'audio');
    assert.equal(inserted.child(1).textContent, 'cd');
});

test('structural table row hits resolve into the nearest cell instead of implying insertion between cells', () => {
    const doc = schema.node('doc', null, schema.node('table', null, schema.node('tableRow', null, [
        schema.node('tableCell', null, paragraph('ab')),
        schema.node('tableCell', null, paragraph('cd')),
    ])));
    const view = createView(doc, {
        hit: { pos: 8, inside: 1 },
        nodes: { 0: rect(120, 100, 680, 250), 1: rect(120, 100, 680, 250), 2: rect(120, 100, 390, 250), 3: rect(135, 115, 375, 145), 8: rect(390, 100, 680, 250), 9: rect(405, 115, 665, 145) },
    });
    const result = resolveAssetDropPosition(view, { left: 410, top: 220 });
    assert.equal(result.position, 13);
    assert.equal(result.inline, false);
    assert.equal(result.rect.left, 405);
    assert.equal(result.rect.width, 260);
    const inserted = view.state.apply(assetDropTransaction(view.state, [audio], result.position)).doc.firstChild.firstChild;
    assert.equal(inserted.child(1).lastChild.type.name, 'audio');
    assert.equal(inserted.child(0).childCount, 1);
});

test('structural column hits resolve into the hovered column and keep the marker within that column', () => {
    const doc = schema.node('doc', null, schema.node('columns', null, [
        schema.node('column', null, paragraph('ab')),
        schema.node('column', null, paragraph('cd')),
    ]));
    const view = createView(doc, {
        hit: { pos: 7, inside: 0 },
        nodes: { 0: rect(120, 100, 680, 250), 1: rect(120, 100, 380, 250), 2: rect(130, 110, 370, 140), 7: rect(420, 100, 680, 250), 8: rect(430, 110, 670, 140) },
    });
    const result = resolveAssetDropPosition(view, { left: 425, top: 120 });
    assert.equal(result.position, 8);
    assert.equal(result.inline, false);
    assert.equal(result.rect.left, 430);
    assert.equal(result.rect.width, 240);
    const inserted = view.state.apply(assetDropTransaction(view.state, [image], result.position)).doc.firstChild;
    assert.equal(inserted.child(1).firstChild.type.name, 'image');
    assert.equal(inserted.child(0).textContent, 'ab');
});

test('invalid positions, hidden editors and stale geometry do not produce a misleading marker', () => {
    const doc = schema.node('doc', null, paragraph('abcd'));
    for (const point of [null, {}, { left: NaN, top: 100 }, { left: 200, top: Infinity }]) {
        assert.equal(resolveAssetDropPosition(createView(doc), point), null);
    }
    for (const position of [-1, 999, NaN, 2.5]) {
        assert.equal(resolveAssetDropPosition(createView(doc, { hit: { pos: position } }), { left: 200, top: 120 }), null);
    }
    for (const options of [
        { hit: null },
        { bounds: rect(0, 0, 0, 0) },
        { bounds: rect(0, 900, 700, 1000) },
        { caret: rect(NaN, 100, 200, 130) },
        { caret: rect(200, 100, 200, 100) },
        { hit: { pos: 0 }, nodes: {} },
    ]) {
        assert.equal(resolveAssetDropPosition(createView(doc, options), { left: 200, top: 120 }), null);
    }
    for (const changes of [
        { editable: false },
        { isDestroyed: true },
        { posAtCoords() { throw new RangeError('stale document'); } },
        { coordsAtPos() { throw new RangeError('stale view'); } },
    ]) {
        assert.equal(resolveAssetDropPosition(Object.assign(createView(doc), changes), { left: 200, top: 120 }), null);
    }
});
