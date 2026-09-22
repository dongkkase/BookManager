import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { splitChapterDocument, splitProjectChapter, importTextChapters, mergeProjectChapters, contentHistoryEntry, restoredChapters } from './chapterOperations.js';
import { createChapter, createProject, inspectProject, newId, textContent, validateProject, walkDocument } from '../../../../electron/epubEditor/model.js';
import { textImportDocument } from '../../../../electron/epubEditor/textImport.js';
import { TEXT_CHAPTER_PARAGRAPHS } from '../../../../electron/epubEditor/textImportLimits.js';
import { remapCssIds } from '../../../../electron/epubEditor/css.js';
import { epubTextEntries } from '../../../../electron/epubEditor/package.js';

const id = { default: null };
const schema = new Schema({
    nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*', attrs: { id, textAlign: { default: null } } },
        heading: { group: 'block', content: 'inline*', attrs: { id, level: { default: 1 } } },
        blockquote: { group: 'block', content: 'block+', attrs: { id } },
        codeBlock: { group: 'block', content: 'text*', marks: '' },
        orderedList: { group: 'block', content: 'listItem+', attrs: { start: { default: 1 } } },
        bulletList: { group: 'block', content: 'listItem+' },
        listItem: { content: 'paragraph block*' },
        text: { group: 'inline' },
        image: { group: 'block', atom: true, attrs: { id, assetId: {}, alt: { default: '' }, width: { default: 100 }, align: { default: 'center' } } },
        audio: { group: 'block', atom: true, attrs: { id, assetId: {}, title: { default: '' }, kind: { default: 'effect' }, loop: { default: false } } },
        footnote: { group: 'inline', inline: true, atom: true, attrs: { id, text: { default: '' } } },
        table: { group: 'block', content: 'tableRow+', attrs: { id } },
        tableRow: { content: 'tableCell+' },
        tableCell: { content: 'paragraph+', attrs: { colspan: { default: 1 }, rowspan: { default: 1 } } },
        columns: { group: 'block', content: 'column{2,3}', attrs: { id } },
        column: { content: 'block+' },
        horizontalRule: { group: 'block' },
    },
    marks: { bold: {}, italic: {}, link: { attrs: { href: {} } } },
});
const p = (text, attrs) => schema.node('paragraph', { id: newId(), ...attrs }, text ? schema.text(text) : null);
const doc = (...nodes) => schema.node('doc', null, nodes);
const stateAt = (document, from, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to) });
const chapterWith = document => ({ ...createChapter('원고'), content: document.toJSON() });
const texts = chapters => chapters.map(item => textContent(item.content));

test('split a marked paragraph without losing text, alignment or shared IDs', () => {
    const document = doc(schema.node('paragraph', { id: newId(), textAlign: 'center' }, [schema.text('앞부분', [schema.mark('bold')]), schema.text('뒷부분', [schema.mark('italic')])]));
    const original = JSON.stringify(document.toJSON());
    const { before, after } = splitChapterDocument(stateAt(document, 4));
    assert.equal(textContent(before), '앞부분');
    assert.equal(textContent(after), '뒷부분');
    assert.equal(before.content[0].content[0].marks[0].type, 'bold');
    assert.equal(after.content[0].content[0].marks[0].type, 'italic');
    assert.equal(after.content[0].attrs.textAlign, 'center');
    assert.notEqual(before.content[0].attrs.id, after.content[0].attrs.id);
    assert.equal(JSON.stringify(document.toJSON()), original);
});

test('heading boundaries create no phantom blocks and set the new title', () => {
    const document = doc(p('앞'), schema.node('heading', { id: newId(), level: 2 }, schema.text('다음 장')), p('뒤'));
    const chapter = chapterWith(document);
    const result = splitProjectChapter([chapter], chapter.id, stateAt(document, 4));
    assert.equal(result.chapters[0].content.content.length, 1);
    assert.equal(result.chapters[1].title, '다음 장');
    assert.equal(result.chapters[1].content.content[0].type, 'heading');
    assert.equal(splitChapterDocument(stateAt(document, 2)).before.content.length, 1);
});

