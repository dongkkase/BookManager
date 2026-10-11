import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { downloadCoverImage, isPublicCoverImageAddress, parseCoverImageUrl, selectGoogleCoverImage } from './coverImageSearch.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function responses(entries, captured = []) {
    return (url, options, callback) => {
        const request = new EventEmitter();
        request.end = () => {
            captured.push({ url: url.href, options });
            const entry = entries.shift();
            assert.ok(entry, 'Unexpected request');
            const abort = () => request.emit('error', options.signal.reason);
            options.signal.addEventListener('abort', abort, { once: true });
            queueMicrotask(() => {
                if (entry.hang) return;
                const response = new PassThrough();
                response.statusCode = entry.status || 200;
                response.headers = entry.headers || {};
                response.once('close', () => options.signal.removeEventListener('abort', abort));
                callback(response);
                for (const chunk of entry.chunks || [entry.buffer || PNG]) response.write(chunk);
                response.end();
            });
        };
        return request;
    };
}

async function downloadFixture(t, entries, overrides = {}) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-search-test-'));
    t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
    const captured = [];
    return {
        tempRoot,
        captured,
        options: {
            tempRoot,
            lookup: publicLookup,
            request: responses(entries, captured),
            loadImage: async imagePath => ({ imagePath, buffer: await fs.readFile(imagePath), width: 1, height: 1 }),
            ...overrides,
        },
    };
}

test('이미지 다운로드 주소에서 로컬 네트워크·자격 증명·특수 스킴을 거부한다', () => {
    for (const url of [
        'file:///tmp/cover.png', 'data:image/png;base64,aGVsbG8=', 'https://user:password@example.com/a',
        'http://localhost/a', 'http://printer.local/a', 'http://router/a', 'http://127.0.0.1/a',
        'http://2130706433/a', 'http://0x7f000001/a', 'http://10.0.0.1/a', 'http://169.254.169.254/a',
        'http://192.168.0.1/a', 'http://100.64.1.2/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a',
        'http://[fe80::1]/a', 'http://[fc00::1]/a', 'https://example.com:8443/a',
    ]) assert.throws(() => parseCoverImageUrl(url), undefined, url);
    assert.equal(parseCoverImageUrl('https://images.example.com/cover.png').protocol, 'https:');
    assert.equal(isPublicCoverImageAddress('8.8.8.8'), true);
    assert.equal(isPublicCoverImageAddress('2606:4700:4700::1111'), true);
    assert.equal(isPublicCoverImageAddress('2002:7f00:1::'), false);
    assert.equal(isPublicCoverImageAddress('2001:db8::1'), false);
});

test('리디렉션 이미지의 실제 형식을 확인하고 검증한 DNS 주소에 연결한다', async t => {
    const { options, captured } = await downloadFixture(t, [
        { status: 302, headers: { location: 'https://cdn.example.com/image?format=png' } },
        { buffer: PNG, headers: { 'content-type': 'application/octet-stream' } },
    ]);
    const image = await downloadCoverImage('https://images.example.com/start', options);
    assert.equal(image.sourceUrl, 'https://cdn.example.com/image?format=png');
    assert.equal(path.extname(image.imagePath), '.png');
    assert.equal(path.dirname(image.imagePath), image.cleanupDirectory);
    assert.deepEqual(image.buffer, PNG);
    assert.equal(captured.length, 2);
    await new Promise((resolve, reject) => {
        captured[0].options.lookup('images.example.com', {}, (error, address, family) => {
            if (error) return reject(error);
            assert.equal(address, '93.184.216.34');
            assert.equal(family, 4);
            resolve();
        });
    });
    assert.equal(captured[0].options.headers.Cookie, undefined);
    assert.equal(captured[0].options.headers.Authorization, undefined);
});

test('공개 도메인의 DNS가 로컬 주소를 포함하면 다운로드하지 않는다', async t => {
    const { options, captured } = await downloadFixture(t, [], {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.2', family: 4 }],
    });
    await assert.rejects(downloadCoverImage('https://images.example.com/a', options), /public server/);
    assert.equal(captured.length, 0);
});

