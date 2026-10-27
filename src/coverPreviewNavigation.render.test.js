import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('큰 표지에서 방향키로 파일·폴더를 이동하고 상세 정보·이미지·닫기 포커스를 동기화한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cover-preview-navigation-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { TooltipLayer } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/TooltipLayer.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const frames = async () => { for (let index = 0; index < 4; index += 1) await frame(); };
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const cover = (color, width = 120) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + (width * 1.5) + '"><rect width="100%" height="100%" fill="' + color + '"/></svg>');
const entries = [
    { path: '/fixture/a-folder', name: 'A Folder', isDirectory: true, is_folder: true, cover_file_path: '/fixture/a-folder/cover.epub', color: '#9c3434' },
    { path: '/fixture/b-book.epub', name: 'B Book.epub', title: 'B Book title', color: '#34619c' },
    { path: '/fixture/c-late.epub', name: 'C Late.epub', title: 'C Late title', color: '#439c34' },
    { path: '/fixture/d-empty.epub', name: 'D Empty.epub', title: 'D Empty title', color: '' },
    { path: '/fixture/e-book.epub', name: 'E Book.epub', title: 'E Book title', color: '#96349c' },
].map(entry => ({ ...entry, full_path: entry.path, ext: entry.isDirectory ? '' : '.epub', size: 1024,
    exists: true, has_metadata: true, author: entry.name + ' author', cover: entry.color ? cover(entry.color) : '' }));