test('split lists, nested lists, quotes and code blocks into valid documents', () => {
    const item = (...nodes) => schema.node('listItem', null, nodes);
    const nested = schema.node('orderedList', { start: 4 }, [item(p('하나')), item(p('둘셋'), schema.node('bulletList', null, item(p('내부문단'))))]);
    const documents = [doc(nested), doc(schema.node('blockquote', { id: newId() }, [p('앞'), nested])), doc(schema.node('codeBlock', null, schema.text('one\ntwo')))];
    for (const document of documents) {
        document.descendants((node, position) => {
            if (!node.isTextblock || node.content.size < 2) return;
            const result = splitChapterDocument(stateAt(document, position + 2));
            assert.equal(schema.nodeFromJSON(result.before).textContent + schema.nodeFromJSON(result.after).textContent, document.textContent);
            schema.nodeFromJSON(result.before).check();
            schema.nodeFromJSON(result.after).check();
        });
    }
    const result = splitChapterDocument(stateAt(doc(nested), 9));
    assert.equal(result.after.content[0].attrs.start, 5);
});

test('split retains media, merged cells, footnotes and chapter CSS, and redirects links from every chapter', () => {
    const anchor = newId();
    const assets = ['image', 'audio'].map(kind => ({ id: newId('a'), name: kind, kind, extension: kind === 'image' ? 'png' : 'mp3', mime: kind === 'image' ? 'image/png' : 'audio/mpeg', size: 1 }));
    const document = doc(p('앞'), schema.node('heading', { id: anchor, level: 1 }, schema.text('뒤')), schema.node('paragraph', { id: newId() }, [schema.text('각주'), schema.node('footnote', { id: newId(), text: '설명' })]), schema.node('image', { id: newId(), assetId: assets[0].id, alt: '그림' }), schema.node('audio', { id: newId(), assetId: assets[1].id }), schema.node('table', { id: newId() }, schema.node('tableRow', null, schema.node('tableCell', { colspan: 2 }, p('병합')))));
    const first = { ...chapterWith(document), css: 'p { color: #123456; }', inToc: false };
    const linked = schema.node('paragraph', { id: newId() }, schema.text('이동', [schema.mark('link', { href: `epub:${first.id}#${anchor}` })]));
    const second = chapterWith(doc(linked));
    const result = splitProjectChapter([first, second], first.id, stateAt(document, 4));
    assert.equal(result.chapters[1].css, first.css);
    assert.equal(result.chapters[1].inToc, false);
    assert.equal(result.chapters[2].content.content[0].content[0].marks[0].attrs.href, `epub:${result.selectedId}#${anchor}`);
    assert.deepEqual(result.chapters[1].content.content, structuredClone(document.toJSON().content.slice(1)));
    const project = { ...createProject(), assets, chapters: result.chapters };
    validateProject(project);
    assert.equal(inspectProject(project).some(issue => ['DUPLICATE_ID', 'BROKEN_LINK'].includes(issue.code)), false);
    const entries = epubTextEntries(project);
    assert.ok(entries.some(entry => entry.text?.includes(anchor) || entry.data?.toString().includes(anchor)));
});

test('splitting at list-item boundaries leaves no empty list items', () => {
    const item = text => schema.node('listItem', null, p(text));
    const list = schema.node('orderedList', { start: 4 }, [item('하나'), item('둘')]);
    const document = doc(list);
    const original = JSON.stringify(document.toJSON());
    for (const position of [5, 9]) {
        const { before, after } = splitChapterDocument(stateAt(document, position));
        assert.equal(before.content[0].content.length, 1);
        assert.equal(after.content[0].content.length, 1);
        assert.equal(after.content[0].attrs.start, 5);
    }
    assert.equal(JSON.stringify(document.toJSON()), original);
});

test('split rejects empty halves, selected ranges, selected media and container cells without mutation', () => {
    const document = doc(p('본문'));
    for (const pos of [1, 3]) assert.throws(() => splitChapterDocument(stateAt(document, pos)), { code: 'SPLIT_EMPTY' });
    assert.throws(() => splitChapterDocument(stateAt(document, 1, 2)), { code: 'SPLIT_CURSOR_REQUIRED' });
    const imageDoc = doc(p('앞'), schema.node('image', { assetId: newId('a') }), p('뒤'));
    assert.throws(() => splitChapterDocument(EditorState.create({ doc: imageDoc, selection: NodeSelection.create(imageDoc, 3) })), { code: 'SPLIT_CURSOR_REQUIRED' });
    for (const node of [schema.node('table', null, schema.node('tableRow', null, schema.node('tableCell', null, p('셀본문')))), schema.node('columns', null, [schema.node('column', null, p('왼쪽')), schema.node('column', null, p('오른쪽'))])]) {
        const containerDoc = doc(p('앞'), node, p('뒤'));
        let position;
        containerDoc.descendants((child, pos) => { if (child.isText && child.text !== '앞' && position === undefined) position = pos + 1; });
        assert.throws(() => splitChapterDocument(stateAt(containerDoc, position)), { code: 'SPLIT_CONTAINER' });
    }
});

