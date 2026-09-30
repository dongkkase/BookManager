import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { captureTtsSelection, draftTtsPreview, ttsDraftError } from './ttsDialogState.js';

const schema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        paragraph: { content: 'inline*', group: 'block' },
        codeBlock: { content: 'text*', group: 'block', marks: '' },
        text: { group: 'inline' },
        hardBreak: { inline: true, group: 'inline' },
        footnote: { inline: true, atom: true, group: 'inline' },
    },
    marks: {
        bold: {}, code: {},
        tts: { attrs: { id: {}, mode: {}, text: { default: '' } }, inclusive: false },
    },
});
const p = (...content) => schema.node('paragraph', null, content);
const text = (value, marks) => schema.text(value, marks);
const doc = (...content) => schema.node('doc', null, content);
const stateAt = (document, from, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to) });
const mark = (id = 'tts_one', mode = 'replace', value = '체력') => schema.mark('tts', { id, mode, text: value });

test('a cursor inside an existing instruction captures its full formatted range without changing selection', () => {
    const document = doc(p(text('앞 '), text('HP', [mark()]), text(' 100', [mark(), schema.mark('bold')]), text(' 뒤')));
    const state = stateAt(document, 4);
    const snapshot = captureTtsSelection(state);
    assert.equal(snapshot.from, 3);
    assert.equal(snapshot.to, 9);
    assert.equal(snapshot.selected, true);
    assert.equal(snapshot.expanded, true);
    assert.equal(snapshot.canAnnotate, true);
    assert.equal(snapshot.annotation.text, '체력');
    assert.equal(draftTtsPreview(snapshot, []).text, '체력');
    assert.equal(state.selection.from, 4);
    assert.equal(state.selection.empty, true);
});

test('overlapping partial instructions expand at both ends, and replacing them speaks only once', () => {
    const document = doc(p(text('ABC', [mark('tts_first', 'replace', '첫째')]), text(' gap '), text('DEF', [mark('tts_last', 'replace', '둘째')])));
    const snapshot = captureTtsSelection(stateAt(document, 2, 10));
    assert.equal(snapshot.from, 1);
    assert.equal(snapshot.to, 12);
    assert.equal(snapshot.mixed, true);
    const draft = { id: 'tts_draft', mode: 'replace', text: '전체 대체' };
    assert.deepEqual(draftTtsPreview(snapshot, [], draft), { original: 'ABC gap DEF', text: '전체 대체' });
    assert.equal(draftTtsPreview(snapshot, []).text, '첫째 gap 둘째');
});

test('automatic mode removes only TTS marks in the preview and leaves the original selection unchanged', () => {
    const document = doc(p(text('C++ (설명)', [mark('tts_read', 'read', ''), schema.mark('bold')])));
    const snapshot = captureTtsSelection(stateAt(document, 2));
    const before = JSON.stringify(snapshot.content);
    assert.equal(draftTtsPreview(snapshot, []).text, 'C++ (설명)');
    const dictionary = [{ id: 'tts_dictionary', source: 'C++', replacement: '씨 플러스 플러스' }];
    assert.equal(draftTtsPreview(snapshot, dictionary, { mode: 'auto' }).text, '씨 플러스 플러스');
    assert.equal(JSON.stringify(snapshot.content), before);
});

test('chapter preview is captured for an unmarked cursor and annotation restrictions preserve preview', () => {
    const document = doc(p(text('첫 문단')), p(text('둘째 문단')));
    const chapter = captureTtsSelection(stateAt(document, 2));
    assert.equal(chapter.selected, false);
    assert.equal(chapter.canAnnotate, false);
    assert.equal(draftTtsPreview(chapter, []).original, '첫 문단\n\n둘째 문단');
    const multiple = captureTtsSelection(stateAt(document, 2, 9));
    assert.equal(multiple.selected, true);
    assert.equal(multiple.canAnnotate, false);
    assert.match(draftTtsPreview(multiple, [], { mode: 'skip' }).text, /문단/);
    for (const restricted of [
        doc(p(text('앞'), schema.node('footnote'), text('뒤'))),
        doc(p(text('코드', [schema.mark('code')]))),
        doc(schema.node('codeBlock', null, text('코드'))),
    ]) assert.equal(captureTtsSelection(stateAt(restricted, 1, restricted.content.size - 1)).canAnnotate, false);
});

test('hard breaks retain one replacement group and remain visible in the original preview', () => {
    const document = doc(p(text('첫째'), schema.node('hardBreak'), text('둘째', [schema.mark('bold')])));
    const snapshot = captureTtsSelection(stateAt(document, 1, document.content.size - 1));
    assert.equal(snapshot.canAnnotate, true);
    assert.deepEqual(draftTtsPreview(snapshot, [], { id: 'tts_draft', mode: 'replace', text: '한 번' }), { original: '첫째\n둘째', text: '한 번' });
    assert.equal(draftTtsPreview(snapshot, [], { id: 'tts_draft', mode: 'skip' }).text, '');
});

test('dictionary and replacement validation explains empty, duplicate, excessive and control-character input', () => {
    const entry = { id: 'tts_entry', source: 'HP', replacement: '체력' };
    assert.equal(ttsDraftError([entry], null), null);
    assert.equal(ttsDraftError([{ ...entry, source: ' ' }], null), 'dictionaryEmpty');
    assert.equal(ttsDraftError([entry, { ...entry, id: 'tts_other' }], null), 'dictionaryDuplicate');
    assert.equal(ttsDraftError([entry, { ...entry, source: 'MP' }], null), 'dictionaryDuplicate');
    assert.equal(ttsDraftError([{ ...entry, source: 'x'.repeat(201) }], null), 'dictionaryLength');
    assert.equal(ttsDraftError(Array(501).fill(entry), null), 'dictionaryLimit');
    assert.equal(ttsDraftError([{ ...entry, replacement: '\u0000x' }], null), 'invalidText');
    assert.equal(ttsDraftError([], { mode: 'replace', text: ' ' }), 'replacementEmpty');
    assert.equal(ttsDraftError([], { mode: 'replace', text: 'x'.repeat(2001) }), 'replacementLength');
    assert.equal(ttsDraftError([], { mode: 'replace', text: '\u0000x' }), 'invalidText');
    assert.equal(ttsDraftError([], { mode: 'skip', text: '' }), null);
});
