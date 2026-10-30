import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('모아보기와 컬렉션의 마지막 페이지를 재실행 후 복원하고 실제 폴더 복귀도 저장한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-session-restore-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { useCallback, useEffect, useState } from 'react';
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
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
async function settle() { for (let index = 0; index < 5; index += 1) await frame(); }
const makeBook = (name, title) => ({
    path: '/fixture/' + name + '.epub', full_path: '/fixture/' + name + '.epub', name: name + '.epub',
    title, ext: '.epub', size: 1024, writer: '테스트 저자', author: '테스트 저자', exists: true,
    readingListAddedAt: new Date().toISOString(), has_metadata: true,
});
const folderBook = makeBook('folder-book', '폴더에 있는 책');
const collectionBook = makeBook('collection-book', '컬렉션에 있는 책');
const files = [folderBook, collectionBook];
let collections = [{ id: 'collection-1', name: '저장한 컬렉션', count: 1 }];
const scans = [];
const stats = [];
const writes = [];
const requests = [];
const baseConfig = { libraries: ['/fixture'], language: 'ko', folder_view_mode: 'table', folder_last_path: '/fixture' };
let savedConfig = { ...baseConfig };
let delayConfig = false;
let statDelay = 0;
let overviewDelay = 0;
let failOverview = false;
let heldListId = '';
let releaseList;
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [{ ...folderBook, lastReadAt: new Date().toISOString() }],
    getFilePreview: async () => ({ success: false }),
    stat: async filePath => {
        stats.push(filePath);
        if (statDelay) await new Promise(resolve => setTimeout(resolve, statDelay));
        return { isDirectory: filePath === '/fixture', isFile: files.some(file => file.path === filePath) };
    },
    readDir: async () => [],
    scanFolder: async folderPath => { scans.push(folderPath); return [folderBook]; },
    readingLists: async request => {
        requests.push(request);
        if (request.operation === 'overview') {
            if (overviewDelay) await new Promise(resolve => setTimeout(resolve, overviewDelay));
            if (failOverview) return { success: false, error: 'offline' };
            return { success: true, collections: [...collections], wishlistCount: 1, recentAddedCount: 2, recentUpdatedCount: 2 };
        }
        if (request.operation === 'dashboard') return { success: true, month: request.month, days: [], totals: { seconds: 0, readingDays: 0, completedBooks: 0 }, goal: { books: 0, minutes: 0 }, completedFiles: [], completedCount: 0 };
        if (request.operation === 'list') {
            if (request.id === heldListId) await new Promise(resolve => { releaseList = resolve; });
            return { success: true, files: request.id === 'collection-1' ? [collectionBook] : [...files] };
        }
        return { success: true, files: [], changes: 0, errors: [] };
    },
};
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
function Session() {
    const [config, setConfig] = useState(() => delayConfig ? null : { ...savedConfig });
    useEffect(() => {
        if (!delayConfig) return;
        const timer = setTimeout(() => setConfig({ ...savedConfig }), 50);
        return () => clearTimeout(timer);
    }, []);
    const saveConfig = useCallback(async patch => {
        writes.push(patch);
        savedConfig = { ...savedConfig, ...patch };
        setConfig(savedConfig);
        return savedConfig;
    }, []);
    return <FolderTab config={config} t={t} saveConfig={saveConfig} showToast={() => {}} />;
}
async function restart() {
    root.render(null);
    await frame();
    root.render(<Session key={++mountKey} />);
    await until(() => document.querySelector('.sidebar-container'), 'Folder tab did not remount');
    await settle();
}
const labels = {
    dashboard: 'reading_lists.dashboard', favorites: 'folder.sidebar.favorites',
    'recent-reading': 'folder.sidebar.recent_reading', 'recent-added': 'reading_lists.recent_added',
    'recent-updated': 'reading_lists.recent_updated', wishlist: 'reading_lists.wishlist',
    collections: 'reading_lists.collections', authors: 'reading_lists.authors', annotations: 'reading_lists.annotations',
};
const navigation = source => [...document.querySelectorAll('.sidebar-section-reading button')]
    .find(button => button.querySelector('.recent-reading-list-main')?.textContent.trim() === t(labels[source]));
