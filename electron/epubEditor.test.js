import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { EpubEditorService } from './epubEditor/service.js';
import { writePackage, openProjectPackage, epubTextEntries } from './epubEditor/package.js';
import { createProject, paragraph, validateProject, inspectProject, duplicateChapter, newId } from './epubEditor/model.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
// A locally synthesized 0.1-second tone, encoded as MPEG Layer 3.
const mp3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMgAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAykAWlpaWlpaWlpaWlpaWlpaWnt7e3t7e3t7e3t7e3t7e3t7nJycnJycnJycnJycnJycnL29vb29vb29vb29vb29vb293t7e3t7e3t7e3t7e3t7e3t7/////////////////////AAAAAExhdmM2Mi4yOAAAAAAAAAAAAAAAACQCowAAAAAAAAMp//YTsAAAAAAAAAAAAAAAAAD/80DEABQgXpBfTxgAAafbb/hD0PQ9D0PV8dsVhpkHELBzg5xDy5qN/EpR5EBAMQfB8/lOXP8o6c6fOcu/hjl3850+7KAmD4Pg+D4IAgCAIAMHw+XD4IBioBg/wQ6VvUSgwwYEAYEAgP/zQsQKFvEaqZ+aUAIAE0i42ioDybiYcMFMsYMoGg4LPgjkkMTOpw2IZ/QDQBIBX8JQDQBb8QINoNorf4ihFEI9Hv/isIoRRCLIiSL+DQlCQNN/yoSBoShIGhL//Oh1xelFVTEgAHDAX//zQMQKFaiOHAHfEAAByMB7CbjA+QeQwfEC8MFzDoDFTxNo3UUp3MWYEEyIOBMBDAPDAfwI4wEMAHMAoAITADQA4vOJAANn///68AY3/Ufc3/L//Z///7f/ShKq645JBn3CpOMrEQbi//NCxA4RoFZYf10QAqDphmEJiANhj0DR94TxkCIIoCAOARABBtrG/Yqg4kPp1DGMZ7Gtasq/1VfR2/+noln9f5Htt2f+uqwFA2HA4HA4BAwANrYl6bQOog7s8oJlS8xo9LwyTEHhHfF4//NAxCMcecKdvZqYAi0MIgtS4yaJPgeSAKNDQuV0TcDWAGzob959k3Cw4Miiyg1d+m9xCUcoUEMaR397vuMsPkjCBEqRhS///KZMFImyYOF8uGH/8uCAOGQwBDMKewBAWud8uqXZXwb/80LEDBMI2kAJ2EgAWB3wAmtosMqZiUnYCXBLMtstFIlgtJDVG4KwoFFQyysimIQRJrZyUrQilq4+UvFCesKgt1//4ixEo9UeZlvPdKpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqo=', 'base64');

test('unload waits for recovery acknowledgment and distinguishes native close from reload', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-ipc-'));
    let handler;
    let closed = 0;
    let reloaded = 0;
    let flushes = 0;
    const window = new EventEmitter();
    window.close = () => { closed += 1; };
    const sender = new EventEmitter();
    Object.assign(sender, { id: 42, isDestroyed: () => false, reload: () => { reloaded += 1; }, send: channel => { if (channel.endsWith(':flush')) flushes += 1; } });
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (channel, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => window }, dialog: {} });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    await handler({ sender }, { action: 'list' });
    window.emit('close', { defaultPrevented: true });
    sender.emit('will-prevent-unload');
    assert.equal(closed + reloaded, 0);
    await handler({ sender }, { action: 'finishUnload' });
    assert.equal(reloaded, 1);
    assert.equal(closed, 0);
    window.emit('close', { defaultPrevented: false });
    sender.emit('will-prevent-unload');
    assert.equal(closed, 0);
    await handler({ sender }, { action: 'finishUnload' });
    await handler({ sender }, { action: 'finishUnload' });
    assert.equal(closed, 1);
    assert.equal(flushes, 2);
});

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-test-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const state = await service.create(1, 'essay', 'ko');
    state.project.metadata.title = '한글 & 日本語 <Book>';
    state.project.metadata.author = 'Author';
    state.project.chapters[0].content.content = [paragraph('첫 문장과 <특수 문자> & punctuation.')];
    return { root, service, state };
}

