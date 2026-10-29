import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('하위 폴더 포함과 파일만보기는 목록을 반복 갱신하지 않는다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-files-only-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#36536c"/></svg>');
let folders;
let books;
let byPath;
function configureScenario(scenario) {
    folders = Array.from({ length: scenario === 'shrink' ? 1500 : 100 }, (_, index) => ({
        path: '/fixture/folder-' + index, full_path: '/fixture/folder-' + index,
        name: 'Folder ' + String(index).padStart(3, '0'), isDirectory: true, size: 0, mtime: 1, exists: true,
    }));
    books = folders.slice(0, scenario === 'shrink' ? 200 : 100).flatMap((folder, index) =>
        Array.from({ length: scenario === 'shrink' ? 2 : 48 }, (_, part) => ({
            path: folder.path + '/book-' + part + '.epub', full_path: folder.path + '/book-' + part + '.epub',
            name: 'Book ' + String(index).padStart(3, '0') + '-' + part + '.epub',
            folder_path: folder.path, ext: '.epub', isDirectory: false, size: 1024, mtime: 1, exists: true, cache_source: 'quick',
        })));
    byPath = new Map([...folders, ...books].map(file => [file.path, file]));
}
let scans = 0;
let previews = 0;
let commits = 0;
let mutations = 0;
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: !filePath.endsWith('.epub'), isFile: filePath.endsWith('.epub'), mtime: 1 }),
    readDir: async filePath => filePath === '/fixture' ? folders : [],
    scanFolder: async (_folderPath, options) => {
        scans += 1;
        await delay(20);
        return options.includeSubfolders ? [...folders, ...books] : folders;
    },
    getFilePreview: async filePath => {
        previews += 1;
        await delay(5);
        const file = byPath.get(filePath);
        return file ? { success: true, file: { ...file, size: 1024, cover, title: file.name, author: 'Author', has_metadata: true, cache_source: 'database' } } : { success: false };
    },
    readingLists: async () => ({ success: true, collections: [], wishlistCount: 0, recentAddedCount: 0, recentUpdatedCount: 0 }),
};
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
const view = () => document.querySelector('.view-container');
const items = () => [...(view()?.querySelectorAll('[data-file-path]') || [])];
const folderItems = () => items().filter(item => !item.dataset.filePath.endsWith('.epub'));
const button = key => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === t(key));
const scroller = () => view()?.querySelector('.file-table-container, .tile-grid, .thumbnail-grid');
const idle = () => view()?.getAttribute('aria-busy') === 'false';
const snapshot = () => ({ scans, previews, commits, mutations });
let mountKey = 0;
async function verify(mode, scenario) {
    configureScenario(scenario);
    root.render(<Profiler id="folder" onRender={() => { commits += 1; }}><FolderTab key={++mountKey}
        config={{ libraries: [], folder_sort_key: 'size', folder_last_path: '/fixture', folder_view_mode: mode, folder_item_scales: { table: 75, tile: 50, thumbnail: 50 } }}
        t={t} saveConfig={async () => {}} showToast={() => {}} /></Profiler>);
    await frame();
    await until(() => folderItems().length > 0 && idle() && button('folder_inc_sub_on').getAttribute('aria-pressed') === 'false', mode + ': initial folder list did not load');
    button('folder_inc_sub_on').click();
    await until(() => button('folder_inc_sub_on').getAttribute('aria-pressed') === 'true' && idle(), mode + ': recursive list did not load');
    await delay(1000);
    scroller().scrollTop = scenario === 'shrink' ? scroller().scrollHeight : 3000;
    await frame();
    await frame();
    const initialScroll = scroller().scrollTop;
    check(initialScroll > 0, mode + ': fixture must be scrolled before filtering');
    button('folder.toolbar.files_only').click();
    const scrollSamples = [];
    for (let index = 0; index < 20; index += 1) {
        await frame();
        scrollSamples.push({ top: scroller()?.scrollTop, height: scroller()?.scrollHeight, count: items().length });
    }

    check(scrollSamples.filter(sample => sample.count === 0).length <= 1, mode + ': filtering leaves repeated empty virtual windows: ' + JSON.stringify(scrollSamples));
    await until(() => button('folder.toolbar.files_only').getAttribute('aria-pressed') === 'true' && items().length > 0 && folderItems().length === 0, mode + ': folders were not hidden');
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(view(), { childList: true, subtree: true, attributes: true, characterData: true });
    await delay(1200);
    const before = snapshot();
    const stableScroll = scroller().scrollTop;
    const stablePaths = JSON.stringify(items().map(item => item.dataset.filePath));
    await delay(1200);
    const after = snapshot();
    observer.disconnect();
    check(scroller().scrollTop === stableScroll, mode + ': scroll position keeps moving');
    check(JSON.stringify(items().map(item => item.dataset.filePath)) === stablePaths, mode + ': visible files keep changing');
    check(after.scans === before.scans, mode + ': scans keep restarting');
    check(after.previews === before.previews, mode + ': previews keep restarting');
    check(after.commits - before.commits <= 2, mode + ': list keeps rendering: ' + JSON.stringify({ before, after }));
    check(after.mutations === before.mutations, mode + ': settled list keeps mutating');
    const scanCount = scans;
    button('folder.toolbar.files_only').click();
    await until(() => folderItems().length > 0, mode + ': folders were not restored');
    check(scans === scanCount, mode + ': files-only toggle unexpectedly rescanned');
    return { mode, scenario, scans: after.scans - before.scans, previews: after.previews - before.previews, commits: after.commits - before.commits, mutations: after.mutations - before.mutations };
}
window.runFolderFilesOnlyTests = async () => {
    const results = [];
    for (const scenario of ['shrink', 'size-sort']) {
        for (const mode of ['table', 'tile', 'thumbnail']) results.push(await verify(mode, scenario));
    }
    root.unmount();
    return results;
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 5174, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) console.error(message);
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runFolderFilesOnlyTests()');
    console.log('FOLDER_FILES_ONLY_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder files-only renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/FOLDER_FILES_ONLY_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        const results = JSON.parse(payload);
        assert.deepEqual(results.map(result => result.mode), ['table', 'tile', 'thumbnail', 'table', 'tile', 'thumbnail']);
        for (const result of results) t.diagnostic(JSON.stringify(result));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