const selected = source => navigation(source)?.getAttribute('aria-current') === 'page';
const row = filePath => document.querySelector('tr[data-file-path="' + filePath + '"]');
async function visit(source) {
    await until(() => navigation(source), 'Navigation missing: ' + source);
    navigation(source).click();
    await until(() => selected(source), 'Navigation did not select: ' + source);
    await settle();
}
async function verifyRestored(source) {
    const scanCount = scans.length;
    const statCount = stats.length;
    await restart();
    await until(() => selected(source), 'Last reading page was not restored: ' + source);
    await settle();
    check(scans.length === scanCount, 'Restoring ' + source + ' must not scan the old folder');
    check(stats.length === statCount, 'Restoring ' + source + ' must not check the old folder');
    check(savedConfig.folder_last_source === source, 'Startup overwrote the saved reading page: ' + source);
    if (source === 'authors') check(document.querySelector('.authors-browser'), 'Author page content was not restored');
    if (source === 'annotations') check(document.querySelector('.annotations-browser'), 'Annotation page content was not restored');
    if (source === 'dashboard') check(document.querySelector('.reading-dashboard'), 'Dashboard content was not restored');
}
window.runSessionRestoreTests = async () => {
    await restart();
    await until(() => row(folderBook.path), 'Legacy last folder was not restored');
    const sources = ['authors', 'annotations', 'dashboard', 'recent-reading', 'recent-added', 'recent-updated', 'wishlist', 'favorites', 'collections'];
    for (const source of sources) {
        await visit(source);
        await until(() => savedConfig.folder_last_source === source, 'Reading page was not saved: ' + source);
        check(savedConfig.folder_last_path === '/fixture', 'Reading pages must preserve the previous physical folder');
        await verifyRestored(source);
    }
    await until(() => row('collection://collection-1'), 'Collection overview did not load');
    row('collection://collection-1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => row(collectionBook.path) && !row(folderBook.path), 'Collection detail did not open');
    await until(() => savedConfig.folder_last_source === 'collection' && savedConfig.folder_last_collection_id === 'collection-1', 'Collection identity was not saved');
    const scansBeforeCollection = scans.length;
    await restart();
    await until(() => selected('collections') && row(collectionBook.path) && !row(folderBook.path), 'Saved collection detail was not restored');
    check(scans.length === scansBeforeCollection, 'Collection restore must not scan the old physical folder');
    check(requests.some(request => request.operation === 'list' && request.id === 'collection-1'), 'Restored collection was not requested');

    await visit('wishlist');
    await until(() => row(folderBook.path) && row(collectionBook.path), 'Wishlist did not load');
    await visit('collections');
    heldListId = 'collection-1';
    row('collection://collection-1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => releaseList, 'Collection refresh did not start');
    await settle();
    check(row(collectionBook.path) && !row(folderBook.path), 'Cached collection members disappeared during slow file access');
    check(document.querySelector('.view-container').getAttribute('aria-busy') === 'true', 'Collection refresh must remain pending for the cache check');
    heldListId = '';
    releaseList();
    releaseList = null;
    await until(() => document.querySelector('.view-container').getAttribute('aria-busy') === 'false', 'Collection refresh did not finish');

    heldListId = 'want-to-read';
    await visit('wishlist');
    await until(() => releaseList, 'Wishlist refresh did not start');
    check(row(folderBook.path) && row(collectionBook.path), 'Cached wishlist disappeared during slow file access');
    check(document.querySelector('.view-container').getAttribute('aria-busy') === 'true', 'Wishlist refresh must remain pending for the cache check');
    await visit('favorites');
    heldListId = '';
    releaseList();
    releaseList = null;
    await settle();
    check(selected('favorites') && !row(collectionBook.path), 'A delayed wishlist response replaced the newly selected page');

    document.querySelector('[data-folder-sidebar-path="/fixture"]').click();
    await until(() => row(folderBook.path) && !row(collectionBook.path), 'Returning to the previous physical folder failed');
    await until(() => savedConfig.folder_last_source === 'folder', 'Returning to the same folder must replace the saved reading-page source');
    check(savedConfig.folder_last_path === '/fixture', 'The physical folder path changed unexpectedly');
    check(!savedConfig.folder_last_collection_id, 'Leaving a collection must clear its saved identity');
    await restart();
    await until(() => row(folderBook.path) && !document.querySelector('.recent-reading-list-item.selected'), 'Physical folder did not remain selected after restart');

    savedConfig = { ...baseConfig, folder_last_source: 'collection', folder_last_collection_id: 'deleted-collection' };
    collections = [];
    const scansBeforeMissing = scans.length;
    await restart();
    await until(() => selected('collections') && savedConfig.folder_last_source === 'collections', 'Deleted collection must fall back to the collection overview');
    check(scans.length === scansBeforeMissing, 'Missing collection fallback must not reopen the old folder');
    check(!savedConfig.folder_last_collection_id, 'Deleted collection identity must be cleared');

    savedConfig = { ...baseConfig, folder_last_source: 'collection', folder_last_collection_id: null };
    await restart();
    await until(() => selected('collections') && savedConfig.folder_last_source === 'collections', 'Missing collection identity must fall back to the collection overview');

    savedConfig = { ...baseConfig, folder_last_source: 'authors', folder_last_collection_id: '' };
    delayConfig = true;
    await verifyRestored('authors');
    delayConfig = false;

    savedConfig = { ...baseConfig, folder_last_source: 'collection', folder_last_collection_id: 'collection-1' };
    failOverview = true;
    const scansBeforeOverviewFailure = scans.length;
    await restart();
    await until(() => selected('collections') && row(collectionBook.path), 'A temporary overview failure must retain the saved collection');
    check(savedConfig.folder_last_source === 'collection' && savedConfig.folder_last_collection_id === 'collection-1', 'A failed overview must not be treated as a deleted collection');
    check(scans.length === scansBeforeOverviewFailure, 'A failed overview must not reopen the physical folder');
    failOverview = false;

    savedConfig = { ...baseConfig };
    statDelay = 80;
    overviewDelay = 20;
    await restart();
    await until(() => row(folderBook.path), 'Finishing the overview while folder stat is pending must not cancel legacy folder restoration');
    statDelay = 0;
    overviewDelay = 0;

    savedConfig = { ...baseConfig, folder_last_source: 'unknown-page', folder_last_collection_id: 'stale-id' };
    await restart();
    await until(() => row(folderBook.path), 'Invalid saved source must preserve legacy physical-folder restoration');
    root.unmount();
    return { sources, collection: true, missingCollection: true, overviewFailure: true, sameFolder: true, delayedConfig: true, delayedFolderRestore: true, legacyAndInvalidSource: true };
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
    const window = new BrowserWindow({ show: false, width: 1200, height: 800, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runSessionRestoreTests()');
    console.log('FOLDER_SESSION_RESTORE_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder session renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/FOLDER_SESSION_RESTORE_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), {
            sources: ['authors', 'annotations', 'dashboard', 'recent-reading', 'recent-added', 'recent-updated', 'wishlist', 'favorites', 'collections'],
            collection: true, missingCollection: true, overviewFailure: true, sameFolder: true, delayedConfig: true, delayedFolderRestore: true, legacyAndInvalidSource: true,
        });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