test('dropped mixed assets preserve successful files in order and report each rejected file', async t => {
    const { root, service, state } = await fixture(t);
    const image = path.join(root, '한글 그림.png');
    const audio = path.join(root, '소리.mp3');
    const bad = path.join(root, 'broken.mp3');
    const font = path.join(root, 'font.otf');
    const missing = path.join(root, 'missing.png');
    await fs.writeFile(image, png);
    await fs.writeFile(audio, mp3);
    await fs.writeFile(bad, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]));
    await fs.writeFile(font, Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]));
    const { assets, rejected } = await service.importAssets(1, state.sessionId, [image, bad, audio, root, font, missing, image]);
    assert.deepEqual(assets.map(asset => asset.kind), ['image', 'audio', 'font']);
    assert.deepEqual(assets.map(asset => asset.name), ['한글 그림.png', '소리.mp3', 'font.otf']);
    assert.deepEqual(rejected, [{ name: 'broken.mp3', code: 'INVALID_ASSET' }, { name: path.basename(root), code: 'ASSET_FILE_REQUIRED' }, { name: 'missing.png', code: 'ENOENT' }]);
    state.project.assets.push(...assets);
    state.project.chapters[0].content.content.push({ type: 'image', attrs: { assetId: assets[0].id, width: 100, align: 'center', alt: '그림' } }, { type: 'audio', attrs: { assetId: assets[1].id, title: '소리', kind: 'effect', loop: false } });
    const saved = path.join(root, 'drop.bmepub');
    await service.write(1, state.sessionId, state.project, saved, 'save', 'drop-save');
    for (const file of [image, audio, font]) await fs.unlink(file);
    const reopened = await service.open(1, saved, 'drop-open');
    assert.deepEqual(reopened.project.assets, assets);
    assert.deepEqual((await service.asset(1, reopened.sessionId, assets[0].id)).data, png);
    assert.deepEqual((await service.asset(1, reopened.sessionId, assets[1].id)).data, mp3);
});

test('asset batch IPC validates ownership and limits without opening file dialogs', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-epub-drop-ipc-'));
    let handler;
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (channel, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: () => assert.fail('Drops must not open a file dialog') } });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: () => {} });
    const state = await handler({ sender }, { action: 'create', template: 'blank', language: 'ko' });
    const file = path.join(root, 'drop.png');
    await fs.writeFile(file, png);
    const payload = { action: 'importAssets', sessionId: state.sessionId, paths: [file] };
    const result = await handler({ sender }, payload);
    assert.equal(result.ok, true);
    assert.equal(result.assets.length, 1);
    const other = Object.assign(new EventEmitter(), { id: 2 });
    assert.equal((await handler({ sender: other }, payload)).error.code, 'SESSION_CLOSED');
    for (const paths of [[], Array(101).fill(file), 'not an array']) assert.equal((await handler({ sender }, { ...payload, paths })).error.code, 'INVALID_ASSET_BATCH');
    const invalid = await handler({ sender }, { ...payload, paths: ['relative.png', null] });
    assert.equal(invalid.assets.length, 0);
    assert.deepEqual(invalid.rejected.map(item => item.code), ['INVALID_ASSET_PATH', 'INVALID_ASSET_PATH']);
});

test('EPUB project preserves chapters, image bytes, style and metadata across save and reopen', async t => {
    const { root, service, state } = await fixture(t);
    const imagePath = path.join(root, '한글 image.png');
    await fs.writeFile(imagePath, png);
    const { asset } = await service.addAsset(1, state.sessionId, imagePath, 'image');
    state.project.assets.push(asset);
    state.project.chapters[0].content.content.push({ type: 'image', attrs: { assetId: asset.id, alt: '도형', width: 65, align: 'center', caption: '설명' } });
    const target = path.join(root, '책 project.bmepub');
    await service.write(1, state.sessionId, state.project, target, 'save', 'save');
    await fs.unlink(imagePath);
    const reopened = await service.open(2, target, 'open');
    assert.deepEqual(reopened.project, state.project);
    assert.deepEqual((await service.asset(2, reopened.sessionId, asset.id)).data, png);
    assert.equal(reopened.savedRevision, 0);
    await assert.rejects(service.asset(1, reopened.sessionId, asset.id), { code: 'SESSION_CLOSED' });
});

