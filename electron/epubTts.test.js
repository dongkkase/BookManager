import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProject, chapterXhtml, duplicateChapter, validateProject } from './epubEditor/model.js';
import { EpubEditorService } from './epubEditor/service.js';
import { annotateTtsDocument, documentTtsPreview, normalizeTtsText, renderTtsSegments, TTS_LIMITS, validTtsSettings } from './epubEditor/tts.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { epubTtsText } from './epubTts.js';

const text = (value, marks = []) => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) });
const mark = (mode, value = '', id = 'tts_selection') => ({ type: 'tts', attrs: { id, mode, text: value } });
const document = (...content) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
const entry = (source, replacement, id = 'tts_entry') => ({ id, source, replacement });

test('TTS automatic preview preserves existing bracket, punctuation and dialogue rules', () => {
    assert.equal(normalizeTtsText('C++ (주석 [중첩]) 【제외】 — 문장!\n\n\n끝'), 'C 문장!\n\n끝');
    assert.equal(normalizeTtsText('“대사” 「대사」 ‘속마음’', true), '“대사” 「대사」 ‘속마음’');
    assert.deepEqual(documentTtsPreview(document(text('C++ (설명)'))), { original: 'C++ (설명)', text: 'C' });
});

test('explicit readings and replacements survive enclosing brackets and are never normalized again', () => {
    const source = document(text('앞 (설명 '), text('C++', [mark('read')]), text(') 뒤 '), text('안 읽음', [mark('skip', '', 'tts_skip')]), text(' 끝'));
    assert.deepEqual(documentTtsPreview(source), { original: '앞 (설명 C++) 뒤 안 읽음 끝', text: '앞 C++ 뒤 끝' });
    assert.equal(renderTtsSegments([{ text: 'A [자동 (' }, { text: 'C++ (명시)', protected: true }, { text: ')] B' }]), 'A C++ (명시) B');
    assert.equal(renderTtsSegments([{ text: 'BMttsProtected0End ' }, { text: '$& + (읽기)', protected: true }]), 'BMttsProtected0End $& + (읽기)');
});

test('formatting splits and hard breaks pronounce one selection once and keep visible source intact', () => {
    const override = mark('replace', '한 번 읽기');
    const source = document(text('원', [override]), text('문', [{ type: 'bold' }, override]), { type: 'hardBreak', marks: [override] }, text('다음', [override]));
    assert.deepEqual(documentTtsPreview(source), { original: '원문\n다음', text: '한 번 읽기' });
    const separated = document(text('A', [override]), text(' 사이 '), text('B', [override]));
    assert.equal(documentTtsPreview(separated).text, '한 번 읽기 사이 한 번 읽기');
});

test('dictionary prefers the longest literal match, crosses formatting, and never replaces its own output', () => {
    const source = document(text('C', [{ type: 'bold' }]), text('++ CPU C+'));
    const dictionary = [entry('C', '짧음'), entry('C++', 'CPU', 'tts_cpp'), entry('CPU', '씨피유', 'tts_cpu')];
    const before = structuredClone(source);
    const annotated = annotateTtsDocument(source, dictionary);
    assert.deepEqual(documentTtsPreview(source, dictionary), { original: 'C++ CPU C+', text: 'CPU 씨피유 짧음' });
    assert.deepEqual(source, before);
    assert.equal(annotated.content[0].content[0].marks[0].type, 'bold');
    assert.equal(annotated.content[0].content[0].marks[1].attrs.id, annotated.content[0].content[1].marks[0].attrs.id);
    assert.equal(documentTtsPreview(document(text('A.B A?B $1')), [entry('A.B', '점'), entry('$1', '$&', 'tts_dollar')]).text, '점 A?B $&');
});