test('리디렉션 대상의 로컬 주소와 변경된 DNS를 다시 검사한다', async t => {
    const direct = await downloadFixture(t, [{ status: 302, headers: { location: 'http://127.0.0.1/private' } }]);
    await assert.rejects(downloadCoverImage('https://images.example.com/a', direct.options), /public HTTP/);
    assert.equal(direct.captured.length, 1);
    const rebound = await downloadFixture(t, [{ status: 302, headers: { location: 'https://internal.example.com/a' } }], {
        lookup: async hostname => hostname === 'internal.example.com'
            ? [{ address: '10.1.2.3', family: 4 }] : publicLookup(),
    });
    await assert.rejects(downloadCoverImage('https://images.example.com/a', rebound.options), /public server/);
    assert.equal(rebound.captured.length, 1);
});

test('헤더 또는 수신 데이터가 제한을 넘으면 이미지 파일을 남기지 않는다', async t => {
    for (const entry of [
        { headers: { 'content-length': '100' } },
        { chunks: [PNG.subarray(0, 20), PNG.subarray(20)] },
    ]) {
        const { options, tempRoot } = await downloadFixture(t, [entry], { maxBytes: 32 });
        await assert.rejects(downloadCoverImage('https://images.example.com/a', options), { code: 'COVER_IMAGE_TOO_LARGE' });
        assert.deepEqual(await fs.readdir(tempRoot), []);
    }
});

test('HTTP 응답 중단 이벤트가 즉시 발생해도 용량 초과 오류를 유지한다', async t => {
    for (const headers of [{}, { 'content-length': '100' }]) {
        let aborted = false;
        const { options, tempRoot } = await downloadFixture(t, [], {
            maxBytes: 32,
            request: (_url, _options, callback) => {
                const request = new EventEmitter();
                request.end = () => queueMicrotask(() => {
                    const response = new IncomingMessage(new Socket());
                    response.statusCode = 200;
                    response.headers = headers;
                    response.once('aborted', () => { aborted = true; });
                    callback(response);
                    response.push(PNG.subarray(0, 20));
                    response.push(PNG.subarray(20));
                    response.push(null);
                });
                return request;
            },
        });
        await assert.rejects(downloadCoverImage('https://images.example.com/a', options), { code: 'COVER_IMAGE_TOO_LARGE' });
        assert.equal(aborted, true);
        assert.deepEqual(await fs.readdir(tempRoot), []);
    }
});