test('EPUB export produces ordered stored mimetype, escaped metadata, cover, navigation and matching spine', async t => {
    const { root, service, state } = await fixture(t);
    const { project } = state;
    const headingId = newId();
    project.chapters[0].content.content.push({ type: 'heading', attrs: { level: 2, id: headingId }, content: [{ type: 'text', text: '절 제목' }] });
    project.chapters[0].content.content.push({ type: 'paragraph', content: [{ type: 'text', text: '다음 장', marks: [{ type: 'link', attrs: { href: `epub:${project.chapters[1].id}` } }] }] });
    project.chapters.reverse();
    const target = path.join(root, 'book.epub');
    await service.write(1, state.sessionId, project, target, 'export', 'export');
    const buffer = await fs.readFile(target);
    const entries = listZipEntries(buffer);
    assert.equal(entries[0].name, 'mimetype');
    assert.equal(entries[0].localHeaderOffset, 0);
    assert.equal(entries[0].method, 0);
    assert.equal(buffer.readUInt16LE(28), 0);
    const read = name => readZipEntry(buffer, entries.find(entry => entry.name === name)).toString();
    assert.equal(read('mimetype'), 'application/epub+zip');
    const opf = read('EPUB/package.opf');
    assert.ok(opf.includes('한글 &amp; 日本語 &lt;Book&gt;'));
    assert.ok(opf.includes('properties="cover-image"'));
    const spine = opf.slice(opf.indexOf('<spine>'));
    assert.ok(spine.indexOf(project.chapters[0].id) < spine.indexOf(project.chapters[1].id));
    const body = read(`EPUB/text/${project.chapters[2].id}.xhtml`);
    assert.ok(body.includes(`href="${project.chapters[1].id}.xhtml"`));
    assert.ok(read('EPUB/nav.xhtml').includes(`#${headingId}`));
    assert.ok(!body.includes('epub:c_'));
    assert.ok(!body.includes(root));
    const { ViewerSessionManager } = await import('./viewerSessions.js');
    const reader = new ViewerSessionManager();
    const readerSession = reader.create(target, { skipAdjacent: true });
    const document = await reader.getEpubText(readerSession.id);
    assert.deepEqual(document.chapters.slice(1).map(chapter => chapter.title), project.chapters.map(chapter => chapter.title));
    assert.ok(document.chapters.at(-1).text.includes('첫 문장과 <특수 문자> & punctuation.'));
    assert.ok(document.toc.some(item => item.anchor === headingId));
});

