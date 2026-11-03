import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ViewerSessionManager } from './viewerSessions.js';
import { viewerComicPageCache, viewerComicQueue } from './viewerComicQueue.js';

async function until(predicate) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
        if (predicate()) return;
        await delay(10);
    }
    assert.fail('Timed out waiting for the comic worker.');
}

function workerFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-comic-resource-'));
    const logPath = path.join(root, 'events.jsonl');
    const executable = path.join(root, 'fake7z.cjs');
    const managers = [];
    fs.writeFileSync(logPath, '');
    fs.writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const archive = process.argv[process.argv.length - 1];
const page = process.argv.find(value => value.startsWith('-i!')) || '';
const log = type => fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ type, pid: process.pid, archive, page }) + '\\n');
log('start');
const timer = setTimeout(() => {
    process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 65), () => { log('finish'); });
}, page.includes('slow') ? 10000 : 40);
process.on('SIGTERM', () => {
    clearTimeout(timer);
    log('cancel');
    if (page.includes('ignore')) { setInterval(() => {}, 1000); return; }
    setTimeout(() => { log('finish'); process.exit(0); }, 60);
});
`, { mode: 0o700 });
    t.after(async () => {
        for (const manager of managers) {
            for (const sessionId of manager.sessions.keys()) manager.cancelComicSession(sessionId);
        }
        await until(() => viewerComicQueue.active === 0);
        fs.rmSync(root, { recursive: true, force: true });
    });
    const events = () => fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const manager = () => {
        const owner = new ViewerSessionManager({ getSevenZPath: async () => executable });
        managers.push(owner);
        return owner;
    };
    const session = (owner, name) => {
        const source = path.join(root, name);
        if (!fs.existsSync(source)) fs.writeFileSync(source, 'archive');
        return owner.create(source, { skipAdjacent: true });
    };
    return { root, executable, events, manager, session };
}

test('실제 자식 프로세스는 두 관리자에서도 전체 두 개, 압축 파일당 한 개만 실행된다', { skip: process.platform === 'win32' }, async t => {
    const fixture = workerFixture(t);
    const left = fixture.manager();
    const right = fixture.manager();
    const first = fixture.session(left, 'first.7z');
    const second = fixture.session(right, 'second.rar');
    const sameArchive = fixture.session(right, 'first.7z');
    const targets = [[left, first], [right, second], [right, sameArchive]];
    const lengths = await Promise.all(Array.from({ length: 24 }, (_, index) => {
        const [manager, session] = targets[index % targets.length];
        return manager.getComicPageData(session.id, `${index}.png`).then(page => page.buffer.length);
    }));
    assert.ok(lengths.every(length => length === 2 * 1024 * 1024));
    const active = new Map();
    let peak = 0;
    for (const event of fixture.events()) {
        if (event.type === 'start') {
            assert.ok(![...active.values()].includes(event.archive), 'Only one decoder may read an archive.');
            active.set(event.pid, event.archive);
            peak = Math.max(peak, active.size);
        } else if (event.type === 'finish') active.delete(event.pid);
    }
    assert.equal(peak, 2);
    assert.equal(active.size, 0);
    assert.equal(viewerComicQueue.requests.size, 0);
    assert.equal(viewerComicQueue.pending.length, 0);
    assert.equal(viewerComicPageCache.entries.size, 12);
    assert.equal(viewerComicPageCache.bytes, 24 * 1024 * 1024);
});

test('중복 페이지 요청을 합치고 마지막 요청과 세션을 취소하면 자식 프로세스도 종료한다', { skip: process.platform === 'win32' }, async t => {
    const fixture = workerFixture(t);
    const manager = fixture.manager();
    const session = fixture.session(manager, 'book.7z');
    const duplicate = await Promise.all(Array.from({ length: 8 }, () => manager.getComicPageData(session.id, 'same.png')));
    assert.ok(duplicate.every(page => page.buffer === duplicate[0].buffer));
    assert.equal(fixture.events().filter(event => event.type === 'start').length, 1);
    await manager.getComicPageData(session.id, 'same.png');
    assert.equal(fixture.events().filter(event => event.type === 'start').length, 1, 'Completed page reads reuse the bounded cache.');
    fs.appendFileSync(path.join(fixture.root, 'book.7z'), 'changed');
    await manager.getComicPageData(session.id, 'same.png');
    assert.equal(fixture.events().filter(event => event.type === 'start').length, 2, 'Changed archives invalidate cached bytes.');

    const controller = new AbortController();
    const request = manager.getComicPageDataFromRequest(`bookmanager-comic://session/${session.id}/slow.png`, { signal: controller.signal });
    const rejected = assert.rejects(request, { name: 'AbortError' });
    await until(() => fixture.events().some(event => event.type === 'start' && event.page.includes('slow.png')));
    controller.abort();
    await rejected;
    await until(() => viewerComicQueue.active === 0);
    assert.ok(fixture.events().some(event => event.type === 'cancel'));

    const running = manager.getComicPageData(session.id, 'slow-again.png');
    const queued = manager.getComicPageData(session.id, 'never.png');
    const settled = Promise.allSettled([running, queued]);
    await until(() => fixture.events().some(event => event.type === 'start' && event.page.includes('slow-again.png')));
    manager.cancelComicSession(session.id);
    assert.ok((await settled).every(result => result.reason.name === 'AbortError'));
    await until(() => viewerComicQueue.active === 0);
    assert.ok(!fixture.events().some(event => event.page.includes('never.png')));
    await assert.rejects(manager.getComicPageData(session.id, 'late.png'), { name: 'AbortError' });
    assert.equal(viewerComicQueue.requests.size, 0);
    const oldGroup = manager.comicRequestGroups.get(session.id);
    manager.activateComicSession(session.id);
    assert.notEqual(manager.comicRequestGroups.get(session.id), oldGroup);
    assert.equal((await manager.getComicPageData(session.id, 'reloaded.png')).buffer.length, 2 * 1024 * 1024);
    assert.ok(fixture.events().some(event => event.type === 'start' && event.page.includes('reloaded.png')));
});

