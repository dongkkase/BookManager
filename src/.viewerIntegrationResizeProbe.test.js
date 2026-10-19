import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('temporary full viewer ResizeObserver probe', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-loading-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const chapters = Array.from({ length: 4 }, (_, index) => ({
    name: 'chapter-' + index + '.xhtml', title: 'Chapter ' + index, text: 'Sample chapter ' + index,
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: '',
        html: '<html><head><style>body{margin:0;font:18px/30px sans-serif}p{margin:0 0 12px}</style></head><body><h1>Chapter ' + index + '</h1>'
            + '<p>Pagination fixture with enough content to cross page boundaries.</p>'.repeat(30) + '</body></html>',
    },
}));
let loadSession;
let phase = 'startup';
const resizeErrors = [];
const observerCalls = [];
const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback) {
        const created = new Error().stack;
        super((entries, observer) => {
            observerCalls.push({callback: callback.name, created, phase, targets: entries.map(entry => ({className: String(entry.target.className), w: entry.contentRect.width, h: entry.contentRect.height}))});
            if (observerCalls.length > 10) observerCalls.shift();
            callback(entries, observer);
        });
    }
};
window.addEventListener('error', event => { if (/ResizeObserver/.test(event.message)) resizeErrors.push({ phase, message: event.message, recent: [...observerCalls] }); });
window.viewerAPI = {
    getCurrentSession: async () => null,
    getText: async () => ({ text: ('Sample paragraph for reflow, pagination and long text loading. '.repeat(6) + String.fromCharCode(10)).repeat(400) }),
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getEpubText: async id => {
        if (id === 'error') throw new Error('Fixture EPUB could not be opened');
        return { chapters, toc: [], fonts: [] };
    },
    listBundledFonts: async () => [], listSystemFonts: async () => [],
};
const listenedDocuments = new WeakSet();
function listenFrames() {
    document.querySelectorAll('iframe').forEach(iframe => {
        const doc = iframe.contentDocument;
        if (!doc || listenedDocuments.has(doc)) return;
        listenedDocuments.add(doc);
        iframe.contentWindow.addEventListener('error', event => { if (/ResizeObserver/.test(event.message)) resizeErrors.push({ phase, message: event.message, frame: iframe.dataset.originalEntry, recent: [...observerCalls] }); });
    });
    requestAnimationFrame(listenFrames);
}
requestAnimationFrame(listenFrames);
const root = createRoot(document.getElementById('root'));
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
window.loadingTests = (async () => {
    const results = [];
    for (const format of ['epub-original']) {
        for (const flowMode of [format === 'text' ? 'scroll' : 'spread']) {
            phase = format + '/' + flowMode + '/load';
            const before = resizeErrors.length;
            const type = format === 'text' ? 'text' : 'epub';
            const session = { id: format + flowMode, filePath: '/fixture/' + format + flowMode, fileName: format + flowMode, type, preview: true };
            localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
                flowMode, slideNavOpen: false, readerSettings: { epubStyle: format === 'epub-original' ? 'original' : 'custom', pageEffect: 'none' },
            }));
            loadSession = null;
            root.render(<ViewerApp key={session.id} />);
            await until(() => loadSession, 'Viewer did not subscribe');
            await loadSession(session);
            await until(() => document.querySelector('header')?.textContent.includes(session.fileName), 'Session did not render');
            await until(() => !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading') && !document.querySelector('.viewer-state'), phase + ': loading never settled');
            for (let count = 0; count < 30; count += 1) await frame();
            for (const [keyIndex, key] of ['+', '+', '+', '+', '-', '-', '-', '-', '+', '+', '-', '-'].entries()) {
                phase = format + '/' + flowMode + '/key/' + keyIndex + '/' + key;
                window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
                for (let count = 0; count < 20; count += 1) await frame();
            }
            for (let count = 0; count < 60; count += 1) await frame();
            const content = document.querySelector('.viewer-content');
            results.push({format, flowMode, errors: resizeErrors.slice(before), client: [content.clientWidth, content.clientHeight], scroll: [content.scrollWidth, content.scrollHeight], outer: [content.offsetWidth, content.offsetHeight]});
        }
    }
    root.unmount();
    return results;
})();

`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}::-webkit-scrollbar{width:16px;height:16px}::-webkit-scrollbar-thumb{background:#888}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.loadingTests');
    console.log('EPUB_LOADING_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('EPUB loading renderer timed out: ' + result)); }, 180000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        await fs.writeFile('/tmp/viewer-integration-probe.log', output.result);
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_LOADING_RESULT=(.+)/)[1]);
        assert.equal(report.length, 1);
        t.diagnostic(JSON.stringify(report.map(result => ({...result, errors: result.errors.map(({recent, ...error}) => error)}))));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
