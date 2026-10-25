import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('10색 하이라이트와 밑줄·취소선의 선택·저장·재진입, 외부 삭제와 원본 EPUB 표시를 확인한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-highlight-colors-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import { HIGHLIGHT_COLORS, highlightBackground } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/highlightColors.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let index = 0; index < 5; index += 1) await frame(); };
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message + ': ' + document.body.innerText.slice(0, 240));
}
const phrase = id => 'The ' + id + ' passage';
const allIds = [...HIGHLIGHT_COLORS.map(color => color.id), 'underline', 'strikethrough'];
const text = allIds.map(phrase).join('. ') + '.';
const pathFor = type => '/fixture/highlight-colors.' + (type === 'text' ? 'txt' : 'epub');
const storageKey = type => 'bookmanager-viewer-highlights:' + pathFor(type);
const annotation = id => ({ id: 'saved-' + id, text: phrase(id), snippet: phrase(id), color: id, pageIndex: 0, createdAt: '2026-10-25T10:00:00Z' });
const chapter = {
    name: 'chapter.xhtml', title: 'Highlight palette', text,
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: 'body { font: 16px/24px sans-serif; } p { margin: 0 0 8px; }',
        html: '<html><body>' + allIds.map(id => '<p id="' + id + '">' + phrase(id) + '</p>').join('') + '</body></html>',
    },
};
let loadSession;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'reduced' }),
    getText: async () => ({ text }),
    getEpubText: async () => ({ chapters: [chapter], toc: [], fonts: [] }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
};
const root = createRoot(document.getElementById('root'));
let mountCount = 0;
async function mount(type) {
    loadSession = null;
    const id = type + '-' + ++mountCount;
    localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
        flowMode: 'single', slideNavOpen: false,
        readerSettings: { epubStyle: 'original', pageEffect: 'none', showHeader: false, showFooter: false },
    }));
    root.render(<ViewerApp key={id} />);
    await until(() => loadSession, 'Missing session listener');
    await loadSession({ id, type, filePath: pathFor(type), fileName: 'Highlight palette', preview: true });
    await until(() => document.querySelector('.viewer-app') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading')
        && (type === 'text' ? document.querySelector('.viewer-text-page') : document.querySelector('.viewer-content iframe')?.dataset.originalReady === 'true'), 'Reader is not ready');
    await settle();
}
function findText(quote) {
    const walker = document.createTreeWalker(document.querySelector('.viewer-content'), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf(quote);
        if (offset >= 0 && node.parentElement.getBoundingClientRect().width > 0) return { node, offset };
    }
    throw new Error('Missing selectable text: ' + quote);
}
async function select(quote, suppliedNode) {
    const { node, offset } = suppliedNode ? { node: suppliedNode, offset: 0 } : findText(quote);
    const selection = node.ownerDocument.defaultView.getSelection();
    const range = node.ownerDocument.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + quote.length);
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = range.getBoundingClientRect();
    node.parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.right, clientY: rect.top }));
    await until(() => document.querySelector('.viewer-selection-toolbar[data-menu-state="open"]'), 'Selection toolbar did not open');
    await settle();
    return document.querySelector('.viewer-selection-toolbar[data-menu-state="open"]');
}
function deleteHighlightFromOtherWindow(type, id) {
    const key = storageKey(type);
    const oldValue = localStorage.getItem(key);
    const nextValue = JSON.stringify(JSON.parse(oldValue).filter(entry => entry.id !== id));
    localStorage.setItem(key, nextValue);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: nextValue, storageArea: localStorage, url: location.href }));
}
function checkToolbar(toolbar) {
    const buttons = [...toolbar.querySelectorAll('.viewer-selection-color')];
    check(buttons.length === 12, 'Toolbar must provide 10 colors, underline, and strikethrough');
    const rects = HIGHLIGHT_COLORS.map(color => {
        const swatch = toolbar.querySelector('.viewer-highlight-swatch.is-' + color.id);
        check(swatch, 'Missing swatch: ' + color.id);
        check(swatch.closest('button').getAttribute('aria-label') === color.label, 'Missing color label: ' + color.id);
        const expected = document.createElement('span');
        expected.style.color = color.hex;
        check(getComputedStyle(swatch).backgroundColor === expected.style.color, 'Swatch differs from the shared palette: ' + color.id);
        return swatch.closest('button').getBoundingClientRect();
    });
    check(rects.slice(0, 5).every(rect => Math.abs(rect.top - rects[0].top) < 1), 'First five colors should share the first row');
    check(rects.slice(5).every(rect => Math.abs(rect.top - rects[5].top) < 1) && rects[5].top >= rects[0].bottom, 'New colors should share the second row');
    const underline = toolbar.querySelector('.viewer-selection-color.is-underline').getBoundingClientRect();
    const strikethroughButton = toolbar.querySelector('.viewer-selection-color.is-strikethrough');
    const strikethrough = strikethroughButton.getBoundingClientRect();
    check(underline.left >= rects[4].right && Math.abs(underline.top - rects[0].top) < 1, 'Underline should occupy the last column of the first row');
    check(strikethrough.left >= rects[9].right && Math.abs(strikethrough.top - rects[5].top) < 1 && strikethrough.top >= underline.bottom, 'Strikethrough should occupy the last column of the second row');
    check(strikethroughButton.getAttribute('aria-label') === '취소선 긋기' && strikethroughButton.title === '취소선 긋기', 'Strikethrough should have an accessible label and tooltip');
    const bounds = toolbar.getBoundingClientRect();
    check(bounds.left >= 9 && bounds.right <= innerWidth - 9 && bounds.top >= 9 && bounds.bottom <= innerHeight - 9,
        'Toolbar extends beyond the viewport: ' + JSON.stringify(bounds.toJSON()));
    return { width: innerWidth, height: innerHeight, buttons: buttons.length, top: bounds.top, bottom: bounds.bottom };
}
window.runHighlightColors = async () => {
    localStorage.clear();
    const existing = [...HIGHLIGHT_COLORS.slice(0, 5).map(color => color.id), 'underline'];
    localStorage.setItem(storageKey('text'), JSON.stringify(existing.map(annotation)));
    await mount('text');
    let toolbar;
    for (const color of HIGHLIGHT_COLORS.slice(5)) {
        toolbar = await select(phrase(color.id));
        checkToolbar(toolbar);
        toolbar.querySelector('.viewer-highlight-swatch.is-' + color.id).closest('button').click();
        await until(() => JSON.parse(localStorage.getItem(storageKey('text'))).some(entry => entry.color === color.id), 'New color was not saved: ' + color.id);
        await until(() => document.querySelector('.viewer-text-highlight.is-' + color.id), 'New color was not applied to the text: ' + color.id);
        check(getComputedStyle(document.querySelector('.viewer-text-highlight.is-' + color.id)).backgroundColor === highlightBackground(color.id), 'Text highlight differs from the shared palette: ' + color.id);
        document.querySelector('.viewer-navigation-close')?.click();
        await settle();
    }
    toolbar = await select(phrase('strikethrough'));
    toolbar.querySelector('.viewer-selection-color.is-strikethrough').click();
    await until(() => document.querySelector('.viewer-text-highlight.is-strikethrough'), 'Strikethrough was not applied to the text');
    const strikeStyle = getComputedStyle(document.querySelector('.viewer-text-highlight.is-strikethrough'));
    check(strikeStyle.textDecorationLine === 'line-through' && strikeStyle.backgroundColor === 'rgba(0, 0, 0, 0)', 'Text strikethrough should draw a line without a highlight background');
    check(document.querySelector('.viewer-navigation-highlight-label svg[data-icon="strikethrough"]'), 'Navigation should identify strikethrough with its icon');
    const saved = JSON.parse(localStorage.getItem(storageKey('text')));
    check(saved.length === 12 && allIds.every(id => saved.some(entry => entry.color === id)), 'Colors, underline, and strikethrough should all retain their IDs');
    await mount('text');
    for (const id of allIds) await until(() => document.querySelector('.viewer-text-highlight.is-' + id), 'Reopening lost a saved color: ' + id);
    const retained = JSON.parse(localStorage.getItem(storageKey('text')));
    check(JSON.stringify(retained) === JSON.stringify(saved), 'Reopening must not rewrite stored highlights');
    toolbar = await select(phrase('orange'));
    return { colors: saved.map(entry => entry.color), toolbar: checkToolbar(toolbar) };
};
window.runHighlightEdges = async () => {
    document.querySelector('.viewer-content').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1, button: 0 }));
    window.getSelection().removeAllRanges();
    await settle();
    const results = [];
    for (const edge of ['top', 'bottom']) {
        const target = document.createElement('span');
        target.textContent = 'Edge selection';
        Object.assign(target.style, { position: 'fixed', right: '12px', zIndex: '2', color: '#fff', font: '14px sans-serif', [edge]: '14px' });
        document.querySelector('.viewer-content').append(target);
        const toolbar = await select(target.textContent, target.firstChild);
        results.push({ edge, ...checkToolbar(toolbar) });
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        window.getSelection().removeAllRanges();
        target.remove();
        await settle();
    }
    const target = document.createElement('span');
    target.textContent = 'Narrow palette';
    Object.assign(target.style, { position: 'fixed', left: '12px', top: '40px', color: '#fff', font: '14px sans-serif' });
    document.querySelector('.viewer-content').append(target);
    await select(target.textContent, target.firstChild);
    return results;
};
window.runExternalHighlightRemoval = async () => {
    const saved = JSON.parse(localStorage.getItem(storageKey('text')));
    const removed = saved.find(entry => entry.color === 'orange');
    deleteHighlightFromOtherWindow('text', removed.id);
    await until(() => !document.querySelector('.viewer-text-highlight.is-orange'), 'External deletion did not remove the text highlight');
    check(document.querySelector('.viewer-text-highlight.is-blue'), 'External deletion removed an unrelated text highlight');
    const toolbar = await select(phrase('red'));
    toolbar.querySelector('.viewer-highlight-swatch.is-yellow').closest('button').click();
    await until(() => JSON.parse(localStorage.getItem(storageKey('text'))).some(entry => entry.text === phrase('red') && entry.color === 'yellow'), 'Could not save a text highlight after external deletion');
    const updated = JSON.parse(localStorage.getItem(storageKey('text')));
    check(updated.length === saved.length && !updated.some(entry => entry.id === removed.id), 'Adding a text highlight restored an externally deleted annotation');
    check(!document.querySelector('.viewer-text-highlight.is-orange'), 'Adding a text highlight restored the deleted text marking');
    document.querySelector('.viewer-navigation-close')?.click();
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage, url: location.href }));
    await until(() => !document.querySelector('.viewer-text-highlight'), 'Clearing external storage did not remove the text highlights');
    return { deleted: removed.color, savedAfterDeletion: updated.length, cleared: true };
};
window.runEpubHighlightColors = async () => {
    const existingIds = allIds.filter(id => id !== 'strikethrough');
    localStorage.setItem(storageKey('epub'), JSON.stringify(existingIds.map(annotation)));
    await mount('epub');
    let iframe = document.querySelector('.viewer-content iframe');
    let doc = iframe.contentDocument;
    let viewport = iframe.contentWindow;
    await until(() => existingIds.every(id => viewport.CSS.highlights.get('bookmanager-highlight-' + id)?.size > 0), 'Original EPUB did not restore existing highlights');
    const strikeToolbar = await select(phrase('strikethrough'), doc.getElementById('strikethrough').firstChild);
    strikeToolbar.querySelector('.viewer-selection-color.is-strikethrough').click();
    await until(() => JSON.parse(localStorage.getItem(storageKey('epub'))).some(entry => entry.color === 'strikethrough'), 'Original EPUB strikethrough was not saved');
    const beforeReopen = localStorage.getItem(storageKey('epub'));
    await mount('epub');
    iframe = document.querySelector('.viewer-content iframe');
    doc = iframe.contentDocument;
    viewport = iframe.contentWindow;
    await until(() => allIds.every(id => viewport.CSS.highlights.get('bookmanager-highlight-' + id)?.size > 0), 'Original EPUB did not register all highlight colors');
    check(localStorage.getItem(storageKey('epub')) === beforeReopen, 'Reopening original EPUB must preserve saved strikethrough and colors');
    const style = doc.querySelector('style[data-original-layout]');
    for (const color of HIGHLIGHT_COLORS) {
        const name = 'bookmanager-highlight-' + color.id;
        const rule = [...style.sheet.cssRules].find(rule => rule.selectorText === '::highlight(' + name + ')');
        check(rule?.style.backgroundColor === highlightBackground(color.id), 'Original EPUB color differs from the shared palette: ' + color.id);
        const ranges = [...viewport.CSS.highlights.get(name)];
        check(ranges.some(range => range.toString() === phrase(color.id)), 'Original EPUB range lost text for ' + color.id);
    }
    check(style.textContent.includes('::highlight(bookmanager-search)') && style.textContent.includes('::highlight(bookmanager-highlight-underline)'), 'Search highlights and underline styles should remain available');
    const strikeRule = [...style.sheet.cssRules].find(rule => rule.selectorText === '::highlight(bookmanager-highlight-strikethrough)');
    check(strikeRule?.style.textDecorationLine === 'line-through' && !strikeRule.style.backgroundColor, 'Original EPUB strikethrough should draw a line without a highlight background');
    check([...viewport.CSS.highlights.get('bookmanager-highlight-strikethrough')].some(range => range.toString() === phrase('strikethrough')), 'Original EPUB strikethrough lost its selected text');
    const saved = JSON.parse(localStorage.getItem(storageKey('epub')));
    check(saved.length === 12 && allIds.every(id => saved.some(entry => entry.color === id)), 'EPUB annotation IDs changed while reading');
    deleteHighlightFromOtherWindow('epub', 'saved-orange');
    await until(() => !viewport.CSS.highlights.get('bookmanager-highlight-orange')?.size, 'External deletion did not remove the original EPUB highlight');
    check(viewport.CSS.highlights.get('bookmanager-highlight-blue')?.size > 0, 'External deletion removed an unrelated EPUB highlight');
    const toolbar = await select(phrase('red'), doc.getElementById('red').firstChild);
    toolbar.querySelector('.viewer-highlight-swatch.is-yellow').closest('button').click();
    await until(() => JSON.parse(localStorage.getItem(storageKey('epub'))).some(entry => entry.text === phrase('red') && entry.color === 'yellow'), 'Could not save an EPUB highlight after external deletion');
    const updated = JSON.parse(localStorage.getItem(storageKey('epub')));
    check(updated.length === saved.length && !updated.some(entry => entry.id === 'saved-orange'), 'Adding an EPUB highlight restored an externally deleted annotation');
    await settle();
    check(!viewport.CSS.highlights.get('bookmanager-highlight-orange')?.size, 'Adding an EPUB highlight restored the deleted EPUB marking');
    root.unmount();
    return { colors: allIds, registered: allIds.length, deleted: 'orange', savedAfterDeletion: updated.length };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    await window.loadURL('http://127.0.0.1:${server.httpServer.address().port}/');
    const text = await window.webContents.executeJavaScript('window.runHighlightColors()');
    const capture = async name => {
        if (process.env.BOOKMANAGER_HIGHLIGHT_CAPTURE) require('fs').writeFileSync(process.env.BOOKMANAGER_HIGHLIGHT_CAPTURE + '.' + name + '.png', (await window.webContents.capturePage()).toPNG());
    };
    await capture('wide');
    window.setContentSize(360, 360);
    const edges = await window.webContents.executeJavaScript('window.runHighlightEdges()');
    await capture('narrow');
    window.setContentSize(1000, 760);
    const external = await window.webContents.executeJavaScript('window.runExternalHighlightRemoval()');
    const epub = await window.webContents.executeJavaScript('window.runEpubHighlightColors()');
    console.log('HIGHLIGHT_COLORS_RESULT=' + JSON.stringify({ text, edges, external, epub }));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Highlight renderer timed out: ' + result)); }, 90000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/HIGHLIGHT_COLORS_RESULT=(.+)/)[1]);
        assert.equal(report.text.colors.length, 12);
        assert.equal(report.text.toolbar.buttons, 12);
        assert.equal(report.edges.length, 2);
        assert.ok(report.edges.every(edge => edge.width === 360 && edge.buttons === 12));
        assert.deepEqual(report.external, { deleted: 'orange', savedAfterDeletion: 12, cleared: true });
        assert.equal(report.epub.registered, 12);
        assert.equal(report.epub.deleted, 'orange');
        assert.equal(report.epub.savedAfterDeletion, 12);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
