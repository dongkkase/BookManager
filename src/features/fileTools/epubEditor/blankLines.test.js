import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Schema } from '@tiptap/pm/model';
import { createProject, createChapter, paragraph, validateProject, inspectProject, renderChapterBody } from '../../../../electron/epubEditor/model.js';
import { contentHistoryEntry, restoredChapters } from './chapterOperations.js';
import { applyBlankLineUpdates, removeProjectBlankLines } from './blankLines.js';

const text = value => ({ type: 'text', text: value });
const br = () => ({ type: 'hardBreak' });
const p = (...content) => ({ type: 'paragraph', content });
const doc = (...content) => ({ type: 'doc', content });
const chapter = (...content) => ({ ...createChapter('검증'), content: doc(...content) });
const clean = content => {
    const source = chapter(...content);
    const result = removeProjectBlankLines([source], source.id);
    return { ...result, content: applyBlankLineUpdates([source], result.updates)[0].content };
};

test('현재 장만 정리하고 본문 문단과 서식은 유지한다', () => {
    const marked = p({ ...text('첫 문장.'), marks: [{ type: 'bold' }] });
    const first = chapter(p(), marked, paragraph(' \t\u3000\u00a0'), paragraph('다음 문장.'));
    const second = chapter(p(), paragraph('다른 장'));
    const before = JSON.stringify([first, second]);
    const result = removeProjectBlankLines([first, second], first.id);
    const updated = applyBlankLineUpdates([first, second], result.updates);
    assert.equal(result.count, 2);
    assert.equal(result.updates.length, 1);
    assert.deepEqual(updated[0].content, doc(marked, paragraph('다음 문장.')));
    assert.equal(updated[1], second);
    assert.equal(JSON.stringify([first, second]), before);
    assert.equal(removeProjectBlankLines(updated, first.id).count, 0);
});

test('문단 안의 빈 줄만 제거하고 본문 사이 개행과 마지막 개행은 유지한다', () => {
    const first = { ...text('첫 문장.'), marks: [{ type: 'italic' }] };
    const source = p(br(), text(' \t'), br(), first, br(), br(), text('\u3000'), br(), text('둘째 문장.'), br(), br());
    const result = clean([source]);
    assert.equal(result.count, 5);
    assert.deepEqual(result.content, doc(p(first, br(), text('둘째 문장.'), br())));
});

test('책 전체 적용과 실행 취소·다시 실행은 모든 변경 장을 함께 복원한다', () => {
    const chapters = [chapter(paragraph('첫 장'), p(), paragraph('끝')), chapter(p(), paragraph('둘째 장')), chapter(paragraph('그대로'))];
    const result = removeProjectBlankLines(chapters, chapters[2].id, 'book');
    const updated = applyBlankLineUpdates(chapters, result.updates);
    assert.equal(result.count, 2);
    assert.equal(result.updates.length, 2);
    assert.equal(updated[2], chapters[2]);
    const undo = contentHistoryEntry(chapters, updated, chapters[2].id, new Map());
    assert.deepEqual(undo.ids, chapters.slice(0, 2).map(item => item.id));
    const restored = restoredChapters(updated, undo);
    assert.deepEqual(restored, chapters);
    const redo = contentHistoryEntry(updated, restored, chapters[2].id, new Map());
    assert.deepEqual(restoredChapters(restored, redo), updated);
    assert.throws(() => restoredChapters([{ ...updated[0], content: doc(paragraph('새 편집')) }, ...updated.slice(1)], undo), { code: 'CHAPTER_HISTORY_CHANGED' });
});

test('삭제 전의 다른 장 편집보다 책 전체 삭제를 먼저 취소하고, 삭제 후 입력은 별도로 취소한다', () => {
    const chapters = [chapter(p(), paragraph('정리할 장')), chapter(paragraph('이미 편집한 장'))];
    const result = removeProjectBlankLines(chapters, chapters[1].id, 'book');
    const updated = applyBlankLineUpdates(chapters, result.updates);
    const entry = { ...contentHistoryEntry(chapters, updated, chapters[1].id, new Map()), operation: 'removeBlankLines' };
    let current = { chapters: updated };
    const source = fs.readFileSync(new URL('./EpubEditorTool.jsx', import.meta.url), 'utf8');
    const method = source.slice(source.indexOf('    const restoreEditing ='), source.indexOf('    const applyTtsSettings ='));
    const restore = vm.runInNewContext(`${method}\nrestoreEditing;`, {
        commitEditor: () => current,
        history: { current: { undo: [entry] } },
        chapterRef: { current: chapters[1].id },
        restoredChapters,
        restoreTtsSettings: project => project,
        restoreStructure: () => 'book',
        atomicHistoryAvailable: () => true,
        editor: {
            can: () => ({ undo: () => true }),
            chain: () => ({ focus: () => ({ undo: () => ({ run: () => 'typing' }) }) }),
        },
    });
    assert.equal(restore('undo'), 'book');
    current = { chapters: [updated[0], { ...updated[1], content: doc(paragraph('삭제 후 새 입력')) }] };
    assert.equal(restore('undo'), 'typing');
});

