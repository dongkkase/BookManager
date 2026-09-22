import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build, createServer } from 'vite';

test('EPUB media pages keep the book turn effect through the viewer toolbar', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-media-effect-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const style = new URL(location.href).searchParams.get('style');
const withMedia = new URL(location.href).searchParams.get('media') !== '0';
const check = (condition, message) => { if (!condition) throw new Error(style + ': ' + message); };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message, timeout = 8000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await nextFrame();
    }
    throw new Error(style + ': ' + message + ': ' + JSON.stringify({
        visible: visibleIndexes(), loading: document.querySelector('.viewer-app')?.className,
        book: book()?.outerHTML.slice(0, 400), text: document.body.innerText.slice(0, 500),
    }));
}
const mediaUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const chapters = Array.from({ length: 6 }, (_, index) => {
    const text = '제 ' + (index + 1) + '장 본문: 영상이 있는 페이지에서도 책 넘김 효과가 유지됩니다. Text before and after embedded video.';
    const hasVideo = withMedia && (index === 0 || index === 1 || index === 2);
    return {
        name: 'OPS/chapter-' + index + '.xhtml', title: 'Chapter ' + (index + 1), text,
        blocks: [
            { type: 'html', text, nodes: [{ type: 'element', tagName: 'p', children: [{ type: 'text', text }] }] },
            ...(hasVideo ? [{ type: 'html', text: 'Test video ' + index, hasVideo: true, nodes: [{
                type: 'element', tagName: 'div', mediaUrl, mediaTitle: 'Test video ' + index,
                children: [{ type: 'text', text: 'Test video ' + index }],
            }] }] : []),
        ],
        original: { resourceUrls: {}, html: '<html><head><style>body{margin:0;font:16px sans-serif}figure{margin:12px 0}</style></head><body><h2>Chapter ' + (index + 1) + '</h2><p>' + text + '</p>' + (hasVideo ? '<figure class="external-media"><figcaption>Test video ' + index + '</figcaption><p><a href="' + mediaUrl + '">YouTube</a></p></figure>' : '') + '<p>End of chapter.</p></body></html>' },
    };
});
window.viewerAPI = {
    getCurrentSession: async () => ({ id: 'media-effect-' + style, type: 'epub', filePath: '/fixture/' + style + '.epub', fileName: 'Inline media effect.epub' }),
    getEpubText: async () => ({ chapters, metadata: {}, toc: [], fonts: [] }),
    getConfig: async () => ({ language: 'ko' }),
    getFullscreenState: async () => ({ fullscreen: false }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
    onLoadSession: () => () => {},
};
localStorage.clear();
localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
    flowMode: 'spread', spreadCoverFirst: false, slideNavOpen: false,
    readerSettings: { pageEffect: 'page', epubStyle: style },
}));
const book = () => document.querySelector('.viewer-page-curl-book');
const visibleIndexes = () => [...document.querySelectorAll('[data-curl-visible="true"]')]
    .map(node => Number(node.dataset.flipbookIndex));
