import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { allowedAuthorWebNavigation, authorWebSearchUrl, openAuthorWebSearch, registerAuthorWebSearchIpc } from './authorWebSearchWindow.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(snapshot = { entries: [], empty: true, url: 'https://www.google.com/search?q=author' }) {
    const state = { windows: [], menu: [], snapshot, loads: 0 };
    class Window extends EventEmitter {
        constructor(options) {
            super(); this.options = options; this.webContents = new EventEmitter();
            this.webContents.session = new EventEmitter();
            this.webContents.session.setPermissionRequestHandler = handler => { state.permission = handler; };
            this.webContents.session.setPermissionCheckHandler = handler => { state.permissionCheck = handler; };
            this.webContents.setWindowOpenHandler = handler => { state.open = handler; };
            this.webContents.getURL = () => this.url;
            this.webContents.getUserAgent = () => 'fixture';
            this.webContents.executeJavaScript = async () => state.snapshot;
            state.windows.push(this);
        }
        setMenu() {}
        setTitle(title) { this.title = title; }
        show() { this.shown = (this.shown || 0) + 1; }
        focus() { this.focused = true; }
        async loadURL(url) { this.url = url; state.loads += 1; }
        isDestroyed() { return Boolean(this.destroyed); }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    state.electron = { BrowserWindow: Window, Menu: { buildFromTemplate: items => ({ popup() { state.menu = items; } }) },
        dialog: { showMessageBox: async () => {} } };
    return state;
}

test('검색 URL과 탐색은 선택한 공개 소스로 제한하며 외부 창과 권한을 허용하지 않는다', async () => {
    assert.equal(new URL(authorWebSearchUrl({ source: 'google', query: '작가 & 책', kind: 'photo' })).searchParams.get('q'), '작가 & 책');
    assert.equal(new URL(authorWebSearchUrl({ source: 'google', query: '작가', kind: 'photo' })).searchParams.get('udm'), '2');
    for (const source of ['google', 'namuwiki']) {
        for (const url of ['file:///tmp/a', 'https://127.0.0.1/', 'https://namu.wiki.evil.test/', 'https://google.com.evil.test/']) {
            assert.equal(allowedAuthorWebNavigation(url, source), false);
        }
        const state = fixture();
        const pending = openAuthorWebSearch({ source, query: '작가', manual: true, electron: state.electron });
        const window = state.windows[0];
        assert.equal(window.options.webPreferences.sandbox, true);
        assert.equal(window.options.webPreferences.nodeIntegration, false);
        assert.equal(window.options.webPreferences.preload, undefined);
        assert.equal(window.options.webPreferences.partition, source === 'google' ? 'persist:cover-image-search' : 'persist:author-web-search');
        assert.deepEqual(state.open(), { action: 'deny' });
        assert.equal(state.permissionCheck(), false);
        state.permission(null, 'camera', allowed => assert.equal(allowed, false));
        window.destroy();
        assert.deepEqual(await pending, { cancelled: true });
        assert.equal(window.webContents.session.listenerCount('will-download'), 0);
    }
});

test('Google 확인 프레임은 허용하지만 같은 호스트의 최상위 탐색과 위장 주소는 거부한다', () => {
    const url = 'https://www.recaptcha.net/recaptcha/api2/anchor?k=site-key';
    assert.equal(allowedAuthorWebNavigation(url, 'google', { isMainFrame: false }), true);
    assert.equal(allowedAuthorWebNavigation(url, 'google'), false);
    assert.equal(allowedAuthorWebNavigation(url, 'namuwiki', { isMainFrame: false }), false);
    for (const blocked of ['https://www.recaptcha.net.evil.test/recaptcha/anchor', 'https://www.recaptcha.net/other', 'http://www.recaptcha.net/recaptcha/anchor']) {
        assert.equal(allowedAuthorWebNavigation(blocked, 'google', { isMainFrame: false }), false);
    }
});

