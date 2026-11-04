import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { comicRequestAbortedError } from './viewerComicQueue.js';
import { loadViewerEpub } from '../src/loadViewerEpub.js';

test('메인 문서 새로고침은 이전 만화 요청을 취소하고 같은 세션을 다시 활성화한다', async t => {
    const source = await fs.readFile(new URL('./viewerWindow.js', import.meta.url), 'utf8');
    const section = (startText, endText) => {
        const start = source.indexOf(startText);
        const end = source.indexOf(endText, start);
        assert.ok(start >= 0 && end > start);
        return source.slice(start, end);
    };
    const sessions = new ViewerSessionManager();
    const currentSession = sessions.create('/reload-current.7z', { skipExistenceCheck: true, skipAdjacent: true });
    const pendingSession = sessions.create('/reload-pending.7z', { skipExistenceCheck: true, skipAdjacent: true });
    t.after(() => {
        sessions.cancelComicSession(currentSession.id);
        sessions.cancelComicSession(pendingSession.id);
    });
    const viewerWindow = { webContents: new EventEmitter() };
    const context = { window: viewerWindow, kind: 'reader', currentSession, pendingSession };
    const oldCurrentGroup = sessions.comicRequestGroups.get(currentSession.id);
    const oldPendingGroup = sessions.comicRequestGroups.get(pendingSession.id);
    const signals = [];
    const untilCancelled = signal => new Promise((resolve, reject) => {
        signals.push(signal);
        signal.addEventListener('abort', () => reject(comicRequestAbortedError()), { once: true });
    });
    const requests = [currentSession, pendingSession].map(session => (
        sessions.runComicRequest(session, 'active', untilCancelled).catch(error => error)
    ));
    let queuedStarted = false;
    requests.push(sessions.runComicRequest(currentSession, 'queued', () => { queuedStarted = true; }).catch(error => error));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signals.length, 2);

    new Function('viewerWindow', 'context', 'sessions', section(
        "viewerWindow.webContents.on('did-start-navigation'",
        "viewerWindow.webContents.on('did-finish-load'",
    ))(viewerWindow, context, sessions);
    const navigate = (isInPlace, isMainFrame) => viewerWindow.webContents.emit('did-start-navigation', {}, 'viewer.html', isInPlace, isMainFrame);
    navigate(false, false);
    navigate(true, true);
    context.window = {};
    navigate(false, true);
    context.window = viewerWindow;
    assert.equal(oldCurrentGroup.cancelled, false, '하위 프레임·동일 문서·이전 창의 이동은 현재 세션을 취소하지 않는다');
    assert.equal(oldPendingGroup.cancelled, false);
    assert.ok(signals.every(signal => !signal.aborted));

    navigate(false, true);
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(oldCurrentGroup.cancelled, true);
    assert.equal(oldPendingGroup.cancelled, true);
    assert.ok((await Promise.all(requests)).every(error => error.name === 'AbortError'));
    assert.equal(queuedStarted, false);

    let getCurrentSession;
    new Function('ipcMain', 'viewerContextForSender', 'sessions', section(
        "ipcMain.handle('viewer:getCurrentSession'",
        "ipcMain.handle('viewer:listComicPages'",
    ))({ handle: (_channel, handler) => { getCurrentSession = handler; } }, () => context, sessions);
    assert.equal(await getCurrentSession({ sender: viewerWindow.webContents }), currentSession);
    assert.notEqual(sessions.comicRequestGroups.get(currentSession.id), oldCurrentGroup);
    assert.equal(await sessions.runComicRequest(currentSession, 'reloaded', () => 'new page'), 'new page');

    const setContextSession = new Function('sessions', 'releasePreview', `${section(
        'const setContextSession =',
        'const mainAppWindow =',
    )} return setContextSession;`)(sessions, () => {});
    let sentSession;
    new Function('viewerWindow', 'context', 'sessions', 'setContextSession', 'sendSession', 'sendFullscreenState', 'console', section(
        "viewerWindow.webContents.on('did-finish-load'",
        "viewerWindow.on('enter-full-screen'",
    ))(viewerWindow, context, sessions, setContextSession, (_context, session) => { sentSession = session; }, () => {}, { info() {} });
    viewerWindow.webContents.emit('did-finish-load');
    assert.equal(context.currentSession, pendingSession);
    assert.equal(context.pendingSession, null);
    assert.equal(sentSession, pendingSession);
    assert.notEqual(sessions.comicRequestGroups.get(pendingSession.id), oldPendingGroup);
    assert.equal(await sessions.runComicRequest(pendingSession, 'loaded', () => 'pending page'), 'pending page');
});