test('text imports preserve literal HTML and blank paragraphs, fill an empty book or insert after the active chapter', () => {
    const document = textImportDocument('첫 줄\r\n\r\n<b>문자</b>').document;
    const empty = chapterWith(doc(p('')));
    const filled = importTextChapters([empty], empty.id, stateAt(doc(p('')), 1), document, '텍본', 'chapter', 1);
    assert.equal(filled.chapters.length, 1);
    assert.equal(filled.selectedId, empty.id);
    assert.equal(filled.chapters[0].title, '텍본');
    assert.equal(filled.chapters[0].content.content.length, 3);
    assert.equal(textContent(filled.chapters[0].content), '첫 줄\n\n<b>문자</b>');
    const first = chapterWith(doc(p('기존')));
    const second = chapterWith(doc(p('마지막')));
    const added = importTextChapters([first, second], first.id, stateAt(schema.nodeFromJSON(first.content), 1), document, '추가', 'chapter', 1);
    assert.deepEqual(added.chapters.map(item => item.title), ['원고', '추가', '원고']);
    assert.equal(added.chapters[0], first);
    assert.equal(added.chapters[2], second);
});

test('cursor import does not replace a selection or lose adjacent text', () => {
    const original = doc(p('ABCD'));
    const chapter = chapterWith(original);
    const incoming = textImportDocument('새로운\n본문').document;
    const result = importTextChapters([chapter], chapter.id, stateAt(original, 3, 5), incoming, '무시', 'cursor', 3);
    const content = schema.nodeFromJSON(result.chapters[0].content);
    assert.equal(content.textContent, 'AB새로운본문CD');
    assert.equal(result.chapters.length, 1);
    content.check();
    const ids = [];
    walkDocument(result.chapters[0].content, node => { if (node.attrs?.id) ids.push(node.attrs.id); });
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(original.textContent, 'ABCD');
    assert.equal(original.child(0).attrs.id, chapter.content.content[0].attrs.id);
});

test('large TXT imports create ordered chapters, retain all paragraphs and support atomic undo/redo', () => {
    const original = `${'첫 줄\n\n'.repeat(TEXT_CHAPTER_PARAGRAPHS)}마지막 줄`;
    const incoming = textImportDocument(original);
    const empty = chapterWith(doc(p('')));
    const state = stateAt(schema.nodeFromJSON(empty.content), 1);
    const result = importTextChapters([empty], empty.id, state, incoming.document, '긴 원고', 'chapter', 1);
    assert.equal(result.chapters.length, incoming.chapterCount);
    assert.equal(result.selectedId, empty.id);
    assert.equal(result.chapters[0].id, empty.id);
    assert.deepEqual(result.chapters.map(item => item.title), ['긴 원고 (1)', '긴 원고 (2)', '긴 원고 (3)']);
    assert.equal(result.chapters.map(item => textContent(item.content)).join('\n'), original);
    assert.ok(result.chapters.every(item => item.content.content.length <= TEXT_CHAPTER_PARAGRAPHS));
    validateProject({ ...createProject(), chapters: result.chapters });
    const undone = restoredChapters(result.chapters, contentHistoryEntry([empty], result.chapters, empty.id));
    assert.equal(textContent(undone[0].content), '');
    const redone = restoredChapters(undone, contentHistoryEntry(result.chapters, undone, result.selectedId));
    assert.deepEqual(redone, result.chapters);
    assert.throws(() => importTextChapters([empty], empty.id, state, incoming.document, '긴 원고', 'cursor', 1), { code: 'TEXT_IMPORT_CHAPTERS_REQUIRED' });
    const existing = [chapterWith(doc(p('기존'))), chapterWith(doc(p('다음')))];
    const inserted = importTextChapters(existing, existing[0].id, state, incoming.document, '추가', 'chapter', 1);
    assert.equal(inserted.chapters[0], existing[0]);
    assert.equal(inserted.chapters.at(-1), existing[1]);
    assert.equal(inserted.chapters.length, existing.length + incoming.chapterCount);
    const full = Array.from({ length: 999 }, () => chapterWith(doc(p('본문'))));
    assert.throws(() => importTextChapters(full, full[0].id, state, incoming.document, '초과', 'chapter', 1), { code: 'CHAPTER_LIMIT' });
    assert.equal(full.length, 999);
});