test('project save detects an external change and preserves the modified file', async t => {
    const { root, service, state } = await fixture(t);
    const target = path.join(root, 'book.bmepub');
    await service.write(1, state.sessionId, state.project, target, 'save', 'save-first');
    await fs.writeFile(target, 'external edit');
    state.project.revision = 1;
    await assert.rejects(service.write(1, state.sessionId, state.project, target, 'save', 'save-conflict'), { code: 'EXTERNAL_CHANGE' });
    assert.equal(await fs.readFile(target, 'utf8'), 'external edit');
    assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('recovery ignores an older revision and restores the latest project after the session ends', async t => {
    const { service, state } = await fixture(t);
    const newer = structuredClone(state.project);
    newer.revision = 2;
    newer.metadata.title = '최신 제목';
    await service.recovery(1, state.sessionId, newer);
    assert.equal((await service.recovery(1, state.sessionId, { ...state.project, revision: 1 })).revision, 2);
    await service.close(1, state.sessionId);
    const restored = await service.restore(2, state.sessionId);
    assert.equal(restored.project.metadata.title, '최신 제목');
    assert.equal(restored.project.revision, 2);
});

test('failed recovery write leaves the previous recovery revision intact', async t => {
    const { service, state } = await fixture(t);
    const original = service.persist;
    service.persist = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    await assert.rejects(service.recovery(1, state.sessionId, { ...state.project, revision: 4 }), { code: 'ENOSPC' });
    assert.equal(service.session(state.sessionId, 1).project.revision, 0);
    service.persist = original;
});

test('canceling a package worker preserves the target and removes temporary output', async t => {
    const { root, service, state } = await fixture(t);
    const target = path.join(root, 'cancel.epub');
    await fs.writeFile(target, 'previous book');
    const writing = service.write(1, state.sessionId, state.project, target, 'export', 'cancel-me');
    const rejection = assert.rejects(writing, { code: 'CANCELED' });
    for (let count = 0; !service.jobs.has('cancel-me') && count < 100; count += 1) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await service.cancel(1, 'cancel-me')).canceled, true);
    await rejection;
    assert.equal(await fs.readFile(target, 'utf8'), 'previous book');
    assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('untrusted packages cannot extract paths outside their asset directory', async t => {
    const { root } = await fixture(t);
    const target = path.join(root, 'bad.bmepub');
    await writePackage(target, [{ name: 'project.json', data: JSON.stringify(createProject()) }, { name: '../escape.txt', data: 'escape' }]);
    await assert.rejects(openProjectPackage(target, path.join(root, 'extract')), { code: 'INVALID_PROJECT' });
    await assert.rejects(fs.stat(path.join(root, 'escape.txt')), { code: 'ENOENT' });
});

test('package CRC errors and duplicate asset entries are rejected', async t => {
    const { root } = await fixture(t);
    const target = path.join(root, 'duplicate.bmepub');
    const project = createProject();
    await writePackage(target, [{ name: 'project.json', data: JSON.stringify(project), store: true }, { name: 'project.json', data: '{}' }]);
    await assert.rejects(openProjectPackage(target, path.join(root, 'extract')), { code: 'INVALID_PROJECT' });
    const single = path.join(root, 'crc.bmepub');
    await writePackage(single, [{ name: 'project.json', data: JSON.stringify(project), store: true }]);
    const buffer = await fs.readFile(single);
    buffer[45] ^= 1;
    await fs.writeFile(single, buffer);
    await assert.rejects(openProjectPackage(single, path.join(root, 'extract-crc')), { code: 'INVALID_PROJECT' });
});

test('unsupported nodes, style injection and executable links are rejected before writing', () => {
    for (const content of [
        [{ type: 'script', content: [] }],
        [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
        [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'https://example.test/\u0000' } }] }] }],
        [{ type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'textStyle', attrs: { color: 'red; background:url(https://example.test)' } }] }] }],
    ]) {
        const project = createProject();
        project.chapters[0].content.content = content;
        assert.throws(() => validateProject(project));
    }
});

test('chapter duplication remaps its own anchors and preserves links to other chapters', () => {
    const project = createProject('essay');
    const chapter = project.chapters[0];
    const id = newId();
    chapter.content.content = [{ type: 'heading', attrs: { id, level: 2 }, content: [{ type: 'text', text: 'Heading' }] }, { type: 'paragraph', content: [
        { type: 'text', text: 'self', marks: [{ type: 'link', attrs: { href: `epub:${chapter.id}#${id}` } }] },
        { type: 'text', text: 'other', marks: [{ type: 'link', attrs: { href: `epub:${project.chapters[1].id}` } }] },
    ] }];
    const copy = duplicateChapter(chapter);
    assert.notEqual(copy.id, chapter.id);
    assert.notEqual(copy.content.content[0].attrs.id, id);
    assert.equal(copy.content.content[1].content[0].marks[0].attrs.href, `epub:${copy.id}#${copy.content.content[0].attrs.id}`);
    assert.equal(copy.content.content[1].content[1].marks[0].attrs.href, `epub:${project.chapters[1].id}`);
    project.chapters.push(copy);
    assert.equal(inspectProject(project).filter(issue => issue.severity === 'error').length, 0);
});

