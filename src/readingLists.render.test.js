import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('읽기 목록에서 파일·폴더 등록과 열기, 컬렉션 관리 및 목록 제거가 연결된다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'reading-lists-render-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderTab } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/FolderTab.jsx')}`)};
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
const book = { path: '/fixture/book.epub', full_path: '/fixture/book.epub', name: 'book.epub', title: 'Test book', ext: '.epub', size: 200, exists: true, readingListAddedAt: '2026-01-01' };
const folder = { path: '/fixture/series', full_path: '/fixture/series', name: 'series', title: 'series', isDirectory: true, is_folder: true, size: 0, exists: true, readingListAddedAt: '2026-01-02' };
const childBook = { ...book, path: '/fixture/series/child.epub', full_path: '/fixture/series/child.epub', name: 'child.epub' };
const entries = new Map([book, folder, childBook].map(entry => [entry.path, entry]));
const books = new Map([['want-to-read', []]]);
const collections = [];
const requests = [];
const scannedPaths = [];
const viewerPaths = [];
const notices = [];
const coverSource = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#4386ad"/></svg>');
book.cover = coverSource + '#book';
const previewRequests = [];
const pendingPreviews = [];
let folderCover = coverSource;
let holdPreviews = false;
let releaseRecent;
let changed;
window.electronAPI = {
    getRoots: async () => [], getSpecialPaths: async () => ({}), getReadingStates: async () => [],
    listRecentReading: async () => [], getLibraryScanStates: async () => ({}),
    stat: async filePath => ({ isDirectory: filePath === '/fixture' || filePath === folder.path, isFile: entries.has(filePath) && filePath !== folder.path }),
    readDir: async filePath => (filePath === '/fixture' ? [folder, book] : [childBook]).map(entry => ({ ...entry, isFile: !entry.isDirectory })),
    scanFolder: async filePath => { scannedPaths.push(filePath); return filePath === folder.path ? [childBook] : [folder, book]; },
    openInternalViewer: async filePath => { viewerPaths.push(filePath); return { success: true }; },
    getFilePreview: async filePath => {
        previewRequests.push(filePath);
        if (filePath !== folder.path) return { success: false };
        const result = { success: true, file: { ...folder, cover: folderCover, cover_file_path: folderCover ? childBook.path : '' } };
        if (holdPreviews) return await new Promise(resolve => pendingPreviews.push(() => resolve(result)));
        return result;
    },
    onReadingListsChanged: callback => { changed = callback; return () => {}; },
    readingLists: async request => {
        requests.push(request);
        const { operation, id } = request;
        if (operation === 'overview') return { success: true, collections: collections.map(c => ({ ...c, count: books.get(c.id).length })), wishlistCount: books.get('want-to-read').length };
        if (operation === 'preview') {
            const members = books.get(id) || [];
            const cover = members.find(entry => !entry.isDirectory && entry.cover)?.cover || (members.some(entry => entry.isDirectory) ? folderCover : '');
            return { success: true, file: { isDirectory: true, is_folder: true, cover } };
        }
        if (operation === 'list') {
            if (id === 'recent-updated') return await new Promise(resolve => { releaseRecent = () => resolve({ success: true, files: [{ ...book, name: 'stale.epub' }] }); });
            return { success: true, files: id === 'recent-added' ? [book] : [...(books.get(id) || [])] };
        }
        if (operation === 'create') {
            collections.push({ id: 'collection-1', name: request.name }); books.set('collection-1', []);
            return { success: true, id: 'collection-1' };
        }
        if (operation === 'rename') collections.find(c => c.id === id).name = request.name;
        if (operation === 'delete') { collections.splice(collections.findIndex(c => c.id === id), 1); books.delete(id); }
        if (operation === 'add') books.set(id, [...new Map([...books.get(id), ...request.paths.map(filePath => entries.get(filePath))].map(entry => [entry.path, entry])).values()]);
        if (operation === 'remove') books.set(id, books.get(id).filter(entry => !request.paths.includes(entry.path)));
        return { success: true, changes: 1, matchedCount: 1, errors: [] };
    },
};
const root = createRoot(document.getElementById('root'));
root.render(<FolderTab config={{ libraries: [], folder_view_mode: 'table' }} t={t} saveConfig={async () => {}} showToast={notice => notices.push(notice)} />);
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text || item.querySelector('.recent-reading-list-main')?.textContent.trim() === text);
const click = async (text, scope = document) => {
    await until(() => button(text, scope), 'Missing button: ' + text);
    button(text, scope).click(); await frame();
};
const setInput = (element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
};
const rowFor = filePath => [...document.querySelectorAll('tr[data-file-path]')].find(row => row.dataset.filePath === filePath);
const collectionPath = 'collection://collection-1';
const collectionCoverImage = () => [...document.querySelectorAll('.view-container [data-file-path]')].find(item => item.dataset.filePath === collectionPath)?.querySelector('img');
const loadedCollectionCover = expected => collectionCoverImage()?.complete && collectionCoverImage().naturalWidth > 0 && collectionCoverImage().getAttribute('src') === expected;
const navigateBack = () => document.querySelector('button[aria-label="' + t('folder.goto.back') + '"]').click();
const folderCoverImage = () => [...document.querySelectorAll('.view-container [data-file-path]')].find(item => item.dataset.filePath === folder.path)?.querySelector('img');
const loadedFolderCover = () => folderCoverImage()?.complete && folderCoverImage().naturalWidth > 0;
async function contextAction(label, filePath = book.path) {
    const row = rowFor(filePath);
    check(row, 'Missing book row');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 450, clientY: 200 }));
    await click('추가');
    await click(label);
}
window.readingListTests = (async () => {
    books.set('want-to-read', [folder]);
    await until(() => document.querySelector('.sidebar-container'), 'Folder sidebar did not mount');
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    await until(loadedFolderCover, 'Wishlist folder cover did not load without a selected folder');
    for (const label of ['menu_thumbnail', 'menu_tile', 'menu_detail']) {
        [...document.querySelectorAll('.view-icon-btn')].find(item => item.title === t(label)).click();
        await frame();
        await until(loadedFolderCover, 'Wishlist cover missing in view: ' + label);
    }
    const coverRequests = () => previewRequests.filter(filePath => filePath === folder.path).length;
    const beforeRefresh = coverRequests();
    changed();
    await until(() => coverRequests() > beforeRefresh && loadedFolderCover(), 'Wishlist refresh did not reload folder cover');
    folderCover = '';
    const beforeEmpty = coverRequests();
    changed();
    await until(() => coverRequests() > beforeEmpty && rowFor(folder.path)?.querySelector('.folder-item-artwork'), 'Folder without a cover did not keep its folder icon');
    folderCover = coverSource + '#old';
    holdPreviews = true;
    changed();
    await until(() => pendingPreviews.length === 1, 'Delayed folder preview was not requested');
    folderCover = coverSource;
    holdPreviews = false;
    changed();
    await until(loadedFolderCover, 'New folder preview was blocked by the old request');
    pendingPreviews.shift()();
    for (let index = 0; index < 5; index += 1) await frame();
    check(folderCoverImage().getAttribute('src') === coverSource, 'Stale preview replaced the current wishlist cover');
    books.set('want-to-read', []);
    changed();
    await until(() => !rowFor(folder.path), 'Preview restored a removed wishlist entry');
    await click('최근 추가됨');
    await until(() => document.querySelector('tr[data-file-path]'), 'Recently added books did not load');
    await contextAction('읽고 싶은 책 추가');
    await until(() => books.get('want-to-read').length === 1, 'Wishlist mutation was not called');
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('tr[data-file-path]'), 'Wishlist book missing');
    await contextAction('컬렉션에 추가');
    await until(() => document.querySelector('dialog[open]'), 'Collection picker did not open');
    let dialog = document.querySelector('dialog[open]');
    setInput(dialog.querySelector('input[placeholder]'), 'Weekend');
    await frame();
    await click('컬렉션 등록', dialog);
    await until(() => collections.length === 1 && dialog.querySelector('input[type=radio]')?.checked, 'New collection was not selected');
    await click('추가', dialog);
    await until(() => !document.querySelector('dialog[open]'), 'Picker did not close');
    check(books.get('collection-1').length === 1, 'Book was not added to collection');
    setInput(document.querySelector('.goto-path-input'), '/fixture');
    await frame();
    document.querySelector('.folder-goto-path-submit').click();
    await until(() => rowFor(folder.path), 'Folder browser did not load for collection registration');
    const normalHeaders = [...document.querySelectorAll('.view-container th')].map(cell => cell.textContent).join('|');
    await contextAction('컬렉션에 추가', folder.path);
    await until(() => document.querySelector('dialog[open]'), 'Folder collection picker missing');
    dialog = document.querySelector('dialog[open]');
    dialog.querySelector('input[type=radio]').click(); await frame();
    await click('추가', dialog);
    await until(() => !document.querySelector('dialog[open]'), 'Folder collection picker did not close');
    check(books.get('collection-1').some(entry => entry.path === folder.path), 'Collection flattened a registered folder');
    await click('컬렉션', document.querySelector('.sidebar-container'));
    await until(() => rowFor(collectionPath) && loadedCollectionCover(book.cover), 'Virtual collection row or file cover missing');
    check([...document.querySelectorAll('.view-container th')].map(cell => cell.textContent).join('|') === normalHeaders, 'Collection does not use the existing table columns');
    check(rowFor(collectionPath).querySelector('.folder-item-name')?.textContent.includes('Weekend'), 'Collection is not rendered as a named folder');
    check(document.querySelector('.goto-path-input').value === '컬렉션' && document.querySelector('.goto-path-input').readOnly, 'Collection location is not virtual');
    for (const label of ['menu_thumbnail', 'menu_tile', 'menu_detail']) {
        [...document.querySelectorAll('.view-icon-btn')].find(item => item.title === t(label)).click();
        await frame();
        await until(() => loadedCollectionCover(book.cover), 'Collection cover missing in view: ' + label);
        if (label === 'menu_thumbnail' && ${JSON.stringify(Boolean(process.env.BOOKMANAGER_READING_SCREENSHOT))}) {
            await new Promise(resolve => { window.continueReadingTest = resolve; console.log('CAPTURE_READING_COLLECTION'); });
        }
    }
    rowFor(collectionPath).click(); await frame();
    check(!document.querySelector('#folder-detail-panel'), 'Virtual collection fetched physical folder details');
    document.activeElement?.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await until(() => rowFor(folder.path) && rowFor(book.path), 'Collection did not open with Enter or preserve its members');
    check(document.querySelector('.goto-path-input').value === '컬렉션 / Weekend', 'Collection breadcrumb missing');
    rowFor(folder.path).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => rowFor(childBook.path), 'Registered collection folder did not open');
    navigateBack();
    await until(() => rowFor(folder.path) && rowFor(book.path), 'Back did not return from registered folder to collection');
    navigateBack();
    await until(() => rowFor(collectionPath), 'Back did not return to collection overview');
    rowFor(collectionPath).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => rowFor(book.path), 'Collection did not open with double click');
    document.querySelector('button[aria-label="' + t('folder.goto.up') + '"]').click();
    await until(() => rowFor(collectionPath), 'Up did not return to collection overview');
    rowFor(collectionPath).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 450, clientY: 200 }));
    await frame();
    check(!button('추가', document.querySelector('.folder-context-menu')), 'Virtual collection exposes physical file actions');
    await click(t('reading_lists.open'), document.querySelector('.folder-context-menu'));
    await until(() => rowFor(book.path), 'Collection context open failed');
    await click('컬렉션 관리');
    await until(() => document.querySelector('dialog[open]'), 'Manage dialog missing');
    dialog = document.querySelector('dialog[open]');
    dialog.querySelector('button[aria-label="이름 변경: Weekend"]').click(); await frame();
    setInput(dialog.querySelector('input[placeholder]'), 'Renamed'); await frame();
    await click('저장', dialog);
    await until(() => collections[0].name === 'Renamed' && document.querySelector('.goto-path-input').value === '컬렉션 / Renamed', 'Renamed title did not update');
    if (${JSON.stringify(Boolean(process.env.BOOKMANAGER_READING_SCREENSHOT))}) {
        await new Promise(resolve => {
            window.continueReadingTest = resolve;
            console.log('CAPTURE_READING_MODAL');
        });
    }
    await click('닫기', dialog);
    await contextAction('컬렉션에서 제외');
    await until(() => !rowFor(book.path) && rowFor(folder.path), 'Removing collection file also removed folder');
    navigateBack();
    await until(() => rowFor(collectionPath) && loadedCollectionCover(folderCover), 'Collection cover did not refresh after member removal');
    rowFor(collectionPath).click(); await frame();
    document.activeElement?.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await until(() => document.querySelector('dialog[open] .reading-collection-confirm'), 'Collection Delete did not open collection confirmation');
    dialog = document.querySelector('dialog[open]');
    await click('삭제', dialog);
    await until(() => collections.length === 0, 'Collection was not deleted');
    await click('닫기', dialog);
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    await until(() => document.querySelector('tr[data-file-path]'), 'Deleting collection removed wishlist');
    await contextAction('읽고 싶은 책 삭제');
    await until(() => !document.querySelector('tr[data-file-path]'), 'Wishlist did not refresh after removal');
    await click('최근 업데이트 됨');
    await until(() => releaseRecent, 'Recent request missing');
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    releaseRecent();
    for (let index = 0; index < 5; index += 1) await frame();
    check(!document.querySelector('tr[data-file-path]'), 'Stale recent response replaced wishlist');
    check(!requests.some(request => request.operation === 'list' && request.id === 'collections'), 'Collections view incorrectly fetched a book list');
    setInput(document.querySelector('.goto-path-input'), '/fixture');
    await frame();
    document.querySelector('.folder-goto-path-submit').click();
    await until(() => rowFor(folder.path) && rowFor(book.path), 'Folder browser did not load');
    await contextAction('읽고 싶은 책 추가', folder.path);
    await until(() => books.get('want-to-read').some(entry => entry.path === folder.path), 'Folder path was not added');
    await contextAction('읽고 싶은 책 추가');
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    await until(() => rowFor(folder.path) && rowFor(book.path), 'Wishlist did not show files and folders together');
    check(rowFor(folder.path).querySelector('.folder-item-name'), 'Wishlist folder is displayed as a file');
    check(notices.includes('파일·폴더 1개를 추가했습니다.'), 'Wishlist notice still counts books');
    rowFor(folder.path).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => scannedPaths.includes(folder.path) && rowFor(childBook.path), 'Wishlist folder did not open in folder browser');
    check(!viewerPaths.includes(folder.path), 'Folder was opened as a book');
    await contextAction('읽고 싶은 책 추가', childBook.path);
    await click('읽고 싶은 책', document.querySelector('.sidebar-container'));
    await until(() => rowFor(folder.path) && rowFor(childBook.path), 'Separate child file missing from wishlist');
    await contextAction('읽고 싶은 책 삭제', folder.path);
    await until(() => !rowFor(folder.path), 'Wishlist folder was not removed');
    check(rowFor(childBook.path) && rowFor(book.path), 'Removing folder removed separately saved files');
    rowFor(book.path).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => viewerPaths.includes(book.path), 'Wishlist file did not open in viewer');
    check(!previewRequests.some(filePath => filePath.startsWith('collection://')), 'Virtual collection was sent to filesystem preview');
    const report = { mutations: requests.filter(request => !['list', 'overview', 'preview'].includes(request.operation)).map(request => request.operation), staleResponseIgnored: true, folderOpened: true, fileOpened: true, folderCoversLoaded: true, virtualCollections: true };
    root.unmount();
    return report;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
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
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', async (_event, level, message) => {
        if (level >= 2) console.error(message);
        if (message === 'CAPTURE_READING_MODAL' || message === 'CAPTURE_READING_COLLECTION') {
            const screenshot = await window.webContents.capturePage();
            const filename = ${JSON.stringify(process.env.BOOKMANAGER_READING_SCREENSHOT || '/tmp/bookmanager-reading-lists.png')};
            require('node:fs').writeFileSync(message === 'CAPTURE_READING_COLLECTION' ? filename.replace('.png', '-collections.png') : filename, screenshot.toPNG());
            await window.webContents.executeJavaScript('window.continueReadingTest()');
        }
    });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.readingListTests');
    console.log('READING_LIST_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Reading list renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/READING_LIST_RESULT=(.+)/)[1]);
        assert.deepEqual(report.mutations, ['add', 'create', 'add', 'add', 'rename', 'remove', 'delete', 'remove', 'add', 'add', 'add', 'remove']);
        assert.equal(report.staleResponseIgnored, true);
        assert.equal(report.folderOpened, true);
        assert.equal(report.fileOpened, true);
        assert.equal(report.folderCoversLoaded, true);
        assert.equal(report.virtualCollections, true);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
