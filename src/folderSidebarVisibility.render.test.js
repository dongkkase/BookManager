import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('모아보기 표시 설정은 순서 변경·숨김·복원·저장과 기존 라이브러리 설정을 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-sidebar-visibility-test-'));
    const captureDirectory = process.env.BOOKMANAGER_SIDEBAR_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    try {
        const renderer = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import FolderSidebar from './src/components/folder/FolderSidebar.jsx';
import { translate } from './src/utils/i18n.js';
import { applyMotionPreference } from './src/motionPolicy.js';
import './src/styles/global.css';
import './src/styles/FolderTab.css';
import './src/styles/ReadingLists.css';
const storageKey = 'bookmanager.folderSidebar.readingDisplayFields';
const orderStorageKey = 'bookmanager.folderSidebar.readingOrder';
const t = (key, values) => translate(key, 'ko', values);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 3) { for (let index = 0; index < count; index += 1) await frame(); }
async function until(predicate, message) {
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) { if (predicate()) return; await frame(); }
    throw new Error(message);
}
const items = [
    ['favorites', 'folder.sidebar.favorites'],
    ['collections', 'reading_lists.collections'],
    ['recent-reading', 'folder.sidebar.recent_reading'],
    ['recent-added', 'reading_lists.recent_added'],
    ['recent-updated', 'reading_lists.recent_updated'],
    ['wishlist', 'reading_lists.wishlist'],
    ['authors', 'reading_lists.authors'],
    ['annotations', 'reading_lists.annotations'],
    ['missing-volumes', 'tf_btn_check_missing'],
];
const defaultOrder = items.map(([key]) => key);
const libraries = ['/fixture/books'];
const favorites = ['/fixture/books/favorite.epub'];
const navigation = [];
const root = createRoot(document.getElementById('root'));
let mount = 0;
window.electronAPI = {
    getRoots: async () => [],
    getSpecialPaths: async () => ({}),
    readDir: async () => [],
    getLibraryFolderChildren: async () => ({ indexed: true, children: [] }),
};
applyMotionPreference('reduced');
localStorage.clear();
function renderSidebar() {
    root.render(<div className="folder-tab"><div className="folder-main-area">
        <aside className="folder-left-panel" style={{ width: 280 }}><div className="sidebar-container">
            <FolderSidebar key={++mount} t={t} libraries={libraries} favorites={favorites}
                readingListSelected="authors" collectionCount={2} recentReadingCount={3}
                recentAddedCount={4} recentUpdatedCount={5} wishlistCount={6}
                authorCount={7} annotationCount={8} missingCount={9}
                onSelectReadingList={kind => navigation.push(kind)}
                onSelectRecentReading={() => navigation.push('recent-reading')}
                onCheckMissingVolumes={() => navigation.push('missing-volumes')} />
        </div></aside>
    </div></div>);
}
const trigger = () => document.querySelector('.reading-display-options-button');
const menu = () => document.querySelector('.reading-display-options-menu');
const options = () => [...(menu()?.querySelectorAll('[role="menuitemcheckbox"]') || [])];
const option = key => options().find(button => button.textContent.trim() === t(items.find(item => item[0] === key)[1]));
const row = key => menu()?.querySelector('[data-reading-key="' + key + '"]');
const handle = key => row(key)?.querySelector('.reading-display-reorder-handle');
const menuOrder = () => [...menu().querySelectorAll('.reading-display-field-row')].map(node => node.dataset.readingKey);
const labels = () => [...document.querySelectorAll('.sidebar-section-reading .nav-list .recent-reading-list-main')]
    .map(node => node.textContent.trim());
