import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { paragraph } from './epubEditor/model.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { createCoverEditViewerGuard } from './coverEditViewerGuard.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-preview-test-'));
    const service = new EpubEditorService(root);
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const state = await service.create(1, 'blank', 'ko');
    state.project.metadata.title = '미리보기 / 책';
    state.project.chapters[0].content.content = [paragraph('저장하지 않은 본문')];
    return { root, service, state };
}

test('viewer preview packages current content, CSS and assets without changing saved state', async t => {
    const { root, service, state } = await fixture(t);
    const saved = path.join(root, 'original.bmepub');
    await service.write(1, state.sessionId, state.project, saved, 'save', 'saved');
    const original = await fs.readFile(saved);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
    const source = path.join(root, 'image.png');
    await fs.writeFile(source, png);
    const { asset } = await service.addAsset(1, state.sessionId, source, 'image');
    state.project.assets.push(asset);
    state.project.chapters[0].content.content.push({ type: 'image', attrs: { assetId: asset.id, alt: '그림', width: 100, align: 'center' } });
    state.project.commonCss = 'p { color: #123456; }';
    state.project.chapters[0].css = 'p { line-height: 2; }';
    state.project.revision = 1;
    const progress = [];
    const preview = await service.preview(1, state.sessionId, state.project, 'preview', value => progress.push(value));
    const data = await fs.readFile(preview.filePath);
    const entries = listZipEntries(data);
    const read = name => readZipEntry(data, entries.find(entry => entry.name === name)).toString();
    assert.equal(read('mimetype'), 'application/epub+zip');
    assert.match(read('EPUB/styles/book.css'), /#123456/);
    assert.match(read(`EPUB/styles/${state.project.chapters[0].id}.css`), /line-height:\s*2/);
    assert.match(read(`EPUB/text/${state.project.chapters[0].id}.xhtml`), /저장하지 않은 본문/);
    assert.ok(entries.some(entry => entry.name.startsWith('EPUB/assets/')));
    assert.equal(preview.revision, 1);
    assert.equal(service.snapshot(service.session(state.sessionId, 1)).savedRevision, 0);
    assert.equal(service.session(state.sessionId, 1).savedPath, saved);
    assert.deepEqual(await fs.readFile(saved), original);
    assert.ok(progress.length > 0);
    const reader = new ViewerSessionManager();
    const session = reader.create(preview.filePath, { skipAdjacent: true });
    const document = await reader.getEpubText(session.id);
    assert.ok(document.chapters.some(chapter => chapter.text.includes('저장하지 않은 본문')));
    await service.close(1, state.sessionId);
    await service.dispose(1);
    assert.ok((await fs.stat(preview.filePath)).isFile(), 'The viewer remains usable after leaving the editor');
    await service.releasePreview(preview.filePath);
    await assert.rejects(fs.stat(preview.filePath), { code: 'ENOENT' });
});

test('repeated previews use distinct files and cleanup only removes generated output', async t => {
    const { root, service, state } = await fixture(t);
    const first = await service.preview(1, state.sessionId, state.project, 'first');
    state.project.chapters[0].content.content = [paragraph('수정한 본문')];
    state.project.revision += 1;
    const second = await service.preview(1, state.sessionId, state.project, 'second');
    assert.notEqual(first.filePath, second.filePath);
    const reader = new ViewerSessionManager();
    for (const [preview, text] of [[first, '저장하지 않은 본문'], [second, '수정한 본문']]) {
        const session = reader.create(preview.filePath, { skipAdjacent: true });
        assert.ok((await reader.getEpubText(session.id)).chapters.some(chapter => chapter.text.includes(text)));
    }
    const unrelated = path.join(root, 'keep.txt');
    await fs.writeFile(unrelated, 'keep');
    await service.releasePreview(unrelated);
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
    await service.dispose();
    for (const preview of [first, second]) await assert.rejects(fs.stat(preview.filePath), { code: 'ENOENT' });
});

test('invalid, unauthorized and canceled previews cannot open or leave partial EPUB files', async t => {
    const { service, state } = await fixture(t);
    await assert.rejects(service.preview(2, state.sessionId, state.project, 'other'), { code: 'SESSION_CLOSED' });
    await assert.rejects(service.preview(1, state.sessionId, { ...state.project, commonCss: 'p {' }, 'invalid'), { code: 'VALIDATION_FAILED' });
    assert.equal(service.previews.size, 0);
    const preparing = service.preview(1, state.sessionId, state.project, 'cancel-preview');
    const rejected = assert.rejects(preparing, { code: 'CANCELED' });
    for (let i = 0; !service.jobs.has('cancel-preview') && i < 100; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await service.cancel(2, 'cancel-preview')).canceled, false);
    assert.equal((await service.cancel(1, 'cancel-preview')).canceled, true);
    await rejected;
    assert.equal(service.previews.size, 0);
    assert.equal(service.jobs.size, 0);
});

async function ipcFixture(t, openViewerPreview) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-preview-ipc-'));
    let handler;
    const controller = registerEpubEditorIpc({
        ipcMain: { handle: (_channel, fn) => { handler = fn; } }, app: { getPath: () => root },
        BrowserWindow: { fromWebContents: () => null },
        dialog: { showSaveDialog: () => assert.fail('Preview must not open a save dialog') }, openViewerPreview,
    });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: () => {} });
    const state = await handler({ sender }, { action: 'create', template: 'blank', language: 'ko' });
    return { handler, sender, state };
}