test('비어 있는 장·인용·목록·단의 필수 문단은 남기고 반복 적용은 변경이 없다', () => {
    const schema = new Schema({ nodes: {
        doc: { content: 'block+' }, text: { group: 'inline' }, paragraph: { group: 'block', content: 'inline*' }, hardBreak: { inline: true, group: 'inline' },
        blockquote: { group: 'block', content: 'block+' }, bulletList: { group: 'block', content: 'listItem+' }, listItem: { content: 'paragraph block*' },
        columns: { group: 'block', content: 'column{2,3}' }, column: { content: 'block+' },
    } });
    for (const content of [
        [p()],
        [paragraph(' \t'), p(), p(br(), br())],
        [{ type: 'blockquote', content: [p(), p()] }],
        [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(), p(), { type: 'blockquote', content: [p(), paragraph('인용')] }] }] }],
        [{ type: 'columns', content: [1, 2].map(() => ({ type: 'column', content: [p(), p()] })) }],
    ]) {
        const result = clean(content);
        schema.nodeFromJSON(result.content).check();
        assert.equal(clean(result.content.content).count, 0);
    }
    assert.deepEqual(clean([paragraph(' \t'), p()]).content, doc(p()));
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p(), p(), paragraph('항목')] }] };
    const cleanedList = clean([list]);
    assert.equal(cleanedList.count, 2);
    assert.deepEqual(cleanedList.content.content[0].content[0].content, [paragraph('항목')]);
    schema.nodeFromJSON(cleanedList.content).check();
});

test('표·코드·제목·이미지·오디오·각주와 의미 있는 인라인 지정은 보존한다', () => {
    const protectedNodes = [
        { type: 'heading', attrs: { level: 2 }, content: [] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(), p(br(), br()), paragraph('내용')] }] }] },
        { type: 'codeBlock', content: [text('first\n\n  \nlast')] },
        { type: 'image', attrs: { assetId: 'a_image', alt: '그림' } },
        { type: 'audio', attrs: { assetId: 'a_audio' } },
        p({ type: 'footnote', attrs: { id: 'n_note', text: '주석' } }),
        p({ ...text(' '), marks: [{ type: 'tts', attrs: { id: 'tts_one', mode: 'replace', text: '읽을 내용' } }] }),
        p({ ...text(' '), marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }),
        p({ ...text(' '), marks: [{ type: 'code' }] }),
    ];
    const result = clean([p(), ...protectedNodes, p()]);
    assert.equal(result.count, 2);
    assert.deepEqual(result.content.content, protectedNodes);
});

test('다른 장에서 참조하는 빈 문단을 보존하고 정리 후에도 프로젝트·XHTML이 유효하다', () => {
    const project = createProject();
    const anchor = { ...p(), attrs: { id: 'n_target' } };
    const first = chapter(p(), anchor, paragraph('본문'));
    const second = chapter(p({ ...text('이동'), marks: [{ type: 'link', attrs: { href: `epub:${first.id}#n_target` } }] }), p());
    project.chapters = [first, second];
    const result = removeProjectBlankLines(project.chapters, first.id, 'book');
    project.chapters = applyBlankLineUpdates(project.chapters, result.updates);
    assert.equal(result.count, 2);
    assert.deepEqual(project.chapters[0].content.content[0], anchor);
    validateProject(project);
    assert.equal(inspectProject(project).filter(issue => issue.code === 'BROKEN_LINK').length, 0);
    assert.match(renderChapterBody(project.chapters[0], project), /id="n_target"/);
    assert.equal(removeProjectBlankLines(project.chapters, first.id, 'book').count, 0);
});

test('빈 줄이 없는 책은 변경하지 않고 잘못된 범위를 거부한다', () => {
    const source = chapter(paragraph('첫 문단'), paragraph('다음 문단'));
    assert.deepEqual(removeProjectBlankLines([source], source.id, 'book'), { updates: [], count: 0 });
    assert.throws(() => removeProjectBlankLines([source], 'missing'), { code: 'INVALID_PROJECT' });
    assert.throws(() => removeProjectBlankLines([source], source.id, 'unknown'), { code: 'INVALID_PROJECT' });
});

test('많은 장의 빈 문단도 표시 상한 없이 전체 삭제한다', () => {
    const chapters = Array.from({ length: 100 }, () => chapter(...Array.from({ length: 200 }, (_, index) => index % 2 ? p() : paragraph('본문'))));
    const result = removeProjectBlankLines(chapters, chapters[0].id, 'book');
    assert.equal(result.count, 10000);
    assert.equal(result.updates.length, 100);
    assert.ok(result.updates.every(update => update.content.content.length === 100));
});
