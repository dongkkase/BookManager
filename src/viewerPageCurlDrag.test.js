import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('뷰어의 페이지 드래그는 본문 선택과 확대 이동을 보존하며 LTR·RTL 이동과 취소를 연결한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-curl-drag-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const options = Object.fromEntries(new URL(location.href).searchParams);
const type = options.type;
const effect = options.effect || 'page';
const original = options.style === 'original';
const rtl = options.direction === 'rtl';
const zoomed = options.zoom === '200';
const label = [type, options.style, options.direction, options.zoom, options.effect].filter(Boolean).join('/');
const check = (condition, message) => { if (!condition) throw new Error(label + ': ' + message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const book = () => document.querySelector('.viewer-page-curl-book');
const sources = () => [...document.querySelectorAll('[data-curl-visible="true"]')]
    .map(node => Number(node.dataset.sourcePageIndex)).sort((a, b) => a - b);
const indexes = () => [...document.querySelectorAll('[data-curl-visible="true"]')]
    .map(node => Number(node.dataset.flipbookIndex));
const dragging = () => Boolean(book()?.hasAttribute('data-curl-dragging'));
const animating = () => book()?.dataset.curlAnimating === 'true';
const canvas = () => document.querySelector('.viewer-page-curl-canvas');
async function until(predicate, message, timeout = 12000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(label + ': ' + message + ': ' + JSON.stringify({ sources: sources(), indexes: indexes(), book: book()?.outerHTML.slice(0, 300), text: document.body.innerText.slice(0, 300) }));
}
const chapterText = '페이지를 드래그해 넘기는 동안에도 글자를 선택하고 링크를 사용할 수 있습니다. Selectable page content. ';
const chapters = Array.from({ length: 8 }, (_, index) => ({
    name: 'chapter-' + index + '.xhtml', title: 'Chapter ' + index, text: chapterText.repeat(8),
    blocks: [{ type: 'html', text: chapterText.repeat(8), nodes: [{ type: 'element', tagName: 'p', children: [{ type: 'text', text: chapterText.repeat(8) }] }] }],
    original: { layout: 'reflowable', resourceUrls: {}, html: '<html><body><p id="selectable">' + chapterText.repeat(8) + '</p><a href="#selectable">Internal link</a><button>Button</button></body></html>' },
}));
const images = Array.from({ length: 8 }, (_, index) => {
    const image = document.createElement('canvas');
    image.width = 480; image.height = 700;
    const context = image.getContext('2d');
    context.fillStyle = ['#c35839', '#487c99', '#399d70', '#b78944'][index % 4];
    context.fillRect(0, 0, 480, 700);
    context.fillStyle = '#ffffff'; context.font = '90px sans-serif'; context.fillText(String(index + 1), 180, 360);
    return { name: String(index) + '.png', width: 480, height: 700, mime: 'image/png', pageUrl: image.toDataURL() };
});
const configListeners = new Set();
const updateMotion = motion_preference => configListeners.forEach(callback => callback({ language: 'ko', motion_preference }));
window.viewerAPI = {
    getCurrentSession: async () => ({ id: label, type, filePath: '/fixture/' + label + '.' + type, fileName: 'Drag fixture', preview: true }),
    getText: async () => ({ text: Array.from({ length: 180 }, (_, index) => (index + 1) + '. ' + chapterText).join('\\n\\n') }),
    getEpubText: async () => ({ chapters, metadata: {}, toc: [], fonts: [] }),
    listComicPages: async () => ({ pages: images }),
    getConfig: async () => ({ language: 'ko', motion_preference: 'full' }),
    onConfigChange: callback => { configListeners.add(callback); return () => configListeners.delete(callback); },
    getFullscreenState: async () => ({ fullscreen: false }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
    onLoadSession: () => () => {},
};
localStorage.clear();
localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
    flowMode: 'spread', spreadCoverFirst: false, slideNavOpen: false, readingDirection: rtl ? 'rtl' : 'ltr', zoom: zoomed ? 200 : 100,
    readerSettings: { pageEffect: effect, epubStyle: original ? 'original' : 'optimized' },
}));
let pointerId = 10;
function pointer(target, type, x, y, id, buttons = type === 'pointerup' || type === 'pointercancel' ? 0 : 1) {
    const viewport = (target.ownerDocument || target).defaultView;
    const event = new viewport.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y });
    target.dispatchEvent(event);
    return event;
}
function gesture(side, { target, insideFrame = false } = {}) {
    const rect = book().getBoundingClientRect();
    const x = side === 'left' ? rect.left + 3 : rect.right - 3;
    const y = rect.top + rect.height * 0.8;
    const leaf = [...book().querySelectorAll('[data-curl-visible="true"]')][side === 'left' ? 0 : 1];
    const embedded = insideFrame ? leaf.querySelector('iframe') : null;
    check(!insideFrame || embedded?.dataset.originalReady === 'true', 'Original EPUB gestures must use a ready iframe document');
    const embeddedRect = embedded?.getBoundingClientRect();
    const doc = embedded?.contentDocument || document;
    const downTarget = target || (embedded ? doc.body : leaf.querySelector('.viewer-text-page, .viewer-comic-image') || leaf);
    const startX = embeddedRect ? Math.min(embeddedRect.width - 3, Math.max(3, x - embeddedRect.left)) : x;
    const startY = embeddedRect ? Math.min(embeddedRect.height - 3, Math.max(3, y - embeddedRect.top)) : y;
    const id = ++pointerId;
    const down = pointer(downTarget, 'pointerdown', startX, startY, id);
    let currentX = startX;
    return {
        down,
        move: ratio => { currentX = startX + (side === 'left' ? 1 : -1) * rect.width * ratio; return pointer(doc, 'pointermove', currentX, startY, id); },
        end: (type = 'pointerup') => pointer(type === 'lostpointercapture' ? book() : doc, type, currentX, startY, id, 0),
    };
}
createRoot(document.getElementById('root')).render(<ViewerApp />);
window.pageCurlDragTests = (async () => {
    const results = [];
    if (effect !== 'page') {
        const currentPages = () => [...document.querySelectorAll('.viewer-page-transition-layer.is-current [data-page-index], .viewer-page-transition-layer.is-current [data-reader-page-index]')]
            .map(node => Number(node.dataset.pageIndex ?? node.dataset.readerPageIndex)).sort((a, b) => a - b).join(',');
        await until(() => !document.querySelector('.is-initial-render-loading') && currentPages() === '0,1', 'Timed-effect fixture did not load');
        const nextPage = () => [...document.querySelectorAll('button')].find(node => node.title === '다음장').click();
        nextPage();
        await until(() => document.querySelector('.has-page-effect'), 'Full motion must start its page transition');
        updateMotion('reduced');
        await frame(); await frame();
        check(!document.querySelector('.has-page-effect') && currentPages() === '2,3', 'Reduced motion must complete a pending timed transition immediately');
        nextPage();
        await frame(); await frame();
        check(!document.querySelector('.has-page-effect') && currentPages() === '4,5', 'Reduced motion must release navigation without waiting for animation events or fallback timers');
        updateMotion('full');
        await frame(); await frame();
        nextPage();
        await until(() => document.querySelector('.has-page-effect'), 'Restoring full motion must restore the saved page effect');
        await until(() => currentPages() === '6,7' && !document.querySelector('.has-page-effect'), 'Restored effect must complete normally');
        return { label, results: ['timed transition completes on reduced motion', 'immediate repeated navigation', 'saved effect resumes in full motion'] };
    }
    await until(() => book() && !document.querySelector('.is-initial-render-loading')
        && (!original || [...book().querySelectorAll('[data-curl-visible="true"] iframe')].every(node => node.dataset.originalReady === 'true')), 'Viewer did not finish loading');
    await delay(300);
    check(sources().join(',') === '0,1', 'The fixture must start with the first two source pages');
    if (zoomed) {
        const content = document.querySelector('.viewer-content');
        const image = book().querySelector('[data-curl-visible="true"] .viewer-comic-image');
        const rect = image.getBoundingClientRect();
        const id = ++pointerId;
        content.setPointerCapture = () => {};
        const down = pointer(image, 'pointerdown', rect.left + rect.width / 2, rect.top + rect.height / 2, id);
        check(content.classList.contains('is-drag-panning') && down.defaultPrevented, 'An enlarged comic must enter pan mode');
        pointer(content, 'pointermove', rect.left + rect.width / 2 - 80, rect.top + rect.height / 2 - 40, id);
        check(!dragging() && !animating(), 'Zoom panning must not start a page curl');
        pointer(content, 'pointerup', rect.left, rect.top, id, 0);
        check(!content.classList.contains('is-drag-panning') && sources().join(',') === '0,1', 'Pan release must preserve the current spread');
        return { label, results: ['zoom panning preserves spread'] };
    }
    const forwardSide = rtl ? 'left' : 'right';
    const backwardSide = rtl ? 'right' : 'left';
    const invalid = gesture(backwardSide);
    invalid.move(0.4); invalid.end();
    await delay(100);
    check(!dragging() && !animating() && sources().join(',') === '0,1', 'A turn before the first source page must be rejected');
    results.push('first-page bounds');
    const protectedLeaf = [...book().querySelectorAll('[data-curl-visible="true"]')][rtl ? 0 : 1];
    const button = document.createElement('button');
    button.textContent = 'Interactive drag fixture';
    protectedLeaf.append(button);
    const interactive = gesture(forwardSide, { target: button });
    interactive.move(0.4); interactive.end();
    check(!interactive.down.defaultPrevented && !dragging() && !animating(), 'Interactive controls must keep native pointer behavior');
    button.remove();
    if (type !== 'comic') {
        const embedded = original ? protectedLeaf.querySelector('iframe') : null;
        const doc = embedded?.contentDocument || document;
        const text = original ? doc.getElementById('selectable') : protectedLeaf.querySelector('.viewer-reader-page-body p, .viewer-reader-page-body');
        const range = doc.createRange(); range.selectNodeContents(text);
        const selection = doc.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const selected = selection.toString();
        const rect = text.getBoundingClientRect();
        const id = ++pointerId;
        const down = pointer(text, 'pointerdown', rect.left + rect.width / 2, rect.top + 10, id);
        pointer(doc, 'pointermove', rect.left + rect.width / 2 - 80, rect.top + 10, id);
        pointer(doc, 'pointerup', rect.left + rect.width / 2 - 80, rect.top + 10, id, 0);
        check(!down.defaultPrevented && !dragging() && !animating(), 'A drag through central text must remain available for selection');
        check(selected && selection.toString() === selected, 'Existing text selection must survive a central pointer gesture');
        selection.removeAllRanges();
    }
    results.push('interactive controls and central text');
    const short = gesture(forwardSide, { insideFrame: original });
    short.move(0.12);
    await until(() => animating() && canvas()?.width > 0, 'Dragging must paint the page before pointer release');
    const firstPixels = canvas().toDataURL();
    short.move(0.22);
    await frame(); await frame();
    check(canvas().toDataURL() !== firstPixels, 'The held page must visibly follow pointer movement');
    check(sources().join(',') === '0,1', 'Dragging must not commit the page before release');
    await delay(150);
    short.end();
    await until(() => !dragging() && !animating(), 'A short drag must roll back');
    check(sources().join(',') === '0,1', 'Rollback must keep the initial spread');
    results.push('pointer-driven progress and short rollback');
    for (const cancelEvent of ['pointercancel', 'lostpointercapture']) {
        const cancelled = gesture(forwardSide, { insideFrame: original });
        cancelled.move(0.18);
        await until(animating, 'Cancellation requires an active curl');
        cancelled.end(cancelEvent);
        await until(() => !dragging() && !animating(), cancelEvent + ' must clear the curl');
        check(sources().join(',') === '0,1', cancelEvent + ' must preserve the current page');
    }
    results.push('pointer cancellation and lost capture');
    const forward = gesture(forwardSide, { insideFrame: original });
    forward.move(0.42);
    await until(animating, 'Forward drag must animate');
    const next = [...document.querySelectorAll('button')].find(node => node.title === '다음장');
    check(next && !next.disabled, 'The toolbar must expose its next-page action during the drag');
    next.click();
    check(sources().join(',') === '0,1', 'Toolbar navigation during a held drag must not advance independently');
    forward.end();
    await until(() => !dragging() && !animating() && sources().join(',') === '2,3', 'A completed drag must advance exactly one spread');
    results.push('forward commit and navigation lock');
    const backward = gesture(backwardSide, { insideFrame: original });
    backward.move(0.42);
    await until(animating, 'Backward drag must animate');
    backward.end();
    await until(() => !dragging() && !animating() && sources().join(',') === '0,1', 'Reverse drag must return to the first source pages');
    results.push('backward commit and reading direction');
    const interrupted = gesture(forwardSide, { insideFrame: original });
    interrupted.move(0.4);
    await until(animating, 'Absolute navigation requires an active drag');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', code: 'Home', bubbles: true, cancelable: true }));
    interrupted.end();
    await until(() => !dragging() && !animating(), 'Home must cancel an unfinished drag even when already at the first page');
    await delay(700);
    check(sources().join(',') === '0,1', 'An interrupted drag must not commit a stale target');
    results.push('Home cancels drag without a stale commit');
    const resumed = gesture(forwardSide, { insideFrame: original });
    resumed.move(0.42);
    resumed.end();
    await until(() => !dragging() && !animating() && sources().join(',') === '2,3', 'A new drag after Home must commit even when released before its snapshot is ready');
    results.push('drag resumes after Home and early release');
    next.click();
    await until(animating, 'Live reduced-motion test requires an active page curl');
    updateMotion('reduced');
    await frame(); await frame();
    check(!animating() && sources().join(',') === '4,5', 'Configuration changes must finish the active curl and preserve its target');
    next.click();
    await frame(); await frame();
    check(!animating() && sources().join(',') === '6,7', 'Reduced page turns must accept the next navigation immediately');
    results.push('live config updates complete curls and release navigation');
    return { label, results };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 5187, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1400, height: 1000, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('RENDERER: ' + message); });
    const reports = [];
    for (const query of ['type=text', 'type=epub&style=optimized', 'type=epub&style=original', 'type=comic&direction=ltr', 'type=comic&direction=rtl', 'type=comic&direction=ltr&zoom=200', 'type=comic&effect=fade', 'type=text&effect=slide']) {
        await window.loadURL(${JSON.stringify(fixtureUrl)} + '?' + query);
        try { reports.push(await window.webContents.executeJavaScript('window.pageCurlDragTests')); }
        catch (error) { reports.push({ query, error: error.message }); }
        console.log('PAGE_CURL_DRAG_CASE=' + JSON.stringify(reports[reports.length - 1]));
    }
    console.log('PAGE_CURL_DRAG_RESULT=' + JSON.stringify(reports));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Page curl drag renderer timed out: ' + result)); }, 120000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/PAGE_CURL_DRAG_RESULT=(.+)/)[1]);
        assert.equal(report.length, 8);
        assert.deepEqual(report.filter(item => item.error), [], output.result);
        assert.ok(report.every(item => item.results.length === (item.label.includes('200') ? 1 : /fade|slide/.test(item.label) ? 3 : 9)));
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
});