test('preview IPC opens the trusted generated path and returns the snapshot revision without a save dialog', async t => {
    let opened;
    let release;
    const { handler, sender, state } = await ipcFixture(t, async (filePath, onRelease) => {
        opened = filePath;
        release = onRelease;
        assert.ok((await fs.stat(filePath)).isFile());
        return { success: true };
    });
    state.project.revision = 7;
    const result = await handler({ sender }, { action: 'previewViewer', sessionId: state.sessionId, project: state.project, operationId: 'preview-ipc', filePath: '/ignored.epub' });
    assert.deepEqual(result, { ok: true, revision: 7 });
    assert.notEqual(opened, '/ignored.epub');
    await handler({ sender }, { action: 'close', sessionId: state.sessionId });
    assert.ok((await fs.stat(opened)).isFile());
    await release();
    await assert.rejects(fs.stat(opened), { code: 'ENOENT' });
});

test('viewer open failure and a missing viewer hook return errors and remove generated files', async t => {
    let opened;
    const { handler, sender, state } = await ipcFixture(t, async filePath => { opened = filePath; return { success: false }; });
    const result = await handler({ sender }, { action: 'previewViewer', sessionId: state.sessionId, project: state.project, operationId: 'failed' });
    assert.equal(result.error.code, 'VIEWER_OPEN_FAILED');
    await assert.rejects(fs.stat(opened), { code: 'ENOENT' });
    const missing = await ipcFixture(t);
    assert.equal((await missing.handler({ sender: missing.sender }, { action: 'previewViewer' })).error.code, 'VIEWER_UNAVAILABLE');
});

async function viewerHarness() {
    const handlers = new Map();
    const windows = [];
    const records = [];
    class FakeWindow extends EventEmitter {
        constructor() {
            super();
            this.webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, isLoadingMainFrame: () => false, send: () => {} });
            windows.push(this);
        }
        static fromWebContents(sender) { return windows.find(window => window.webContents === sender); }
        isDestroyed() { return !!this.destroyed; }
        isMinimized() { return false; }
        isMaximized() { return false; }
        getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 860 }; }
        setTitle(title) { this.title = title; }
        setMenu() {}
        loadFile() {}
        show() {}
        focus() {}
        close() { this.emit('close', { defaultPrevented: false }); this.destroyed = true; this.emit('closed'); }
    }
    const source = (await fs.readFile(new URL('./viewerWindow.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\n/gm, '').replace('export function setupViewerWindowManager', 'function setupViewerWindowManager');
    const setup = vm.runInNewContext(`${source}\nsetupViewerWindowManager`, {
        path, console, process, AbortController, setTimeout, clearTimeout,
        ViewerSessionManager, createCoverEditViewerGuard, BrowserWindow: FakeWindow, installEditorMediaHeaders: () => {},
        protocol: { handle: () => {} }, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: () => {} },
        screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
        LibraryDB: class { async upsertReadingState(filePath) { records.push(filePath); } },
    });
    return { manager: setup({ getLibraryDbPath: () => 'test-db' }), handlers, windows, records };
}

test('the actual viewer manager reuses its reader window, releases previews on replacement/close and skips reading history', async t => {
    const { service, state } = await fixture(t);
    const { manager, handlers, windows, records } = await viewerHarness();
    const first = await service.preview(1, state.sessionId, state.project, 'one');
    const second = await service.preview(1, state.sessionId, state.project, 'two');
    let firstRelease;
    let secondRelease;
    const firstOpened = await manager.openPreview(first.filePath, () => firstRelease = service.releasePreview(first.filePath));
    assert.equal(firstOpened.session.preview, true);
    assert.equal(firstOpened.session.adjacent.hasNext, false);
    const event = { sender: manager.getWindow().webContents };
    assert.equal(await handlers.get('viewer:saveReadingState')(event, firstOpened.session.id, { pageIndex: 1 }), null);
    assert.equal(await handlers.get('viewer:getReadiveReadingState')(event, firstOpened.session.id), null);
    const book = await handlers.get('viewer:getEpubText')(event, firstOpened.session.id);
    assert.ok(book.chapters.some(chapter => chapter.text.includes('저장하지 않은 본문')));
    await manager.openPreview(second.filePath, () => secondRelease = service.releasePreview(second.filePath));
    assert.equal(windows.length, 1);
    await firstRelease;
    await assert.rejects(fs.stat(first.filePath), { code: 'ENOENT' });
    manager.getWindow().close();
    await Promise.resolve();
    await secondRelease;
    await assert.rejects(fs.stat(second.filePath), { code: 'ENOENT' });
    assert.equal(records.length, 0);
});

test('opening a normal book releases the preview while retaining normal reader history behavior', async t => {
    const { root, service, state } = await fixture(t);
    const { manager, records } = await viewerHarness();
    const preview = await service.preview(1, state.sessionId, state.project, 'preview');
    let cleanup;
    await manager.openPreview(preview.filePath, () => cleanup = service.releasePreview(preview.filePath));
    const exported = path.join(root, 'ordinary.epub');
    await service.write(1, state.sessionId, state.project, exported, 'export', 'export');
    const opened = await manager.openViewer(exported);
    assert.equal(opened.session.preview, undefined);
    await cleanup;
    await assert.rejects(fs.stat(preview.filePath), { code: 'ENOENT' });
    assert.deepEqual(records, [exported]);
    manager.getWindow().close();
});