test('이미지를 가장한 HTML과 지원하지 않는 형식을 거부한다', async t => {
    const { options, tempRoot } = await downloadFixture(t, [{ buffer: Buffer.from('<html>not an image</html>'), headers: { 'content-type': 'image/png' } }]);
    await assert.rejects(downloadCoverImage('https://images.example.com/a', options), { code: 'COVER_IMAGE_UNSUPPORTED_FORMAT' });
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('기존 이미지 검증이 실패하면 만들어 둔 임시 폴더를 정리한다', async t => {
    const { options, tempRoot } = await downloadFixture(t, [{ buffer: PNG }], {
        loadImage: async () => { throw new Error('Invalid decoded image'); },
    });
    await assert.rejects(downloadCoverImage('https://images.example.com/a', options), /Invalid decoded/);
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

test('반복 리디렉션과 응답 없는 서버를 제한한다', async t => {
    const redirects = await downloadFixture(t, Array.from({ length: 6 }, () => ({ status: 302, headers: { location: '/again' } })));
    await assert.rejects(downloadCoverImage('https://images.example.com/a', redirects.options), /redirected too many/);
    const timeout = await downloadFixture(t, [{ hang: true }], { timeoutMs: 10 });
    await assert.rejects(downloadCoverImage('https://images.example.com/a', timeout.options), /timed out/);
    assert.deepEqual(await fs.readdir(timeout.tempRoot), []);
});

test('응답하지 않는 DNS 조회도 제한 시간 안에 취소한다', async t => {
    const { options } = await downloadFixture(t, [], { lookup: () => new Promise(() => {}), timeoutMs: 10 });
    await assert.rejects(downloadCoverImage('https://images.example.com/a', options), /timed out/);
});

test('이미지 검증 도중 취소하면 임시 파일을 제거하고 결과를 반환하지 않는다', async t => {
    const controller = new AbortController();
    let release;
    let started;
    const loading = new Promise(resolve => { started = resolve; });
    const { options, tempRoot } = await downloadFixture(t, [{ buffer: PNG }], {
        signal: controller.signal,
        loadImage: imagePath => {
            started();
            return new Promise(resolve => { release = () => resolve({ imagePath }); });
        },
    });
    const download = downloadCoverImage('https://images.example.com/a', options);
    await loading;
    controller.abort(new Error('User cancelled'));
    release();
    await assert.rejects(download, /User cancelled/);
    assert.deepEqual(await fs.readdir(tempRoot), []);
});

function electronFixture(options = {}) {
    const state = { windows: [], menu: null, errors: [], sessions: new Map(), storageClears: 0, storageFlushes: 0, cookieFlushes: 0 };
    class Window extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.destroyed = false;
            this.webContents = new EventEmitter();
            let session = state.sessions.get(options.webPreferences.partition);
            if (!session) {
                session = new EventEmitter();
                session.setPermissionRequestHandler = handler => { state.requestPermission = handler; };
                session.setPermissionCheckHandler = handler => { state.checkPermission = handler; };
                session.clearStorageData = async () => { state.storageClears += 1; };
                session.flushStorageData = () => { state.storageFlushes += 1; };
                session.cookies = { flushStore: async () => { state.cookieFlushes += 1; } };
                state.sessions.set(options.webPreferences.partition, session);
            }
            this.webContents.session = session;
            this.webContents.setWindowOpenHandler = handler => { state.openWindow = handler; };
            this.webContents.getUserAgent = () => 'test-user-agent';
            this.webContents.isLoadingMainFrame = () => Boolean(state.loadingMainFrame);
            state.windows.push(this);
        }
        setMenu() {}
        setTitle(title) { this.title = title; }
        isDestroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; this.emit('closed'); }
        async loadURL(url) {
            this.url = url;
            if (options.loadURL) return options.loadURL(this, url);
            this.webContents.emit('did-finish-load');
        }
    }
    state.electron = {
        BrowserWindow: Window,
        Menu: { buildFromTemplate: template => ({ popup: () => { state.menu = template; } }) },
        dialog: { showMessageBox: async (_window, message) => { state.errors.push(message); } },
    };
    return state;
}

test('검색 창은 원격 이미지 페이지를 격리하고 권한·팝업·외부 탐색을 차단한다', async () => {
    const state = electronFixture();
    const promise = selectGoogleCoverImage({ query: '책 이름 커버', electron: state.electron });
    const window = state.windows[0];
    assert.equal(new URL(window.url).searchParams.get('q'), '책 이름 커버');
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.preload, undefined);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.webSecurity, true);
    assert.equal(window.options.webPreferences.partition, 'persist:cover-image-search');
    assert.deepEqual(state.openWindow({ url: 'https://example.com' }), { action: 'deny' });
    assert.equal(state.checkPermission(), false);
    state.requestPermission(null, 'clipboard-read', allowed => assert.equal(allowed, false));
    for (const url of ['file:///tmp/test', 'https://example.com', 'http://www.google.com', 'https://google.com.example.com']) {
        let prevented = false;
        window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, url);
        assert.equal(prevented, true, url);
    }
    let prevented = false;
    window.webContents.emit('will-redirect', { preventDefault: () => { prevented = true; } }, 'https://consent.google.com/');
    assert.equal(prevented, false);
    window.destroy();
    assert.deepEqual(await promise, { cancelled: true });
});

test('한글 검색어를 NFC로 정규화하고 현재 Google 이미지 검색 주소를 연다', async () => {
    const state = electronFixture();
    const promise = selectGoogleCoverImage({ query: '  마귀 001화'.normalize('NFD'), electron: state.electron });
    const url = new URL(state.windows[0].url);
    assert.equal(url.searchParams.get('q'), '마귀 001화');
    assert.equal(url.searchParams.get('udm'), '2');
    assert.equal(url.searchParams.get('imgsz'), 'l');
    assert.equal(url.searchParams.has('tbm'), false);
    state.windows[0].destroy();
    assert.deepEqual(await promise, { cancelled: true });
});

test('검색을 닫거나 취소해도 같은 전용 세션을 다시 사용하고 저장 정보를 지우지 않는다', async () => {
    const state = electronFixture();
    const first = selectGoogleCoverImage({ query: 'first book', electron: state.electron });
    const firstWindow = state.windows[0];
    const session = firstWindow.webContents.session;
    assert.equal(session.listenerCount('will-download'), 1);
    firstWindow.destroy();
    assert.deepEqual(await first, { cancelled: true });
    assert.equal(session.listenerCount('will-download'), 0);
    const controller = new AbortController();
    const second = selectGoogleCoverImage({ query: 'second book', electron: state.electron, signal: controller.signal });
    assert.equal(state.windows[1].webContents.session, session);
    assert.equal(session.listenerCount('will-download'), 1);
    controller.abort();
    assert.deepEqual(await second, { cancelled: true });
    assert.equal(session.listenerCount('will-download'), 0);
    assert.equal(state.sessions.size, 1);
    assert.equal(state.storageClears, 0);
    assert.equal(state.storageFlushes, 2);
    assert.equal(state.cookieFlushes, 2);
});

