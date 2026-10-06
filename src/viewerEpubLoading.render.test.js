import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB은 페이지 계산과 위치 복원을 마친 뒤 본문을 한 번 표시한다', async t => {
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
const chapters = Array.from({ length: 12 }, (_, index) => ({
    name: 'chapter-' + index + '.xhtml', title: 'Chapter ' + index, text: 'Sample chapter ' + index,
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: '',
        html: '<html><head><style>body{margin:0;font:18px/30px sans-serif}p{margin:0 0 12px}</style></head><body><h1>Chapter ' + index + '</h1>'
            + '<p>Pagination fixture with enough content to cross page boundaries.</p>'.repeat(30) + '</body></html>',
    },
}));
let loadSession;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getEpubText: async id => {
        if (id === 'error') throw new Error('Fixture EPUB could not be opened');
        return { chapters, toc: [], fonts: [] };
    },
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
window.loadingTests = (async () => {
    const results = [];
    for (const flowMode of ['spread', 'single', 'scroll']) {
        const session = { id: flowMode, filePath: '/fixture/' + flowMode + '.epub', fileName: 'Preview EPUB ' + flowMode, type: 'epub', preview: true };
        localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
            flowMode, slideNavOpen: false, readerSettings: { epubStyle: 'original', pageEffect: flowMode === 'spread' ? 'page' : 'none' },
        }));
        localStorage.setItem('bookmanager-viewer-state:' + session.filePath, JSON.stringify({ pageIndex: 2 }));
        loadSession = null;
        root.render(<ViewerApp key={flowMode} />);
        await until(() => loadSession, 'Viewer did not subscribe to sessions');
        await loadSession(session);
        await until(() => document.querySelector('header')?.textContent.includes(session.fileName), 'New session did not render');
        const initialFrames = new Set();
        const measuredChapters = new Set();
        let exposedPendingFrames = 0;
        await until(() => {
            const content = document.querySelector('.viewer-content');
            const loading = document.querySelector('.viewer-app').classList.contains('is-initial-render-loading');
            const frames = [...content.querySelectorAll('.viewer-epub-original-frame')];
            frames.forEach(item => initialFrames.add(item));
            document.querySelectorAll('.is-measure iframe').forEach(item => measuredChapters.add(item.dataset.originalEntry));
            if (loading && frames.length && getComputedStyle(content).opacity !== '0') exposedPendingFrames += 1;
            return !loading && frames.length > 0;
        }, flowMode + ': loading never settled');
        check(exposedPendingFrames === 0, flowMode + ': incomplete pages were visible');
        if (flowMode !== 'scroll') {
            check(measuredChapters.size > 3, flowMode + ': fixture must span multiple measurement batches');
            check(initialFrames.size === (flowMode === 'spread' ? 2 : 1), flowMode + ': visible documents were remounted during pagination: ' + initialFrames.size);
        }
        const content = document.querySelector('.viewer-content');
        check(getComputedStyle(content).opacity === '1', flowMode + ': ready content remained hidden');
        check(!content.hasAttribute('aria-busy'), flowMode + ': busy state was not cleared');
        const target = content.querySelector(flowMode === 'spread'
            ? '[data-curl-visible="true"] iframe'
            : flowMode === 'scroll' ? '[data-reader-index="2"] iframe' : '[data-reader-page-index="2"] iframe');
        check(target?.dataset.originalReady === 'true', flowMode + ': restored page is not ready');
        const targetDocument = target.contentDocument;
        for (let count = 0; count < 20; count += 1) await frame();
        check(target.isConnected && target.contentDocument === targetDocument, flowMode + ': ready page reloaded');
        results.push({ flowMode, initialFrames: initialFrames.size, measuredChapters: measuredChapters.size, exposedPendingFrames });
    }
    await loadSession({ id: 'error', filePath: '/fixture/error.epub', type: 'epub' });
    await until(() => document.querySelector('.viewer-error'), 'EPUB error is missing');
    const error = document.querySelector('.viewer-error');
    check(getComputedStyle(error.parentElement).opacity === '1', 'EPUB error was hidden by the loading mask');
    root.unmount();
    return results;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('EPUB loading renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_LOADING_RESULT=(.+)/)[1]);
        assert.equal(report.length, 3);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