test('정상 종료 신호를 무시하는 압축 해제 프로세스도 취소 후 강제 종료된다', { skip: process.platform === 'win32' }, async t => {
    const fixture = workerFixture(t);
    const manager = fixture.manager();
    const session = fixture.session(manager, 'book.7z');
    const request = manager.getComicPageData(session.id, 'slow-ignore.png');
    const rejected = assert.rejects(request, { name: 'AbortError' });
    await until(() => fixture.events().some(event => event.type === 'start'));
    manager.cancelComicSession(session.id);
    await rejected;
    await until(() => viewerComicQueue.active === 0);
    assert.ok(fixture.events().some(event => event.type === 'cancel'));
    assert.equal(viewerComicQueue.requests.size, 0);
});

test('개별 렌더러 소비자를 취소해도 같은 페이지의 다른 소비자는 유지한다', { skip: process.platform === 'win32' }, async t => {
    const fixture = workerFixture(t);
    const manager = fixture.manager();
    const session = fixture.session(manager, 'book.7z');
    const url = `bookmanager-comic://session/${session.id}/slow.png`;
    const first = manager.getComicPageDataFromRequest(`${url}?requestId=first`);
    const second = manager.getComicPageDataFromRequest(`${url}?requestId=second`);
    const firstRejected = assert.rejects(first, { name: 'AbortError' });
    const secondRejected = assert.rejects(second, { name: 'AbortError' });
    await until(() => fixture.events().some(event => event.type === 'start'));
    manager.cancelComicPageRequest(session.id, 'first');
    await firstRejected;
    await delay(100);
    assert.equal(fixture.events().filter(event => event.type === 'start').length, 1);
    assert.ok(!fixture.events().some(event => event.type === 'cancel'));
    assert.equal(manager.comicRequestGroups.get(session.id).consumers.size, 1);
    manager.cancelComicPageRequest(session.id, 'second');
    await secondRejected;
    await until(() => viewerComicQueue.active === 0);
    assert.ok(fixture.events().some(event => event.type === 'cancel'));
    assert.equal(manager.comicRequestGroups.get(session.id).consumers.size, 0);
});

test('프로토콜보다 먼저 온 취소를 기억하고 취소 ID와 세션 상태를 제한한다', async () => {
    const manager = new ViewerSessionManager();
    const session = manager.create('/mock/book.7z', { skipExistenceCheck: true, skipAdjacent: true });
    manager.readComicPageData = () => assert.fail('Cancelled requests must not start extraction.');
    manager.cancelComicPageRequest(session.id, 'before-request');
    await assert.rejects(manager.getComicPageDataFromRequest(`bookmanager-comic://session/${session.id}/001.png?requestId=before-request`), { name: 'AbortError' });
    for (let index = 0; index < 2000; index += 1) manager.cancelComicPageRequest(session.id, `cancelled-${index}`);
    const group = manager.comicRequestGroups.get(session.id);
    assert.equal(group.cancelledRequestIds.size, 1024);
    assert.ok(group.cancelledRequestIds.has('cancelled-1999'));
    assert.equal(manager.cancelComicPageRequest(session.id, 'x'.repeat(201)), false);
    manager.cancelComicSession(session.id);
    assert.equal(group.cancelledRequestIds.size, 0);
    assert.equal(group.consumers.size, 0);
});

