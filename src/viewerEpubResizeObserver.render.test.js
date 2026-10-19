import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB 원본 확대와 본문 크기 변경은 ResizeObserver 오류 없이 다시 계산된다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-resize-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const chapters = Array.from({ length: 4 }, (_, index) => ({
    name: 'chapter-' + index + '.xhtml', title: 'Chapter ' + index,
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: '',
        html: '<html><head><style>body{margin:0;font:18px/30px sans-serif}p{margin:0 0 12px}</style></head><body><h1>Chapter ' + index + '</h1>'
            + '<p>Pagination fixture with enough content to cross page boundaries.</p>'.repeat(30) + '</body></html>',
    },
}));
let phase = 'load';
let loadSession;
let bodyDeliveries = 0;
const bodyWidths = new Set();
const deliveredBodies = new WeakMap();
const resizeErrors = [];
const watchedDocuments = new WeakSet();
function watchDocument(viewport, document) {
    if (watchedDocuments.has(document)) return;
    watchedDocuments.add(document);
    viewport.addEventListener('error', event => {
        if (/ResizeObserver/.test(event.message)) resizeErrors.push({ phase, message: event.message, iframe: viewport !== window });
    });
    const NativeResizeObserver = viewport.ResizeObserver;
    viewport.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback) {
            super((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.target.tagName !== 'BODY') return;
                    bodyDeliveries += 1;
                    bodyWidths.add(Math.round(entry.contentRect.width));
                    deliveredBodies.set(entry.target, (deliveredBodies.get(entry.target) || 0) + 1);
                });
                callback(entries, observer);
            });
        }
    };
}
function watchFrames() {
    document.querySelectorAll('iframe').forEach(iframe => {
        if (iframe.contentDocument) watchDocument(iframe.contentWindow, iframe.contentDocument);
    });
}
watchDocument(window, document);
document.addEventListener('load', event => {
    if (event.target.tagName === 'IFRAME') watchFrames();
}, true);
let watchRequest;
function watchFrameDocuments() {
    watchFrames();
    watchRequest = requestAnimationFrame(watchFrameDocuments);
}
watchFrameDocuments();
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getEpubText: async () => ({ chapters, toc: [], fonts: [] }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
};
const root = createRoot(document.getElementById('root'));
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
window.resizeTests = (async () => {
    localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
        flowMode: 'spread', slideNavOpen: false, readerSettings: { epubStyle: 'original', pageEffect: 'none' },
    }));
    root.render(<ViewerApp />);
    await until(() => loadSession, 'Viewer did not subscribe to sessions');
    await loadSession({ id: 'resize', filePath: '/fixture/resize.epub', fileName: 'Resize EPUB', type: 'epub', preview: true });
    await until(() => document.querySelector('header')?.textContent.includes('Resize EPUB'), 'Session did not render');
    const ready = () => !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading')
        && !document.querySelector('.viewer-state') && document.querySelector('.viewer-content iframe[data-original-ready="true"]');
    await until(ready, 'Initial pagination did not settle');
    for (let count = 0; count < 30; count += 1) await frame();
    for (const [index, key] of ['+', '+', '+', '+', '-', '-', '-', '-', '+', '+', '-', '-'].entries()) {
        phase = 'zoom ' + index + ' ' + key;
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        for (let count = 0; count < 20; count += 1) await frame();
    }
    await until(ready, 'Pagination did not settle after zooming');
    for (let count = 0; count < 30; count += 1) await frame();
    check(bodyWidths.size >= 3, 'Zoom did not recalculate the original document widths');
    phase = 'body resize';
    const body = document.querySelector('.viewer-content iframe[data-original-ready="true"]').contentDocument.body;
    const before = deliveredBodies.get(body) || 0;
    body.style.paddingBottom = '123px';
    await until(() => (deliveredBodies.get(body) || 0) > before, 'Original document body observer stopped responding');
    for (let count = 0; count < 30; count += 1) await frame();
    check(ready(), 'Original document did not remain ready after its body resized');
    const result = { resizeErrors, bodyDeliveries, bodyWidths: [...bodyWidths] };
    root.unmount();
    cancelAnimationFrame(watchRequest);
    return result;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}::-webkit-scrollbar{width:16px;height:16px}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.resizeTests');
    console.log('EPUB_RESIZE_RESULT=' + JSON.stringify(result));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('EPUB resize renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_RESIZE_RESULT=(.+)/)[1]);
        assert.deepEqual(report.resizeErrors, [], 'Parent or iframe reported a ResizeObserver error');
        assert.ok(report.bodyDeliveries > 0);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
