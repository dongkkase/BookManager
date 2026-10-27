import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('목록 방향키가 포커스·표시 순서·범위 선택과 가상 목록의 화면 이동을 따른다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-keyboard-selection-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(typeof message === 'function' ? message() : message);
}
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#36536c"/></svg>');
const books = Array.from({ length: 400 }, (_, index) => ({
    path: '/fixture/book-' + index + '.epub', full_path: '/fixture/book-' + index + '.epub',
    name: 'Book ' + String(index).padStart(3, '0') + '.epub', title: 'Keyboard book ' + index,
    author: index % 3 === 0 ? 'A author' : 'B author', ext: '.epub', size: 1024, exists: true, has_metadata: true, cover,
}));
let entries = books.slice(0, 24);
let completedScanKey = 0;
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: filePath !== '/fixture' }),
    readDir: async () => entries.map(book => ({ ...book, isFile: true })),
    scanFolder: async () => { completedScanKey = mountKey; return [...entries]; },
    getFilePreview: async () => ({ success: false }), loadMetadataCover: async () => cover,
    readingLists: async () => ({ success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 }),
};
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
const list = () => document.querySelector('.view-container');
const scroller = () => list()?.querySelector('.file-table-container, .tile-grid, .thumbnail-grid');
const itemFor = filePath => [...list().querySelectorAll('[data-file-path]')].find(item => item.dataset.filePath === filePath);
const visibleItems = () => [...list().querySelectorAll('[data-file-path]')];
const paths = () => visibleItems().map(item => item.dataset.filePath);
const selectedPaths = () => visibleItems().filter(item => item.classList.contains('selected')).map(item => item.dataset.filePath);
const activePath = () => list().querySelector('.active-selection')?.dataset.filePath;
async function nativeInput(request) {
    await new Promise(resolve => {
        window.keyboardInputRequest = request;
        window.continueKeyboardInput = resolve;
        console.log('FOLDER_KEYBOARD_INPUT');
    });
    await frame();
}
const key = (keyCode, modifiers = []) => nativeInput({ kind: 'key', keyCode, modifiers });
async function clickItem(filePath) {
    const item = itemFor(filePath);
    check(item, 'Missing clickable item: ' + filePath);
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await frame();
    const target = item.querySelector('.file-name-cell, .tile-title') || item;
    const bounds = target.getBoundingClientRect();
    const viewport = scroller().getBoundingClientRect();
    const x = Math.round(Math.max(bounds.left, viewport.left) + Math.min(bounds.width, viewport.width) / 2);
    const y = Math.round((Math.max(bounds.top, viewport.top) + Math.min(bounds.bottom, viewport.bottom)) / 2);
    check(item.contains(document.elementFromPoint(x, y)), 'Item click must hit the actual list item');
    await nativeInput({ kind: 'click', x, y });
    await until(() => activePath() === filePath, 'Mouse selection did not activate ' + filePath);
}
async function expectActive(filePath, label) {
    await until(() => activePath() === filePath, label + ': active item mismatch, got ' + activePath());
    const book = books.find(entry => entry.path === filePath);
    await until(() => document.querySelector('#folder-detail-panel')?.textContent.includes(book.title), label + ': details did not follow selection');
}
async function mount(mode, count = 24, extra = {}) {
    entries = books.slice(0, count).reverse();
    root.render(<FolderTab key={++mountKey} config={{ libraries: [], folder_last_path: '/fixture', folder_view_mode: mode,
        folder_detail_panel_height: 200, folder_item_scales: { table: 75, tile: 50, thumbnail: 50 }, ...extra }}
        t={t} saveConfig={async () => {}} showToast={() => {}} />);
    await until(() => completedScanKey === mountKey && list()?.getAttribute('aria-busy') === 'false' && paths().length > 1
        && (mode === 'table' ? list().querySelector('table') : list().querySelector('.' + (mode === 'tile' ? 'tile-grid' : 'thumbnail-grid'))), mode + ': fixture did not load');
    for (let index = 0; index < 4; index += 1) await frame();
}
async function verifyTable() {
    await mount('table', 24, { folder_group_key: 'author', folder_sort_order: 'desc' });
    const order = paths();
    check(order[0] === books[21].path && order[1] === books[18].path, 'Grouped descending order must differ from input and filename order');
    const search = document.querySelector('.search-input');
    search.focus();
    await clickItem(order[0]);
    check(document.activeElement === list(), 'Clicking a row after search must move keyboard focus to the list');
    await key('Down');
    await expectActive(order[1], 'Table ArrowDown');
    list().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, repeat: true }));
    await expectActive(order[2], 'Held ArrowDown');
    await key('Down', ['shift']);
    await expectActive(order[3], 'Shift ArrowDown');
    check(JSON.stringify(selectedPaths()) === JSON.stringify(order.slice(2, 4)), 'Shift ArrowDown must extend from the active selection');
    await key('Up', ['shift']);
    await expectActive(order[2], 'Shift ArrowUp');
    check(JSON.stringify(selectedPaths()) === JSON.stringify([order[2]]), 'Shift ArrowUp must contract the range');
    for (const [keyCode, modifiers] of [['Left', []], ['Right', []], ['Down', ['control']], ['Down', ['meta']], ['Down', ['alt']]]) {
        await key(keyCode, modifiers);
        check(activePath() === order[2], 'Table must ignore horizontal or modified arrows: ' + keyCode + ' ' + modifiers);
    }
    for (const [label, control] of [
        ['search', search],
        ['path', document.querySelector('.goto-path-input')],
        ['sidebar', document.querySelector('.folder-left-panel button')],
        ['table header', list().querySelector('th button')],
    ]) {
        check(control, 'Missing focus scope: ' + label);
        control.focus();
        await key('Down');
        check(activePath() === order[2], label + ' arrow must not change list selection');
    }
    list().focus();
    const coverButton = document.querySelector('#folder-detail-panel .detail-cover-preview-button');
    check(coverButton, 'Missing cover preview button');
    coverButton.click();
    await until(() => document.querySelector('.detail-cover-preview-dialog'), 'Cover dialog did not open');
    await key('Down');
    await expectActive(order[3], 'Cover dialog ArrowDown');
    await key('Escape');
    await until(() => !document.querySelector('.detail-cover-preview-dialog'), 'Cover dialog did not close');
    list().focus();
    await key('Up');
    await expectActive(order[2], 'Arrow navigation after closing dialog');
    return { mode: 'table', orderedRows: order.length };
}
async function verifyGrid(mode) {
    await mount(mode);
    const order = paths();
    const columns = Number(scroller().dataset.navigationColumns);
    check(columns > 1 && order.length > columns * 2, mode + ': expected multiple grid rows and columns');
    await clickItem(order[0]);
    await key('Right');
    await expectActive(order[1], mode + ' ArrowRight');
    await key('Down');
    await expectActive(order[columns + 1], mode + ' ArrowDown');
    await key('Left');
    await expectActive(order[columns], mode + ' ArrowLeft');
    await key('Up');
    await expectActive(order[0], mode + ' ArrowUp');
    await key('Left');
    await expectActive(order[0], mode + ' first boundary');
    return { mode, columns };
}
async function verifyVirtualReveal(mode) {
    await mount(mode, 400);
    const viewport = scroller();
    check(paths().length < 400, mode + ': fixture must use virtualization');
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    for (let index = 0; index < 3; index += 1) await frame();
    const startIndex = 280;
    viewport.scrollTop = viewport.scrollHeight * startIndex / books.length;
    await until(() => itemFor(books[startIndex].path), () => mode + ': distant item was not rendered after scrolling: ' + JSON.stringify({
        connected: viewport.isConnected, current: viewport === scroller(), top: viewport.scrollTop, height: viewport.scrollHeight, viewport: viewport.clientHeight, paths: paths(),
    }));
    await clickItem(books[startIndex].path);
    await expectActive(books[startIndex].path, mode + ' distant mouse selection');
    for (let index = 0; index < 4; index += 1) await frame();
    viewport.scrollTop = 0;
    await until(() => !itemFor(books[startIndex].path), mode + ': selected item must be unmounted before keyboard reveal');
    list().focus();
    const columns = mode === 'table' ? 1 : Number(viewport.dataset.navigationColumns);
    const expected = books[startIndex - columns].path;
    await key('Up');
    await expectActive(expected, mode + ' virtual keyboard reveal');
    const fullyVisible = filePath => {
        const itemBounds = itemFor(filePath)?.getBoundingClientRect();
        const viewBounds = viewport.getBoundingClientRect();
        const headerHeight = viewport.querySelector('thead')?.offsetHeight || 0;
        return itemBounds && itemBounds.top >= viewBounds.top + headerHeight - 1 && itemBounds.bottom <= viewBounds.bottom + 1;
    };
    await until(() => fullyVisible(expected), mode + ': selected virtual item must be fully visible below the table header');
    check(viewport.scrollTop > 0, mode + ': keyboard navigation did not restore the offscreen selection');
    for (let index = 0; index < 4; index += 1) await frame();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    await frame();
    viewport.scrollTop += viewport.clientHeight * 2;
    await until(() => !itemFor(expected) || itemFor(expected).getBoundingClientRect().bottom < viewport.getBoundingClientRect().top,
        mode + ': selection must move above the viewport before upward reveal');
    const previous = books[startIndex - columns * 2].path;
    await key('Up');
    await expectActive(previous, mode + ' upward keyboard reveal');
    await until(() => fullyVisible(previous), mode + ': upward navigation hid the selected item behind the header');
    for (let index = 0; index < 4; index += 1) await frame();
    check(fullyVisible(previous), mode + ': selection scrolling moved the item back behind the header');
    return { mode: mode + '-virtual', columns, scrollTop: viewport.scrollTop };
}
window.runFolderKeyboardSelectionTests = async () => {
    applyMotionPreference('reduced');
    const results = [await verifyTable()];
    for (const mode of ['tile', 'thumbnail']) results.push(await verifyGrid(mode));
    for (const mode of ['table', 'tile', 'thumbnail']) results.push(await verifyVirtualReveal(mode));
    root.unmount();
    return results;
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
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
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message !== 'FOLDER_KEYBOARD_INPUT') return;
        const request = await window.webContents.executeJavaScript('window.keyboardInputRequest');
        window.webContents.focus();
        if (request.kind === 'click') {
            const { x, y } = request;
            window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
            window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        } else {
            const { keyCode, modifiers } = request;
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        }
        await window.webContents.executeJavaScript('window.continueKeyboardInput()');
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runFolderKeyboardSelectionTests()');
    console.log('FOLDER_KEYBOARD_SELECTION_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder keyboard renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/FOLDER_KEYBOARD_SELECTION_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        const results = JSON.parse(payload);
        assert.deepEqual(results.map(result => result.mode), ['table', 'tile', 'thumbnail', 'table-virtual', 'tile-virtual', 'thumbnail-virtual']);
        for (const result of results) t.diagnostic(JSON.stringify(result));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
