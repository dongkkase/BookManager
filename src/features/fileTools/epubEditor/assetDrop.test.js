import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { ASSET_DRAG, readAssetDrag, assetDropTransaction } from './assetDrop.js';

const schema = new Schema({ nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
    image: { group: 'block', atom: true, attrs: { assetId: {}, width: {}, align: {}, alt: {} } },
    audio: { group: 'block', atom: true, attrs: { assetId: {}, title: {}, kind: {}, loop: {} } },
} });
const assets = [{ id: 'a_image', kind: 'image', name: '그림.png' }, { id: 'a_font', kind: 'font', name: 'font.ttf' }, { id: 'a_audio', kind: 'audio', name: '소리.mp3' }];

test('dropping multiple assets splits a paragraph at the drop position without replacing the selection', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('앞문장뒷문장'))]);
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 7), plugins: [history()] });
    state = state.apply(assetDropTransaction(state, assets, 4));
    assert.deepEqual(state.doc.content.content.map(node => node.type.name), ['paragraph', 'image', 'audio', 'paragraph']);
    assert.equal(state.doc.child(0).textContent, '앞문장');
    assert.equal(state.doc.child(3).textContent, '뒷문장');
    assert.equal(state.doc.child(1).attrs.assetId, 'a_image');
    assert.equal(state.doc.child(2).attrs.assetId, 'a_audio');
    assert.equal(state.doc.child(2).attrs.title, '소리.mp3');
    const inserted = state.doc;
    assert.equal(undo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(doc));
    assert.equal(redo(state, tr => { state = state.apply(tr); }), true);
    assert.ok(state.doc.eq(inserted));
});

test('asset drops reject foreign projects, unknown IDs, font nodes and invalid positions', () => {
    const transfer = value => ({ getData: type => type === ASSET_DRAG ? value : '' });
    assert.equal(readAssetDrag(transfer(JSON.stringify({ sessionId: 's_current', assetId: 'a_audio' })), 's_current', assets), assets[2]);
    for (const value of ['bad JSON', 'null', JSON.stringify({ sessionId: 's_other', assetId: 'a_image' }), JSON.stringify({ sessionId: 's_current', assetId: 'a_missing' }), JSON.stringify({ sessionId: 's_current', assetId: 'a_font' })]) {
        assert.equal(readAssetDrag(transfer(value), 's_current', assets), null);
    }
    const state = EditorState.create({ schema });
    for (const position of [-1, 999, NaN]) assert.equal(assetDropTransaction(state, assets, position), null);
    assert.equal(assetDropTransaction(state, [assets[1]], 0), null);
    assert.equal(state.apply(assetDropTransaction(state, [assets[2]], 1)).doc.firstChild.type.name, 'audio');
});