test('explicit selections take priority over dictionary entries and dictionary IDs cannot collide', () => {
    const source = document(text('CPU', [mark('read', '', 'tts_dictionary_0')]), text(' CPU '), text('CPU', [mark('replace', '내 발음')]), text(' CPU', [mark('skip', '', 'tts_skip')]));
    const dictionary = [entry('CPU', '씨피유')];
    const result = annotateTtsDocument(source, dictionary);
    assert.equal(documentTtsPreview(source, dictionary).text, 'CPU 씨피유 내 발음');
    assert.equal(result.content[0].content[2].marks[0].attrs.id, 'tts_dictionary_1');
});

test('chapter preview includes image, audio and media captions and numbered footnotes', () => {
    const source = document(text('본문'), { type: 'footnote', attrs: { id: 'n_note', text: 'CPU 각주' } });
    source.content.push({ type: 'image', attrs: { assetId: 'a_image', caption: 'CPU 그림' } }, { type: 'audio', attrs: { assetId: 'a_audio', title: '' } }, { type: 'media', attrs: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '동영상' } });
    const result = documentTtsPreview(source, [entry('CPU', '씨피유')], { assets: [{ id: 'a_audio', name: 'CPU 오디오' }] });
    assert.equal(result.original, '본문1\n\nCPU 그림\n\nCPU 오디오\n\n동영상\n\n1 ↩ CPU 각주');
    assert.equal(result.text, '본문1\n\n씨피유 그림\n\n씨피유 오디오\n\n동영상\n\n1 씨피유 각주');
});

test('TTS project validation accepts legacy books and rejects malformed dictionary and annotations', () => {
    const project = createProject();
    assert.equal(validateProject(project), project);
    project.tts = { dictionary: [entry('CPU', '씨피유')] };
    project.chapters[0].content = document(text('CPU', [mark('replace', '씨피유')]));
    assert.equal(validateProject(project), project);
    for (const dictionary of [null, [entry('', '소리')], [entry(' ', '소리')], [entry('CPU', '')], [entry('CPU', '\u0000')], [entry('CPU', '소리', undefined), entry('CPU', '다른 소리', 'tts_other')], Array.from({ length: TTS_LIMITS.dictionary + 1 }, (_, index) => entry(String(index), '소리', `tts_${index}`))]) {
        const invalid = structuredClone(project);
        invalid.tts.dictionary = dictionary;
        assert.throws(() => validateProject(invalid), { code: 'INVALID_PROJECT' });
    }
    assert.equal(validTtsSettings({ dictionary: [{ source: 'CPU', replacement: '소리' }] }), false);
    for (const attrs of [{ mode: 'read' }, { id: 'tts_bad', mode: 'auto', text: '' }, { id: 'tts_bad', mode: 'replace', text: ' ' }, { id: 'tts_bad', mode: 'replace', text: 'x'.repeat(TTS_LIMITS.replacement + 1) }]) {
        const invalid = structuredClone(project);
        invalid.chapters[0].content.content[0].content[0].marks = [{ type: 'tts', attrs }];
        assert.throws(() => validateProject(invalid), { code: 'INVALID_DOCUMENT' });
    }
});

test('chapter duplication remaps grouped TTS identities without changing readings', () => {
    const project = createProject();
    project.chapters[0].content = document(text('C', [mark('replace', '씨 플러스 플러스')]), text('++', [mark('replace', '씨 플러스 플러스'), { type: 'bold' }]));
    const copy = duplicateChapter(project.chapters[0]);
    const marks = copy.content.content[0].content.map(node => node.marks.find(item => item.type === 'tts'));
    assert.equal(marks[0].attrs.id, marks[1].attrs.id);
    assert.notEqual(marks[0].attrs.id, 'tts_selection');
    assert.equal(documentTtsPreview(copy.content).text, '씨 플러스 플러스');
});

