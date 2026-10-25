import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('상세 더보기 메뉴는 현재 책에만 작업하며 두 패널 배치에서 접근할 수 있다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'folder-detail-actions-')));
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
    throw new Error(message);
}
const makeBook = (name, title, ext = '.epub') => ({
    path: '/fixture/' + name + ext, full_path: '/fixture/' + name + ext, name: name + ext,
    title, ext, size: 2048, exists: true, has_metadata: true, rating: '3',
});
const first = makeBook('first', '첫 번째 책');
const current = makeBook('current', '상세 작업 대상');
const unsupported = makeBook('unsupported', '지원하지 않는 형식', '.mobi');
const files = [first, current, unsupported];
const memberships = new Map([['want-to-read', new Set()], ['collection-1', new Set()]]);
const listRequests = [];
const progressRequests = [];
const ratingRequests = [];
const navigations = [];
const viewerPaths = [];
window.addEventListener('bookmanager:navigate', event => navigations.push(event.detail));
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getLibraryScanStates: async () => ({}),
    getReadingStates: async () => [], listRecentReading: async () => [],
    stat: async filePath => ({ isDirectory: filePath === '/fixture', isFile: files.some(file => file.path === filePath) }),
    readDir: async () => files.map(file => ({ ...file, isFile: true })), scanFolder: async () => files,
    getFilePreview: async () => ({ success: false }),
    openInternalViewer: async filePath => { viewerPaths.push(filePath); return { success: true }; },
    readingLists: async request => {
        listRequests.push(request);
        const members = memberships.get(request.id);
        if (request.operation === 'overview') return { success: true, collections: [{ id: 'collection-1', name: '테스트 컬렉션', count: memberships.get('collection-1').size }], wishlistCount: memberships.get('want-to-read').size, recentAddedCount: 0, recentUpdatedCount: 0 };
        if (request.operation === 'membership') return { success: true, totalCount: request.paths.length, memberCount: request.paths.filter(filePath => members.has(filePath)).length };
        if (request.operation === 'add') request.paths.forEach(filePath => members.add(filePath));
        if (request.operation === 'remove') request.paths.forEach(filePath => members.delete(filePath));
        return { success: true, changes: request.paths?.length || 0, matchedCount: request.paths?.length || 0, errors: [] };
    },
    updateReadingProgress: async (paths, action) => {
        progressRequests.push({ paths, action });
        return { states: paths.map(filePath => ({ filePath, status: action === 'mark-read' ? 'completed' : 'unread', scrollPercent: action === 'mark-read' ? 100 : 0 })), errors: [] };
    },
    saveRating: async request => {
        ratingRequests.push(request);
        return { success: true, filePath: request.filePath, rating: request.rating, storage: 'database' };
    },
};
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
root.render(<FolderTab config={{ libraries: [], folder_view_mode: 'table', folder_last_path: '/fixture', folder_detail_panel_height: 320 }}
    t={t} saveConfig={async () => {}} showToast={() => {}} />);
