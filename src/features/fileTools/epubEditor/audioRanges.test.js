import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { history } from '@tiptap/pm/history';
import { createAudioExtension } from './audioNode.js';
import { audioBlockChoices, audioRangeAtSelection, audioRangeTransaction, captureAudioRangeSelection, createAudioRangeExtension } from './audioRanges.js';
import { selectionContext } from './contextTools.js';

const settings = { assetId: 'a_audio', title: '배경음', kind: 'background', controls: false, loop: true, volume: 0.35 };
const paragraph = text => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined });
const resolveAsset = id => id === settings.assetId ? 'blob:audio' : '';

function fixture(t, content = [paragraph('first text'), paragraph('second text')]) {
    const extension = createAudioRangeExtension(resolveAsset);
    const editor = new Editor({ element: null, extensions: [StarterKit, createAudioExtension(resolveAsset), extension], content: { type: 'doc', content } });
    editor.registerPlugin(history());
    t.after(() => editor.destroy());
    return { editor, extension };
}

function marks(doc) {
    const result = [];
    doc.descendants(node => { if (node.isText) for (const mark of node.marks) if (mark.type.name === 'audioRange') result.push(mark.attrs); });
    return result;
}

test('attaching audio across paragraphs preserves text and formatting and supports undo/redo', t => {
    const { editor } = fixture(t, [{ type: 'paragraph', content: [{ type: 'text', text: 'first ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'text' }] }, paragraph('second text')]);
    editor.commands.setTextSelection({ from: 1, to: 19 });
    const before = editor.getJSON();
    const text = editor.state.doc.textContent;
    const snapshot = captureAudioRangeSelection(editor.state);
    assert.equal(snapshot.canAttach, true);
    assert.equal(snapshot.text, 'first text\nsecond');
    editor.view.dispatch(audioRangeTransaction(editor.state, snapshot, settings));
    const saved = editor.getJSON();
    assert.equal(editor.state.doc.textContent, text);
    assert.equal(editor.state.doc.firstChild.firstChild.marks.some(mark => mark.type.name === 'bold'), true);
    assert.equal(new Set(marks(editor.state.doc).map(attrs => attrs.id)).size, 1);
    assert.ok(marks(editor.state.doc).every(attrs => attrs.volume === .35 && attrs.controls === false));
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(editor.getJSON(), saved);
    editor.commands.setContent(saved);
    assert.deepEqual(editor.getJSON(), saved);
});

test('cursor editing changes every fragment of the same range and detaching preserves the text', t => {
    const { editor } = fixture(t);
    editor.commands.setTextSelection({ from: 2, to: 20 });
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), settings));
    const id = marks(editor.state.doc)[0].id;
    editor.commands.setTextSelection(15);
    assert.equal(selectionContext(editor.state).kind, 'audioRange');
    assert.equal(audioRangeAtSelection(editor.state).id, id);
    const snapshot = captureAudioRangeSelection(editor.state);
    assert.equal(snapshot.existing.id, id);
    assert.equal(snapshot.text, 'irst text\nsecond ');
    editor.view.dispatch(audioRangeTransaction(editor.state, snapshot, { ...settings, volume: 0, loop: false, controls: true }));
    assert.ok(marks(editor.state.doc).every(attrs => attrs.id === id && attrs.volume === 0 && attrs.loop === false && attrs.controls === true));
    const text = editor.state.doc.textContent;
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), null));
    assert.deepEqual(marks(editor.state.doc), []);
    assert.equal(editor.state.doc.textContent, text);
    assert.equal(editor.commands.undo(), true);
    assert.ok(marks(editor.state.doc).length > 0);
});

test('typing at either range boundary stays outside its audio mark', t => {
    const { editor } = fixture(t, [paragraph('abcdef')]);
    editor.commands.setTextSelection({ from: 2, to: 5 });
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), settings));
    editor.commands.setTextSelection(5);
    editor.view.dispatch(editor.state.tr.insertText('X'));
    assert.equal(editor.state.doc.textContent, 'abcdXef');
    assert.equal(editor.state.doc.nodeAt(5).marks.some(mark => mark.type.name === 'audioRange'), false);
    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.insertText('Y'));
    assert.equal(editor.state.doc.textContent, 'aYbcdXef');
    assert.equal(editor.state.doc.nodeAt(2).marks.some(mark => mark.type.name === 'audioRange'), false);
});