test('missing assets, invalid language and broken links block export without blocking project storage', () => {
    const project = createProject();
    project.metadata.language = 'not_a_language';
    project.chapters[0].content.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'broken', marks: [{ type: 'link', attrs: { href: 'epub:c_missing' } }] }] });
    project.chapters[0].content.content.push({ type: 'image', attrs: { assetId: 'a_missing', width: 100, align: 'center', alt: '' } });
    validateProject(project);
    const codes = inspectProject(project).map(issue => issue.code);
    assert.ok(codes.includes('LANGUAGE_REQUIRED'));
    assert.ok(codes.includes('BROKEN_LINK'));
    assert.ok(codes.includes('IMAGE_MISSING'));
    assert.throws(() => epubTextEntries(project), { code: 'VALIDATION_FAILED' });
});

test('common and chapter CSS cascade, draft errors remain saveable, and unsafe resources are blocked', async t => {
    const { root, service, state } = await fixture(t);
    const { project } = state;
    project.commonCss = 'p { color: #123456; }';
    project.chapters[0].css = 'p { color: #654321; }';
    let entries = epubTextEntries(project);
    const chapter = project.chapters[0];
    const read = name => entries.find(entry => entry.name === name)?.data;
    assert.ok(read('EPUB/styles/book.css').endsWith('p{color:#123456}\n'));
    assert.equal(read(`EPUB/styles/${chapter.id}.css`), 'p{color:#654321}');
    const html = read(`EPUB/text/${chapter.id}.xhtml`);
    assert.ok(html.indexOf('styles/book.css') < html.indexOf(`styles/${chapter.id}.css`));
    assert.ok(read('EPUB/package.opf').includes(`id="css-${chapter.id}"`));
    chapter.css = 'p { color: red';
    assert.ok(inspectProject(project).some(issue => issue.code === 'CSS_INVALID' && issue.chapterId === chapter.id));
    const target = path.join(root, 'draft.bmepub');
    await service.write(1, state.sessionId, project, target, 'save', 'save-css');
    const reopened = await service.open(2, target, 'open-css');
    assert.equal(reopened.project.chapters[0].css, chapter.css);
    assert.throws(() => epubTextEntries(project), { code: 'VALIDATION_FAILED' });
    for (const css of ['@import "https://example.com/style.css";', 'p{background:url(https://example.com/image)}', 'p{background:u\\72l("https://example.com/image")}', 'p{background:image-set("https://example.com/image")}', '@font-face{font-family:x;src:url(file:///secret)}']) {
        chapter.css = css;
        assert.ok(inspectProject(project).some(issue => issue.code === 'CSS_RESOURCE'), css);
    }
    chapter.css = ':root { --accent: #abc; } p { color: var(--accent); } @media (max-width: 600px) { p { font-size: 1em; } }';
    entries = epubTextEntries(project);
    assert.ok(entries.some(entry => entry.name === `EPUB/styles/${chapter.id}.css`));
});

test('footnotes renumber in document order, escape content and retain unique backlinks after duplication', () => {
    const project = createProject();
    const chapter = project.chapters[0];
    const first = { type: 'footnote', attrs: { id: newId(), text: '<주석> & 내용\n두 번째 줄' } };
    const second = { type: 'footnote', attrs: { id: newId(), text: '먼저 오는 주석' } };
    chapter.content.content = [{ type: 'paragraph', content: [{ type: 'text', text: '본문' }, second, first] }];
    project.chapters.push(duplicateChapter(chapter));
    assert.ok(!inspectProject(project).some(issue => issue.severity === 'error'));
    const entries = epubTextEntries(project);
    const html = entries.find(entry => entry.name === `EPUB/text/${chapter.id}.xhtml`).data;
    assert.ok(html.includes(`href="#note-${second.attrs.id}">1</a>`));
    assert.ok(html.includes(`href="#note-${first.attrs.id}">2</a>`));
    assert.ok(html.includes(`href="#${first.attrs.id}" role="doc-backlink"`));
    assert.ok(html.includes('&lt;주석&gt; &amp; 내용<br />두 번째 줄'));
    const copy = entries.find(entry => entry.name === `EPUB/text/${project.chapters[1].id}.xhtml`).data;
    assert.ok(!copy.includes(first.attrs.id));
    chapter.content.content[0].content = [first];
    assert.ok(epubTextEntries(project).find(entry => entry.name === `EPUB/text/${chapter.id}.xhtml`).data.includes(`href="#note-${first.attrs.id}">1</a>`));
});