const players = () => [...document.querySelectorAll('.viewer-epub-inline-media iframe')];
const button = title => [...document.querySelectorAll('button')].find(node => node.title === title);
let playerLoads = 0;
window.addEventListener('message', event => {
    if (event.data === 'epub-media-effect-player-ready') playerLoads += 1;
});
function painted(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    const context = canvas.getContext('2d');
    return [0.2, 0.5, 0.8].some(x => [0.2, 0.5, 0.8].some(y =>
        context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data[3] > 0));
}
createRoot(document.getElementById('root')).render(<ViewerApp />);
window.mediaEffectTests = (async () => {
    await until(() => book() && !document.querySelector('.is-initial-render-loading') && (!withMedia || (players().length > 0 && playerLoads > 0)),
        'Viewer did not finish opening a spread containing playable media', 15000);
    await new Promise(resolve => setTimeout(resolve, 600));
    const initialIndexes = visibleIndexes();
    const initialBook = book();
    check(initialIndexes.length === 2, 'A spread must show two leaves');
    const transitions = [];
    const turns = [{ direction: '다음장' }, { direction: '이전장' }];
    if (location.protocol === 'http:' && style === 'original' && withMedia) {
        turns.push({ direction: '다음장', delayed: true }, { direction: '이전장' });
    }
    for (const { direction, delayed = false } of turns) {
        const before = JSON.stringify(visibleIndexes());
        const next = button(direction);
        check(next && !next.disabled, 'Toolbar navigation must be enabled: ' + direction);
        let animationSeen = false;
        let canvasPainted = false;
        let observing = true;
        const sample = () => {
            if (!observing) return;
            if (book()?.dataset.curlAnimating === 'true') {
                animationSeen = true;
                canvasPainted ||= painted(document.querySelector('.viewer-page-curl-canvas'));
            }
            requestAnimationFrame(sample);
        };
        const decode = HTMLImageElement.prototype.decode;
        let delayedSnapshots = 0;
        let duplicateClickMs = null;
        if (delayed) {
            HTMLImageElement.prototype.decode = async function () {
                if (this.src.startsWith('data:image/svg+xml')) {
                    delayedSnapshots += 1;
                    await new Promise(resolve => setTimeout(resolve, 2700));
                }
                return decode.call(this);
            };
        }
        const started = performance.now();
        try {
            sample();
            next.click();
            if (delayed) {
                await new Promise(resolve => setTimeout(resolve, 2600));
                check(delayedSnapshots > 0 && JSON.stringify(visibleIndexes()) === before,
                    'The duplicate input fixture must still be preparing its first page turn');
                duplicateClickMs = Math.round(performance.now() - started);
                next.click();
            }
            await until(() => JSON.stringify(visibleIndexes()) !== before && book()?.dataset.curlAnimating !== 'true', 'Toolbar did not complete page navigation');
        } finally {
            observing = false;
            HTMLImageElement.prototype.decode = decode;
        }
        check(book() === initialBook, 'Navigation must retain the mounted book while turning its pages');
        if (delayed) check(JSON.stringify(visibleIndexes()) === '[2,3]', 'A second Next input during snapshot preparation must not skip a spread');
        transitions.push({ direction, animationSeen, canvasPainted, durationMs: Math.round(performance.now() - started), indexes: visibleIndexes(),
            ...(delayed ? { delayedSnapshots, duplicateClickMs } : {}) });
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    check(JSON.stringify(visibleIndexes()) === JSON.stringify(initialIndexes), 'Previous returns to the initial spread');
    if (withMedia) await until(() => players().length > 0, 'Returning to media page must restore the player');
    return { protocol: location.protocol, style, withMedia, transitions, playerLoads };
})();
`);
        const index = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        await fs.writeFile(path.join(directory, 'index.html'), index.replace('/src/main.jsx', '/fixture.jsx'));
        const viteOptions = {
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
        };
        await build({ ...viteOptions, base: './', build: { outDir: path.join(directory, 'build'), minify: false } });
        server = await createServer({
            ...viteOptions,
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('RENDERER: ' + message); });
    window.webContents.session.protocol.handle('https', () => new Response('<html><body style="background:#1d3340;color:white">Inline player<script>parent.postMessage("epub-media-effect-player-ready", "*")</script></body></html>', { headers: { 'Content-Type': 'text/html' } }));
    const reports = [];
    for (const baseUrl of ${JSON.stringify([fixtureUrl, pathToFileURL(path.join(directory, 'build/index.html')).href])}) {
        for (const style of ['original', 'optimized']) {
            for (const withMedia of [true, false]) {
                await window.loadURL(baseUrl + '?style=' + style + '&media=' + (withMedia ? '1' : '0'));
                try {
                    reports.push(await window.webContents.executeJavaScript('window.mediaEffectTests'));
                } catch (error) {
                    reports.push({ protocol: new URL(baseUrl).protocol, style, withMedia, error: error.message });
                }
            }
        }
    }
    console.log('EPUB_MEDIA_EFFECT_RESULT=' + JSON.stringify(reports));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Media effect renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_MEDIA_EFFECT_RESULT=(.+)/)[1]);
        assert.equal(report.length, 8);
        assert.deepEqual(report.filter(item => item.error), [], output.result);
        assert.deepEqual(report.filter(item => item.transitions.some(transition => !transition.animationSeen || !transition.canvasPainted)), [], output.result);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