test('세션 쿠키 쓰기가 실패해도 검색 취소를 완료한다', async () => {
    const state = electronFixture();
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron });
    const window = state.windows[0];
    window.webContents.session.cookies.flushStore = async () => { throw new Error('Disk unavailable'); };
    window.destroy();
    assert.deepEqual(await promise, { cancelled: true });
    assert.equal(state.storageClears, 0);
});

test('Google 검색 갱신 주소를 Electron의 details 및 레거시 탐색 이벤트에서 허용한다', async () => {
    const state = electronFixture();
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron });
    const window = state.windows[0];
    const redirectedUrl = 'https://www.google.com/search?q=%E1%84%86%E1%85%A1%E1%84%80%E1%85%B1+001%E1%84%92%E1%85%AA&hl=ko&udm=2&sei=AhPKaqHJZLrDj2ruoP17u-sQ';
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
        for (const shape of ['details', 'legacy', 'both']) {
            let prevented = false;
            const event = { preventDefault: () => { prevented = true; } };
            if (shape !== 'legacy') Object.assign(event, { url: redirectedUrl, isMainFrame: true });
            window.webContents.emit(eventName, event, shape !== 'details' ? redirectedUrl : undefined);
            assert.equal(prevented, false, `${eventName}: ${shape}`);
        }
        let prevented = false;
        window.webContents.emit(eventName, { url: 'https://google.com.example.com/', preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true, eventName);
    }
    window.destroy();
    assert.deepEqual(await promise, { cancelled: true });
});

test('초기 검색의 ERR_ABORTED 뒤 Google의 교체 탐색이 끝나면 이미지를 선택할 수 있다', async () => {
    const state = electronFixture({
        loadURL: async window => {
            const url = 'https://www.google.com/search?udm=2&q=book&hl=ko&sei=redirect';
            window.webContents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false });
            throw Object.assign(new Error(`ERR_ABORTED (-3) loading '${url}'`), { code: 'ERR_ABORTED', errno: -3 });
        },
    });
    const expected = { imagePath: '/temporary/cover.png', cleanupDirectory: '/temporary' };
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron, downloadImage: async () => expected });
    await new Promise(resolve => setImmediate(resolve));
    const window = state.windows[0];
    assert.equal(window.destroyed, false);
    window.webContents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', window.url, true);
    window.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', window.url, true);
    window.webContents.emit('did-finish-load');
    window.webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'https://images.example.com/cover.png' });
    await state.menu[0].click();
    assert.deepEqual(await promise, expected);
});

test('초기 검색 및 교체 탐색의 실제 네트워크 오류는 주소 없는 안내로 반환한다', async () => {
    const privateUrl = 'https://www.google.com/search?udm=2&q=private-title&sei=token';
    const initial = electronFixture({
        loadURL: async () => { throw Object.assign(new Error(`ERR_NAME_NOT_RESOLVED loading '${privateUrl}'`), { code: 'ERR_NAME_NOT_RESOLVED', errno: -105 }); },
    });
    await assert.rejects(selectGoogleCoverImage({ query: 'book', electron: initial.electron }), error => {
        assert.equal(error.code, 'COVER_SEARCH_LOAD_FAILED');
        assert.match(error.message, /인터넷 연결/);
        assert.doesNotMatch(error.message, /https:|private-title|token/);
        return true;
    });
    assert.equal(initial.windows[0].destroyed, true);
    const replacement = electronFixture({ loadURL: async () => { throw Object.assign(new Error('ERR_ABORTED'), { errno: -3 }); } });
    const promise = selectGoogleCoverImage({ query: 'book', electron: replacement.electron, language: 'en' });
    const rejected = assert.rejects(promise, { code: 'COVER_SEARCH_LOAD_FAILED', message: 'Could not load Google Images. Check your internet connection and try again.' });
    await new Promise(resolve => setImmediate(resolve));
    replacement.windows[0].webContents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', privateUrl, true);
    await rejected;
});

