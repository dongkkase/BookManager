import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('초기 목록의 화면 밖 행을 제한하고 메타데이터 로딩 중 클릭·드래그 선택을 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-startup-selection-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { FOLDER_COLUMNS } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/folderColumnLayout.js')}`)};
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
    throw new Error(message);
}
const root = createRoot(document.getElementById('root'));
let entries = [];
let releaseMetadata;
let mountKey = 0;
let metadataLoaded = false;
let missingBusy = false;
let missingFinished = false;
window.startupMissing.onBusy(() => { missingBusy = true; });
const date = '2026-01-02T03:04:00Z';
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: filePath !== '/fixture' }),
    readDir: async () => entries.map(entry => ({ ...entry, isFile: !entry.isDirectory })),
    scanFolder: async (_folderPath, options) => {
        if (!options.skipArchiveExtraction) return entries;
        await new Promise(resolve => { releaseMetadata = resolve; });
        metadataLoaded = true;
        return entries;
    },
    getFilePreview: async () => ({ success: false }),
    getFolderDetails: async () => ({ success: true, details: { fileCount: 1, folderCount: 0 } }),
    checkMissingVolumes: async (...args) => {
        try { return await window.startupMissing.check(...args); }
        finally { missingFinished = true; }
    },
    readingLists: async () => ({ success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 }),
};
const scroller = () => document.querySelector('.file-table-container');
const rows = () => [...scroller().querySelectorAll('[data-file-path]')];
const selectedPaths = () => rows().filter(row => row.getAttribute('aria-selected') === 'true').map(row => row.dataset.filePath);
const activePath = () => scroller().querySelector('.active-selection')?.dataset.filePath;
async function input(request) {
    await new Promise(resolve => {
        window.startupSelectionInput = request;
        window.continueStartupSelection = resolve;
        console.log('STARTUP_SELECTION_INPUT');
    });
    await frame();
}
async function clickRow(row) {
    const bounds = row.getBoundingClientRect();
    await input({ kind: 'click', x: Math.round(bounds.left + 30), y: Math.round(bounds.top + bounds.height / 2) });
    await until(() => activePath() === row.dataset.filePath, 'Click did not select the entry');
}
async function mount(count, grouped) {
    releaseMetadata = null;
    metadataLoaded = false;
    entries = Array.from({ length: count }, (_, index) => {
        const isDirectory = count === 4 || index < 2;
        const name = (isDirectory ? 'Folder ' : 'Book ') + String(index).padStart(3, '0') + (isDirectory ? '' : '.epub');
        return { name, path: '/fixture/' + name, full_path: '/fixture/' + name, isDirectory,
            title: name, ext: isDirectory ? '' : '.epub', author: 'Author', created: date, modified: date,
            size: 1024, has_metadata: true, exists: true };
    });
    root.render(<FolderTab key={++mountKey} config={{ libraries: count === 4 ? ['/fixture'] : [], folder_last_path: '/fixture',
        folder_view_mode: 'table', folder_group_key: grouped ? 'author' : 'none',
        folder_column_layout: FOLDER_COLUMNS.map(column => ({ ...column, visible: ['name', 'created', 'modified'].includes(column.key) })),
    }} t={t} saveConfig={async () => {}} showToast={() => {}} />);
    await until(() => releaseMetadata && scroller() && rows().length > 2, 'Initial quick list did not appear');
    await frame();
    await frame();
}
window.runStartupSelectionTests = async () => {
    applyMotionPreference('full');
    const results = [];
    for (const count of [4, 300, 100, 40]) {
        await mount(count, count === 300);
        if (count === 4) await until(() => missingBusy, 'Startup did not start the automatic missing-volume check');
        const initialRows = rows().length;
        if (count >= 100) check(initialRows < count / 2, 'Startup rendered offscreen rows: ' + initialRows + '/' + count);
        else check(initialRows === count, 'Small list lost rows');
        const started = performance.now();
        await clickRow(rows()[0]);
        await until(() => document.querySelector('.directory-detail-panel'), 'First folder selection did not open details');
        const firstSelectionMs = Math.round(performance.now() - started);
        await clickRow(rows()[2]);
        check(!metadataLoaded, 'Selection must not wait for the background metadata scan');
        const selectedFile = activePath();
        releaseMetadata();
        const expectedDate = new Date(date).toLocaleDateString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        await until(() => rows()[0].querySelector('.date-cell')?.textContent === expectedDate, 'Folder date formatting changed');
        check(activePath() === selectedFile, 'Metadata arrival cleared selection');
        check(rows()[2].querySelector('.date-cell')?.textContent === expectedDate, 'File date formatting changed');
        for (let index = 0; index < 24; index += 1) await frame();

        const tableBounds = scroller().querySelector('table').getBoundingClientRect();
        const viewport = scroller().getBoundingClientRect();
        const first = rows()[0].getBoundingClientRect();
        const third = rows()[2].getBoundingClientRect();
        const x = Math.round(tableBounds.right + 12);
        check(x < viewport.right - 12, 'Drag must start in the empty list area');
        const expected = rows().slice(0, 3).map(row => row.dataset.filePath);
        await input({ kind: 'drag', x, y: Math.round(first.top + 3),
            endX: Math.round(first.left + 20), endY: Math.round(third.bottom - 3) });
        await until(() => JSON.stringify(selectedPaths()) === JSON.stringify(expected), 'Rubber selection lost files or folders');

        scroller().scrollTop = scroller().scrollHeight;
        await until(() => rows().some(row => row.dataset.filePath === entries.at(-1).path), 'Last row is unreachable');
        const last = rows().find(row => row.dataset.filePath === entries.at(-1).path);
        await clickRow(last);
        check(selectedPaths().length === 1, 'Single selection after dragging did not replace the range');
        if (count === 4) {
            check(!missingFinished, 'Mouse input waited for the missing-volume database query');
            await window.startupMissing.release();
            await until(() => missingFinished, 'Missing-volume check did not finish after releasing the query');
            check(activePath() === entries.at(-1).path, 'Automatic check completion cleared selection');
        }
        results.push({ count, initialRows, firstSelectionMs });
    }
    root.unmount();
    return results;
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startupMissing', {
    check: (folders, options) => ipcRenderer.invoke('fixture:missingVolumes', folders, options),
    release: () => ipcRenderer.invoke('fixture:releaseMissingVolumes'),
    onBusy: callback => ipcRenderer.on('fixture:missingBusy', () => callback()),
});
`);
        await fs.writeFile(path.join(directory, 'missing-worker.mjs'), `
import { parentPort, workerData } from 'node:worker_threads';
import { LibraryDB } from ${JSON.stringify(new URL('../electron/database/library_db.js', import.meta.url).href)};
const getMetadata = LibraryDB.prototype.getMissingVolumeMetadata;
LibraryDB.prototype.getMissingVolumeMetadata = function (...args) {
    parentPort.postMessage({ type: 'busy' });
    Atomics.wait(new Int32Array(workerData.options.pause), 0, 0, 10000);
    return getMetadata.apply(this, args);
};
await import(${JSON.stringify(new URL('../electron/missingVolumesWorker.js', import.meta.url).href)});
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain } = require('electron');
const { Worker } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const { runMissingVolumesInWorker } = await import(${JSON.stringify(new URL('../electron/missingVolumesService.js', import.meta.url).href)});
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, useContentSize: true,
        webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    const pause = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    class ObservedWorker extends Worker {
        constructor(...args) {
            super(...args);
            this.on('message', message => {
                if (message.type === 'busy') window.webContents.send('fixture:missingBusy');
            });
        }
    }
    ipcMain.handle('fixture:missingVolumes', (event, folders, options) => runMissingVolumesInWorker(folders, {
        ...options, dbPath: ${JSON.stringify(path.join(directory, 'library.db'))}, pause: pause.buffer,
    }, event, { WorkerClass: ObservedWorker, workerUrl: pathToFileURL(${JSON.stringify(path.join(directory, 'missing-worker.mjs'))}) }));
    ipcMain.handle('fixture:releaseMissingVolumes', () => {
        Atomics.store(pause, 0, 1);
        Atomics.notify(pause, 0);
    });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message !== 'STARTUP_SELECTION_INPUT') return;
        const request = await window.webContents.executeJavaScript('window.startupSelectionInput');
        window.webContents.focus();
        const { x, y } = request;
        window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        if (request.kind === 'drag') {
            for (let step = 1; step <= 6; step += 1) {
                window.webContents.sendInputEvent({ type: 'mouseMove', button: 'left',
                    x: Math.round(x + (request.endX - x) * step / 6), y: Math.round(y + (request.endY - y) * step / 6) });
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
        window.webContents.sendInputEvent({ type: 'mouseUp', x: request.endX ?? x, y: request.endY ?? y, button: 'left', clickCount: 1 });
        await window.webContents.executeJavaScript('window.continueStartupSelection()');
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runStartupSelectionTests()');
    console.log('STARTUP_SELECTION_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Startup selection renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/STARTUP_SELECTION_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        const results = JSON.parse(payload);
        assert.deepEqual(results.map(result => result.count), [4, 300, 100, 40]);
        for (const result of results) t.diagnostic(JSON.stringify(result));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