test('moving an existing block to a range maps selection positions and removes only that block', t => {
    for (const location of ['before', 'inside', 'after']) {
        const audio = { type: 'audio', attrs: settings };
        const content = location === 'before' ? [audio, paragraph('first'), paragraph('second')]
            : location === 'inside' ? [paragraph('first'), audio, paragraph('second')]
                : [paragraph('first'), paragraph('second'), audio];
        const { editor } = fixture(t, content);
        const blocks = audioBlockChoices(editor.state.doc);
        editor.commands.setTextSelection({ from: location === 'before' ? 2 : 1, to: location === 'after' ? 14 : 15 });
        const before = editor.getJSON();
        const text = editor.state.doc.textContent;
        const snapshot = captureAudioRangeSelection(editor.state);
        editor.view.dispatch(audioRangeTransaction(editor.state, snapshot, settings, blocks[0]));
        assert.equal(audioBlockChoices(editor.state.doc).length, 0, location);
        assert.equal(editor.state.doc.textContent, text, location);
        assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n'), 'first\nsecond', location);
        assert.equal(new Set(marks(editor.state.doc).map(attrs => attrs.id)).size, 1, location);
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.getJSON(), before, location);
    }
});

test('range creation rejects stale selection, code and overlapping audio without changing content', t => {
    const { editor } = fixture(t, [paragraph('first'), { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }]);
    editor.commands.setTextSelection({ from: 1, to: 12 });
    let snapshot = captureAudioRangeSelection(editor.state);
    assert.equal(snapshot.restricted, true);
    assert.equal(snapshot.canAttach, false);
    assert.throws(() => audioRangeTransaction(editor.state, snapshot, settings), { code: 'AUDIO_RANGE_SELECTION_REQUIRED' });
    editor.commands.setTextSelection({ from: 2, to: 4 });
    snapshot = captureAudioRangeSelection(editor.state);
    editor.view.dispatch(audioRangeTransaction(editor.state, snapshot, settings));
    assert.throws(() => audioRangeTransaction(editor.state, snapshot, settings), { code: 'AUDIO_RANGE_CHANGED' });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    snapshot = captureAudioRangeSelection(editor.state);
    assert.equal(snapshot.overlaps, true);
    assert.equal(snapshot.canAttach, false);
});

test('inline code and non-text node selections cannot become audio ranges', t => {
    const { editor } = fixture(t, [{ type: 'paragraph', content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }] }, { type: 'audio', attrs: settings }]);
    editor.commands.setTextSelection({ from: 1, to: 5 });
    assert.equal(captureAudioRangeSelection(editor.state).restricted, true);
    editor.commands.setNodeSelection(6);
    assert.equal(captureAudioRangeSelection(editor.state).canAttach, false);
});

test('soft line breaks keep the same settings during range updates and lose only their audio mark on detach', t => {
    const { editor } = fixture(t, [{ type: 'paragraph', content: [{ type: 'text', text: 'first ' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }] }]);
    editor.commands.setTextSelection({ from: 1, to: 14 });
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), settings));
    editor.commands.setTextSelection(9);
    let hardBreak;
    editor.state.doc.descendants(node => { if (node.type.name === 'hardBreak') hardBreak = node; });
    assert.equal(hardBreak.marks.some(mark => mark.type.name === 'audioRange'), true);
    const text = editor.state.doc.textContent;
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), { ...settings, volume: 0, loop: false }));
    editor.state.doc.descendants(node => {
        for (const mark of node.marks) if (mark.type.name === 'audioRange') {
            assert.equal(mark.attrs.volume, 0);
            assert.equal(mark.attrs.loop, false);
        }
    });
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), null));
    editor.state.doc.descendants(node => {
        assert.equal(node.marks.some(mark => mark.type.name === 'audioRange'), false);
        if (node.type.name === 'hardBreak') hardBreak = node;
    });
    assert.equal(hardBreak.type.name, 'hardBreak');
    assert.equal(editor.state.doc.textContent, text);
});

test('clipboard attributes retain muted settings and paste gives all fragments one new range ID', t => {
    const { editor, extension } = fixture(t);
    editor.commands.setTextSelection({ from: 1, to: 19 });
    editor.view.dispatch(audioRangeTransaction(editor.state, captureAudioRangeSelection(editor.state), { ...settings, volume: 0 }));
    const saved = marks(editor.state.doc)[0];
    const html = extension.config.renderHTML({ mark: { attrs: saved } });
    const parsed = editor.schema.marks.audioRange.spec.parseDOM[0].getAttrs({ getAttribute: key => html[1][key] == null ? null : String(html[1][key]) });
    assert.deepEqual(parsed, { ...saved });
    const plugin = extension.config.addProseMirrorPlugins()[0];
    const original = editor.state.selection.content();
    const pasted = plugin.props.transformPasted(original);
    const ids = new Set();
    pasted.content.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'audioRange') { ids.add(mark.attrs.id); assert.equal(mark.attrs.volume, 0); } });
    assert.equal(ids.size, 1);
    assert.equal(ids.has(saved.id), false);
    assert.equal(pasted.content.textBetween(0, pasted.content.size), original.content.textBetween(0, original.content.size));
});