const row = file => document.querySelector('tr[data-file-path="' + file.path + '"]');
const selectedPaths = () => [...document.querySelectorAll('tr[data-file-path][aria-selected="true"]')].map(item => item.dataset.filePath).sort();
const activePanel = () => document.querySelector('#folder-detail-panel .detail-panel-layer:not(.is-outgoing)');
const visibleControl = selector => [...(activePanel()?.querySelectorAll(selector) || [])].find(element => element.getClientRects().length > 0);
const more = () => visibleControl('.detail-more-button');
const menu = () => document.querySelector('#folder-detail-actions-menu');
const isMenuOpen = () => menu() && menu().getAttribute('aria-hidden') !== 'true' && !menu().closest('[inert]');
const menuButton = key => [...(menu()?.querySelectorAll('button') || [])].find(item => item.textContent.trim() === t(key));
const rect = element => element.getBoundingClientRect();
const onlyCurrent = paths => JSON.stringify(paths) === JSON.stringify([current.path]);
const clickVisible = element => {
    check(element && !element.disabled, 'Missing or disabled control');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const bounds = rect(element);
    const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    check(target && element.contains(target), 'Control is covered: ' + element.textContent);
    element.focus();
    element.click();
};
async function openMenu() {
    more().scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await frame();
    await frame();
    clickVisible(more());
    await until(isMenuOpen, 'Detail menu did not open');
    await frame();
}
async function action(key) {
    await openMenu();
    await until(() => menuButton(key) && !menuButton(key).disabled, 'Detail action unavailable: ' + key);
    clickVisible(menuButton(key));
    await until(() => !isMenuOpen(), 'Detail action did not close its menu');
    await frame();
}
async function selectCurrentWithAnotherBook() {
    row(first).click();
    await until(() => activePanel()?.textContent.includes(first.title) && selectedPaths().includes(first.path), 'First book selection did not settle');
    const modifier = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    row(current).dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifier }));
    await until(() => activePanel()?.textContent.includes(current.title) && more(), 'Current book details did not load');
    await until(() => selectedPaths().length === 2, 'Fixture must retain two selected books: ' + JSON.stringify(selectedPaths()));
}
function verifyMenuLayout(position) {
    const reading = visibleControl('.detail-open-button');
    check(reading, 'Reading button is missing');
    const readBounds = rect(reading);
    const moreBounds = rect(more());
    check(moreBounds.left >= readBounds.right && Math.abs(moreBounds.top - readBounds.top) <= 1, position + ': more button must be beside the reading button');
    check(Math.abs(moreBounds.height - readBounds.height) <= 1, position + ': more and reading buttons must share their height');
    check(more().querySelector('svg') && more().getAttribute('aria-label'), position + ': icon button needs an accessible name');
    const bounds = rect(menu());
    check(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, position + ': menu escapes the viewport');
    const labels = [...menu().querySelectorAll('button')].map(button => button.textContent.trim());
    const expected = ['reading_lists.wishlist_add', 'reading_lists.wishlist_remove', 'reading_lists.collection_add', 'folder.reading.mark_read', 'folder.reading.reset_progress', 'rating_editor_title', 'folder.detail.edit_metadata', 'folder.detail.edit_cover'].map(key => t(key));
    check(JSON.stringify(labels) === JSON.stringify(expected), position + ': unexpected menu actions: ' + JSON.stringify(labels));
}
window.runFolderDetailActionTests = async () => {
    await until(() => row(current)?.textContent.includes(current.title) && row(unsupported) && document.querySelector('.view-container')?.getAttribute('aria-busy') === 'false', 'Fixture files did not load');
    await frame();
    await frame();
    await selectCurrentWithAnotherBook();
    const initialSelection = JSON.stringify(selectedPaths());
    await document.fonts.ready;
    await openMenu();
    verifyMenuLayout('bottom');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await until(() => !isMenuOpen(), 'Escape did not close the detail menu');
    check(document.activeElement === more(), 'Escape did not return focus to the more button');
    await openMenu();
    document.querySelector('.view-container').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await until(() => !isMenuOpen(), 'Click outside did not close the detail menu');
    await action('reading_lists.wishlist_add');
    await until(() => memberships.get('want-to-read').has(current.path), 'Wishlist addition did not complete');
    check(memberships.get('want-to-read').size === 1, 'Wishlist added another selected book');
    check(JSON.stringify(selectedPaths()) === initialSelection, 'Wishlist addition changed the selection');
    await openMenu();
    await until(() => menuButton('reading_lists.wishlist_add')?.disabled && !menuButton('reading_lists.wishlist_remove')?.disabled, 'Wishlist membership did not update the menu');
    clickVisible(menuButton('reading_lists.wishlist_remove'));
    await until(() => !isMenuOpen() && memberships.get('want-to-read').size === 0, 'Wishlist removal did not complete');
    await action('reading_lists.collection_add');
    await until(() => document.querySelector('.reading-collections-dialog[open]'), 'Collection dialog did not open');
    document.querySelector('.reading-collections-dialog input[type="radio"]').click();
    await frame();
    clickVisible(document.querySelector('.reading-collections-dialog footer .primary'));
    await until(() => memberships.get('collection-1').has(current.path) && !document.querySelector('.reading-collections-dialog'), 'Collection addition did not complete');
    check(memberships.get('collection-1').size === 1, 'Collection added another selected book');
    for (const [key, expectedAction] of [['folder.reading.mark_read', 'mark-read'], ['folder.reading.reset_progress', 'reset-progress']]) {
        await action(key);
        await until(() => progressRequests.at(-1)?.action === expectedAction, 'Reading progress action did not run');
        check(onlyCurrent(progressRequests.at(-1).paths), 'Reading action affected another selected book');
    }
    await action('rating_editor_title');
    await until(() => document.querySelector('.rating-editor-dialog'), 'Rating dialog did not open');
    check(document.querySelector('.rating-editor-book-title').textContent === current.title, 'Rating dialog targeted another book');
    document.querySelector('.rating-editor-dialog input[value="8"]').click();
    await frame();
    clickVisible(document.querySelector('.rating-editor-submit'));
    await until(() => ratingRequests.length === 1 && !document.querySelector('.rating-editor-dialog'), 'Rating save did not complete');
    check(ratingRequests[0].filePath === current.path && ratingRequests[0].rating === 8, 'Rating saved the wrong book or value');
    await action('folder.detail.edit_metadata');
    check(navigations.at(-1)?.tabId === 'metadata' && onlyCurrent(navigations.at(-1).paths), 'Metadata navigation must target only the current detail book');
    await action('folder.detail.edit_cover');
    check(navigations.at(-1)?.tabId === 'tools' && navigations.at(-1)?.toolId === 'cover-editor' && onlyCurrent(navigations.at(-1).paths), 'Cover editor must target only the current detail book');
    check(JSON.stringify(selectedPaths()) === initialSelection, 'Detail actions changed the list selection');
    check(listRequests.filter(request => ['membership', 'add', 'remove'].includes(request.operation)).every(request => onlyCurrent(request.paths)), 'Membership queries or changes included other selected files');
    document.querySelector('.folder-detail-position-button[data-position="right"]').click();
    await until(() => document.querySelector('.folder-content-area.is-detail-right'), 'Right detail layout did not activate');
    await openMenu();
    verifyMenuLayout('right');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await until(() => !isMenuOpen(), 'Right detail menu did not close');
    clickVisible(visibleControl('.detail-open-button'));
    await until(() => viewerPaths.includes(current.path), 'Reading action stopped working beside the new menu');
    row(unsupported).click();
    await until(() => activePanel()?.textContent.includes(unsupported.title), 'Unsupported file details did not load');
    await openMenu();
    check(menuButton('rating_editor_title')?.disabled, 'Unsupported file rating must be disabled');
    check(menuButton('folder.detail.edit_cover')?.disabled, 'Unsupported file cover editing must be disabled');
    root.unmount();
    return { layouts: ['bottom', 'right'], actions: 8, progressChanges: progressRequests.length, ratingSaves: ratingRequests.length };
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
    const window = new BrowserWindow({ show: false, width: 1000, height: 700, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.runFolderDetailActionTests()');
    console.log('FOLDER_DETAIL_ACTIONS_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder detail actions renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/FOLDER_DETAIL_ACTIONS_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), { layouts: ['bottom', 'right'], actions: 8, progressChanges: 2, ratingSaves: 1 });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
