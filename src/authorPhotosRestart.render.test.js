import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('프로세스를 종료하고 다시 실행해도 자동·직접 지정 사진을 파일에서 복원하며 재검색하지 않는다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'author-photos-restart-'));
    const photoDirectory = path.join(directory, 'BookManagerData', 'author-photos');
    try {
        await build({
            stdin: { loader: 'jsx', resolveDir: projectRoot, contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthorsBrowser } from './src/components/folder/AuthorsBrowser.jsx';
import { useAuthorProfiles } from './src/hooks/useAuthorProfiles.js';
import { authorKey } from './src/authorCatalog.js';
import { AUTOMATIC_AUTHOR_PROFILES_KEY, AUTHOR_PROFILES_KEY } from './src/authorProfileStore.js';
const names = ['Automatic Photo', 'Manual Profile', 'Manual Photo', 'Uploaded Photo', 'Profile Source Photo'];
const authors = names.map(name => ({ key: authorKey(name), name, books: [] }));
const files = names.map((writer, index) => ({ path: '/fixture/' + index + '.epub', name: 'Book ' + index, writer }));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await pause(20);
    }
    throw new Error(message);
}
let store;
function Fixture({ visible }) {
    store = useAuthorProfiles(authors);
    return visible ? <AuthorsBrowser files={files} profileStore={store} language="en" t={key => key} /> : <div>Dashboard</div>;
}
const root = createRoot(document.getElementById('root'));
const read = key => JSON.parse(localStorage.getItem(key) || '{}');
window.runRestartTest = async (phase, uploadDataUrl) => {
    root.render(<Fixture visible={false} />);
    await until(() => store, 'The profile store should initialize');
    if (phase === 'create') {
        check(await store.saveManual('Manual Profile', {
            provider: 'wikidata', id: 'Q123', name: 'Manual Profile',
            photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Manual.jpg',
        }), 'A manually selected profile should save its photo');
        const photo = store.getProfile('Manual Profile').storedPhoto;
        check(await store.saveManual('Manual Photo', {
            provider: 'naver', id: photo.id, name: 'Manual Photo',
            photoOverride: { id: photo.id, sourceUrl: photo.sourceUrl, query: 'Manual Photo' },
        }), 'A directly selected local photo should retain its file identity');
        const uploaded = await window.electronAPI.importAuthorPhoto({ dataUrl: uploadDataUrl });
        check(uploaded.success, 'An uploaded photo should be normalized and saved');
        check(await store.saveManual('Uploaded Photo', {
            provider: 'local', id: uploaded.photo.id, name: 'Uploaded Photo', photoOverride: uploaded.photo,
        }), 'An uploaded photo should save without an external author profile');
        const source = await window.electronAPI.saveAuthorProfilePhoto({
            ...store.getProfile('Manual Profile'),
            imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Manual.jpg',
            imageArtist: 'Photographer', imageLicense: 'CC BY 4.0',
        }, { includeDataUrl: true });
        check(source.success && source.dataUrl, 'A source profile should provide editable pixels and photo attribution');
        const edited = await window.electronAPI.importAuthorPhoto({ dataUrl: source.dataUrl, photo: source.photo });
        check(edited.success, 'An edited profile photo should retain its attribution');
        check(await store.saveManual('Profile Source Photo', {
            id: 'OL555A', name: 'Profile Source Photo', description: 'Existing biography', photoOverride: edited.photo,
        }), 'A photo from another profile should preserve the existing author information');
    } else {
        check(read(AUTOMATIC_AUTHOR_PROFILES_KEY)[authorKey(names[0])]?.profile?.storedPhoto,
            'Automatic photo metadata must survive complete process termination');
        check(read(AUTHOR_PROFILES_KEY)[authorKey(names[1])]?.storedPhoto,
            'Manual profile metadata must survive complete process termination');
        check(read(AUTHOR_PROFILES_KEY)[authorKey(names[2])]?.photoOverride,
            'Direct photo metadata must survive complete process termination');
        check(read(AUTHOR_PROFILES_KEY)[authorKey(names[3])]?.photoOverride?.source === 'local',
            'Uploaded photo metadata must survive complete process termination');
        check(read(AUTHOR_PROFILES_KEY)[authorKey(names[4])]?.photoOverride?.source === 'wikidata',
            'Source profile photo metadata must survive complete process termination');
        await pause(5500);
        check(names.every(name => store.getStatus(name) === 'ready'), 'Background scanning must preserve every saved photo');
    }
    const sourceProfile = store.getProfile('Profile Source Photo');
    check(sourceProfile.id === 'OL555A' && sourceProfile.description === 'Existing biography', 'Photo edits must preserve author information');
    check(sourceProfile.imageSourceUrl === 'https://commons.wikimedia.org/wiki/File:Manual.jpg'
        && sourceProfile.imageArtist === 'Photographer' && sourceProfile.imageLicense === 'CC BY 4.0',
        'Photo source, artist, and license must survive editing and process restarts');
    const uploadedProfile = store.getProfile('Uploaded Photo');
    check(uploadedProfile.provider === 'local' && uploadedProfile.sourceUrl === '' && uploadedProfile.imageSourceUrl === '',
        'Uploaded photos must not gain an invented external source');
    root.render(<Fixture visible />);
    await until(() => {
        const images = [...document.querySelectorAll('.author-card img')];
        images.forEach(image => { image.loading = 'eager'; });
        return images.filter(image => image.complete && image.naturalWidth > 0).length === names.length;
    },
        'Every automatic and manual photo must render from its saved file');
    const photos = Object.fromEntries(names.map(name => {
        const image = document.querySelector('[data-author-key="' + authorKey(name) + '"] img');
        check(image?.src.startsWith('bookmanager-thumbnail://author-photo/'), 'Photos must use the local file protocol');
        return [name, image.src];
    }));
    await pause(500);
    if (phase === 'create') {
        const cached = read(AUTOMATIC_AUTHOR_PROFILES_KEY);
        const entry = cached[authorKey(names[0])];
        cached[authorKey(names[0])] = { ...entry, checkedAt: 1, expiresAt: 2, version: 0, failed: true };
        localStorage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(cached));
    }
    root.unmount();
    return { photos };
};
` },
            bundle: true, outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file', '.png': 'file' }, logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;height:100%}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const phase = process.argv[2];
const directory = ${JSON.stringify(directory)};
const photoDirectory = ${JSON.stringify(photoDirectory)};
app.setPath('userData', path.join(directory, 'profile'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-thumbnail', privileges: { standard: true, secure: true } }]);
app.whenReady().then(async () => {
    const { registerAuthorProfilePhotosIpc } = await import(${JSON.stringify(new URL('../electron/authorProfilePhotos.js', import.meta.url).href)});
    const requests = [];
    const downloads = [];
    const remoteRequests = [];
    const fileReads = [];
    protocol.handle('bookmanager-thumbnail', async request => {
        const url = new URL(request.url);
        const filename = decodeURIComponent(url.pathname.slice(1));
        if (url.hostname !== 'author-photo' || !/^[a-f0-9]{64}\\.png$/.test(filename)) return new Response(null, { status: 404 });
        fileReads.push(filename);
        return new Response(await fs.readFile(path.join(photoDirectory, filename)), { headers: { 'Content-Type': 'image/png' } });
    });
    for (const scheme of ['http', 'https']) protocol.handle(scheme, request => {
        remoteRequests.push(request.url);
        return new Response(null, { status: 503 });
    });
    const window = new BrowserWindow({ show: false, width: 900, height: 700,
        webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(projectRoot, 'electron/preload.cjs'))} } });
    const photos = registerAuthorProfilePhotosIpc({
        ipcMain, getMainWindow: () => window, getPhotoDirectory: () => photoDirectory,
        downloadImage: async url => {
            downloads.push(url);
            if (phase !== 'create') throw new Error('Photo downloads must not repeat after restart');
            const pixels = Buffer.from(url.includes('openlibrary') ? [30, 80, 160, 255] : [180, 100, 20, 255]);
            const buffer = nativeImage.createFromBitmap(pixels, { width: 1, height: 1 }).toPNG();
            return { buffer, width: 1, height: 1 };
        },
    });
    ipcMain.handle('authors:searchProfiles', (_event, name) => {
        requests.push(name);
        if (phase !== 'create' || name !== 'Automatic Photo') return { success: false };
        return { success: true, profiles: [{ id: 'OL123A', name }] };
    });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadFile(path.join(directory, 'index.html'));
    const uploadDataUrl = nativeImage.createFromBitmap(Buffer.from([90, 170, 50, 255]), { width: 1, height: 1 }).toDataURL();
    const result = await window.webContents.executeJavaScript('window.runRestartTest(' + JSON.stringify(phase) + ',' + JSON.stringify(uploadDataUrl) + ')');
    photos.dispose();
    console.log('AUTHOR_RESTART_RESULT=' + JSON.stringify({ ...result, requests, downloads, remoteRequests, fileReads }));
    window.close();
    app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const results = [];
        for (const phase of ['create', 'restart', 'restart-again']) {
            const output = await new Promise((resolve, reject) => {
                const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs'), phase], { env, stdio: ['ignore', 'pipe', 'pipe'] });
                let result = '';
                child.stdout.on('data', data => { result += data; });
                child.stderr.on('data', data => { result += data; });
                const timeout = setTimeout(() => { child.kill(); reject(new Error(phase + ' timed out: ' + result)); }, 25000);
                child.once('error', error => { clearTimeout(timeout); reject(error); });
                child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
            });
            assert.equal(output.code, 0, phase + ': ' + output.result);
            const payload = output.result.match(/AUTHOR_RESTART_RESULT=(.+)/)?.[1];
            assert.ok(payload, output.result);
            const result = JSON.parse(payload);
            assert.deepEqual(result.requests, phase === 'create' ? ['Automatic Photo'] : [], phase);
            assert.equal(result.downloads.length, phase === 'create' ? 2 : 0, phase);
            assert.deepEqual(result.remoteRequests, [], phase);
            assert.equal(new Set(result.fileReads).size, 4, 'Each process must actually read all saved image files');
            if (results.length) assert.deepEqual(result.photos, results[0].photos);
            results.push(result);
            await fs.rm(path.join(directory, 'profile', 'Cache'), { recursive: true, force: true });
        }
        assert.equal((await fs.readdir(photoDirectory)).filter(name => name.endsWith('.png')).length, 4);
        t.diagnostic('Two full process restarts: all 5 photos restored, including uploaded and edited source photos with attribution; 0 author searches, 0 downloads, 0 remote image requests after each restart.');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
