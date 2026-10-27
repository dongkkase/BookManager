import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('저자 목록은 자동 사진 조회 상태를 표시하고 숨긴 창과 화면 밖 대기 조회를 멈춘다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'authors-browser-render-'));
    try {
        const renderer = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthorAvatar, AuthorsBrowser } from './src/components/folder/AuthorsBrowser.jsx';
import { authorKey } from './src/authorCatalog.js';
import { AUTOMATIC_AUTHOR_PROFILES_KEY, AUTHOR_PROFILES_KEY, AUTHOR_PROFILE_CACHE_VERSION } from './src/authorProfileStore.js';
import { applyMotionPreference } from './src/motionPolicy.js';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
const names = Array.from({ length: 64 }, (_, index) => 'Author ' + String(index + 1).padStart(3, '0'));
const files = names.map((writer, index) => ({ path: '/fixture/book-' + index + '.epub', name: 'Book ' + index, title: 'Book ' + index, writer }));
const profile = index => ({ id: 'OL' + (index + 1) + 'A', name: names[index] });
const storedProfile = index => ({ ...profile(index), storedPhoto: {
    id: (index + 1).toString(16).padStart(64, '0'), sourceUrl: 'https://covers.openlibrary.org/a/olid/OL' + (index + 1) + 'A-M.jpg?default=false',
} });
const first = names[0];
const queued = names[1];
const distant = names[60];
const checkedAt = Date.now();
const cached = Object.fromEntries(names.filter(name => ![first, queued, distant].includes(name)).map(name => [authorKey(name), {
    profile: null, checkedAt, expiresAt: checkedAt + 7 * 24 * 60 * 60 * 1000, version: AUTHOR_PROFILE_CACHE_VERSION,
}]));
cached[authorKey(names[4])] = {
    profile: storedProfile(4), checkedAt: checkedAt - 10000, expiresAt: checkedAt - 1, version: 0, failed: true,
};
localStorage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(cached));
localStorage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify({ [authorKey(names[2])]: null, [authorKey(names[3])]: storedProfile(3) }));
let hidden = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
const setHidden = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
const requests = [];
const photoSaves = [];
let activeRequests = 0;
let maximumActiveRequests = 0;
window.electronAPI = {
    saveAuthorProfilePhoto: async value => {
        photoSaves.push(value);
        return { success: true, photo: {
            id: Number(value.id.slice(2, -1)).toString(16).padStart(64, '0'), sourceUrl: value.photoUrl,
        } };
    },
    searchAuthorProfiles(name, options) {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        return new Promise(resolve => requests.push({ name, options, fail() {
            activeRequests -= 1;
            resolve({ success: false });
        }, complete(profiles) {
            activeRequests -= 1;
            resolve({ success: true, profiles });
        } }));
    },
};
const root = createRoot(document.getElementById('root'));
let revision = 0;
let backAction = null;
const onBackActionChange = action => { backAction = action; };
const render = () => root.render(<AuthorsBrowser key={++revision} files={files} language="en" t={key => key} onBackActionChange={onBackActionChange} />);
const card = name => [...document.querySelectorAll('[data-author-key]')].find(node => node.dataset.authorKey === authorKey(name));
const avatar = name => card(name)?.querySelector('.author-avatar');
const assertStatus = (name, status, text, busy = false) => {
    const node = avatar(name);
    check(node?.dataset.photoStatus === status, name + ' should show ' + status + ', received ' + node?.dataset.photoStatus);
    check(node.getAttribute('aria-busy') === String(busy), name + ' should expose its current busy state');
    const visibleText = busy || status === 'queued' ? text : undefined;
    check(node.querySelector('.author-photo-status')?.textContent === visibleText, name + ' should display a photo status only while waiting or loading');
    check(node.title === (text || ''), name + ' should retain its photo status as a hover hint');
    check(Boolean(node.querySelector('.author-photo-spinner')) === busy, name + ' should animate only while actually loading');
};
const photoLoaded = node => {
    const image = node?.querySelector('.author-avatar img');
    return image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1';
};
const scrollTo = name => {
    const scroller = document.querySelector('.authors-browser');
    const target = card(name);
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24;
    scroller.dispatchEvent(new Event('scroll'));
};
window.runAuthorsBrowserTests = async () => {
    applyMotionPreference('full');
    render();
    await until(() => requests.length === 1, 'The visible author should be looked up without opening details');
    check(requests[0].name === first, 'Automatic lookup must start with a visible author');
    await until(() => avatar(first)?.dataset.photoStatus === 'loading', 'Lookup should visibly enter its loading state');
    assertStatus(first, 'loading', 'Finding photo…', true);
    assertStatus(queued, 'queued', 'Waiting for lookup');
    assertStatus(names[2], 'initials', undefined);
    assertStatus(names[5], 'empty', 'No photo found');
    const spinner = avatar(first).querySelector('.author-photo-spinner');
    await until(() => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(spinner).transform), 'Normal motion should rotate the active lookup indicator');
    applyMotionPreference('reduced');
    await until(() => ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(spinner).transform), 'Reduced motion should stop the active lookup indicator');
    await pause(100);
    check(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(spinner).transform), 'The reduced-motion indicator should remain static');
    assertStatus(first, 'loading', 'Finding photo…', true);
    applyMotionPreference('full');
    await until(() => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(spinner).transform), 'Restoring full motion should resume the active lookup indicator');
    await frame();
    await window.captureAuthorStatus();
    await until(() => photoLoaded(card(names[3])) && photoLoaded(card(names[4])), 'Saved manual and automatic photos should render in the list');
    assertStatus(names[3], 'ready', undefined);
    assertStatus(names[4], 'ready', undefined);
    check(!card(names[2]).querySelector('img'), 'An explicit initials preference must remain unchanged');
    check(!requests.some(request => request.name === distant), 'An offscreen author must not be looked up before scrolling');

    setHidden(true);
    await until(() => avatar(queued)?.dataset.photoStatus === 'idle', 'Pausing the queue should remove the waiting status');
    requests[0].complete([profile(0)]);
    await pause(450);
    check(requests.length === 1, 'A hidden window must not start the next queued author lookup');
    await until(() => photoLoaded(card(first)), 'The completed automatic photo should appear in the author list');
    check(card(first).querySelector('img').src.startsWith('bookmanager-thumbnail://author-photo/'), 'Automatic photos must display the saved local file');
    check(photoSaves.some(value => value.name === first), 'Automatic photo results must be persisted before use');
    assertStatus(first, 'ready', undefined);

    setHidden(false);
    scrollTo(distant);
    await until(() => requests.length === 2, 'Visible author lookup should resume after the window becomes visible and scrolling settles');
    check(requests[1].name === distant, 'Scrolling away must drop a previously queued offscreen author');
    requests[1].complete([profile(60)]);
    await until(() => photoLoaded(card(distant)), 'Scrolling into view should load a photo without opening author details');
    const scrollTop = document.querySelector('.authors-browser').scrollTop;
    card(distant).click();
    await until(() => photoLoaded(document.querySelector('.author-detail')) && typeof backAction === 'function', 'Author details should reuse the loaded photo');
    backAction();
    await until(() => photoLoaded(card(distant)), 'Returning to the author list should keep the loaded photo');
    check(Math.abs(document.querySelector('.authors-browser').scrollTop - scrollTop) < 2, 'Returning from details should restore list position');
    check(document.activeElement === card(distant), 'Returning from details should restore author focus');
    check(requests.length === 2, 'Opening and leaving details must not repeat a cached lookup');

    scrollTo(first);
    await until(() => requests.length === 3, 'A skipped author should load after scrolling back into view');
    check(requests[2].name === queued, 'Only the uncached visible author should be looked up again');
    requests[2].complete([]);
    await until(() => Object.hasOwn(JSON.parse(localStorage.getItem(AUTOMATIC_AUTHOR_PROFILES_KEY)), authorKey(queued)), 'Empty results should be persisted');
    await until(() => avatar(queued)?.dataset.photoStatus === 'empty', 'An empty lookup should replace its loading indicator');
    assertStatus(queued, 'empty', 'No photo found');
    const manualProfiles = JSON.parse(localStorage.getItem(AUTHOR_PROFILES_KEY));
    manualProfiles[authorKey(names[3])] = profile(3);
    localStorage.setItem(AUTHOR_PROFILES_KEY, JSON.stringify(manualProfiles));
    window.dispatchEvent(new Event('focus'));
    await until(() => JSON.parse(localStorage.getItem(AUTHOR_PROFILES_KEY))[authorKey(names[3])]?.storedPhoto, 'Existing manually chosen remote photos must migrate to local files');
    check(photoSaves.some(value => value.name === names[3]) && !requests.some(request => request.name === names[3]), 'Migrating a manual photo must reuse its URL without another author search');
    const expiredProfiles = JSON.parse(localStorage.getItem(AUTOMATIC_AUTHOR_PROFILES_KEY));
    expiredProfiles[authorKey(first)] = { ...expiredProfiles[authorKey(first)], checkedAt: checkedAt - 10000, expiresAt: checkedAt - 1, version: 0, failed: true };
    localStorage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(expiredProfiles));
    const previousCard = card(first);
    render();
    await until(() => card(first) !== previousCard && photoLoaded(card(first)), 'Remounting should restore the automatic photo from storage');
    await pause(450);
    check(requests.length === 3, 'Remounting must keep stored photos even when their old cache version, expiration, and failure flag are stale');
    assertStatus(queued, 'empty', 'No photo found');
    check(requests.every(request => request.options?.allSources !== true), 'Automatic browsing must not request the broader manual profile search');
    check(maximumActiveRequests === 1, 'Automatic author lookups must remain sequential');
    const saved = JSON.parse(localStorage.getItem(AUTOMATIC_AUTHOR_PROFILES_KEY));
    delete saved[authorKey(queued)];
    localStorage.setItem(AUTOMATIC_AUTHOR_PROFILES_KEY, JSON.stringify(saved));
    const cachedCard = card(first);
    render();
    await until(() => card(first) && card(first) !== cachedCard, 'The final test mount should render before cleanup');
    root.unmount();
    await pause(450);
    check(requests.length === 3, 'Unmounting must cancel the delayed lookup of an uncached visible author');
    const failureRoot = createRoot(document.getElementById('root'));
    failureRoot.render(<AuthorsBrowser files={[files[1]]} language="en" t={key => key} />);
    await until(() => requests.length === 4 && avatar(queued)?.dataset.photoStatus === 'loading', 'A fresh lookup should display loading before failure');
    requests[3].fail();
    await until(() => avatar(queued)?.dataset.photoStatus === 'error', 'Failed lookups should replace the loading state');
    assertStatus(queued, 'error', 'Lookup failed');
    failureRoot.unmount();
    const imageRoot = createRoot(document.getElementById('root'));
    const labels = { photoLoading: 'Loading photo…', photoFailed: 'Photo unavailable' };
    imageRoot.render(<div data-author-key={authorKey(first)}><AuthorAvatar name={first} profile={{ photoUrl: 'https://fixture.test/pending-photo.png' }} status="ready" labels={labels} /></div>);
    await until(() => avatar(first)?.dataset.photoStatus === 'image-loading', 'An image request should display its own loading status');
    assertStatus(first, 'image-loading', 'Loading photo…', true);
    await until(() => avatar(first)?.dataset.photoStatus === 'image-error', 'An unavailable image should stop displaying a loading status');
    assertStatus(first, 'image-error', 'Photo unavailable');
    imageRoot.unmount();
    const layoutRoot = createRoot(document.getElementById('root'));
    const layoutStates = ['empty', 'queued', 'loading', 'error', 'ready'];
    const failedPhoto = { photoUrl: 'https://fixture.test/pending-photo.png' };
    const renderLayout = width => layoutRoot.render(<div className="authors-browser layout-check" style={{ width }}><div className="author-grid">
        {layoutStates.map(status => <button className="author-card" key={status}>
            <span className="author-card-image"><AuthorAvatar name="강호풍" status={status} profile={status === 'ready' ? failedPhoto : null} /><span className="author-book-count">1</span></span>
            <strong>강호풍</strong>
        </button>)}
    </div></div>);
    const overlaps = (firstRect, secondRect) => firstRect.left < secondRect.right && firstRect.right > secondRect.left
        && firstRect.top < secondRect.bottom && firstRect.bottom > secondRect.top;
    const assertLayout = () => {
        for (const node of document.querySelectorAll('.layout-check .author-card')) {
            const portrait = node.querySelector('.author-avatar');
            const initials = portrait.querySelector(':scope > [aria-hidden="true"]');
            const status = portrait.querySelector('.author-photo-status');
            if (['empty', 'error', 'image-error'].includes(portrait.dataset.photoStatus)) {
                check(!status, 'A finished lookup must not leave a visible photo status');
                check(portrait.title, 'A finished lookup should remain available as a hover hint');
                const portraitRect = portrait.getBoundingClientRect();
                const initialsRect = initials.getBoundingClientRect();
                check(Math.abs((initialsRect.top + initialsRect.bottom) - (portraitRect.top + portraitRect.bottom)) < 2,
                    'The initials should return to the vertical center after a lookup finishes');
                check(Math.abs((initialsRect.left + initialsRect.right) - (portraitRect.left + portraitRect.right)) < 2,
                    'The initials should remain horizontally centered after a lookup finishes');
                continue;
            }
            check(status, 'An unfinished lookup should display its photo status');
            const statusRect = status.getBoundingClientRect();
            for (const [label, element] of [
                ['initials', initials],
                ['book count', node.querySelector('.author-book-count')],
                ['author name', node.querySelector('strong')],
            ]) {
                check(!overlaps(statusRect, element.getBoundingClientRect()), portrait.dataset.photoStatus + ' must not overlap ' + label);
            }
        }
    };
    renderLayout('100%');
    await until(() => document.querySelector('.layout-check [data-photo-status="image-loading"]'), 'The layout fixture should include image loading');
    assertLayout();
    await until(() => document.querySelector('.layout-check [data-photo-status="image-error"]'), 'The layout fixture should include an unavailable image');
    assertLayout();
    await window.captureAuthorStatus('overlap');
    renderLayout(560);
    await until(() => document.querySelector('.layout-check').getBoundingClientRect().width === 560, 'The layout fixture should enter its narrow container layout');
    await frame();
    assertLayout();
    layoutRoot.unmount();
    return { requests: requests.map(request => request.name), maximumActiveRequests, hiddenPause: true, offscreenQueueRemoved: true, cachedListPhoto: true, detailReturn: true, unmountStopsQueue: true, photoStatuses: true, reducedMotion: true, photoStatusLayout: true, permanentPhotos: true, manualPhotoMigration: true };
};
`;
        await build({
            stdin: { contents: renderer, loader: 'jsx', resolveDir: projectRoot },
            bundle: true,
            outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file', '.png': 'file' },
            logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;height:100%;overflow:hidden}body{--panel-bg:#fff;--panel-bg-2:#eee;--panel-bg-3:#ddd;--text:#222;--muted:#666;--line:#ccc;--accent:#246}</style></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('captureAuthorStatus', kind => ipcRenderer.invoke('capture-author-status', kind));
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-thumbnail', privileges: { standard: true, secure: true } }]);
app.whenReady().then(async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=', 'base64');
    protocol.handle('bookmanager-thumbnail', () => new Response(png, { headers: { 'content-type': 'image/png' } }));
    protocol.handle('https', async request => {
        if (request.url === 'https://fixture.test/pending-photo.png') {
            await new Promise(resolve => setTimeout(resolve, 350));
            return new Response(null, { status: 404 });
        }
        return new Response(png, { headers: { 'content-type': 'image/png' } });
    });
    protocol.handle('http', request => new Response(null, { status: 403 }));
    const window = new BrowserWindow({ show: false, width: 820, height: 620, useContentSize: true, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    ipcMain.handle('capture-author-status', async (_event, kind) => {
        const screenshotPath = kind === 'overlap' ? process.env.BOOKMANAGER_AUTHOR_STATUS_OVERLAP_SCREENSHOT : process.env.BOOKMANAGER_AUTHOR_STATUS_SCREENSHOT;
        if (screenshotPath) {
            const capture = await window.webContents.capturePage();
            await fs.writeFile(screenshotPath, capture.toPNG());
        }
    });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
    const result = await window.webContents.executeJavaScript('window.runAuthorsBrowserTests()');
    console.log('AUTHORS_BROWSER_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Authors browser renderer timed out: ' + result)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/AUTHORS_BROWSER_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), {
            requests: ['Author 001', 'Author 061', 'Author 002', 'Author 002'], maximumActiveRequests: 1,
            hiddenPause: true, offscreenQueueRemoved: true, cachedListPhoto: true, detailReturn: true, unmountStopsQueue: true,
            photoStatuses: true, reducedMotion: true, photoStatusLayout: true, permanentPhotos: true, manualPhotoMigration: true,
        });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
