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
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
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
const longChapters = Array.from({ length: 513 }, (_, index) => ({
    name: 'long-' + index + '.xhtml', title: 'Chapter ' + index, text: 'Body ' + index,
}));
const textChapters = Array.from({ length: 36 }, (_, index) => ({
    name: 'text-' + index + '.xhtml', title: 'Section ' + index,
    original: { html: '<html><body><h1>Section ' + index + '</h1>' + (index ? '' : '<img src="slow.png">')
        + Array.from({ length: 175 }, (_, p) => '<p>Paragraph ' + p + ' in section ' + index + '.</p>').join('') + '</body></html>',
        resourceUrls: { 'slow.png': '/api/viewer/epub-asset/slow.png' } },
}));
let loadSession;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getEpubText: async id => {
        if (id === 'error') throw new Error('Fixture EPUB could not be opened');
        return { chapters: id === 'long' ? longChapters : id.startsWith('resume-') ? textChapters : chapters, toc: [], fonts: [] };
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
    throw new Error(message + ' (' + (document.querySelector('.viewer-title')?.textContent || '') + ')');
}
const thumbPages = button => [...button.querySelectorAll('.viewer-slide-thumb-reader-preview strong')].map(node => Number(node.textContent));
async function walkNavigation(strip, total, spread, maxButtons = total) {
    const seen = new Set();
    let peakButtons = 0;
    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const step = Math.max(1, Math.floor(strip.clientWidth * 0.8));
    for (let left = 0; ; left = Math.min(maxScroll, left + step)) {
        strip.scrollLeft = left;
        await frame();
        await frame();
        const buttons = [...strip.querySelectorAll('.viewer-slide-thumb')];
        peakButtons = Math.max(peakButtons, buttons.length);
        check(buttons.length > 0 && buttons.length <= maxButtons, 'Unexpected thumbnail DOM size: ' + buttons.length);
        let previous = null;
        buttons.forEach(button => {
            const pages = thumbPages(button);
            const first = pages[0];
            const size = spread && first < total ? 2 : 1;
            check(first >= 1 && first <= total && pages.length === size, 'Incorrect thumbnail group: ' + pages);
            check(previous === null || first === previous + 1, 'Thumbnails were skipped or reordered before ' + first);
            previous = pages.at(-1);
            if (spread) check(first % 2 === 1 && (size === 1 || pages[1] === first + 1), 'Incorrect spread: ' + pages);
            pages.forEach(page => seen.add(page));
        });
        if (left === maxScroll) break;
    }
    check(seen.size === total, 'Horizontal scrolling reached only ' + seen.size + ' of ' + total + ' pages');
    return peakButtons;
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
        const provisionalPageCounts = new Set();
        let exposedPendingFrames = 0;
        await until(() => {
            const content = document.querySelector('.viewer-content');
            const loading = document.querySelector('.viewer-app').classList.contains('is-initial-render-loading');
            const frames = [...content.querySelectorAll('.viewer-epub-original-frame')];
            frames.forEach(item => initialFrames.add(item));
            const measuring = document.querySelectorAll('.is-measure iframe');
            measuring.forEach(item => measuredChapters.add(item.dataset.originalEntry));
            if (measuring.length) provisionalPageCounts.add(document.querySelector('.viewer-title small')?.textContent);
            if (loading && frames.length && getComputedStyle(content).opacity !== '0') exposedPendingFrames += 1;
            return !loading && frames.length > 0;
        }, flowMode + ': loading never settled');
        check(exposedPendingFrames === 0, flowMode + ': incomplete pages were visible');
        if (flowMode !== 'scroll') {
            check(measuredChapters.size > 3, flowMode + ': fixture must span multiple measurement batches');
            check(provisionalPageCounts.size === 1 && provisionalPageCounts.has('EPUB'), flowMode + ': partial measurements showed an unfinished page count');
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
        const slideToggle = document.querySelector('.viewer-slide-toggle');
        const slideStrip = document.querySelector('.viewer-slide-strip');
        check(slideToggle?.getAttribute('aria-expanded') === 'false', flowMode + ': slide navigation must start closed');
        check(slideStrip.querySelectorAll('.viewer-slide-thumb').length === 0, flowMode + ': closed EPUB navigation created thumbnails');
        slideToggle.click();
        await until(() => slideToggle.getAttribute('aria-expanded') === 'true' && slideStrip.querySelector('.viewer-slide-thumb'), flowMode + ': opening navigation did not render thumbnails');
        const totalPages = flowMode === 'scroll' ? chapters.length : Number(document.querySelector('.viewer-title small').textContent.match(/\\d+/g)[1]);
        check(slideStrip.querySelector('[aria-current="page"]'), flowMode + ': navigation did not mark the current page');
        await walkNavigation(slideStrip, totalPages, flowMode === 'spread');
        slideToggle.click();
        await until(() => slideToggle.getAttribute('aria-expanded') === 'false' && slideStrip.querySelectorAll('.viewer-slide-thumb').length === 0, flowMode + ': closing navigation retained EPUB thumbnails');
        check(document.querySelector('.viewer-slide-controls').inert, flowMode + ': closed navigation must not receive focus');
        results.push({ flowMode, initialFrames: initialFrames.size, measuredChapters: measuredChapters.size, exposedPendingFrames, navigationPages: totalPages });
    }
    for (const flowMode of ['single', 'spread']) {
        loadSession = null;
        root.render(<ViewerApp key={flowMode + '-long'} />);
        await until(() => loadSession, 'Long book did not subscribe to sessions');
        localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
            flowMode, slideNavOpen: true, readerSettings: { epubStyle: 'optimized', pageEffect: 'none' },
        }));
        await loadSession({ id: 'long', filePath: '/fixture/long.epub', fileName: 'Long EPUB', type: 'epub', preview: true });
        const pageNumbers = () => (document.querySelector('.viewer-title small')?.textContent.match(/\\d+/g) || []).map(Number);
        await until(() => pageNumbers()[1] === longChapters.length && !document.querySelector('.viewer-app.is-initial-render-loading'), 'Long book did not open');
        const strip = document.querySelector('.viewer-slide-strip');
        const peakButtons = await walkNavigation(strip, longChapters.length, flowMode === 'spread', 80);
        const buttonFor = page => [...strip.querySelectorAll('.viewer-slide-thumb')].find(button => thumbPages(button).includes(page));
        buttonFor(longChapters.length).click();
        await until(() => pageNumbers()[0] === longChapters.length && buttonFor(longChapters.length)?.getAttribute('aria-current') === 'page', 'Last thumbnail did not navigate');
        strip.scrollLeft = (strip.scrollWidth - strip.clientWidth) / 2;
        const middleButton = () => [...strip.querySelectorAll('.viewer-slide-thumb')].find(button => {
            const [page] = thumbPages(button);
            const rect = button.getBoundingClientRect();
            const viewport = strip.getBoundingClientRect();
            return page > longChapters.length / 3 && page < longChapters.length * 2 / 3 && rect.left >= viewport.left && rect.right <= viewport.right;
        });
        await until(middleButton, 'Scrolling back to the middle did not mount reachable thumbnails');
        const middle = middleButton();
        const [middlePage] = thumbPages(middle);
        middle.click();
        await until(() => pageNumbers()[0] === middlePage, 'Middle thumbnail opened the wrong page');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
        await until(() => {
            const first = buttonFor(1);
            if (pageNumbers()[0] !== 1 || first?.getAttribute('aria-current') !== 'page') return false;
            const rect = first.getBoundingClientRect();
            const viewport = strip.getBoundingClientRect();
            return rect.left >= viewport.left - 1 && rect.right <= viewport.right + 1;
        }, 'External navigation did not bring the active thumbnail back into view');
        results.push({ flowMode: flowMode + '-long', navigationPages: longChapters.length, peakButtons });
    }
    const currentFrames = () => [...document.querySelectorAll('.viewer-content [data-page-transition-role="current"] iframe')];
    const currentIndex = () => Number(currentFrames()[0]?.closest('[data-reader-page-index]')?.dataset.readerPageIndex);
    const turn = key => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    for (const [flowMode, motion] of [['single', 'full'], ['spread', 'full'], ['single', 'reduced']]) {
        const id = flowMode + '-' + motion;
        loadSession = null;
        root.render(<ViewerApp key={id} />);
        await until(() => loadSession, id + ': not subscribed');
        applyMotionPreference(motion);
        localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
            flowMode, slideNavOpen: false, readerSettings: { epubStyle: 'original', pageEffect: motion === 'reduced' ? 'slide' : 'none' },
        }));
        await loadSession({ id, filePath: '/fixture/' + id + '.epub', fileName: id, type: 'epub', preview: true });
        await until(() => currentIndex() === 0 && !document.querySelector('.is-initial-render-loading') && currentFrames().every(item => item.dataset.originalReady === 'true'), id + ': original frames not ready');
        const originals = currentFrames().map(item => ({ item, document: item.contentDocument }));
        const step = flowMode === 'spread' ? 2 : 1;
        check(originals.length === step, id + ': incorrect number of visible frames');
        originals.forEach(entry => { entry.document.documentElement.style.scrollBehavior = 'smooth'; });
        turn('PageDown');
        await until(() => currentIndex() === step, id + ': same-chapter turn failed');
        currentFrames().forEach((item, slot) => {
            const root = item.contentDocument.documentElement;
            check(item === originals[slot].item && item.contentDocument === originals[slot].document, id + ': reloaded a visible chapter on turn');
            check(Math.abs(root.scrollLeft - (step + slot) * root.clientWidth) < 2, id + ': incorrect in-chapter offset');
        });
        turn('PageUp');
        await until(() => currentIndex() === 0, id + ': reverse turn failed');
        check(currentFrames()[0] === originals[0].item && originals[0].document.documentElement.scrollLeft === 0, id + ': first page was not restored');
        turn('End');
        await until(() => currentFrames().some(item => item.dataset.originalEntry === chapters.at(-1).name && item.dataset.originalReady === 'true'), id + ': last chapter missing');
        check(currentFrames().every(item => item.contentDocument.body.textContent.includes(chapters.at(-1).title)), id + ': wrong chapter content after jump');
    }
    let latePage;
    for (const kind of ['chapter', 'legacy']) {
        const id = 'resume-' + kind;
        loadSession = null;
        root.render(<ViewerApp key={id} />);
        await until(() => loadSession, id + ': not subscribed');
        const target = textChapters.at(-2);
        const state = kind === 'chapter' ? { pageIndex: 3000, epubPosition: { entryName: target.name, chapterProgress: 0 } } : { pageIndex: latePage };
        localStorage.setItem('bookmanager-viewer-state:/fixture/' + id + '.epub', JSON.stringify(state));
        localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
            flowMode: 'single', slideNavOpen: false, readerSettings: { epubStyle: 'original', pageEffect: 'none' },
        }));
        await loadSession({ id, filePath: '/fixture/' + id + '.epub', fileName: id, type: 'epub', preview: true });
        await until(() => currentFrames()[0]?.dataset.originalEntry === target.name && !document.querySelector('.is-initial-render-loading'), id + ': wrong saved chapter');
        if (kind === 'chapter') {
            check(document.querySelector('.viewer-title small').textContent === 'EPUB', 'Did not start reading before full pagination');
            check(currentFrames()[0].contentDocument.documentElement.scrollLeft === 0, 'Should restore first page of saved chapter');
            const initial = currentIndex();
            turn('PageDown');
            await until(() => currentIndex() === initial + 1 && currentFrames()[0].contentDocument.documentElement.scrollLeft > 0, 'Cannot read next page while paginating');
            const offset = currentFrames()[0].contentDocument.documentElement.scrollLeft;
            await until(() => document.querySelector('.viewer-title small')?.textContent.includes(' / ') && currentFrames()[0]?.dataset.originalReady === 'true', 'Full pagination did not finish');
            check(currentFrames()[0].dataset.originalEntry === target.name && currentFrames()[0].contentDocument.documentElement.scrollLeft === offset, 'Final layout moved the reader');
            latePage = currentIndex();
            check(latePage > textChapters.length, 'Chapter-based restore used a provisional page index');
        } else check(currentIndex() === latePage, 'Legacy restore changed the exact saved page');
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
            plugins: [{ name: 'delayed-epub-image', configureServer(vite) {
                vite.middlewares.use('/api/viewer/epub-asset/slow.png', (_request, response) => {
                    setTimeout(() => { response.statusCode = 404; response.end(); }, 1200);
                });
            } }],
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', fs: { allow: [directory, projectRoot] } },
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
        assert.equal(report.length, 5);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
});