test('chapter split and text import undo/redo restore content and preserve later metadata edits', () => {
    const original = doc(p('앞뒤'));
    const chapter = chapterWith(original);
    const result = splitProjectChapter([chapter], chapter.id, stateAt(original, 2));
    const entry = contentHistoryEntry([chapter], result.chapters, chapter.id, new Map());
    const editedTitle = result.chapters.map(item => item.id === chapter.id ? { ...item, title: '새 제목' } : item);
    const restored = restoredChapters(editedTitle, entry);
    assert.deepEqual(texts(restored), ['앞뒤']);
    assert.equal(restored[0].title, '새 제목');
    const redo = contentHistoryEntry(editedTitle, restored, result.selectedId, new Map());
    assert.deepEqual(texts(restoredChapters(restored, redo)), ['앞', '뒤']);
    const empty = chapterWith(doc(p('')));
    const imported = importTextChapters([empty], empty.id, stateAt(doc(p('')), 1), textImportDocument('가져온 글').document, '파일명', 'chapter', 1);
    const undone = restoredChapters(imported.chapters, contentHistoryEntry([empty], imported.chapters, empty.id));
    assert.equal(undone[0].title, empty.title);
    assert.equal(textContent(undone[0].content), '');
});

test('atomic history protects body and CSS edits made after a split', () => {
    const original = doc(p('앞뒤'));
    const chapter = chapterWith(original);
    const result = splitProjectChapter([chapter], chapter.id, stateAt(original, 2));
    const entry = contentHistoryEntry([chapter], result.chapters, chapter.id);
    for (const change of [{ content: doc(p('후속 편집')).toJSON() }, { css: 'p { color: red; }' }]) {
        const modified = result.chapters.map((item, index) => index === 1 ? { ...item, ...change } : item);
        assert.throws(() => restoredChapters(modified, entry), { code: 'CHAPTER_HISTORY_CHANGED' });
    }
    assert.deepEqual(restoredChapters(result.chapters, [chapter]).map(item => item.content), [result.chapters[0].content]);
});

test('chapter limit prevents insert and split without changing existing content', () => {
    const document = doc(p('앞뒤'));
    const chapters = Array.from({ length: 1000 }, () => chapterWith(document));
    assert.throws(() => splitProjectChapter(chapters, chapters[0].id, stateAt(document, 2)), { code: 'CHAPTER_LIMIT' });
    assert.throws(() => importTextChapters(chapters, chapters[0].id, stateAt(document, 2), textImportDocument('글').document, '제목', 'chapter', 2), { code: 'CHAPTER_LIMIT' });
});

test('merge a range in book order, preserving unrelated chapters, first-chapter metadata and every block', () => {
    const chapters = ['서문', '첫째', '둘째', '셋째', '끝'].map(title => ({ ...chapterWith(doc(p(title))), title }));
    chapters[1].tocTitle = '시작 목차';
    chapters[1].inToc = false;
    const before = JSON.stringify(chapters);
    const merged = mergeProjectChapters(chapters, chapters[1].id, chapters[3].id, { title: '합친 원고' });
    assert.equal(merged.chapters.length, 3);
    assert.equal(merged.chapters[0], chapters[0]);
    assert.equal(merged.chapters[2], chapters[4]);
    assert.equal(merged.selectedId, chapters[1].id);
    assert.equal(merged.chapters[1].title, '합친 원고');
    assert.equal(merged.chapters[1].tocTitle, '시작 목차');
    assert.equal(merged.chapters[1].inToc, false);
    assert.equal(textContent(merged.chapters[1].content), '첫째\n둘째\n셋째');
    schema.nodeFromJSON(merged.chapters[1].content).check();
    assert.equal(JSON.stringify(chapters), before);
});