test('정리된 세션의 늦은 만화 목록 응답은 고아 캐시를 만들지 않는다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-session-lifecycle-'));
    try {
        const source = path.join(root, 'book.cbz');
        await fs.writeFile(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('page'));
        let pendingSevenZip;
        const manager = new ViewerSessionManager({ getSevenZPath: () => pendingSevenZip });
        for (let batch = 0; batch < 3; batch += 1) {
            let release;
            pendingSevenZip = new Promise(resolve => { release = resolve; });
            const requests = [];
            for (let index = 0; index < 40; index += 1) {
                const session = manager.create(source, { skipAdjacent: true });
                requests.push(manager.listComicPages(session.id));
            }
            release('');
            const results = await Promise.allSettled(requests);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 16);
            assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.name === 'AbortError'));
            assert.equal(manager.sessions.size, 16);
            assert.equal(manager.comicArchiveEntryCaches.size, 16);
            assert.ok([...manager.comicArchiveEntryCaches.keys()].every(id => manager.sessions.has(id)));
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('EPUB 장과 이미지의 읽기는 ZIP 목록을 재사용하고 취소 후 중단한다', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-lifecycle-'));
    const originalOpen = fs.open;
    try {
        const source = path.join(root, 'book.epub');
        await fs.writeFile(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'style.css', 'p { color: #123456; }');
        for (let index = 1; index <= 3; index += 1) {
            await replaceZipEntry(source, `chapter${index}.html`, `<html><head><link rel="stylesheet" href="style.css" /></head><body><p>Chapter ${index}</p><img src="image1.png" /></body></html>`);
        }
        for (let index = 1; index <= 2; index += 1) {
            const png = Buffer.alloc(24);
            png[0] = 0x89;
            png.write('PNG', 1, 'ascii');
            png.write('IHDR', 12, 'ascii');
            png.writeUInt32BE(1200, 16);
            png.writeUInt32BE(1800, 20);
            await replaceZipEntry(source, `image${index}.png`, png);
        }
        const manager = new ViewerSessionManager();
        const session = manager.create(source, { skipAdjacent: true });
        let openCount = 0;
        let controller;
        fs.open = async (...args) => {
            if (args[0] === source) {
                openCount += 1;
                if (controller && openCount === 3) controller.abort();
            }
            return originalOpen(...args);
        };
        const result = await manager.getEpubText(session.id);
        assert.deepEqual(result.chapters.map(chapter => chapter.text), ['Chapter 1', 'Chapter 2', 'Chapter 3']);
        assert.equal(openCount, 8, '목록 1회, 이미지 2회, CSS 2회, 본문 3회만 연다');
        openCount = 0;
        controller = new AbortController();
        await assert.rejects(manager.getEpubText(session.id, { signal: controller.signal }), { name: 'AbortError' });
        assert.equal(openCount, 3, '취소한 뒤 다음 이미지와 본문을 읽지 않는다');
    } finally {
        fs.open = originalOpen;
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('EPUB 워커 전송은 긴 장의 최적화 블록, 원본 문서와 공유 자산을 복원하며 교체된 요청을 취소한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-packed-epub-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'large.epub');
    await fs.writeFile(source, Buffer.alloc(0));
    await replaceZipEntry(source, 'one.xhtml', '<html><body><h1>중간 제목</h1>'
        + Array.from({ length: 1200 }, (_, index) => `<p id="p${index}">문단 ${index} ${'가나다 '.repeat(16)}</p>`).join('')
        + '<img src="cover.png"></body></html>');
    await replaceZipEntry(source, 'two.xhtml', '<html><body><p>마지막 장</p></body></html>');
    await replaceZipEntry(source, 'cover.png', Buffer.from('fixture'));
    const manager = new ViewerSessionManager();
    const session = manager.create(source, { skipAdjacent: true });
    const direct = await manager.getEpubText(session.id);
    const actual = await loadViewerEpub({
        getEpubText: async (id, packed) => {
            const result = await manager.getEpubText(id, { packed });
            assert.ok(result.chapterPackets.length > 1);
            return result;
        },
    }, session.id, () => true);
    assert.deepEqual(actual, JSON.parse(JSON.stringify(direct)));
    assert.equal(actual.chapters[0].original.resourceUrls, actual.chapters[1].original.resourceUrls);
    const controller = new AbortController();
    const loading = manager.getEpubText(session.id, { packed: true, signal: controller.signal });
    controller.abort();
    await assert.rejects(loading, { name: 'AbortError' });
});
