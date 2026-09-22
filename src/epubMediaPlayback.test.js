import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB media plays inline with stable layout and unloads outside active pages', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-media-test-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import EpubInlineMedia from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubInlineMedia.jsx')}`)};
import { buildEpubOriginalDocument } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/epubOriginalDocument.js')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate, message) {
    for (let count = 0; count < 200; count += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(message);
}
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const chapter = {
    name: 'OPS/media.xhtml',
    original: { resourceUrls: {}, html: '<html><head><style>body{margin:16px;font:16px sans-serif}figure{margin:16px 0}p{margin:12px 0}</style></head><body><script>window.publisherScriptRan = true;<\/script><p>Text before the video</p><figure class="external-media" id="youtube"><figcaption>Inline YouTube video</figcaption><p><a href="https://www.youtube.com/watch?v=jNQXAC9IVRw&amp;t=30">YouTube link</a></p></figure><p>Text after the video</p><object id="vimeo" data="https://player.vimeo.com/video/123456789?h=a1b2c3d4e5"></object><iframe src="https://www.youtube.com.evil.test/embed/jNQXAC9IVRw"></iframe><iframe srcdoc="unsafe"></iframe></body></html>' },
};
for (const mode of ['page', 'scroll', 'measure']) {
    const built = new DOMParser().parseFromString(buildEpubOriginalDocument(chapter, { mode }), 'text/html');
    check(!built.querySelector('iframe,object,embed,script,[srcdoc]'), 'Publisher executable content must stay blocked');
    check(built.querySelectorAll('[data-epub-media-url]').length === 2, 'Supported embeds and exported figures reserve inline video slots');
    check(built.querySelector('#youtube [data-epub-media-url]').dataset.epubMediaUrl === 'https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30', 'YouTube timestamps survive');
    check(built.querySelector('meta[http-equiv]').content.includes("script-src 'none'"), 'Publisher document scripts remain blocked');
}
const messages = [];
window.addEventListener('message', event => {
    if (event.data?.type === 'epub-test-player-ready') messages.push(event.origin);
});
const root = createRoot(document.getElementById('root'));
const players = () => [...document.querySelectorAll('.viewer-epub-inline-media iframe')];
const originalFrame = () => document.querySelector('.viewer-epub-original-frame');
let layout;
const renderOriginal = (mode, extra = {}) => root.render(<EpubOriginalDocument chapter={chapter} mode={mode} pageSize={{ width: 600, height: 400 }} onLayout={value => layout = value} {...extra} />);
const ready = () => originalFrame()?.dataset.originalReady === 'true';
const aligned = () => {
    const frame = originalFrame();
    const frameRect = frame.getBoundingClientRect();
    const scaleX = frameRect.width / frame.clientWidth;
    const scaleY = frameRect.height / frame.clientHeight;
    for (const player of players()) {
        const slot = [...frame.contentDocument.querySelectorAll('[data-epub-media-url]')].find(node => node.dataset.epubMediaTitle === player.title);
        check(slot, 'Each player has a publisher document slot');
        const slotRect = slot.getBoundingClientRect();
        const rect = player.getBoundingClientRect();
        check(Math.abs(rect.left - frameRect.left - slotRect.left * scaleX) < 2, 'Inline player must align horizontally with its slot');
        check(Math.abs(rect.top - frameRect.top - slotRect.top * scaleY) < 2, 'Inline player must align vertically with its slot');
        check(Math.abs(rect.width - slotRect.width * scaleX) < 2 && Math.abs(rect.height - slotRect.height * scaleY) < 2, 'Inline player size must match reserved layout');
    }
};
window.mediaTests = (async () => {
    renderOriginal('measure');
    await until(ready, 'Measurement did not load');
    await pause();
    check(players().length === 0 && messages.length === 0, 'Measurement never loads external players');
    renderOriginal('scroll');
    await until(() => ready() && messages.length === 2, 'Original inline players did not initialize under the application CSP');
    check(!document.querySelector('dialog'), 'Playback must not create a dialog');
    check(!originalFrame().contentWindow.publisherScriptRan, 'Publisher scripts must not execute');
    check(originalFrame().sandbox.value === 'allow-same-origin', 'Publisher sandbox must not gain script permissions');
    aligned();
    const youtube = players().find(player => player.src.includes('youtube'));
    check(youtube.src.endsWith('?start=30'), 'Playback retains start time');
    check(players().some(player => player.src.endsWith('?h=a1b2c3d4e5')), 'Unlisted Vimeo hash survives');
    const loaded = messages.length;
    renderOriginal('scroll', { appearance: { theme: { bg: '#182029', fg: '#e7edf5' } } });
    await pause();
    check(messages.length === loaded && players().includes(youtube), 'Appearance updates do not restart videos');
    renderOriginal('scroll', { mediaActive: false });
    await until(() => players().length === 0, 'Inactive pages must stop playback by unloading their players');
    check(!youtube.isConnected, 'Inactive player is removed');
    document.getElementById('root').style.display = 'none';
    renderOriginal('scroll', { mediaActive: false, appearance: { horizontalPadding: 24 } });
    await until(ready, 'Hidden cached page did not initialize');
    await pause();
    document.getElementById('root').style.display = '';
    renderOriginal('scroll', { mediaActive: true, appearance: { horizontalPadding: 24 } });
    await until(() => players().length === 2, 'Reactivating a cached page must restore its inline players');
    aligned();
    renderOriginal('page', { pageOffset: 0 });
    await until(() => ready() && layout?.pageCount > 1 && players().length === 1, 'Paged reading loads only the player on the current page');
    const firstPagePlayer = players()[0];
    aligned();
    renderOriginal('page', { pageOffset: layout.anchors.vimeo });
    await until(() => players().length === 1 && players()[0].src.includes('vimeo'), 'Page turns move playback to the next inline slot');
    check(!firstPagePlayer.isConnected, 'Turning a page unloads the previous player');
    aligned();
    renderOriginal('scroll', { scale: 0.8, appearance: { horizontalPadding: 20, verticalPadding: 20 } });
    await until(() => ready() && players().length === 2, 'Scaled scroll players did not initialize');
    await pause();
    aligned();
    const fixedChapter = { ...chapter, original: { ...chapter.original, layout: 'pre-paginated', viewport: { width: 600, height: 800 } } };
    renderOriginal('page', { chapter: fixedChapter, appearance: { horizontalPadding: 20, verticalPadding: 20 } });
    await until(() => ready() && players().length === 2, 'Fixed-layout players did not initialize');
    await pause();
    aligned();
    const renderOptimized = active => root.render(<div style={{ width: 600 }}><p>Optimized text before video</p><EpubInlineMedia url="https://youtu.be/jNQXAC9IVRw?t=30" title="Optimized video" active={active} /><p id="after">Optimized text after video</p></div>);
    renderOptimized(false);
    await until(() => !originalFrame() && players().length === 0, 'Optimized measurement must not load players');
    const placeholder = document.querySelector('.viewer-epub-inline-media').getBoundingClientRect();
    renderOptimized(true);
    await until(() => players().length === 1, 'Optimized player must render directly in the text flow');
    const playerRect = players()[0].getBoundingClientRect();
    check(Math.abs(playerRect.height - placeholder.height) < 1, 'Loading a player must not change measured page height');
    check(document.getElementById('after').getBoundingClientRect().top >= playerRect.bottom, 'Following text must not overlap the video');
    document.getElementById('root').style.marginTop = '2000px';
    await until(() => players().length === 0, 'Scrolling a video out of view must stop playback');
    document.getElementById('root').style.marginTop = '';
    renderOriginal('scroll');
    await until(() => ready() && players().length === 2, 'Final inline preview did not load');
    aligned();
    await pause();
    return { messages, players: players().length };
})();

`);
        const index = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        await fs.writeFile(path.join(directory, 'index.html'), index.replace('/src/main.jsx', '/fixture.jsx'));
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } });
    const requests = [];
    window.webContents.session.protocol.handle('https', request => {
        requests.push(request.url);
        return new Response('<html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1d3340;color:white;font:20px sans-serif">Inline test player<script>parent.postMessage({type:"epub-test-player-ready"}, "*")</script></body></html>', { headers: { 'Content-Type': 'text/html' } });
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.mediaTests');
    if (requests.some(url => !['https://www.youtube-nocookie.com', 'https://player.vimeo.com'].includes(new URL(url).origin))) throw new Error('Unexpected network requests: ' + JSON.stringify(requests));
    if (process.env.BOOKMANAGER_MEDIA_SCREENSHOT) await require('fs/promises').writeFile(process.env.BOOKMANAGER_MEDIA_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    console.log('EPUB_MEDIA_RESULT=' + JSON.stringify({ ...result, requests }));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Media renderer timed out: ' + result)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_MEDIA_RESULT=(.+)/)[1]);
        assert.equal(report.players, 2);
        assert.ok(report.requests.length >= 2);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