const originals = new Map(entries.filter(entry => entry.color).map(entry => [entry.cover_file_path || entry.path, cover(entry.color, 900)]));
const requests = [];
const pending = [];
const errors = [];
let mountKey = 0;
let completedScanKey = 0;
window.addEventListener('error', event => errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture' || filePath === entries[0].path, isFile: filePath.endsWith('.epub') }),
    readDir: async () => entries.map(entry => ({ ...entry, isFile: !entry.isDirectory })),
    scanFolder: async () => { completedScanKey = mountKey; return [...entries]; },
    getFilePreview: async () => ({ success: false }),
    getFolderDetails: async () => ({ success: true, details: { fileCount: 1, folderCount: 0, pageCount: 10, estimatedReadingSeconds: 200 } }),
    loadMetadataCover: filePath => {
        requests.push(filePath);
        if (filePath === entries[2].path) return new Promise(resolve => pending.push(() => resolve(originals.get(filePath))));
        return Promise.resolve(originals.get(filePath) || '');
    },
    readingLists: async () => ({ success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 }),
};
const root = createRoot(document.getElementById('root'));
const dialog = () => document.querySelector('.detail-cover-preview-dialog');
const image = () => dialog()?.querySelector('.detail-cover-preview-image');
const list = () => document.querySelector('.view-container');
const layer = () => document.querySelector('#folder-detail-panel .detail-panel-layer:not(.is-outgoing)');
const trigger = () => layer()?.querySelector('.detail-cover-preview-button');
const activePath = () => list()?.querySelector('.active-selection')?.dataset.filePath;
const itemFor = filePath => [...list().querySelectorAll('[data-file-path]')].find(item => item.dataset.filePath === filePath);
async function nativeInput(request) {
    await new Promise(resolve => {
        window.previewKeyRequest = request;
        window.continuePreviewKey = resolve;
        console.log('COVER_PREVIEW_KEY');
    });
    await frame();
}
const nativeKey = keyCode => nativeInput({ kind: 'key', keyCode });
async function nativePointer(element, kind = 'hover') {
    await nativeInput({ kind: 'hover', x: 2, y: 2 });
    await until(() => !element.matches(':hover') && !document.querySelector('[role="tooltip"]'), 'Pointer hover did not leave its previous target');
    const bounds = element.getBoundingClientRect();
    const x = Math.round(bounds.left + bounds.width / 2);
    const y = Math.round(bounds.top + bounds.height / 2);
    check(element.contains(document.elementFromPoint(x, y)), 'Preview navigation button must receive pointer input');
    await nativeInput({ kind, x, y });
    if (kind === 'hover') await until(() => element.matches(':hover'), 'Native hover did not reach the navigation button');
}
async function resize(width, height) {
    await nativeInput({ kind: 'resize', width, height });
    await until(() => innerWidth === width && innerHeight === height, 'Preview test window did not resize');
    await frames();
}
async function mount(preference, mode) {
    applyMotionPreference(preference);
    root.render(<><FolderTab key={++mountKey} config={{ libraries: [], folder_last_path: '/fixture', folder_view_mode: mode,
        folder_detail_panel_height: 220, folder_item_scales: { table: 75, tile: 50, thumbnail: 50 } }}
        t={t} saveConfig={async () => {}} showToast={() => {}} /><TooltipLayer /></>);
    await until(() => completedScanKey === mountKey && list()?.getAttribute('aria-busy') === 'false'
        && list().querySelectorAll('[data-file-path]').length === entries.length, 'Fixture folder did not load');
    await frames();
    itemFor(entries[1].path).click();
    await until(() => trigger() && layer().textContent.includes(entries[1].title), 'Initial book details did not load');
    await frames();
}
async function open() {
    trigger().focus();
    trigger().click();
    await until(() => dialog()?.open && dialog().dataset.phase === 'open' && image()?.complete, 'Preview did not open');
    check(dialog().matches(':modal') && dialog().contains(document.activeElement), 'Preview must retain modal focus');
    return dialog();
}
async function expectSelection(index, originalDialog, label) {
    const entry = entries[index];
    const title = entry.title || entry.name;
    await until(() => activePath() === entry.path && layer()?.textContent.includes(title), label + ': selection and metadata did not follow preview');
    if (entry.isDirectory) {
        await until(() => !layer().textContent.includes(t('folder.detail.loading')), label + ': folder details did not finish loading');
    }
    check(dialog() === originalDialog && originalDialog.open && document.querySelectorAll('.detail-cover-preview-dialog').length === 1,
        label + ': navigating must preserve one open dialog node');
    check(originalDialog.matches(':modal') && originalDialog.contains(document.activeElement), label + ': navigation lost modal focus');
    check(originalDialog.getAttribute('aria-label').includes(title), label + ': accessible cover label did not update');
    if (entry.color) {
        await until(() => image()?.complete && image().naturalWidth > 0 && image().alt === title, label + ': next cover did not load');
        check(!dialog().querySelector('[role="status"]'), label + ': previous empty-image state did not reset');
    } else {
        await until(() => dialog()?.querySelector('[role="status"]')?.textContent === t('no_image'), label + ': missing cover needs the empty-image state');
        check(!image(), label + ': missing cover retained the previous image');
    }
}
async function move(keyCode, index, originalDialog, label) {
    await nativeKey(keyCode);
    await expectSelection(index, originalDialog, label);
}
async function close(expectTrigger) {
    await nativeKey('Escape');
    await until(() => !dialog(), 'Closing preview left the dialog mounted');
    await frames();
    check(document.activeElement === (expectTrigger ? trigger() : list()), 'Closing preview did not focus the current cover or list fallback');
}
async function verifyNavigationButtons(current, preference) {
    const previous = current.querySelector('.detail-cover-preview-prev');
    const next = current.querySelector('.detail-cover-preview-next');
    check(previous && next && current.querySelectorAll('.detail-cover-preview-nav').length === 2, 'Preview needs previous and next arrow buttons');
    const assertBounds = () => {
        const body = current.querySelector('.detail-cover-preview-body').getBoundingClientRect();
        for (const [button, side] of [[previous, 'previous'], [next, 'next']]) {
            const bounds = button.getBoundingClientRect();
            check(bounds.width >= 40 && bounds.height >= 40 && bounds.left >= 0 && bounds.right <= innerWidth
                && bounds.top >= 0 && bounds.bottom <= innerHeight, side + ': navigation control must fit in the viewport');
            check(Math.abs(bounds.top + bounds.height / 2 - body.top - body.height / 2) <= 1, side + ': arrow must align with the cover center');
            check(side === 'previous' ? bounds.right <= body.left : bounds.left >= body.right, side + ': arrow must sit beside the artwork');
        }
    };
    const hoverHint = async (button, direction) => {
        const hint = t('folder.detail.preview_' + direction + '_hint');
        check(button.getAttribute('aria-label') === t('folder.detail.preview_' + direction)
            && button.getAttribute('data-tooltip') === hint && !button.hasAttribute('title'), direction + ': arrow needs translated label and keyboard tooltip');
        await frames();
        await nativePointer(button);
        await until(() => {
            const tooltip = current.querySelector('[role="tooltip"]');
            return tooltip?.textContent === hint && getComputedStyle(tooltip).visibility === 'visible';
        }, preference + ' ' + innerWidth + ' ' + direction + ': native hover did not show the keyboard hint');
        const tooltip = current.querySelector('[role="tooltip"]');
        check(tooltip.parentElement === current && button.getAttribute('aria-describedby')?.split(' ').includes(tooltip.id), direction + ': tooltip must stay in the modal and describe its button');
        const bounds = tooltip.getBoundingClientRect();
        check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
            direction + ': keyboard tooltip must fit in the viewport');
    };
    assertBounds();
    await hoverHint(previous, 'previous');
    await nativePointer(previous, 'click');
    await expectSelection(0, current, preference + ' previous button');
    await hoverHint(next, 'next');
    await nativePointer(next, 'click');
    await expectSelection(1, current, preference + ' next button');
    await resize(360, 640);
    assertBounds();
    await hoverHint(previous, 'previous');
    await nativePointer(previous, 'click');
    await expectSelection(0, current, preference + ' narrow previous button');
    await hoverHint(next, 'next');
    await nativePointer(next, 'click');
    await expectSelection(1, current, preference + ' narrow next button');
    await resize(1280, 900);
    assertBounds();
    if (preference === 'full' && ${JSON.stringify(Boolean(process.env.BOOKMANAGER_COVER_NAVIGATION_SCREENSHOT))}) {
        await hoverHint(next, 'next');
        await frames();
        await nativeInput({ kind: 'capture' });
    }
}
async function verify(preference, mode) {
    await mount(preference, mode);
    const originalTrigger = trigger();
    const current = await open();
    await expectSelection(1, current, preference + ' initial');
    await verifyNavigationButtons(current, preference);
    await move('Right', 2, current, preference + ' next file');
    await until(() => pending.length > 0, 'Deferred original cover request did not start');
    check(image().getAttribute('src') === entries[2].cover, 'Deferred original must show the current thumbnail immediately');
    await move('Down', 3, current, preference + ' empty cover');
    await nativePointer(current.querySelector('.detail-cover-preview-next'), 'click');
    await expectSelection(4, current, preference + ' next button after empty cover');
    await until(() => image()?.getAttribute('src') === originals.get(entries[4].path), 'Newest original cover did not load');
    pending.splice(0).forEach(resolve => resolve());
    await frames();
    check(image().getAttribute('src') === originals.get(entries[4].path), 'Late original cover overwrote the new selection');
    await move('Right', 4, current, preference + ' last boundary');
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, repeat: true }));
    await expectSelection(3, current, preference + ' held arrow');
    await move('Up', 2, current, preference + ' previous Up');
    await move('Left', 1, current, preference + ' previous Left');
    await move('Up', 0, current, preference + ' file to folder');
    await until(() => image()?.getAttribute('src') === originals.get(entries[0].cover_file_path), 'Folder preview did not load its source file cover');
    check(requests.includes(entries[0].cover_file_path) && !requests.includes(entries[0].path), 'Folder preview must request cover_file_path instead of its directory path');
    await move('Left', 0, current, preference + ' first boundary');
    await move('Down', 1, current, preference + ' folder to file');
    await move('Right', 2, current, preference + ' next deferred file');
    await move('Down', 3, current, preference + ' next missing file');
    await move('Right', 4, current, preference + ' final cover');
    await frames();
    check(trigger() !== originalTrigger, 'Fixture must replace the original cover trigger during navigation');
    await close(true);
    const reopened = await open();
    await move('Left', 3, reopened, preference + ' close without cover');
    await close(false);
    pending.splice(0).forEach(resolve => resolve());
    await frames();
    check(!dialog() && activePath() === entries[3].path, 'Late original response reopened or changed the closed preview');
    return { preference, mode, originalRequests: requests.length };
}
window.runCoverPreviewNavigationTests = async () => {
    const results = [await verify('full', 'table'), await verify('reduced', 'thumbnail')];
    root.unmount();
    check(errors.length === 0, 'Unexpected renderer errors: ' + errors.join('; '));
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
        if (message !== 'COVER_PREVIEW_KEY') return;
        const request = await window.webContents.executeJavaScript('window.previewKeyRequest');
        if (request.kind === 'key' || request.kind === 'click') window.webContents.focus();
        if (request.kind === 'key') {
            const { keyCode } = request;
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        } else if (request.kind === 'resize') {
            window.setContentSize(request.width, request.height);
        } else if (request.kind === 'capture') {
            const screenshot = await window.webContents.capturePage();
            require('node:fs').writeFileSync(${JSON.stringify(process.env.BOOKMANAGER_COVER_NAVIGATION_SCREENSHOT || '/private/tmp/bookmanager-cover-navigation.png')}, screenshot.toPNG());
        } else {
            const { x, y } = request;
            window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
            if (request.kind === 'click') {
                window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
                window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
            }
        }
        await window.webContents.executeJavaScript('window.continuePreviewKey()');
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runCoverPreviewNavigationTests()');
    console.log('COVER_PREVIEW_NAVIGATION_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Cover preview navigation renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/COVER_PREVIEW_NAVIGATION_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        const results = JSON.parse(payload);
        assert.deepEqual(results.map(result => result.preference), ['full', 'reduced']);
        for (const result of results) t.diagnostic(JSON.stringify(result));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
