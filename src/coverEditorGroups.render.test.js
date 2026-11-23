import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

async function checkGroups() {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const until = async (predicate, message) => {
        const deadline = performance.now() + 8000;
        while (performance.now() < deadline) {
            if (predicate()) return;
            await frame();
        }
        throw new Error(message);
    };
    const canvas = Object.assign(document.createElement('canvas'), { width: 200, height: 300 });
    const context = canvas.getContext('2d');
    const makeCover = color => {
        context.fillStyle = color;
        context.fillRect(0, 0, 200, 300);
        return canvas.toDataURL();
    };
    const covers = { '/images/A.png': makeCover('#446e89'), '/images/B.png': makeCover('#92694e') };
    let imagePath = '/images/A.png';
    const saved = [];
    const files = ['별빛 여행/01.cbz', '바람의 기록/01.cbz', '별빛 여행/02.cbz', '별빛 여행/외전/01.cbz']
        .map(relative => ({ full_path: '/books/' + relative, name: relative.split('/').at(-1), checked: true }));
    window.electronAPI = {
        inspectCoverEditor: async filePath => ({ filePath, name: filePath.split('/').at(-1), version: 'v1', kind: 'comic',
            storage: 'file', canAdd: true, canRenumber: true, pageCount: 100, size: 10485760, coverDataUrl: covers['/images/A.png'], coverEntry: '001.jpg' }),
        selectFile: async () => imagePath,
        previewCoverEditorImage: async imagePath => ({ imagePath, imageVersion: imagePath, dataUrl: covers[imagePath], width: 200, height: 300, size: 1024 }),
        releaseCoverEditorImages: async () => {},
    };
    const t = (key, values) => translate(key, 'ko', values);
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(CoverEditorDialog, { embedded: true, files, t, onClose() {}, onToggleAll() {}, onToggleFile() {},
        onExecute: async requests => {
            saved.push(...requests);
            return { batch: true, successCount: requests.length, failureCount: 0, cancelledCount: 0,
                results: requests.map(request => ({ success: true, sourcePath: request.filePath, filePath: request.filePath })) };
        } }));
    const group = name => document.querySelector('[data-cover-group="/books/' + name + '"]');
    const browse = () => [...document.querySelectorAll('button')].find(button => button.textContent === t('cover_editor_local_browse'));
    const newCover = () => document.querySelector('.cover-editor-candidate img')?.getAttribute('src');
    const save = () => document.querySelector('.cover-editor-save');
    await until(() => group('별빛 여행') && !browse()?.disabled, 'Groups did not finish loading');
    check(document.querySelectorAll('[data-cover-group]').length === 3, 'Nested folders must form separate groups');
    const groupToggle = () => document.querySelector('.cover-editor-toggle-groups');
    groupToggle().click();
    await until(() => !document.querySelector('[data-cover-file]'), 'Collapse all must hide every file row');
    check(groupToggle().textContent === t('cover_editor_groups_expand_all'), 'Collapsed groups must offer expand all');
    groupToggle().click();
    await until(() => document.querySelectorAll('[data-cover-file]').length === files.length, 'Expand all must restore every file row');
    browse().click();
    await until(() => newCover() === covers['/images/A.png'], 'First group cover was not selected');
    check(save().disabled, 'Other groups still require covers');
    group('바람의 기록').querySelector('.cover-editor-group-select').click();
    await until(() => group('바람의 기록').querySelector('[aria-pressed="true"]'), 'Second group was not selected');
    check(newCover() !== covers['/images/A.png'], 'Another group inherited the first group cover');
    imagePath = '/images/B.png';
    browse().click();
    await until(() => newCover() === covers['/images/B.png'], 'Second group cover was not selected');
    group('별빛 여행/외전').querySelector('.cover-editor-group-select').click();
    await frame();
    browse().click();
    await until(() => !save().disabled, 'All checked groups have covers');
    const toggle = group('별빛 여행').querySelector('.cover-editor-group-toggle');
    toggle.focus();
    toggle.click();
    await until(() => !group('별빛 여행').querySelector('[data-cover-file]'), 'Collapsed group still shows files');
    check(toggle.getAttribute('aria-expanded') === 'false', 'Collapse state is not accessible');
    check(!save().disabled, 'Collapsing a group must retain save targets');
    const groupName = group('별빛 여행').querySelector('.cover-editor-group-select');
    groupName.click();
    await until(() => groupName.getAttribute('aria-pressed') === 'true', 'Clicking a collapsed group must select it');
    check(!group('별빛 여행').querySelector('[data-cover-file]'), 'Selecting a collapsed group must keep it collapsed');
    check(newCover() === covers['/images/A.png'], 'Selecting a collapsed group must show its cover');
    groupName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => group('별빛 여행').querySelectorAll('[data-cover-file]').length === 2, 'Double-click must expand a collapsed group');
    groupName.click();
    groupName.click();
    groupName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await until(() => !group('별빛 여행').querySelector('[data-cover-file]'), 'Double-click must collapse an expanded group');
    group('바람의 기록').querySelector('.cover-editor-group-select').click();
    await frame();
    document.querySelector('[id$="-source-metadata"]').click();
    await until(() => document.querySelector('input[id$="-query"]')?.value === '바람의 기록', 'Group selection must use the folder title');
    group('바람의 기록').querySelector('[data-cover-file]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await until(() => document.querySelector('input[id$="-query"]')?.value === '01', 'Selecting the current file must restore its title');
    document.querySelector('[id$="-source-local"]').click();
    await frame();
    await document.fonts.ready;
    window.groupRenderChecks = { saved, expected: files.map(file => file.full_path), root };
    return { groups: document.querySelectorAll('[data-cover-group]').length, visibleFiles: document.querySelectorAll('[data-cover-file]').length };
}