test('merge optionally preserves subsequent chapter titles without duplicating an existing leading heading', () => {
    const first = { ...chapterWith(doc(p('시작'))), title: '첫 장' };
    const second = { ...chapterWith(doc(p('내용'))), title: '다음 장' };
    const third = { ...chapterWith(doc(schema.node('heading', { id: newId(), level: 2 }, schema.text('마지막 장')), p('마지막'))), title: '마지막 장' };
    const result = mergeProjectChapters([first, second, third], first.id, third.id, { keepTitles: true });
    const blocks = result.chapters[0].content.content;
    assert.deepEqual(blocks.map(node => node.type), ['paragraph', 'heading', 'paragraph', 'heading', 'paragraph']);
    assert.equal(textContent(blocks[1]), '다음 장');
    assert.equal(blocks[3].attrs.level, 2);
});

test('merge redirects whole-chapter, heading and footnote links inside and outside the merged range', () => {
    const first = chapterWith(doc(p('앞')));
    const headingId = newId();
    const noteId = newId();
    const second = chapterWith(doc(schema.node('heading', { id: headingId }, schema.text('뒤')), schema.node('paragraph', { id: newId() }, schema.node('footnote', { id: noteId, text: '각주' }))));
    const hrefs = [`epub:${first.id}`, `epub:${second.id}`, `epub:${second.id}#${headingId}`, `epub:${second.id}#note-${noteId}`];
    const linkDoc = doc(...hrefs.map(href => schema.node('paragraph', { id: newId() }, schema.text(href, [schema.mark('link', { href })]))));
    const linked = chapterWith(linkDoc);
    second.content.content.push(...structuredClone(linkDoc.toJSON().content));
    const result = mergeProjectChapters([linked, first, second], first.id, second.id);
    const expected = [`epub:${first.id}`, `epub:${first.id}#${headingId}`, `epub:${first.id}#${headingId}`, `epub:${first.id}#note-${noteId}`];
    for (const chapter of result.chapters) {
        const links = [];
        walkDocument(chapter.content, node => { for (const mark of node.marks || []) if (mark.type === 'link') links.push(mark.attrs.href); });
        assert.deepEqual(links, expected);
    }
    const project = { ...createProject(), chapters: result.chapters };
    assert.equal(inspectProject(project).some(issue => issue.code === 'BROKEN_LINK'), false);
    assert.ok(epubTextEntries(project).some(entry => entry.data?.toString().includes(`${first.id}.xhtml#${headingId}`)));
});

test('merge retains rich blocks, asset IDs, merged table cells and footnote text', () => {
    const first = chapterWith(doc(p('앞')));
    const rich = doc(schema.node('image', { id: newId(), assetId: newId('a'), alt: '그림' }), schema.node('audio', { id: newId(), assetId: newId('a'), kind: 'background', loop: true }), schema.node('paragraph', { id: newId() }, schema.node('footnote', { id: newId(), text: '설명' })), schema.node('table', { id: newId() }, schema.node('tableRow', null, schema.node('tableCell', { colspan: 2 }, p('셀')))), schema.node('columns', { id: newId() }, [schema.node('column', null, p('왼쪽')), schema.node('column', null, p('오른쪽'))]));
    const second = chapterWith(rich);
    const result = mergeProjectChapters([first, second], first.id, second.id);
    assert.deepEqual(result.chapters[0].content.content.slice(1), structuredClone(rich.toJSON().content));
    schema.nodeFromJSON(result.chapters[0].content).check();
});

test('merge handles equal IDs from different chapters and remaps their links and chapter CSS', () => {
    const shared = newId();
    const sharedNote = newId();
    const create = text => chapterWith(doc(p(text, { id: shared }), schema.node('paragraph', { id: newId() }, schema.node('footnote', { id: sharedNote, text }))));
    const first = create('첫째');
    const second = create('둘째');
    second.css = `#${shared}, [id="${shared}"] { color: red; } #note-${sharedNote} { color: blue; }`;
    const link = href => schema.node('paragraph', { id: newId() }, schema.text('참조', [schema.mark('link', { href })]));
    const third = chapterWith(doc(link(`epub:${first.id}#${shared}`), link(`epub:${second.id}#${shared}`), link(`epub:${second.id}#note-${sharedNote}`)));
    const original = JSON.stringify([first, second, third]);
    const result = mergeProjectChapters([first, second, third], first.id, second.id);
    const blocks = result.chapters[0].content.content;
    const nextId = blocks[2].attrs.id;
    const nextNote = blocks[3].content[0].attrs.id;
    assert.notEqual(nextId, shared);
    assert.notEqual(nextNote, sharedNote);
    assert.ok(result.chapters[0].css.includes(`#${nextId}`));
    assert.ok(result.chapters[0].css.includes(`[id="${nextId}"]`));
    assert.ok(result.chapters[0].css.includes(`#note-${nextNote}`));
    assert.deepEqual(result.chapters[1].content.content.map(node => node.content[0].marks[0].attrs.href), [`epub:${first.id}#${shared}`, `epub:${first.id}#${nextId}`, `epub:${first.id}#note-${nextNote}`]);
    const project = { ...createProject(), chapters: result.chapters };
    assert.equal(inspectProject(project).some(issue => ['BROKEN_LINK', 'DUPLICATE_ID'].includes(issue.code)), false);
    assert.equal(JSON.stringify([first, second, third]), original);
});

