import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('실제 검색 창에서 확인 대기 후 이미지 결과로 돌아오고 검색 세션을 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run Electron.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'author-web-search-render-'));
    try {
        const entry = path.join(directory, 'main.cjs');
        await fs.writeFile(entry, `
const assert = require('node:assert/strict');
const { app, BrowserWindow, session } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
    for (let count = 0; count < 200; count += 1) {
        if (predicate()) return;
        await pause(25);
    }
    throw new Error('Fixture navigation timed out');
}
app.whenReady().then(async () => {
    const { openAuthorWebSearch } = await import(${JSON.stringify(new URL('./authorWebSearchWindow.js', import.meta.url).href)});
    const searchSession = session.fromPartition('persist:cover-image-search');
    let searches = 0;
    let confirmationFrames = 0;
    // Serve local fixtures only; the test never contacts Google or submits a real challenge.
    searchSession.protocol.handle('https', request => {
        const url = new URL(request.url);
        let html = '';
        if (url.hostname === 'www.recaptcha.net') {
            confirmationFrames += 1;
            html = '<p>Local confirmation frame</p>';
        } else if (url.pathname === '/sorry/index') {
            html = '<iframe src="https://www.recaptcha.net/recaptcha/api2/anchor"></iframe><button>Complete local fixture</button><script>document.querySelector("button").onclick=()=>location.href="/search?q=author&udm=2&confirmed=1";</script>';
        } else if (url.pathname === '/search') {
            searches += 1;
            html = url.searchParams.has('confirmed')
                ? '<img alt="Author portrait" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:fixture">'
                : '<script>location.replace("/sorry/index")</script>';
        }
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    const parent = new BrowserWindow({ show: false });
    let searchWindow;
    app.once('browser-window-created', (_event, window) => { searchWindow = window; });
    const result = openAuthorWebSearch({ source: 'google', query: 'author', kind: 'photo', parentWindow: parent, timeoutMs: 1500 });
    result.catch(() => {});
    await until(() => searchWindow?.isVisible() && confirmationFrames === 1 && !searchWindow.webContents.isLoading());
    await pause(1600);
    assert.equal(searchWindow.isDestroyed(), false);
    assert.match(searchWindow.getTitle(), /Google 확인/);
    assert.equal(searches, 1);
    assert.equal(searchWindow.webContents.session, searchSession);
    await searchSession.cookies.set({ url: 'https://www.google.com', name: 'fixture-session', value: 'preserved' });
    await searchWindow.webContents.executeJavaScript('document.querySelector("button").click()');
    const profiles = await result;
    assert.equal(profiles[0].photoUrl, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:fixture');
    assert.equal(searchWindow.isDestroyed(), true);
    assert.equal(searches, 2);
    assert.equal((await searchSession.cookies.get({ name: 'fixture-session' }))[0].value, 'preserved');
    parent.destroy();
    console.log('AUTHOR_WEB_SEARCH_OK');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Search renderer timed out: ' + result)); }, 20000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        assert.match(output.result, /AUTHOR_WEB_SEARCH_OK/);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