async function checkLargeList() {
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const files = Array.from({ length: 5000 }, (_, index) => ({ full_path: `/books/대량 목록/책 ${index}화.cbz`, name: `책 ${index}화.cbz`, checked: true }));
    const root = window.groupRenderChecks.root;
    root.render(React.createElement(CoverEditorDialog, { key: 'large-list', embedded: true, files,
        t: (key, values) => translate(key, 'ko', values), onClose() {}, onToggleAll() {}, onToggleFile() {} }));
    const deadline = performance.now() + 15000;
    let handle;
    while (performance.now() < deadline) {
        handle = document.querySelector('.cover-editor-panel-resizer');
        if (handle && !handle.getAttribute('aria-disabled') && document.querySelectorAll('[data-cover-file]').length === files.length) break;
        await frame();
    }
    if (!handle || handle.getAttribute('aria-disabled') || document.querySelectorAll('[data-cover-file]').length !== files.length) {
        throw new Error('Large list did not finish loading');
    }
    await frame();
    await frame();
    const filesPanel = document.querySelector('.cover-editor-tool-files');
    const initial = filesPanel.getBoundingClientRect().height;
    const durations = [];
    for (let index = 0; index < 30; index += 1) {
        const start = performance.now();
        handle.dispatchEvent(new KeyboardEvent('keydown', { key: index % 2 ? 'ArrowUp' : 'ArrowDown', bubbles: true, cancelable: true }));
        await frame();
        const height = filesPanel.getBoundingClientRect().height;
        if (Math.abs(height - initial - (index % 2 ? 0 : 24)) > 2) throw new Error('Large list resize lost the requested height');
        durations.push(performance.now() - start);
    }
    const selected = document.querySelector('[data-cover-file][aria-selected="true"]');
    if (selected?.getAttribute('data-cover-file') !== files[0].full_path) throw new Error('Resizing changed the selected file');
    const maxFrameMs = Math.round(Math.max(...durations));
    const averageFrameMs = Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
    if (averageFrameMs > 250 || maxFrameMs > 600) throw new Error('Large list resizing stalled: ' + JSON.stringify({ averageFrameMs, maxFrameMs }));
    return { files: files.length, maxFrameMs, averageFrameMs };
}