test('하위 프레임 오류는 검색을 닫지 않고 정상 로드 후에는 제한 시간을 해제한다', async () => {
    const state = electronFixture({ loadURL: async () => {} });
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron, searchTimeoutMs: 10 });
    const window = state.windows[0];
    window.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://accounts.google.com/', false);
    window.webContents.emit('did-finish-load');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(window.destroyed, false);
    window.destroy();
    assert.deepEqual(await promise, { cancelled: true });
});

test('중단 뒤 대체 검색이 끝나지 않으면 제한 시간 오류를 반환한다', async () => {
    const state = electronFixture({ loadURL: async () => { throw Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }); } });
    await assert.rejects(selectGoogleCoverImage({ query: 'book', electron: state.electron, searchTimeoutMs: 10 }), { code: 'COVER_SEARCH_TIMEOUT' });
    assert.equal(state.windows[0].destroyed, true);
});

test('이전 문서의 로드 완료가 진행 중인 교체 탐색의 제한 시간을 해제하지 않는다', async () => {
    const state = electronFixture({ loadURL: async () => { throw Object.assign(new Error('ERR_ABORTED'), { errno: -3 }); } });
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron, searchTimeoutMs: 10 });
    const rejected = assert.rejects(promise, { code: 'COVER_SEARCH_TIMEOUT' });
    state.loadingMainFrame = true;
    state.windows[0].webContents.emit('did-finish-load');
    await rejected;
});

test('초기 페이지가 로드되는 동안 창을 닫으면 뒤늦은 실패를 취소로 처리한다', async () => {
    let rejectLoad;
    const state = electronFixture({ loadURL: () => new Promise((_resolve, reject) => { rejectLoad = reject; }) });
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron });
    state.windows[0].destroy();
    rejectLoad(Object.assign(new Error('ERR_ABORTED'), { code: 'ERR_ABORTED' }));
    assert.deepEqual(await promise, { cancelled: true });
});

test('검색 결과의 큰 이미지 선택 결과를 반환하고 미리보기 data URL은 선택하지 않는다', async () => {
    const state = electronFixture();
    const expected = { imagePath: '/temporary/cover.png', cleanupDirectory: '/temporary', width: 100 };
    const promise = selectGoogleCoverImage({
        query: 'book cover', electron: state.electron,
        downloadImage: async (url, options) => {
            assert.equal(url, 'https://images.example.com/cover.png');
            assert.equal(options.userAgent, 'test-user-agent');
            return expected;
        },
    });
    const window = state.windows[0];
    window.webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'data:image/png;base64,example' });
    assert.equal(state.menu[0].enabled, false);
    window.webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'https://images.example.com/cover.png' });
    assert.equal(state.menu[0].enabled, true);
    await state.menu[0].click();
    assert.deepEqual(await promise, expected);
    assert.equal(window.destroyed, true);
    assert.equal(state.storageClears, 0);
    assert.equal(state.storageFlushes, 1);
    assert.equal(state.cookieFlushes, 1);
});

test('이미지 다운로드 실패 후 검색 창에서 다른 이미지를 고를 수 있다', async () => {
    const state = electronFixture();
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron, downloadImage: async () => { throw new Error('HTTP 403'); } });
    const window = state.windows[0];
    window.webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'https://images.example.com/cover.png' });
    await state.menu[0].click();
    assert.equal(state.errors.length, 1);
    assert.equal(window.destroyed, false);
    window.destroy();
    assert.deepEqual(await promise, { cancelled: true });
});

test('외부 취소 신호가 검색 창을 닫는다', async () => {
    const state = electronFixture();
    const controller = new AbortController();
    const promise = selectGoogleCoverImage({ query: 'book', electron: state.electron, signal: controller.signal });
    controller.abort();
    assert.deepEqual(await promise, { cancelled: true });
    assert.equal(state.windows[0].destroyed, true);
});

test('검색 창을 닫은 뒤 도착한 이미지 결과는 임시 파일을 정리한다', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-late-result-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const state = electronFixture();
    let release;
    const promise = selectGoogleCoverImage({
        query: 'book', electron: state.electron,
        downloadImage: () => new Promise(resolve => { release = () => resolve({ cleanupDirectory: directory }); }),
    });
    const window = state.windows[0];
    window.webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'https://images.example.com/cover.png' });
    const selecting = state.menu[0].click();
    window.destroy();
    release();
    await selecting;
    assert.deepEqual(await promise, { cancelled: true });
    await assert.rejects(fs.stat(directory), { code: 'ENOENT' });
});
