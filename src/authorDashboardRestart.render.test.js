import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('재실행 후 대시보드에만 머물러도 사진 없는 저자만 순차 조회하고 저장된 사진은 건너뛴다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'author-dashboard-restart-')));
    const photoDirectory = path.join(directory, 'BookManagerData', 'author-photos');
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
import { createAuthorProfileStore, AUTHOR_PROFILES_KEY, AUTOMATIC_AUTHOR_PROFILES_KEY, AUTHOR_PROFILE_CACHE_VERSION } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/authorProfileStore.js')}`)};
import { authorKey, normalizeAuthorProfile } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/authorCatalog.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const names = ['Saved Automatic', 'Saved Manual', 'Saved Direct', 'Missing New', 'Missing Expired', 'Empty Cooldown', 'Failure Cooldown'];
const missing = ['Missing New', 'Missing Expired'];
const files = names.map((writer, index) => ({
    path: '/fixture/' + index + '.epub', full_path: '/fixture/' + index + '.epub', name: index + '.epub',
    title: 'Book ' + index, writer, author: writer, ext: '.epub', exists: true, has_metadata: true,
}));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
async function until(predicate, message, timeout = 15000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await pause(25);
    }
    throw new Error(message);
}
const read = key => JSON.parse(localStorage.getItem(key) || '{}');
const ipc = window.photoTestApi;
const catalogRequests = [];
window.electronAPI = {
    searchAuthorProfiles: ipc.searchAuthorProfiles, saveAuthorProfilePhoto: ipc.saveAuthorProfilePhoto,
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    getFilePreview: async () => ({ success: false }), readDir: async () => [], scanFolder: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: false }),
    readingLists: async request => {
        catalogRequests.push(request);
        if (request.operation === 'overview') return { success: true, collections: [], wishlistCount: 0, recentAddedCount: files.length, recentUpdatedCount: files.length };
        if (request.operation === 'dashboard') return { success: true, month: request.month, days: [], totals: { seconds: 0, readingDays: 0, completedBooks: 0 }, goal: { books: 0, minutes: 0 }, completedFiles: [], completedCount: 0 };
        if (request.operation === 'list') return { success: true, files: request.id === 'library-catalog' ? files : [] };
        return { success: true, files: [], changes: 0, errors: [] };
    },
};
window.runDashboardRestartTest = async phase => {
    if (phase === 'seed') {
        const automatic = { id: 'OL101A', name: names[0] };
        const store = createAuthorProfileStore({ storage: localStorage,
            search: async () => ({ success: true, profiles: [automatic] }),
            persistPhoto: async profile => {
                const result = await ipc.saveAuthorProfilePhoto(profile);
                check(result.success, 'The initial photo must save successfully');
                return normalizeAuthorProfile({ ...profile, storedPhoto: result.photo });
            },
        });
        check(await store.saveManual(names[1], { id: 'OL102A', name: names[1] }), 'Manual profile should save');
        const photo = store.getProfile(names[1]).storedPhoto;
        check(await store.saveManual(names[2], { provider: 'naver', id: photo.id, name: names[2],
            photoOverride: { ...photo, query: names[2] } }), 'Direct photo should save');
        store.setAuthors([{ key: authorKey(names[0]), name: names[0], books: [] }]);
        await until(() => store.getProfile(names[0])?.storedPhoto, 'Automatic profile should save');
        store.dispose();
        const cached = read(AUTOMATIC_AUTHOR_PROFILES_KEY);
        cached[authorKey(names[0])] = { ...cached[authorKey(names[0])], checkedAt: 1, expiresAt: 2, version: 0, failed: true };
        cached[authorKey('Missing Expired')] = { profile: { id: 'OL103A', name: 'Missing Expired', hasPhoto: false }, checkedAt: 1, expiresAt: 2, version: AUTHOR_PROFILE_CACHE_VERSION };
        const now = Date.now();
        cached[authorKey('Empty Cooldown')] = { profile: null, checkedAt: now, expiresAt: now + 7 * 86400000, version: AUTHOR_PROFILE_CACHE_VERSION };
        cached[authorKey('Failure Cooldown')] = { profile: null, checkedAt: now, expiresAt: now + 3600000, failed: true, version: AUTHOR_PROFILE_CACHE_VERSION };
        localStorage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(cached));
        return { seeded: true };
    }
    const previousAutomatic = read(AUTOMATIC_AUTHOR_PROFILES_KEY)[authorKey(names[0])];
    const previousManual = localStorage.getItem(AUTHOR_PROFILES_KEY);
    check(previousAutomatic?.profile?.storedPhoto && previousManual, 'Existing photos must survive the previous process exit');
    const restoredConfig = await ipc.getConfig();
    check(restoredConfig.folder_last_source === 'dashboard', 'The saved start page must be the dashboard');
    const root = createRoot(document.getElementById('root'));
    let authorPageMounted = false;
    const observer = new MutationObserver(records => {
        if (document.querySelector('.authors-browser')) authorPageMounted = true;
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && (node.matches('.authors-browser') || node.querySelector('.authors-browser'))) authorPageMounted = true;
        }
    });
    observer.observe(document.getElementById('root'), { childList: true, subtree: true });
    root.render(<FolderTab config={restoredConfig} t={(key, values) => translate(key, 'ko', values)}
        saveConfig={ipc.saveConfig} showToast={() => {}} />);
    await until(() => document.querySelector('.reading-dashboard') && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Startup must restore the actual dashboard');
    check(catalogRequests.some(request => request.id === 'library-catalog'), 'Dashboard startup must load the author catalog');
    await until(() => missing.every(name => read(AUTOMATIC_AUTHOR_PROFILES_KEY)[authorKey(name)]?.profile?.storedPhoto),
        'Missing photos must be searched and saved without visiting the author page');
    await pause(5500);
    check(document.querySelector('.reading-dashboard') && !authorPageMounted, 'The entire session must stay on the dashboard without mounting authors');
    check(JSON.stringify(read(AUTOMATIC_AUTHOR_PROFILES_KEY)[authorKey(names[0])]) === JSON.stringify(previousAutomatic), 'Existing automatic photo must remain unchanged');
    check(localStorage.getItem(AUTHOR_PROFILES_KEY) === previousManual, 'Manually configured photos must remain unchanged');
    const storedIds = missing.map(name => read(AUTOMATIC_AUTHOR_PROFILES_KEY)[authorKey(name)].profile.storedPhoto.id);
    observer.disconnect();
    root.unmount();
    return { dashboardOnly: true, authorPageMounted, storedIds };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;overflow:hidden}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ libraries: ['/fixture'], language: 'ko', folder_view_mode: 'table', folder_last_path: '/fixture', folder_last_source: 'dashboard' }));
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('photoTestApi', {
    searchAuthorProfiles: (name, options) => ipcRenderer.invoke('authors:searchProfiles', name, options),
    saveAuthorProfilePhoto: profile => ipcRenderer.invoke('authors:saveProfilePhoto', profile),
    getConfig: () => ipcRenderer.invoke('fixture:getConfig'),
    saveConfig: patch => ipcRenderer.invoke('fixture:saveConfig', patch),
});
`);
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const directory = ${JSON.stringify(directory)};
const phase = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const { registerAuthorProfilePhotosIpc } = await import(${JSON.stringify(new URL('../electron/authorProfilePhotos.js', import.meta.url).href)});
    const requests = [];
    const downloads = [];
    let active = 0;
    let maximumActive = 0;
    const window = new BrowserWindow({ show: false, width: 1280, height: 900,
        webPreferences: { backgroundThrottling: false, preload: path.join(directory, 'preload.cjs') } });
    const photos = registerAuthorProfilePhotosIpc({
        ipcMain, getMainWindow: () => window, getPhotoDirectory: () => ${JSON.stringify(photoDirectory)},
        downloadImage: async url => {
            downloads.push(url);
            const id = Number(/OL([0-9]+)A/.exec(url)?.[1]);
            const buffer = nativeImage.createFromBitmap(Buffer.from([id, 80, 160, 255]), { width: 1, height: 1 }).toPNG();
            return { buffer, width: 1, height: 1 };
        },
    });
    ipcMain.handle('authors:searchProfiles', async (_event, name, options) => {
        const request = { name, startedAt: Date.now(), allSources: options?.allSources === true };
        requests.push(request);
        maximumActive = Math.max(maximumActive, ++active);
        await new Promise(resolve => setTimeout(resolve, 200));
        active -= 1;
        request.completedAt = Date.now();
        const id = { 'Missing New': 'OL104A', 'Missing Expired': 'OL105A' }[name];
        return id ? { success: true, profiles: [{ id, name }] } : { success: false };
    });
    const configPath = path.join(directory, 'config.json');
    ipcMain.handle('fixture:getConfig', async () => JSON.parse(await fs.readFile(configPath, 'utf8')));
    ipcMain.handle('fixture:saveConfig', async (_event, patch) => {
        const config = { ...JSON.parse(await fs.readFile(configPath, 'utf8')), ...patch };
        await fs.writeFile(configPath, JSON.stringify(config));
        return config;
    });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runDashboardRestartTest(' + JSON.stringify(phase) + ')');
    photos.dispose();
    console.log('AUTHOR_DASHBOARD_RESULT=' + JSON.stringify({ ...result, requests, downloads, maximumActive }));
    window.close();
    app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        for (const phase of ['seed', 'restart-dashboard', 'restart-dashboard-again']) {
            const output = await new Promise((resolve, reject) => {
                const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs'), phase], { env, stdio: ['ignore', 'pipe', 'pipe'] });
                let result = '';
                child.stdout.on('data', data => { result += data; });
                child.stderr.on('data', data => { result += data; });
                const timer = setTimeout(() => { child.kill(); reject(new Error(phase + ' timed out: ' + result)); }, 35000);
                child.once('error', error => { clearTimeout(timer); reject(error); });
                child.once('close', code => { clearTimeout(timer); resolve({ code, result }); });
            });
            assert.equal(output.code, 0, phase + ': ' + output.result);
            const payload = output.result.match(/AUTHOR_DASHBOARD_RESULT=(.+)/)?.[1];
            assert.ok(payload, output.result);
            const result = JSON.parse(payload);
            assert.deepEqual(result.requests.map(request => request.name).sort(), phase === 'restart-dashboard' ? ['Missing Expired', 'Missing New'] : [], phase);
            assert.equal(result.downloads.length, phase === 'restart-dashboard-again' ? 0 : 2, phase);
            if (phase !== 'seed') {
                assert.equal(result.dashboardOnly, true);
                assert.equal(result.authorPageMounted, false);
                for (const id of result.storedIds) assert.ok((await fs.stat(path.join(photoDirectory, id + '.png'))).size > 0);
            }
            if (phase === 'restart-dashboard') {
                assert.equal(result.maximumActive, 1);
                assert.ok(result.requests.every(request => !request.allSources));
                assert.ok(result.requests[1].startedAt - result.requests[0].completedAt >= 4900, 'Background requests must leave a five-second interval');
            }
        }
        t.diagnostic('Dashboard only after full restart: 2 missing authors searched, 3 configured photos and 2 cooldown entries skipped, concurrency 1, interval >= 4.9 seconds; next restart: 0 searches/downloads.');
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