test('folder groups render, collapse and save their own covers in the embedded tool', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cover-groups-render-')));
    const screenshots = process.env.BOOKMANAGER_RENDERER_SCREENSHOTS;
    let server;
    try {
        const source = relative => JSON.stringify('/@fs/' + path.join(projectRoot, relative));
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CoverEditorDialog } from ${source('src/components/folder/CoverEditorDialog.jsx')};
import { translate } from ${source('src/utils/i18n.js')};
import { applyMotionPreference } from ${source('src/motionPolicy.js')};
import ${source('src/styles/global.css')};
import ${source('src/styles/App.css')};
applyMotionPreference('reduced');
window.groupChecks = (${checkGroups.toString()})();
window.checkLargeList = ${checkLargeList.toString()};
`);
        const appHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        const policy = appHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
        assert.ok(policy);
        await fs.writeFile(path.join(directory, 'index.html'), policy + '<style>html,body,#root{width:100%;height:100%;margin:0}#root{box-sizing:border-box;padding:12px}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({ configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } } });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 850, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify('http://127.0.0.1:' + server.httpServer.address().port)});
    const result = await window.webContents.executeJavaScript('window.groupChecks');
    const measure = () => window.webContents.executeJavaScript(
        "(() => { const height = selector => document.querySelector(selector).getBoundingClientRect().height; const handle = document.querySelector('.cover-editor-panel-resizer'); const bounds = handle.getBoundingClientRect(); return { list: height('.cover-editor-tool-files'), table: height('.cover-editor-file-table'), source: height('.cover-editor-sources'), min: Number(handle.getAttribute('aria-valuemin')), max: Number(handle.getAttribute('aria-valuemax')), now: Number(handle.getAttribute('aria-valuenow')), x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }; })()"
    );
    const settle = () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const before = await measure();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'mouseMove', x: before.x, y: before.y });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: before.x, y: before.y, button: 'left', modifiers: ['leftButtonDown'], clickCount: 1 });
    await settle();
    window.webContents.sendInputEvent({ type: 'mouseMove', x: before.x, y: before.y + 90, modifiers: ['leftButtonDown'] });
    await settle();
    window.webContents.sendInputEvent({ type: 'mouseUp', x: before.x, y: before.y + 90, button: 'left', clickCount: 1 });
    await settle();
    const dragged = await measure();
    if (Math.abs(dragged.list - before.list - 90) > 2 || Math.abs(dragged.table - before.table - 90) > 2
        || Math.abs(before.source - dragged.source - 90) > 2) throw new Error('Dragging must resize both panels and the file table: ' + JSON.stringify({ before, dragged }));
    const press = async key => {
        await window.webContents.executeJavaScript("document.querySelector('.cover-editor-panel-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: '" + key + "', bubbles: true, cancelable: true }))");
        await settle();
    };
    await press('ArrowUp');
    const keyboard = await measure();
    if (Math.abs(keyboard.list - dragged.list + 24) > 2) throw new Error('Arrow key did not adjust the panel height');
    await press('End');
    const largest = await measure();
    if (Math.abs(largest.list - largest.max) > 2 || largest.source < 179) throw new Error('The source panel lost its minimum height');
    await press('Home');
    const smallest = await measure();
    if (Math.abs(smallest.list - smallest.min) > 2 || smallest.table < 89) throw new Error('The work list lost its minimum height');
    await window.webContents.executeJavaScript("document.querySelector('.cover-editor-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    await settle();
    const reset = await measure();
    if (Math.abs(reset.list - before.list) > 2 || Math.abs(reset.now - reset.list) > 2) throw new Error('Double-click did not restore the default panel size');
    await press('ArrowDown');
    window.setContentSize(700, 700);
    await settle();
    const narrow = await measure();
    if (narrow.table < 89 || narrow.source < 179) throw new Error('Resizing lost panel minimums in the narrow layout');
    window.setContentSize(1200, 850);
    await settle();
    ${screenshots ? `await fs.mkdir(${JSON.stringify(screenshots)}, { recursive: true });
    await fs.writeFile(path.join(${JSON.stringify(screenshots)}, 'cover-groups.png'), (await window.webContents.capturePage()).toPNG());` : ''}
    const saved = await window.webContents.executeJavaScript(
        "document.querySelector('.cover-editor-save').click(); new Promise(resolve => setTimeout(() => resolve(window.groupRenderChecks.saved.map(item => [item.filePath, item.imagePath])), 100))"
    );
    console.log('COVER_GROUPS=' + JSON.stringify({ ...result, saved }));
    const largeList = await window.webContents.executeJavaScript('window.checkLargeList()');
    const largeBefore = await measure();
    window.webContents.sendInputEvent({ type: 'mouseDown', x: largeBefore.x, y: largeBefore.y, button: 'left', modifiers: ['leftButtonDown'], clickCount: 1 });
    for (let step = 1; step <= 8; step += 1) {
        window.webContents.sendInputEvent({ type: 'mouseMove', x: largeBefore.x, y: largeBefore.y + step * 6, modifiers: ['leftButtonDown'] });
        await settle();
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: largeBefore.x, y: largeBefore.y + 48, button: 'left', clickCount: 1 });
    await settle();
    const largeAfter = await measure();
    if (Math.abs(largeAfter.list - largeBefore.list - 48) > 2) throw new Error('Large list pointer resizing lost its final height');
    console.log('COVER_LARGE_LIST=' + JSON.stringify(largeList));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Group renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        console.log(output.result.match(/COVER_LARGE_LIST=.+/)?.[0]);
        const result = JSON.parse(output.result.match(/COVER_GROUPS=(.+)/)?.[1] || '{}');
        assert.deepEqual(result, { groups: 3, visibleFiles: 2, saved: [
            ['/books/별빛 여행/01.cbz', '/images/A.png'], ['/books/바람의 기록/01.cbz', '/images/B.png'],
            ['/books/별빛 여행/02.cbz', '/images/A.png'], ['/books/별빛 여행/외전/01.cbz', '/images/B.png'],
        ] });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