test('XHTML keeps source and formatting while escaping custom readings and dictionary spans', () => {
    const project = createProject();
    project.tts = { dictionary: [entry('CPU', '씨피유')] };
    project.chapters[0].title = 'CPU 제목';
    project.chapters[0].content = document(text('CPU '), text('원문', [mark('replace', '<읽기> & "음성"'), { type: 'bold' }]), text(' C++', [mark('read', '', 'tts_read')]), text(' 숨김', [mark('skip', '', 'tts_skip')]));
    const before = structuredClone(project);
    const xhtml = chapterXhtml(project.chapters[0], project);
    assert.match(xhtml, /data-bm-tts="replace" data-bm-tts-id="tts_selection" data-bm-tts-text="&lt;읽기&gt; &amp; &quot;음성&quot;"><strong>원문<\/strong><\/span>/);
    assert.match(xhtml, /data-bm-tts-text="씨피유">CPU<\/span>/);
    assert.match(xhtml, /data-bm-tts="read"[^>]*> C\+\+<\/span>/);
    assert.match(xhtml, /data-bm-tts="skip"[^>]*> 숨김<\/span>/);
    const dictionaryIds = [...xhtml.matchAll(/data-bm-tts-id="(tts_dictionary_\d+)"/g)].map(match => match[1]);
    assert.equal(dictionaryIds.length, 2);
    assert.equal(new Set(dictionaryIds).size, dictionaryIds.length);
    assert.deepEqual(project, before);
});

test('project save, recovery, reopening and EPUB export preserve independent TTS corrections', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-tts-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const state = await service.create(1, 'blank', 'ko');
    const png = path.join(root, 'image.png');
    await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64'));
    const { asset } = await service.addAsset(1, state.sessionId, png, 'image');
    state.project.assets.push(asset);
    state.project.tts = { dictionary: [entry('CPU', '씨피유')] };
    state.project.chapters[0].content = document(text('CPU '), text('표', [mark('replace', '수치 요약')]), text(' (필수)', [mark('read', '', 'tts_read')]));
    state.project.chapters[0].content.content.push({ type: 'paragraph', content: [text('주석'), { type: 'footnote', attrs: { id: 'n_note', text: 'CPU 설명' } }] }, { type: 'image', attrs: { assetId: asset.id, alt: '그림', width: 100, align: 'center', caption: 'CPU 그림' } }, { type: 'media', attrs: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '동영상' } });
    state.project.revision = 1;
    await service.recovery(1, state.sessionId, state.project);
    const target = path.join(root, '낭독.bmepub');
    await service.write(1, state.sessionId, state.project, target, 'save', 'tts-save');
    const reopened = await service.open(2, target, 'tts-open');
    assert.deepEqual(reopened.project, state.project);
    await service.close(1, state.sessionId);
    const restored = await service.restore(1, state.sessionId);
    assert.deepEqual(restored.project.tts, state.project.tts);
    assert.deepEqual(restored.project.chapters[0].content, state.project.chapters[0].content);
    const epub = path.join(root, '낭독.epub');
    await service.write(2, reopened.sessionId, reopened.project, epub, 'export', 'tts-export');
    const bytes = await fs.readFile(epub);
    const file = listZipEntries(bytes).find(item => item.name === `EPUB/text/${state.project.chapters[0].id}.xhtml`);
    const xhtml = readZipEntry(bytes, file).toString();
    assert.match(xhtml, /data-bm-tts-text="씨피유">CPU<\/span>/);
    assert.match(xhtml, /data-bm-tts-text="수치 요약">표<\/span>/);
    const preview = documentTtsPreview(reopened.project.chapters[0].content, reopened.project.tts.dictionary);
    const viewer = new ViewerSessionManager();
    const session = viewer.create(epub, { skipAdjacent: true });
    const rendered = await viewer.getEpubText(session.id);
    const blocks = rendered.chapters.at(-1).blocks.slice(1);
    assert.equal(blocks.map(block => block.text).join('\n\n'), preview.original);
    assert.equal(blocks.map(block => epubTtsText(block.text, block.ttsEdits, false)).join('\n\n'), preview.text);
});
