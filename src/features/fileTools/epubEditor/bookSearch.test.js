import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema, Node, Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { adjacentBookMatch, bookSearchPosition, createBookSearchIndex, searchSchemaSpec } from './bookSearch.js';
import { createBookSearchClient } from './bookSearchClient.js';
import { findDocumentMatches, replaceSearchMatches } from './search.js';

const Footnote = Node.create({ name: 'footnote', group: 'inline', inline: true, atom: true, addAttributes: () => ({ text: { default: '' } }) });
const Image = Node.create({ name: 'image', group: 'block', atom: true, addAttributes: () => ({ assetId: { default: '' } }) });
const Column = Node.create({ name: 'column', content: 'block+', group: 'block' });
const Columns = Node.create({ name: 'columns', content: 'column{2}', group: 'block' });
const Tts = Mark.create({ name: 'tts', addAttributes: () => ({ reading: { default: '' } }) });
const schema = getSchema([StarterKit, TableKit, Footnote, Image, Column, Columns, Tts]);
const text = (value, marks = []) => schema.text(value, marks.map(mark => typeof mark === 'string' ? schema.mark(mark) : mark));
const paragraph = (...content) => schema.node('paragraph', null, content);
const doc = (...content) => schema.node('doc', null, content);
const chapter = (id, document) => ({ id, content: document.toJSON() });
function indexFor(chapters) {
    const index = createBookSearchIndex(structuredClone(searchSchemaSpec(schema)));
    index.sync({ chapterIds: chapters.map(item => item.id), updates: chapters });
    return index;
}

test('worker schema preserves nested document positions, marks, atoms and code restrictions', () => {
    const original = doc(
        schema.node('image', { assetId: 'a_image' }),
        schema.node('columns', null, [schema.node('column', null, paragraph(text('가😀나', ['bold']))), schema.node('column', null, paragraph(text('word')))]),
        schema.node('table', null, schema.node('tableRow', null, schema.node('tableCell', null, paragraph(text('word', [schema.mark('tts', { reading: '워드' })]))))),
        paragraph(text('left'), schema.node('hardBreak'), text('right'), schema.node('footnote', { text: 'word' })),
        schema.node('codeBlock', { language: 'js' }, text('word')),
    );
    const copy = new Schema(structuredClone(searchSchemaSpec(schema))).nodeFromJSON(original.toJSON());
    copy.check();
    assert.deepEqual(copy.toJSON(), original.toJSON());
    assert.equal(copy.nodeSize, original.nodeSize);
    assert.equal(copy.type.schema.nodes.codeBlock.spec.marks, '');
    for (const query of ['word', '😀', 'leftright', '가😀나']) assert.deepEqual(findDocumentMatches(copy, query), findDocumentMatches(original, query));
    const index = indexFor([chapter('one', original)]);
    assert.deepEqual(index.find('word'), [{ id: 'one', count: 3 }]);
});

test('book search counts literal, Unicode and case-sensitive matches without crossing chapter or block boundaries', () => {
    const chapters = [chapter('one', doc(paragraph(text('cat CAT [a.*] 가😀나')))), chapter('empty', doc(paragraph())), chapter('two', doc(paragraph(text('ca')), paragraph(text('t cat [A.*]'))))];
    const before = structuredClone(chapters);
    const index = indexFor(chapters);
    assert.deepEqual(index.find('cat').map(item => item.count), [2, 0, 1]);
    assert.deepEqual(index.find('cat', true).map(item => item.count), [1, 0, 1]);
    assert.deepEqual(index.find('[a.*]').map(item => item.count), [1, 0, 1]);
    assert.deepEqual(index.find('😀').map(item => item.count), [1, 0, 0]);
    assert.deepEqual(index.find('').map(item => item.count), [0, 0, 0]);
    assert.deepEqual(structuredClone(chapters), before);
});

test('incremental synchronization updates changed chapters, order, additions and removals', () => {
    const one = chapter('one', doc(paragraph(text('word'))));
    const two = chapter('two', doc(paragraph(text('word word'))));
    const index = indexFor([one, two]);
    const three = chapter('three', doc(paragraph(text('word word word'))));
    index.sync({ chapterIds: ['three', 'one'], updates: [three, chapter('one', doc(paragraph(text('new'))))] });
    assert.deepEqual(index.find('word'), [{ id: 'three', count: 3 }, { id: 'one', count: 0 }]);
    assert.deepEqual(index.replaceAll('word', 'text').updates.map(item => item.id), ['three']);
});

test('book replacement matches current-chapter replacement and preserves structure, styles, links and surrounding text', () => {
    const original = doc(paragraph(text('before ', ['italic']), text('ca', ['bold']), text('t'), text(' after ', ['italic']), text('cat', [schema.mark('link', { href: 'https://example.com' })])));
    const chapters = [chapter('one', original), chapter('untouched', doc(paragraph(text('other')))), chapter('two', doc(paragraph(text('CAT', [schema.mark('tts', { reading: '고양이' })]))))];
    const before = structuredClone(chapters);
    const result = indexFor(chapters).replaceAll('cat', '<dog>');
    assert.equal(result.count, 3);
    assert.deepEqual(result.updates.map(item => item.id), ['one', 'two']);
    const expected = replaceSearchMatches(EditorState.create({ doc: original }), findDocumentMatches(original, 'cat'), '<dog>');
    assert.deepEqual(result.updates[0].content, expected.transaction.doc.toJSON());
    assert.equal(result.updates[1].content.content[0].content[0].marks[0].attrs.reading, '고양이');
    for (const item of result.updates) schema.nodeFromJSON(item.content).check();
    assert.deepEqual(structuredClone(chapters), before);
});