test('자동 검색은 사람 확인 화면을 유지하고 완료 후 같은 창에서 결과를 가져온다', async () => {
    for (const url of ['https://www.google.com/sorry/index', 'https://consent.google.com/m']) {
        const state = fixture({ url, entries: [] });
        const parent = new EventEmitter();
        const pending = openAuthorWebSearch({ source: 'google', query: '작가', kind: 'photo', parentWindow: parent, timeoutMs: 15, electron: state.electron });
        const window = state.windows[0];
        window.url = url;
        window.webContents.emit('did-start-navigation', {}, url, false, true);
        window.webContents.emit('did-finish-load');
        await new Promise(resolve => setTimeout(resolve, 35));
        assert.equal(window.isDestroyed(), false, 'User verification must not expire with the network timeout');
        assert.equal(window.shown, 1);
        assert.equal(window.focused, true);
        assert.match(window.title, /Google 확인/);
        assert.equal(state.loads, 1, 'Do not issue another search while confirmation is pending');
        window.url = 'https://www.google.com/search?q=author&udm=2';
        state.snapshot = { url: window.url, entries: [{ title: '작가 사진', url: 'https://www.google.com/imgres?imgurl=portrait',
            image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:portrait' }] };
        window.webContents.emit('did-start-navigation', {}, window.url, false, true);
        window.webContents.emit('did-finish-load');
        const profiles = await pending;
        assert.equal(profiles[0].photoUrl, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:portrait');
        assert.equal(window.isDestroyed(), true);
        assert.equal(parent.listenerCount('closed'), 0);
    }
});

test('확인 중 창을 닫으면 취소하고 재검색이나 확인 페이지 메뉴 선택을 하지 않는다', async () => {
    const state = fixture();
    const pending = openAuthorWebSearch({ source: 'google', query: '작가', parentWindow: new EventEmitter(), electron: state.electron });
    const window = state.windows[0];
    window.url = 'https://www.google.com/sorry/index';
    window.webContents.emit('did-finish-load');
    window.destroy();
    await assert.rejects(pending, { code: 'AUTHOR_PROFILE_CANCELLED' });
    assert.equal(state.loads, 1);
    assert.equal(window.webContents.session.listenerCount('will-download'), 0);
});

test('자동 검색은 결과·정상 빈 결과와 접속 제한을 구분하고 창을 정리한다', async () => {
    const state = fixture({ url: 'https://www.google.com/search?q=author', entries: [{ title: '소개', url: 'https://example.com/author' }] });
    const pending = openAuthorWebSearch({ source: 'google', query: '작가', electron: state.electron });
    state.windows[0].webContents.emit('did-finish-load');
    assert.equal((await pending)[0].provider, 'google');
    assert.equal(state.windows[0].isDestroyed(), true);
    const blocked = fixture({ entries: [], url: 'https://www.google.com/sorry/index' });
    const failed = openAuthorWebSearch({ source: 'google', query: '작가', electron: blocked.electron });
    blocked.windows[0].webContents.emit('did-finish-load');
    await assert.rejects(failed, { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
    const empty = fixture();
    const noResults = openAuthorWebSearch({ source: 'google', query: '작가', electron: empty.electron });
    empty.windows[0].webContents.emit('did-finish-load');
    assert.deepEqual(await noResults, []);
});

test('직접 선택은 우클릭한 결과만 가져오고 사진 출처를 보존한다', async () => {
    const state = fixture({ url: 'https://www.google.com/search?q=author', entries: [
        { title: '선택한 소개', url: 'https://example.com/person', linkUrl: 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fperson' },
    ] });
    const pending = openAuthorWebSearch({ source: 'google', query: '작가', manual: true, electron: state.electron });
    state.windows[0].webContents.emit('context-menu', {}, { linkURL: 'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fperson' });
    await tick();
    assert.equal(state.menu[0].enabled, true);
    await state.menu[0].click();
    assert.equal((await pending).profile.sourceUrl, 'https://example.com/person');
    const photos = fixture();
    const image = openAuthorWebSearch({ source: 'namuwiki', query: '작가', kind: 'photo', manual: true, electron: photos.electron,
        downloadImage: async url => ({ buffer: Buffer.from('image'), dataUrl: 'data:image/png;base64,aW1hZ2U=', sourceUrl: url }) });
    photos.windows[0].webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'http://127.0.0.1/private' });
    await tick();
    assert.equal(photos.menu[0].enabled, false);
    photos.windows[0].webContents.emit('context-menu', {}, { mediaType: 'image', srcURL: 'https://i.namu.wiki/i/portrait.webp' });
    await tick();
    await photos.menu[0].click();
    const result = await image;
    assert.equal(result.photo.source, 'namuwiki');
    assert.equal(result.photo.sourceUrl, 'https://i.namu.wiki/i/portrait.webp');
    assert.match(result.photo.id, /^[a-f\d]{64}$/);
});

test('창 종료와 요청 취소는 대기 작업을 끝내며 IPC는 메인 창의 최상위 프레임만 받는다', async () => {
    const state = fixture();
    const controller = new AbortController();
    const pending = openAuthorWebSearch({ source: 'google', query: '작가', manual: true, signal: controller.signal, electron: state.electron });
    controller.abort();
    assert.deepEqual(await pending, { cancelled: true });
    assert.equal(state.windows[0].isDestroyed(), true);
    const parent = new EventEmitter();
    const child = fixture();
    const automatic = openAuthorWebSearch({ source: 'google', query: '작가', parentWindow: parent, electron: child.electron });
    parent.emit('closed');
    await assert.rejects(automatic, { code: 'AUTHOR_PROFILE_CANCELLED' });
    assert.equal(child.windows[0].isDestroyed(), true);
    assert.equal(parent.listenerCount('closed'), 0);
    const handlers = new Map();
    const sender = new EventEmitter();
    sender.mainFrame = {}; sender.isDestroyed = () => false;
    let signal;
    registerAuthorWebSearchIpc({ ipcMain: { handle: (key, value) => handlers.set(key, value) },
        getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
        openSearch: options => new Promise(resolve => { signal = options.signal; signal.addEventListener('abort', () => resolve({ cancelled: true })); }) });
    const event = { sender, senderFrame: sender.mainFrame };
    const search = handlers.get('authors:openWebSearch');
    assert.equal((await search({ ...event, senderFrame: {} }, { source: 'google', query: '작가' })).code, 'AUTHOR_PROFILE_UNTRUSTED_SENDER');
    const running = search(event, { source: 'google', query: '작가' });
    assert.equal((await search(event, { source: 'google', query: '다른 작가' })).success, false);
    handlers.get('authors:cancelWebSearch')(event);
    assert.equal(signal.aborted, true);
    assert.deepEqual(await running, { cancelled: true });
    assert.equal(sender.listenerCount('destroyed'), 0);
});
