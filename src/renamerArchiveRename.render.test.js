import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('압축 파일 이름 변경 대화상자는 취소와 오류를 처리하고 선택 항목을 갱신한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'renamer-archive-rename-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import RenamerTab from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/tabs/RenamerTab.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import { translate } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/utils/i18n.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/App.css')}`)};
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
const calls = { rename: [], messages: [], notices: [], execute: 0, prompt: 0 };
const errors = [];
window.addEventListener('unhandledrejection', event => { errors.push(String(event.reason?.message || event.reason)); event.preventDefault(); });
window.addEventListener('error', event => errors.push(event.message));
const nativePrompt = window.prompt.bind(window);
window.prompt = (...args) => { calls.prompt += 1; return nativePrompt(...args); };
let ready = false;
let working = false;
let renameMode = 'success';
let releaseRename;
let blockedExistsPath;
let releaseExists;
const existing = new Set(['/fixture/first.cbz', '/fixture/second.cbz', '/fixture/duplicate.cbz']);
window.addEventListener('bookmanager:tab-ready', event => { if (event.detail?.tabId === 'renamer') ready = true; });
window.addEventListener('bookmanager:working-state', event => { if (event.detail?.tabId === 'renamer') working = event.detail.isWorking; });
window.electronAPI = {
    analyzeRenamer: async paths => ({ items: paths.map(filepath => ({
        id: filepath, filepath, name: filepath.split('/').pop(), checked: true,
        entries: [{ id: filepath + ':1', originalPath: '001.jpg', oldName: '001.jpg', size_kb: 1 }],
    })) }),
    extractArchiveImage: async () => ({ success: false }),
    exists: async filepath => {
        if (filepath === blockedExistsPath) await new Promise(resolve => { releaseExists = resolve; });
        return existing.has(filepath);
    },
    renameFile: async (source, target) => {
        calls.rename.push({ source, target });
        if (renameMode === 'reject') throw new Error('Fixture rename IPC rejected');
        if (renameMode === 'pending') await new Promise(resolve => { releaseRename = resolve; });
        existing.delete(source);
        existing.add(target);
        return { success: true };
    },
    showMessage: async message => { calls.messages.push(message); return 'ok'; },
    executeRenamer: async () => { calls.execute += 1; return { success: true, outputFiles: [] }; },
};
const t = (key, values) => translate(key, 'ko', values);
applyMotionPreference('reduced');
const root = createRoot(document.getElementById('root'));
const row = filepath => [...document.querySelectorAll('[data-renamer-archive-id]')]
    .find(element => element.dataset.renamerArchiveId === filepath);
const dialog = () => document.querySelector('.renamer-rename-dialog');
const input = () => document.getElementById('renamer-archive-name-input');
const action = action => window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { activeTab: 'renamer', action } }));
async function chooseRename(filepath) {
    row(filepath).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 450, clientY: 210 }));
    await until(() => document.querySelector('.renamer-context-menu[data-menu-state="open"]'), 'Context menu did not open');
    [...document.querySelectorAll('.renamer-context-menu button')].find(button => button.textContent === t('action_rename_file')).click();
}
async function openRename(filepath = '/fixture/first.cbz') {
    await chooseRename(filepath);
    await until(() => input() && document.activeElement === input(), 'Rename input did not receive focus; errors: ' + errors.join(', '));
    check(dialog().getAttribute('role') === 'dialog', 'Rename dialog lacks dialog semantics');
    check(input().selectionStart === 0 && input().selectionEnd === input().value.length, 'Existing name was not selected');
}
function setName(value) {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function expectClosed() {
    await until(() => !dialog(), 'Rename dialog remained open');
    await frame();
}
window.renameTests = (async () => {
    root.render(<RenamerTab config={{ language: 'ko' }} saveConfig={() => {}} t={t} showToast={notice => calls.notices.push(notice)} />);
    await until(() => ready, 'Renamer did not become ready');
    window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: {
        activeTab: 'renamer', action: 'drop-paths', paths: ['/fixture/first.cbz', '/fixture/second.cbz'],
    } }));
    await until(() => row('/fixture/first.cbz') && row('/fixture/second.cbz') && !working, 'Fixture archives did not load');

    await openRename();
    await document.fonts.ready;
    await frame();
    await window.rendererTest.capture();
    action('run-current');
    action('remove-selected');
    row('/fixture/first.cbz').closest('[tabindex]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await frame();
    check(calls.execute === 0 && row('/fixture/first.cbz') && row('/fixture/second.cbz'), 'Modal allowed underlying table actions');
    await window.rendererTest.press('Escape');
    await expectClosed();
    check(calls.rename.length === 0, 'Escape renamed a file');
    check(document.activeElement?.contains(row('/fixture/first.cbz')), 'Cancel did not restore table focus');

    await openRename();
    setName('cancelled.cbz');
    document.querySelector('.renamer-rename-cancel').click();
    await expectClosed();
    check(calls.rename.length === 0, 'Cancel renamed a file');

    await openRename();
    setName('duplicate.cbz');
    await window.rendererTest.press('Enter');
    await until(() => calls.messages.some(message => message.message === t('msg_rename_dup')), 'Duplicate name warning was missing');
    await expectClosed();
    check(calls.rename.length === 0 && row('/fixture/first.cbz'), 'Duplicate name mutated the archive');

    renameMode = 'reject';
    const noticesBefore = calls.notices.length;
    await openRename();
    setName('rejected.cbz');
    await window.rendererTest.press('Enter');
    await until(() => calls.notices.length > noticesBefore, 'Rejected IPC did not show an error');
    check(calls.notices.at(-1) === t('msg_err_rename_fail', ['Fixture rename IPC rejected']), 'Rejected IPC error was not explained');
    await expectClosed();
    check(calls.rename.length === 1 && row('/fixture/first.cbz'), 'Rejected IPC changed the row');

    renameMode = 'pending';
    await openRename();
    setName('renamed.cbz');
    await window.rendererTest.press('Enter');
    await until(() => releaseRename, 'Rename IPC was not called');
    check(input().disabled && document.querySelector('.renamer-rename-confirm').disabled, 'Pending rename did not disable submission');
    document.querySelector('.renamer-rename-confirm').click();
    await window.rendererTest.press('Enter');
    await window.rendererTest.press('Escape');
    action('run-current');
    action('clear-all');
    await frame();
    check(dialog() && calls.rename.length === 2 && calls.execute === 0, 'Pending rename was duplicated or canceled');
    releaseRename();
    await expectClosed();
    const renamed = row('/fixture/renamed.cbz');
    check(renamed?.classList.contains('selected') && renamed.textContent.includes('renamed.cbz'), 'Successful rename did not update selected row');
    check(!row('/fixture/first.cbz') && row('/fixture/second.cbz'), 'Successful rename changed unrelated rows');
    check(calls.notices.some(notice => notice.key === 'msg_rename_success'), 'Successful rename notification was missing');

    blockedExistsPath = '/fixture/second.cbz';
    await chooseRename('/fixture/second.cbz');
    await until(() => releaseExists, 'Source existence check did not start');
    root.unmount();
    releaseExists();
    await frame();
    await frame();
    check(!dialog() && calls.rename.length === 2, 'Unmount during source check renamed an archive');

    blockedExistsPath = '/fixture/unmounted.cbz';
    releaseExists = undefined;
    ready = false;
    const remountedRoot = createRoot(document.getElementById('root'));
    remountedRoot.render(<RenamerTab config={{ language: 'ko' }} saveConfig={() => {}} t={t} showToast={notice => calls.notices.push(notice)} />);
    await until(() => ready, 'Remounted renamer did not become ready');
    window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: {
        activeTab: 'renamer', action: 'drop-paths', paths: ['/fixture/second.cbz'],
    } }));
    await until(() => row('/fixture/second.cbz') && !working, 'Remounted fixture archive did not load');
    await openRename('/fixture/second.cbz');
    setName('unmounted.cbz');
    await window.rendererTest.press('Enter');
    await until(() => releaseExists, 'Destination existence check did not start');
    remountedRoot.unmount();
    releaseExists();
    await frame();
    await frame();
    check(!dialog() && calls.rename.length === 2, 'Unmount during destination check renamed an archive');
    check(calls.prompt === 0, 'Rename still invoked unsupported window.prompt');
    for (let index = 0; index < 5; index += 1) await frame();
    check(errors.length === 0, 'Unexpected renderer errors: ' + errors.join(', '));
    return { renameCalls: calls.rename.length, messages: calls.messages.length, promptCalls: calls.prompt, errors };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rendererTest', {
    press: key => ipcRenderer.invoke('fixture:key', key),
    capture: () => ipcRenderer.invoke('fixture:capture'),
});
`);
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
ipcMain.handle('fixture:key', (event, key) => {
    if (!['Enter', 'Escape'].includes(key)) throw new Error('Unsupported fixture key');
    event.sender.focus();
    event.sender.sendInputEvent({ type: 'keyDown', keyCode: key });
    if (key === 'Enter') event.sender.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) });
    event.sender.sendInputEvent({ type: 'keyUp', keyCode: key });
});
ipcMain.handle('fixture:capture', async event => {
    const screenshotPath = ${JSON.stringify(process.env.BOOKMANAGER_RENDERER_SCREENSHOT || '')};
    if (screenshotPath) await fs.writeFile(screenshotPath, (await event.sender.capturePage()).toPNG());
});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1120, height: 800, webPreferences: {
        preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))}, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.renameTests');
    console.log('RENAMER_RENAME_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Renamer renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/RENAMER_RENAME_RESULT=(.+)/)[1]);
        assert.equal(report.renameCalls, 2);
        assert.equal(report.promptCalls, 0);
        assert.deepEqual(report.errors, []);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