const visible = key => labels().includes(t(items.find(item => item[0] === key)[1]));
function keyDown(key) {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
async function openMenu() {
    trigger().click();
    await until(() => options().length === items.length && getComputedStyle(menu()).visibility !== 'hidden', 'Reading display menu did not open');
    await frames();
}
function checkOrder(expected) {
    check(JSON.stringify(menuOrder()) === JSON.stringify(expected), 'Settings rows must follow the configured order: ' + menuOrder().join(', '));
    const expectedLabels = expected.filter(key => option(key).getAttribute('aria-checked') === 'true')
        .map(key => t(items.find(item => item[0] === key)[1]));
    check(JSON.stringify(labels()) === JSON.stringify(expectedLabels), 'Visible sidebar rows must follow the configured order: ' + labels().join(', '));
}
async function moveWithKeyboard(key, direction) {
    const control = handle(key);
    check(control?.draggable && control.getAttribute('role') === 'menuitem' && control.getAttribute('aria-label'), 'Reorder handles must be draggable and named');
    control.focus();
    keyDown(direction);
    await frames();
    check(document.activeElement === handle(key), 'Keyboard reordering must preserve focus on the moved handle');
}
async function dragBeforeOrAfter(key, targetKey, after) {
    const control = handle(key);
    const target = row(targetKey);
    const bounds = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    control.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    const eventOptions = { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height * (after ? 0.75 : 0.25) };
    target.dispatchEvent(new DragEvent('dragover', eventOptions));
    target.dispatchEvent(new DragEvent('drop', eventOptions));
    control.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    await frames();
}
async function toggle(key) {
    const button = option(key);
    check(button, 'Missing display toggle: ' + key);
    const wasChecked = button.getAttribute('aria-checked') === 'true';
    button.click();
    await until(() => option(key)?.getAttribute('aria-checked') === String(!wasChecked), 'Toggle did not update: ' + key);
    await frames();
    check(Boolean(menu()), 'The menu must stay open for consecutive changes');
    check(visible(key) !== wasChecked, 'The corresponding navigation row did not update: ' + key);
}
renderSidebar();
window.runFolderSidebarVisibilityTest = async () => {
    await document.fonts.ready;
    await until(() => labels().length === items.length, 'All nine reading items should be visible by default');
    check(trigger().getAttribute('aria-label') === '모아보기 표시 설정', 'Display options needs an accessible label');
    check(trigger().getAttribute('aria-haspopup') === 'menu', 'Display options needs menu semantics');
    await openMenu();
    check(options().every(button => button.getAttribute('aria-checked') === 'true'), 'Every default toggle should be enabled');
    check(document.activeElement === options()[0], 'Opening the menu should focus its first option');
    keyDown('ArrowDown');
    check(document.activeElement === options()[1], 'ArrowDown should navigate to the next toggle without reordering');
    keyDown('ArrowLeft');
    check(document.activeElement === handle('collections'), 'ArrowLeft should focus the reorder handle');
    keyDown('ArrowRight');
    check(document.activeElement === option('collections'), 'ArrowRight should return to the visibility toggle');
    keyDown('End');
    check(document.activeElement === options().at(-1), 'End should focus the last toggle');
    keyDown('ArrowDown');
    check(document.activeElement === options()[0], 'Arrow navigation should wrap around visibility toggles');
    keyDown('ArrowUp');
    check(document.activeElement === options().at(-1), 'ArrowUp should wrap to the last toggle without reordering');
    keyDown('Home');
    check(document.activeElement === options()[0], 'Home should focus the first toggle');
    checkOrder(defaultOrder);
    await moveWithKeyboard('favorites', 'ArrowUp');
    await moveWithKeyboard('missing-volumes', 'ArrowDown');
    checkOrder(defaultOrder);
    await moveWithKeyboard('authors', 'ArrowUp');
    checkOrder(['favorites', 'collections', 'recent-reading', 'recent-added', 'recent-updated', 'authors', 'wishlist', 'annotations', 'missing-volumes']);
    await moveWithKeyboard('authors', 'ArrowDown');
    checkOrder(defaultOrder);
    await dragBeforeOrAfter('authors', 'favorites', false);
    let savedOrder = ['authors', ...defaultOrder.filter(key => key !== 'authors')];
    checkOrder(savedOrder);
    await dragBeforeOrAfter('annotations', 'authors', true);
    savedOrder = ['authors', 'annotations', ...defaultOrder.filter(key => !['authors', 'annotations'].includes(key))];
    checkOrder(savedOrder);
    check(JSON.stringify(JSON.parse(localStorage.getItem(orderStorageKey))) === JSON.stringify(savedOrder), 'Reordering must persist independently from visibility');
    check(document.querySelector('.sidebar-section-reading [aria-current="page"]')?.textContent.includes(t('reading_lists.authors')), 'Reordering must retain the selected navigation item');
    check(navigation.length === 0, 'Reordering must not navigate or run the missing-volume check');

    await toggle('authors');
    await toggle('annotations');
    check(navigation.length === 0, 'Hiding the selected page must not navigate away or invoke a row action');
    const stored = JSON.parse(localStorage.getItem(storageKey));
    check(stored.authors === false && stored.annotations === false && stored.favorites === true, 'Changed visibility must be persisted separately');
    keyDown('Escape');
    await until(() => !menu(), 'Escape should close the display menu');
    check(document.activeElement === trigger(), 'Escape should restore focus to the trigger');
    check(trigger().getAttribute('aria-expanded') === 'false', 'Closed trigger must reflect its collapsed state');

    renderSidebar();
    await frames();
    check(labels().length === 7 && !visible('authors') && !visible('annotations'), 'A remount should restore saved hidden items');
    await openMenu();
    check(option('authors').getAttribute('aria-checked') === 'false', 'The restored menu should match saved visibility');
    checkOrder(savedOrder);
    await dragBeforeOrAfter('annotations', 'missing-volumes', true);
    savedOrder = [...savedOrder.filter(key => key !== 'annotations'), 'annotations'];
    checkOrder(savedOrder);
    check(!visible('annotations'), 'Reordering a hidden item must not make it visible');
    await toggle('annotations');
    checkOrder(savedOrder);
    check(labels().at(-1) === t('reading_lists.annotations'), 'Restored hidden items must use their updated position');
    await toggle('annotations');
    for (const [key] of items) {
        if (option(key).getAttribute('aria-checked') === 'true') await toggle(key);
    }
    check(labels().length === 0, 'All reading items may be hidden');
    check(navigation.length === 0, 'Visibility changes must never select or execute a menu item');
    keyDown('Escape');
    await until(() => !menu(), 'The all-hidden menu should still close');
    check(trigger().getBoundingClientRect().height > 0, 'The display settings trigger must remain reachable when all items are hidden');
    await openMenu();
    await toggle('authors');
    check(labels().length === 1 && visible('authors'), 'The menu should restore items from an all-hidden state');
    check(document.querySelector('.sidebar-section-reading [aria-current="page"]')?.textContent.includes(t('reading_lists.authors')), 'Restoring the selected item should keep its selected state');
    keyDown('Escape');
    await until(() => !menu(), 'Reading settings should close before library settings');

    const libraryTrigger = document.querySelector('.library-display-options-button');
    libraryTrigger.click();
    await until(() => document.querySelectorAll('.library-display-options-menu [role="menuitemcheckbox"]').length === 3, 'Existing library display menu should still open');
    const libraryOption = [...document.querySelectorAll('.library-display-options-menu [role="menuitemcheckbox"]')]
        .find(button => button.textContent.trim() === t('folder_library_show_folders'));
    check(libraryOption?.getAttribute('aria-checked') === 'true', 'Library folder counts should be enabled by default');
    libraryOption.click();
    await frames();
    check(libraryOption.getAttribute('aria-checked') === 'false', 'The existing library folder-count toggle should still work');
    check(JSON.parse(localStorage.getItem('bookmanager.folderSidebar.libraryDisplayFields')).folders === false, 'Library display settings should use their own saved state');
    check(JSON.parse(localStorage.getItem(storageKey)).authors === true, 'Library display settings must not overwrite reading visibility');
    check(JSON.stringify(JSON.parse(localStorage.getItem(orderStorageKey))) === JSON.stringify(savedOrder), 'Library display settings must not overwrite reading order');
    keyDown('Escape');
    await until(() => !document.querySelector('.library-display-options-menu'), 'Library menu should close with Escape');
    check(document.activeElement === libraryTrigger, 'Library menu focus restoration must remain intact');

    for (const invalid of ['{broken', 'null', '"invalid"']) {
        localStorage.setItem(storageKey, invalid);
        renderSidebar();
        await frames();
        check(labels().length === 9, 'Malformed visibility settings should preserve all default navigation items');
    }
    localStorage.setItem(storageKey, JSON.stringify({ authors: false }));
    renderSidebar();
    await frames();
    check(labels().length === 8 && !visible('authors') && visible('annotations'), 'Missing fields in saved settings should remain visible');
    localStorage.removeItem(storageKey);
    renderSidebar();
    await frames();
    check(labels().length === 9, 'Missing saved settings should restore the default view');
    for (const invalid of ['{broken', 'null', '"invalid"', '{}']) {
        localStorage.setItem(orderStorageKey, invalid);
        renderSidebar();
        await frames();
        await openMenu();
        checkOrder(defaultOrder);
        keyDown('Escape');
        await until(() => !menu(), 'Invalid-order fallback menu should close');
    }
    localStorage.setItem(orderStorageKey, JSON.stringify(['annotations', 'annotations', 'unregistered', null, 3, 'authors']));
    renderSidebar();
    await frames();
    await openMenu();
    const normalizedOrder = ['annotations', 'authors', ...defaultOrder.filter(key => !['annotations', 'authors'].includes(key))];
    checkOrder(normalizedOrder);
    check(JSON.stringify(JSON.parse(localStorage.getItem(orderStorageKey))) === JSON.stringify(normalizedOrder), 'Saved order must remove invalid keys and duplicates and append missing items');
    keyDown('Escape');
    await until(() => !menu(), 'Normalized-order menu should close');
    localStorage.removeItem(orderStorageKey);
    renderSidebar();
    await frames();
    await openMenu();
    checkOrder(defaultOrder);
    const bounds = menu().getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'The menu must stay inside the window');
    return { itemCount: items.length, navigationCount: navigation.length, savedVisibility: true, savedOrder: true, keyboardNavigation: true, dragReordering: true, librarySettings: true };
};
`;
        await build({
            stdin: { contents: renderer, loader: 'jsx', resolveDir: projectRoot },
            bundle: true,
            outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file' },
            logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 800, height: 760, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.runFolderSidebarVisibilityTest()');
        const capturePath = ${JSON.stringify(captureDirectory ? path.join(captureDirectory, 'reading-display-options.png') : null)};
        if (capturePath) await fs.writeFile(capturePath, (await window.webContents.capturePage()).toPNG());
        process.stdout.write('FOLDER_SIDEBAR_VISIBILITY_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const executable = createRequire(import.meta.url)('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(executable, [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('Folder sidebar visibility test timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/FOLDER_SIDEBAR_VISIBILITY_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        assert.deepEqual(JSON.parse(payload), {
            itemCount: 9, navigationCount: 0, savedVisibility: true, savedOrder: true, keyboardNavigation: true, dragReordering: true, librarySettings: true,
        });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