test('만화 요청 취소 IPC는 페이지 읽기와 같은 뷰어 소유권을 검사한다', async () => {
    const source = fs.readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8');
    const start = source.indexOf("ipcMain.handle('viewer:cancelComicPageRequest'");
    const end = source.indexOf("ipcMain.handle('viewer:getDocumentData'", start);
    let handler;
    let cancelled = false;
    const install = new Function('ipcMain', 'viewerContextForSessionRequest', 'sessions', source.slice(start, end));
    install({ handle: (_channel, callback) => { handler = callback; } }, event => {
        if (!event.allowed) throw new Error('Viewer session does not belong to this window.');
    }, { cancelComicPageRequest: (sessionId, requestId) => { cancelled = true; return `${sessionId}:${requestId}`; } });
    await assert.rejects(handler({ allowed: false }, 'session', 'request'), /does not belong/);
    assert.equal(cancelled, false);
    assert.equal(await handler({ allowed: true }, 'session', 'request'), 'session:request');
});

test('실제 Electron 이미지 제거 후 명시적 IPC 취소가 압축 해제 프로세스를 종료한다', { timeout: 30000 }, async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || process.platform === 'win32' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display and a POSIX worker fixture.');
        return;
    }
    const fixture = workerFixture(t);
    const source = path.join(fixture.root, 'book.7z');
    fs.writeFileSync(source, 'archive');
    const entry = path.join(fixture.root, 'main.cjs');
    fs.writeFileSync(entry, `
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(path.join(fixture.root, 'profile'))});
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-comic', privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }]);
let manager;
let session;
app.whenReady().then(async () => {
    const { ViewerSessionManager } = await import(${JSON.stringify(new URL('./viewerSessions.js', import.meta.url).href)});
    const { viewerComicQueue } = await import(${JSON.stringify(new URL('./viewerComicQueue.js', import.meta.url).href)});
    manager = new ViewerSessionManager({ getSevenZPath: async () => ${JSON.stringify(fixture.executable)} });
    session = manager.create(${JSON.stringify(source)}, { skipAdjacent: true });
    let nativeAborts = 0;
    protocol.handle('bookmanager-comic', async request => {
        request.signal.addEventListener('abort', () => { nativeAborts += 1; });
        try {
            const page = await manager.getComicPageDataFromRequest(request.url, { signal: request.signal });
            return new Response(page.buffer, { headers: { 'Content-Type': page.mime, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
        } catch { return new Response('', { status: 404 }); }
    });
    ipcMain.handle('viewer:cancelComicPageRequest', (_event, id, requestId) => manager.cancelComicPageRequest(id, requestId));
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(fileURLToPath(new URL('./viewerPreload.cjs', import.meta.url)))} } });
    await window.loadURL('data:text/html,<body>comic cancellation fixture</body>');
    const events = () => fs.readFileSync(${JSON.stringify(path.join(fixture.root, 'events.jsonl'))}, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
    const waitFor = async predicate => {
        for (let attempt = 0; attempt < 400; attempt += 1) {
            if (predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error('Worker did not settle.');
    };
    const url = 'bookmanager-comic://session/' + session.id + '/slow.png?requestId=active';
    await window.webContents.executeJavaScript('window.fixtureImage = new Image(); fixtureImage.src = ' + JSON.stringify(url) + '; document.body.append(fixtureImage);');
    await waitFor(() => events().some(event => event.type === 'start'));
    await window.webContents.executeJavaScript('fixtureImage.removeAttribute("src"); window.viewerAPI.cancelComicPageRequest(' + JSON.stringify(session.id) + ', "active")');
    await waitFor(() => viewerComicQueue.active === 0);
    assert.ok(events().some(event => event.type === 'cancel'));
    assert.equal(manager.comicRequestGroups.get(session.id).consumers.size, 0);
    await window.webContents.executeJavaScript('window.viewerAPI.cancelComicPageRequest(' + JSON.stringify(session.id) + ', "before")');
    await window.webContents.executeJavaScript('fixtureImage.src = ' + JSON.stringify(url.replace('requestId=active', 'requestId=before')));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(events().filter(event => event.type === 'start').length, 1);
    console.log('COMIC_CANCEL_RESULT=' + JSON.stringify({ nativeAborts, explicitWorkerCancellation: true, cancelledBeforeStart: true }));
    manager.cancelComicSession(session.id);
    app.exit(0);
}).catch(error => { console.error(error); manager?.cancelComicSession(session?.id); setTimeout(() => app.exit(1), 1000); });
`);
    const require = createRequire(import.meta.url);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron cancellation fixture timed out: ${output}`)); }, 20000);
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    const report = JSON.parse(result.output.match(/COMIC_CANCEL_RESULT=(.+)/)[1]);
    assert.equal(report.explicitWorkerCancellation, true);
    assert.equal(report.cancelledBeforeStart, true);
    t.diagnostic(JSON.stringify(report));
});

test('1GiB의 모의 페이지를 읽어도 이미지 캐시는 제한되고 세션 종료 후 해제된다', t => {
    const moduleUrl = new URL('./viewerSessions.js', import.meta.url).href;
    const queueUrl = new URL('./viewerComicQueue.js', import.meta.url).href;
    const script = `
        import assert from 'node:assert/strict';
        import { ViewerSessionManager } from ${JSON.stringify(moduleUrl)};
        import { viewerComicPageCache, viewerComicQueue } from ${JSON.stringify(queueUrl)};
        const manager = new ViewerSessionManager();
        const session = manager.create('/mock/book.7z', { skipExistenceCheck: true, skipAdjacent: true });
        const group = manager.comicRequestGroups.get(session.id);
        let peakCacheBytes = 0;
        manager.readComicPageData = async (_session, name) => {
            const page = { buffer: Buffer.alloc(8 * 1024 * 1024, 1) };
            viewerComicPageCache.set(name, group, 'mock-signature', page);
            peakCacheBytes = Math.max(peakCacheBytes, viewerComicPageCache.bytes);
            return page;
        };
        global.gc();
        const baseline = process.memoryUsage().arrayBuffers;
        const lengths = await Promise.all(Array.from({ length: 128 }, (_, index) =>
            manager.getComicPageData(session.id, index + '.png').then(page => page.buffer.length)));
        assert.ok(lengths.every(length => length === 8 * 1024 * 1024));
        assert.equal(viewerComicPageCache.entries.size, 8);
        assert.equal(peakCacheBytes, 64 * 1024 * 1024);
        manager.cancelComicSession(session.id);
        assert.equal(viewerComicPageCache.bytes, 0);
        await new Promise(resolve => setImmediate(resolve));
        global.gc();
        global.gc();
        const retainedBytes = process.memoryUsage().arrayBuffers - baseline;
        assert.ok(retainedBytes < 16 * 1024 * 1024, 'Retained bytes: ' + retainedBytes);
        assert.equal(viewerComicQueue.requests.size, 0);
        assert.equal(viewerComicQueue.pending.length, 0);
        console.log(JSON.stringify({ processedBytes: 128 * 8 * 1024 * 1024, peakCacheBytes, retainedBytes }));
    `;
    const result = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const measured = JSON.parse(result.stdout);
    assert.equal(measured.processedBytes, 1024 * 1024 * 1024);
    t.diagnostic(JSON.stringify(measured));
});

test('만화 프로토콜은 취소 신호와 스트림 응답을 사용하고 이미지 HTTP 캐시를 남기지 않는다', async () => {
    const source = fs.readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8');
    const start = source.indexOf('function registerComicProtocol(sessions)');
    const end = source.indexOf('export function setupViewerWindowManager', start);
    let handler;
    const install = new Function('protocol', 'Readable', `let comicProtocolRegistered = false; ${source.slice(start, end)}; return registerComicProtocol;`);
    const controller = new AbortController();
    const bytes = Buffer.from('page');
    install({ handle: (_scheme, callback) => { handler = callback; } }, Readable)({
        getComicPageDataFromRequest: async (url, options) => {
            assert.equal(url, 'bookmanager-comic://session/test/page.png');
            assert.equal(options.signal, controller.signal);
            return { buffer: bytes, mime: 'image/png' };
        },
    });
    const response = await handler({ url: 'bookmanager-comic://session/test/page.png', signal: controller.signal });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('프로토콜의 미리읽기 우선순위는 같은 원본 페이지 요청으로 전달된다', async () => {
    const manager = new ViewerSessionManager();
    const controller = new AbortController();
    manager.getComicPageData = async (sessionId, entryName, options) => ({ sessionId, entryName, ...options });
    const background = await manager.getComicPageDataFromRequest('bookmanager-comic://session/test/chapter%2F001.png?priority=background', { signal: controller.signal });
    assert.equal(background.sessionId, 'test');
    assert.equal(background.entryName, 'chapter/001.png');
    assert.equal(background.priority, 1);
    assert.equal(background.signal, controller.signal);
    const foreground = await manager.getComicPageDataFromRequest('bookmanager-comic://session/test/chapter%2F001.png');
    assert.equal(foreground.priority, 0);
});