test('merged table dimensions and column widths survive project save and EPUB output', async t => {
    const { root, service, state } = await fixture(t);
    const cell = (text, attrs = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs }, content: [paragraph(text)] });
    state.project.chapters[0].content.content.push({ type: 'table', content: [
        { type: 'tableRow', content: [cell('병합', { colspan: 2, colwidth: [120, 180], backgroundColor: '#abcdef', verticalAlign: 'middle', cellPadding: 16 }), cell('C', { colwidth: [300], rowspan: 2 })] },
        { type: 'tableRow', content: [cell('A'), cell('B')] },
    ] });
    const target = path.join(root, 'table.bmepub');
    await service.write(1, state.sessionId, state.project, target, 'save', 'save-table');
    const reopened = await service.open(2, target, 'open-table');
    assert.deepEqual(reopened.project.chapters, state.project.chapters);
    const html = epubTextEntries(reopened.project).find(entry => entry.name === `EPUB/text/${state.project.chapters[0].id}.xhtml`).data;
    assert.ok(html.includes('colspan="2" rowspan="1"'));
    assert.ok(html.includes('background-color:#abcdef;vertical-align:middle;padding:1rem'));
    assert.ok(html.includes('colspan="1" rowspan="2"'));
    assert.ok(html.includes('<col style="width:20.0000%" /><col style="width:30.0000%" /><col style="width:50.0000%" />'));
});

test('audio assets, position and loop settings survive source removal, reopen and EPUB packaging', async t => {
    const { root, service, state } = await fixture(t);
    const file = path.join(root, 'effect.mp3');
    const bytes = mp3;
    await fs.writeFile(file, bytes);
    const { asset } = await service.addAsset(1, state.sessionId, file, 'audio');
    await fs.writeFile(path.join(root, 'invalid.mp3'), Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]));
    await assert.rejects(service.addAsset(1, state.sessionId, path.join(root, 'invalid.mp3'), 'audio'), { code: 'INVALID_ASSET' });
    state.project.assets.push(asset);
    state.project.chapters[0].content.content.push({ type: 'audio', attrs: { id: newId(), assetId: asset.id, title: '문이 열리는 소리 & 배경', kind: 'background', loop: true } }, paragraph('소리 뒤의 문장'));
    const target = path.join(root, 'audio.bmepub');
    await service.write(1, state.sessionId, state.project, target, 'save', 'save-audio');
    await fs.unlink(file);
    const reopened = await service.open(2, target, 'open-audio');
    assert.deepEqual(reopened.project, state.project);
    assert.deepEqual((await service.asset(2, reopened.sessionId, asset.id)).data, bytes);
    const epub = path.join(root, 'audio.epub');
    await service.write(2, reopened.sessionId, reopened.project, epub, 'export', 'export-audio');
    const buffer = await fs.readFile(epub);
    const entries = listZipEntries(buffer);
    const read = name => readZipEntry(buffer, entries.find(entry => entry.name === name)).toString();
    const html = read(`EPUB/text/${state.project.chapters[0].id}.xhtml`);
    assert.ok(html.includes('controls="controls" preload="none" loop="loop"'));
    assert.ok(!html.includes('autoplay'));
    assert.ok(html.indexOf('<audio ') < html.indexOf('소리 뒤의 문장'));
    assert.ok(read('EPUB/package.opf').includes('media-type="audio/mpeg"'));
    assert.ok(entries.some(entry => entry.name === `EPUB/assets/${asset.id}.mp3`));
    reopened.project.assets = [];
    assert.ok(inspectProject(reopened.project).some(issue => issue.code === 'AUDIO_MISSING'));
});

test('legacy projects without optional CSS fields remain editable and exportable', () => {
    const project = createProject();
    delete project.commonCss;
    delete project.chapters[0].css;
    assert.equal(validateProject(project), project);
    assert.ok(epubTextEntries(project).some(entry => entry.name === 'EPUB/styles/book.css'));
});
