import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createProject, paragraph, validateProject } from '../../../../electron/epubEditor/model.js';
import { documentTtsPreview } from '../../../../electron/epubEditor/tts.js';
import { TtsMark, ttsAnnotationTransaction, ttsHistoryEntry, restoreTtsSettings } from './ttsEditing.js';
import { restoredChapters } from './chapterOperations.js';

function fixture(t) {
    const editor = new Editor({ element: null, extensions: [StarterKit, TtsMark], content: { type: 'doc', content: [paragraph('CPU (설명) C++')] } });
    editor.registerPlugin(editor.extensionManager.plugins.find(plugin => plugin.props.transformPasted));
    t.after(() => editor.destroy());
    return editor;
}

test('TTS editing preserves visible text and formatting; clearing formatting retains pronunciation', t => {
    const editor = fixture(t);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.commands.setBold();
    editor.view.dispatch(ttsAnnotationTransaction(editor.state, { from: 1, to: 4, mode: 'replace', text: '씨피유' }));
    assert.equal(editor.state.doc.textContent, 'CPU (설명) C++');
    assert.equal(editor.isActive('bold'), true);
    assert.equal(documentTtsPreview(editor.getJSON()).text, '씨피유 C');
    editor.commands.unsetAllMarks();
    assert.equal(editor.isActive('bold'), false);
    assert.equal(editor.isActive('tts'), true);
    const project = createProject();
    project.chapters[0].content = editor.getJSON();
    validateProject(project);
    editor.view.dispatch(ttsAnnotationTransaction(editor.state, { from: 1, to: 4, mode: 'auto' }));
    assert.equal(documentTtsPreview(editor.getJSON()).text, 'CPU C');
});

test('read and skip annotations survive project JSON without modifying source text', t => {
    const editor = fixture(t);
    editor.view.dispatch(ttsAnnotationTransaction(editor.state, { from: 5, to: 9, mode: 'read' }));
    assert.equal(documentTtsPreview(editor.getJSON()).text, 'CPU (설명) C');
    editor.view.dispatch(ttsAnnotationTransaction(editor.state, { from: 1, to: 4, mode: 'skip' }));
    const saved = JSON.parse(JSON.stringify(editor.getJSON()));
    editor.commands.setContent(saved);
    assert.equal(editor.state.doc.textContent, 'CPU (설명) C++');
    assert.equal(documentTtsPreview(editor.getJSON()).text, '(설명) C');
});

test('invalid ranges and empty replacements cannot silently overwrite existing annotations', t => {
    const editor = fixture(t);
    const before = editor.getJSON();
    for (const annotation of [
        { from: 0, to: 3, mode: 'read' },
        { from: 1, to: 4, mode: 'replace', text: ' ' },
        { from: 1, to: 999, mode: 'skip' },
        { from: 1, to: 4, mode: 'unknown' },
    ]) assert.throws(() => ttsAnnotationTransaction(editor.state, annotation));
    assert.deepEqual(editor.getJSON(), before);
});

test('pasting adjacent replacement text generates a distinct group and reads both occurrences', t => {
    const editor = fixture(t);
    editor.view.dispatch(ttsAnnotationTransaction(editor.state, { from: 1, to: 4, mode: 'replace', text: '씨피유' }));
    const slice = editor.state.doc.slice(1, 4);
    const transform = editor.state.plugins.find(plugin => plugin.props.transformPasted)?.props.transformPasted;
    assert.equal(typeof transform, 'function');
    const pasted = transform(slice);
    assert.notEqual(pasted.content.firstChild.marks.find(mark => mark.type.name === 'tts').attrs.id, slice.content.firstChild.marks.find(mark => mark.type.name === 'tts').attrs.id);
    editor.view.dispatch(editor.state.tr.replaceRange(4, 4, pasted));
    assert.equal(documentTtsPreview(editor.getJSON()).text, '씨피유씨피유 C');
});

test('one history entry restores dictionary and annotation together and rejects stale content', t => {
    const editor = fixture(t);
    const before = createProject();
    before.chapters[0].content = editor.getJSON();
    const content = ttsAnnotationTransaction(editor.state, { from: 1, to: 4, mode: 'replace', text: '씨피유' }).doc.toJSON();
    const after = { ...before, tts: { dictionary: [{ id: 'dict_test', source: 'C++', replacement: '씨 플러스 플러스' }] }, chapters: [{ ...before.chapters[0], content }] };
    const entry = ttsHistoryEntry(before, after, before.chapters[0].id, new Map());
    const undone = restoreTtsSettings({ ...after, chapters: restoredChapters(after.chapters, entry) }, entry);
    assert.deepEqual(undone, before);
    const redo = ttsHistoryEntry(after, undone, before.chapters[0].id, new Map());
    assert.deepEqual(restoreTtsSettings({ ...undone, chapters: restoredChapters(undone.chapters, redo) }, redo), after);
    assert.throws(() => restoreTtsSettings({ ...after, tts: { dictionary: [] } }, entry));
    const dictionaryOnly = ttsHistoryEntry(before, { ...before, tts: after.tts }, before.chapters[0].id, new Map());
    assert.deepEqual(dictionaryOnly.ids, [before.chapters[0].id]);
});