test('same-text replacements preserve mixed formatting; deletion keeps paragraphs; replacements are literal and not recursive', () => {
    const mixed = chapter('one', doc(paragraph(text('ca', ['bold']), text('t', ['italic']))));
    const index = indexFor([mixed]);
    assert.deepEqual(index.replaceAll('cat', 'cat'), { updates: [], count: 0 });
    const removed = index.replaceAll('cat', '');
    assert.equal(removed.count, 1);
    assert.equal(schema.nodeFromJSON(removed.updates[0].content).firstChild.type.name, 'paragraph');
    assert.equal(schema.nodeFromJSON(removed.updates[0].content).textContent, '');
    const repeated = index.replaceAll('cat', '$& catcat');
    assert.equal(repeated.count, 1);
    assert.equal(schema.nodeFromJSON(repeated.updates[0].content).textContent, '$& catcat');
    assert.deepEqual(index.replaceAll('', 'new'), { updates: [], count: 0 });
    assert.equal(index.find('cat')[0].count, 1);
});

test('book navigation crosses chapters, skips empty ones and wraps in both directions', () => {
    const counts = [{ id: 'one', count: 2 }, { id: 'empty', count: 0 }, { id: 'two', count: 1 }];
    const matches = [{ from: 1, to: 4 }, { from: 5, to: 8 }];
    assert.deepEqual(adjacentBookMatch(counts, 'one', matches, matches[0]), { chapterId: 'one', index: 1 });
    assert.deepEqual(adjacentBookMatch(counts, 'one', matches, matches[1]), { chapterId: 'two', index: 0 });
    assert.deepEqual(adjacentBookMatch(counts, 'one', matches, matches[0], -1), { chapterId: 'two', index: 0 });
    assert.deepEqual(adjacentBookMatch(counts, 'two', [matches[0]], matches[0]), { chapterId: 'one', index: 0 });
    assert.deepEqual(adjacentBookMatch(counts, 'two', [matches[0]], matches[0], -1), { chapterId: 'one', index: 1 });
    assert.deepEqual(adjacentBookMatch(counts, 'empty', [], { from: 1, to: 1 }), { chapterId: 'two', index: 0 });
    assert.deepEqual(adjacentBookMatch(counts, 'empty', [], { from: 1, to: 1 }, -1), { chapterId: 'one', index: 1 });
    assert.equal(adjacentBookMatch([], 'one', [], { from: 1, to: 1 }), null);
});

test('book navigation and counters use current unsaved editor matches instead of stale chapter counts', () => {
    const counts = [{ id: 'one', count: 2 }, { id: 'two', count: 1 }];
    const match = { from: 3, to: 6 };
    assert.deepEqual(bookSearchPosition(counts, 'one', [], { from: 1, to: 1 }), { total: 1, current: 0, chapters: 1 });
    assert.deepEqual(bookSearchPosition(counts, 'two', [match, { from: 7, to: 10 }], match), { total: 4, current: 3, chapters: 2 });
    assert.deepEqual(adjacentBookMatch([{ id: 'one', count: 1 }], 'one', [], { from: 1, to: 1 }), null);
    assert.deepEqual(adjacentBookMatch(counts, 'one', [match], { from: 1, to: 1 }), { chapterId: 'one', index: 0 });
    assert.deepEqual(adjacentBookMatch(counts, 'one', [match], { from: 9, to: 9 }, -1), { chapterId: 'one', index: 0 });
});

function mockWorker() {
    return { messages: [], terminated: false, postMessage(value) { this.messages.push(structuredClone(value)); }, terminate() { this.terminated = true; } };
}

test('client sends only changed content and correlates out-of-order worker replies', async () => {
    const worker = mockWorker();
    const client = createBookSearchClient(worker, schema);
    const chapters = [chapter('one', doc(paragraph(text('word')))), chapter('two', doc(paragraph(text('other'))))];
    client.sync(chapters);
    assert.equal(worker.messages.at(-1).updates.length, 2);
    client.sync([...chapters].reverse());
    assert.deepEqual(worker.messages.at(-1).updates, []);
    assert.deepEqual(worker.messages.at(-1).chapterIds, ['two', 'one']);
    client.sync([{ ...chapters[0], content: doc(paragraph(text('new'))).toJSON() }, chapters[1]]);
    assert.deepEqual(worker.messages.at(-1).updates.map(item => item.id), ['one']);
    const first = client.request('find', { query: 'word' });
    const firstId = worker.messages.at(-1).id;
    const second = client.request('find', { query: 'new' });
    const secondId = worker.messages.at(-1).id;
    worker.onmessage({ data: { id: secondId, ok: true, result: ['second'] } });
    worker.onmessage({ data: { id: firstId, ok: true, result: ['first'] } });
    assert.deepEqual(await first, ['first']);
    assert.deepEqual(await second, ['second']);
    client.destroy();
    assert.equal(worker.terminated, true);
});

test('worker errors and disposal reject pending operations instead of leaving controls busy', async () => {
    for (const code of ['error', 'CANCELED']) {
        const worker = mockWorker();
        const client = createBookSearchClient(worker, schema);
        const promise = client.request('replaceAll', { query: 'word', replacement: 'new' });
        const rejected = assert.rejects(promise, error => error.code === code);
        if (code === 'error') worker.onerror(); else client.destroy();
        await rejected;
        await assert.rejects(client.request('find', { query: 'word' }), error => error.code === code);
        assert.throws(() => client.sync([]), error => error.code === code);
        client.destroy();
    }
});