test('merge gives a code-first chapter a valid link destination and keeps its code unchanged', () => {
    const first = chapterWith(doc(schema.node('codeBlock', null, schema.text('first'))));
    const second = chapterWith(doc(schema.node('codeBlock', null, schema.text('second'))));
    const link = chapterWith(doc(schema.node('paragraph', { id: newId() }, schema.text('다음', [schema.mark('link', { href: `epub:${second.id}` })]))));
    const result = mergeProjectChapters([first, second, link], first.id, second.id);
    const document = result.chapters[0].content;
    assert.deepEqual(document.content.map(node => node.type), ['codeBlock', 'paragraph', 'codeBlock']);
    assert.equal(document.content[2].content[0].text, 'second');
    assert.equal(result.chapters[1].content.content[0].content[0].marks[0].attrs.href, `epub:${first.id}#${document.content[1].attrs.id}`);
});

test('merge CSS keeps the last occurrence of identical sheets in cascade order and prevents oversize', () => {
    const a = 'p { color: red; }';
    const b = 'p { color: blue; }';
    const chapters = [a, b, a].map(css => ({ ...chapterWith(doc(p('본문'))), css }));
    assert.equal(mergeProjectChapters(chapters, chapters[0].id, chapters[2].id).chapters[0].css, `${b}\n\n${a}`);
    const large = chapters.map((chapter, index) => ({ ...chapter, css: `/*${index}${'x'.repeat(40000)}*/` }));
    assert.throws(() => mergeProjectChapters(large, large[0].id, large[2].id), { code: 'MERGE_CSS_TOO_LARGE' });
    assert.throws(() => remapCssIds('p {', new Map([['old', 'next']])), { code: 'MERGE_CSS_INVALID' });
    assert.equal(remapCssIds('#old { color: red; }', new Map()), '#old { color: red; }');
});

test('merge history restores every chapter and incoming link; redo and later edit guards work', () => {
    const first = chapterWith(doc(p('첫째')));
    const second = chapterWith(doc(p('둘째')));
    const linked = chapterWith(doc(schema.node('paragraph', { id: newId() }, schema.text('둘째로', [schema.mark('link', { href: `epub:${second.id}` })]))));
    const original = [first, second, linked];
    const result = mergeProjectChapters(original, first.id, second.id, { title: '합친 장' });
    const entry = contentHistoryEntry(original, result.chapters, second.id, new Map());
    const restored = restoredChapters(result.chapters, entry);
    assert.equal(JSON.stringify(restored), JSON.stringify(original));
    const redo = contentHistoryEntry(result.chapters, restored, first.id, new Map());
    assert.equal(JSON.stringify(restoredChapters(restored, redo)), JSON.stringify(result.chapters));
    const modified = result.chapters.map((item, index) => index === 0 ? { ...item, content: doc(p('수정')).toJSON() } : item);
    assert.throws(() => restoredChapters(modified, entry), { code: 'CHAPTER_HISTORY_CHANGED' });
});

test('merge rejects missing, single or reversed ranges and empty result titles without mutation', () => {
    const chapters = [chapterWith(doc(p('첫째'))), chapterWith(doc(p('둘째')))];
    const original = JSON.stringify(chapters);
    for (const [start, end] of [[chapters[0].id, chapters[0].id], [chapters[1].id, chapters[0].id], ['missing', chapters[1].id], [chapters[0].id, 'missing']]) assert.throws(() => mergeProjectChapters(chapters, start, end), { code: 'MERGE_RANGE_REQUIRED' });
    assert.throws(() => mergeProjectChapters(chapters, chapters[0].id, chapters[1].id, { title: '   ' }), { code: 'CHAPTER_TITLE_REQUIRED' });
    assert.equal(JSON.stringify(chapters), original);
});
