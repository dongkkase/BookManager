import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

async function runCoverImageChecks() {
    let checks = 0;
    const check = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const until = async (predicate, message) => {
        const deadline = performance.now() + 12000;
        while (performance.now() < deadline) {
            if (predicate()) return;
            await frame();
        }
        throw new Error(message + ': active=' + document.activeElement?.tagName + ' imageDialog=' + document.querySelector('dialog.ee-image-edit-dialog')?.outerHTML.slice(0, 150) + ' ' + document.body.textContent);
    };
    const t = (key, values) => translate(key, 'ko', values);
    const button = (label, root = document) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === label);
    const blobDataUrl = blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
    const createLargeSource = async () => {
        const surface = Object.assign(document.createElement('canvas'), { width: 4096, height: 4096 });
        const context = surface.getContext('2d');
        const pixels = context.createImageData(surface.width, surface.height);
        let random = 0x12345678;
        for (let index = 0; index < pixels.data.length; index += 4) {
            random ^= random << 13;
            random ^= random >>> 17;
            random ^= random << 5;
            pixels.data[index] = random & 255;
            pixels.data[index + 1] = random >>> 8 & 255;
            pixels.data[index + 2] = random >>> 16 & 255;
            pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        const blob = await new Promise(resolve => surface.toBlob(resolve, 'image/jpeg', 0.85));
        const bitmap = await createImageBitmap(blob);
        surface.width = 3072;
        context.drawImage(bitmap, 512, 0, 3072, 4096, 0, 0, 3072, 4096);
        bitmap.close();
        const oversizedPng = await new Promise(resolve => surface.toBlob(resolve, 'image/png'));
        surface.width = surface.height = 1;
        check(blob.size < 16 * 1024 * 1024, 'The large JPEG source must fit the existing cover import limit');
        check(oversizedPng.size > 16 * 1024 * 1024, 'The same cropped pixels must exceed the cover limit when forced to PNG');
        return { imagePath: '/fixture/large-cover.jpg', imageVersion: 'large-source-version', dataUrl: await blobDataUrl(blob),
            width: 4096, height: 4096, size: blob.size, extension: '.jpg', croppedPngBytes: oversizedPng.size };
    };
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 480 });
    const context = canvas.getContext('2d');
    context.fillStyle = '#204c6a';
    context.fillRect(0, 0, 320, 480);
    context.fillStyle = '#e5bb6b';
    context.fillRect(20, 20, 140, 210);
    context.fillStyle = '#ebedf1';
    context.font = 'bold 25px sans-serif';
    context.fillText('Book cover', 26, 320);
    const dataUrl = canvas.toDataURL('image/png');
    const sourceBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const source = { imagePath: '/fixture/source-cover.png', imageVersion: 'source-version', dataUrl,
        width: 320, height: 480, size: sourceBlob.size, extension: '.png' };
    const calls = { imported: [], released: [], saved: [], closed: 0, toasts: [] };
    const book = { name: '사진 편집 확인.cbz', full_path: '/fixture/book.cbz', checked: true };
    const info = { filePath: book.full_path, name: book.name, version: 'book-version', textContentHash: '', kind: 'comic',
        storage: 'file', canAdd: true, canRenumber: true, conversion: false, coverDataUrl: dataUrl,
        coverEntry: '001.png', pageCount: 2, pages: [{ name: '001.png' }, { name: '002.png' }] };
    window.electronAPI = {
        inspectCoverEditor: async () => ({ ...info }),
        selectFile: async () => source.imagePath,
        previewCoverEditorImage: async () => ({ ...source }),
        releaseCoverEditorImages: async request => { calls.released.push(request); },
        previewCoverEditorImportedImage: async ({ bytes }) => {
            check(bytes instanceof Uint8Array, 'Edited images must be imported as bytes');
            const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
            const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
            check(jpeg || png, 'Edited images must have an actual JPEG or PNG signature');
            check(bytes.byteLength <= 16 * 1024 * 1024, 'Imported output must fit the cover limit before reaching the backend');
            const extension = jpeg ? '.jpg' : '.png';
            const blob = new Blob([bytes], { type: jpeg ? 'image/jpeg' : 'image/png' });
            const bitmap = await createImageBitmap(blob);
            const dimensions = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            const image = { imagePath: '/fixture/edited-cover-' + (calls.imported.length + 1) + extension,
                imageVersion: 'edited-version-' + (calls.imported.length + 1), dataUrl: await blobDataUrl(blob),
                ...dimensions, size: bytes.byteLength, extension };
            calls.imported.push(image);
            return image;
        },
    };
    const host = document.getElementById('root');
    const root = createRoot(host);
    const render = embedded => root.render(React.createElement(CoverEditorDialog, {
        key: String(embedded), embedded, ...(embedded ? { files: [book], localImageRequest: { id: 1, path: source.imagePath } } : { file: book }),
        preferences: { mode: 'replace', backup: true, renumber: false }, t,
        onClose: () => { calls.closed += 1; }, showToast: value => calls.toasts.push(value),
        onExecute: async request => { calls.saved.push(request); return { success: true, filePath: book.full_path }; },
    }));
    const imageDialog = () => document.querySelector('dialog.ee-image-edit-dialog[open]');
    const candidate = () => document.querySelector('.cover-editor-candidate img');
    const openEditor = async () => {
        const edit = button(t('cover_editor_edit'));
        check(edit && !edit.disabled, 'A chosen cover must expose its edit button');
        edit.focus();
        edit.click();
        await until(() => imageDialog()?.querySelector('.ee-image-edit-picture img') && !button('적용', imageDialog())?.disabled, 'The shared image editor must render a decoded preview');
        const dialog = imageDialog();
        check(dialog.contains(document.activeElement), 'Opening image editing must focus inside the native dialog');
        check(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent === '자르기', 'Image editing must initially use the EPUB crop panel');
        check(getComputedStyle(dialog).display === 'flex' && dialog.getBoundingClientRect().width > 700, 'The image editor must load shared dialog styles');
        check(document.querySelector('.cover-editor-dialog').hasAttribute('inert'), 'The underlying cover editor must be inert while editing');
        check(button(t('cover_editor_save')).disabled, 'Saving a cover must be disabled while its image is edited');
        button('크기 조절', dialog).click();
        await until(() => /16\s*MiB/.test(dialog.querySelector('.ee-image-edit-options').textContent), 'Cover editing must display its 16 MiB output limit');
        button('자르기', dialog).click();
        await frame();
        return { edit, dialog };
    };
    try {
        render(true);
        await until(() => button(t('cover_editor_edit')) && candidate()?.src === dataUrl, 'The embedded cover candidate must load');
        const clear = button(t('cover_editor_clear'));
        const edit = button(t('cover_editor_edit'));
        const size = clear.closest('.cover-editor-preview').querySelector('.cover-editor-preview-actions > span');
        const clearBounds = clear.getBoundingClientRect();
        const editBounds = edit.getBoundingClientRect();
        const sizeBounds = size.getBoundingClientRect();
        check(clearBounds.top >= sizeBounds.bottom, 'Clear selection and edit must sit below the image dimensions');
        check(Math.abs(clearBounds.top - editBounds.top) < 1 && editBounds.left > clearBounds.right, 'Edit must be to the right of clear selection on the same new row');
        let opened = await openEditor();
        button('90° 회전', opened.dialog).click();
        await until(() => opened.dialog.textContent.includes('480 × 320 px'), 'Rotation must update the output dimensions');
        await until(() => opened.dialog.querySelector('.ee-image-edit-picture img')?.naturalWidth === 480, 'Rotation must update the actual preview bitmap');
        if (window.fixtureDriver.capture) await window.fixtureDriver.capture('editor');
        check(calls.saved.length === 0 && calls.imported.length === 0, 'Preview edits must not write book files or import intermediate images');
        button('적용', opened.dialog).click();
        await until(() => !imageDialog() && calls.imported.length === 1 && candidate()?.src === calls.imported[0].dataUrl, 'Applying must replace the candidate with the rendered image');
        check(calls.imported[0].width === 480 && calls.imported[0].height === 320, 'The import boundary must receive rotated PNG pixels');
        check(calls.saved.length === 0, 'Applying an image edit must leave the original book untouched');
        check(calls.released.some(request => request?.imagePath === source.imagePath), 'Replacing the candidate must release its old temporary image');
        check(document.activeElement === opened.edit, 'Applying image edits must restore focus to the edit button');
        const editedCandidate = candidate().src;
        opened = await openEditor();
        button('90° 회전', opened.dialog).click();
        button('취소', opened.dialog).click();
        await until(() => !imageDialog(), 'Cancel must close only the image editor');
        check(candidate().src === editedCandidate && calls.imported.length === 1, 'Cancelling must keep the previously applied candidate');
        check(calls.closed === 0, 'Image edit cancellation must keep the cover tool open');
        await until(() => document.activeElement === opened.edit, 'Cancelling must restore focus to the image edit button');
        opened = await openEditor();
        button('90° 회전', opened.dialog).focus();
        await window.fixtureDriver.escape();
        await until(() => !imageDialog(), 'Escape must close the native image dialog');
        check(calls.closed === 0 && candidate().src === editedCandidate, 'Escape must preserve the parent and selected cover');
        await until(() => document.activeElement === opened.edit, 'Escape must restore focus to the image edit button');
        check(document.activeElement === opened.edit, 'Escape must restore focus to the image edit button');
        if (window.fixtureDriver.capture) await window.fixtureDriver.capture('candidate');
        button(t('cover_editor_save')).click();
        await until(() => calls.saved.length === 1, 'Explicit cover saving must execute the existing save path');
        check(calls.saved[0].imagePath === calls.imported[0].imagePath && calls.saved[0].imageVersion === calls.imported[0].imageVersion,
            'Cover saving must use the edited temporary image and its verified version');
        check(calls.saved[0].filePath === book.full_path && calls.saved[0].version === 'book-version', 'Cover saving must preserve the inspected target and original version');

        render(false);
        await until(() => document.querySelector('.cover-editor-backdrop') && document.querySelector('button[aria-label="' + t('cover_editor_local_browse') + '"]')?.disabled === false, 'The standalone cover dialog must finish inspection');
        const picker = document.querySelector('button[aria-label="' + t('cover_editor_local_browse') + '"]');
        check(picker, 'The standalone dialog must offer image selection');
        picker.click();
        await until(() => button(t('cover_editor_edit')) && candidate()?.src === dataUrl, 'The standalone dialog must load the candidate');
        opened = await openEditor();
        const focusTarget = button('90° 회전', opened.dialog);
        focusTarget.focus();
        await frame();
        check(document.activeElement === focusTarget, 'The parent focus trap must not steal focus from image editing');
        await window.fixtureDriver.escape();
        await until(() => !imageDialog(), 'Escape must close the standalone nested image editor');
        check(calls.closed === 0 && candidate().src === dataUrl, 'Nested Escape must not close the standalone cover dialog or change its cover');
        await until(() => document.activeElement === opened.edit, 'Nested Escape must restore focus in the standalone parent');
        check(document.activeElement === opened.edit, 'Nested Escape must restore focus in the standalone parent');
        check(calls.saved.length === 1 && calls.toasts.length === 0, 'Image editing and cancellation must not cause extra saves or errors');

        const largeSource = await createLargeSource();
        Object.assign(source, largeSource);
        render(true);
        await until(() => button(t('cover_editor_edit')) && candidate()?.src === source.dataUrl, 'The large JPEG cover candidate must load');
        opened = await openEditor();
        button('3:4', opened.dialog).click();
        await until(() => opened.dialog.textContent.includes('3072 × 4096 px'), 'Cropping the large cover must update its full-resolution dimensions');
        check(calls.imported.length === 1 && calls.saved.length === 1, 'Changing the large crop must only update its preview');
        button('적용', opened.dialog).click();
        await until(() => !imageDialog() && calls.imported.length === 2 && candidate()?.src === calls.imported[1].dataUrl,
            'Applying a large JPEG crop must replace the candidate instead of failing the PNG size limit');
        const croppedCover = calls.imported[1];
        check(croppedCover.extension === '.jpg' && croppedCover.dataUrl.startsWith('data:image/jpeg;base64,'),
            'The large opaque cover must be imported as JPEG without PNG expansion');
        check(croppedCover.width === 3072 && croppedCover.height === 4096, 'Applying must preserve the full cropped resolution');
        await until(() => candidate()?.complete && candidate().naturalWidth === 3072 && candidate().naturalHeight === 4096,
            'The new cover preview must decode the actual cropped image');
        check(calls.saved.length === 1, 'Applying the large crop must still wait for explicit cover saving');
        check(calls.released.some(request => request?.imagePath === largeSource.imagePath), 'Applying the large crop must release the replaced source');
        button(t('cover_editor_save')).click();
        await until(() => calls.saved.length === 2, 'Explicit cover saving must accept the cropped JPEG candidate');
        check(calls.saved[1].imagePath === croppedCover.imagePath && calls.saved[1].imageVersion === croppedCover.imageVersion,
            'Cover saving must use the newly cropped JPEG and its verified version');
        check(calls.toasts.length === 0, 'Large cover cropping must not show an import or size error');
        return { checks, imported: calls.imported.length, saved: calls.saved.length,
            editedDimensions: [calls.imported[0].width, calls.imported[0].height],
            largeCrop: { sourceBytes: largeSource.size, pngBytes: largeSource.croppedPngBytes, editedBytes: croppedCover.size,
                extension: croppedCover.extension, dimensions: [croppedCover.width, croppedCover.height] } };
    } finally {
        root.unmount();
    }
}

test('cover image editing reuses the EPUB editor, preserves cancellation, and saves only its applied candidate', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-edit-render-')));
    const screenshotDirectory = process.env.BOOKMANAGER_RENDERER_SCREENSHOTS;
    let server;
    try {
        const source = relative => JSON.stringify('/@fs/' + path.join(projectRoot, relative));
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CoverEditorDialog } from ${source('src/components/folder/CoverEditorDialog.jsx')};
import { translate } from ${source('src/utils/i18n.js')};
import ${source('src/styles/global.css')};
import ${source('src/styles/App.css')};
window.coverImageTests = (${runCoverImageChecks.toString()})();
`);
        const appHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        const contentSecurityPolicy = appHtml.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
        assert.ok(contentSecurityPolicy, 'The renderer test must preserve the production content security policy');
        await fs.writeFile(path.join(directory, 'index.html'), contentSecurityPolicy + '<style>html,body,#root{width:100%;height:100%;margin:0}#root{box-sizing:border-box;padding:16px}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixtureDriver', {
    escape: () => ipcRenderer.invoke('fixture:escape'),
    ${screenshotDirectory ? "capture: name => ipcRenderer.invoke('fixture:capture', name)," : ''}
});
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1400, height: 1000, useContentSize: true,
        webPreferences: { preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))}, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    ipcMain.handle('fixture:escape', async () => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    });
    ${screenshotDirectory ? `ipcMain.handle('fixture:capture', async (_event, name) => {
        await fs.mkdir(${JSON.stringify(screenshotDirectory)}, { recursive: true });
        const capture = await window.webContents.capturePage();
        await fs.writeFile(path.join(${JSON.stringify(screenshotDirectory)}, 'cover-image-' + name + '.png'), capture.toPNG());
    });` : ''}
    await window.loadURL(${JSON.stringify('http://127.0.0.1:PORT/'.replace('PORT', String(server.httpServer.address().port)))});
    const result = await window.webContents.executeJavaScript('window.coverImageTests');
    console.log('COVER_IMAGE_EDIT_RESULT=' + JSON.stringify(result));
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
            let timedOut = false;
            const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result: (timedOut ? 'Renderer timed out: ' : '') + result }); });
        });
        assert.equal(output.code, 0, output.result);
        const match = output.result.match(/COVER_IMAGE_EDIT_RESULT=(.+)/);
        assert.ok(match, output.result);
        const report = JSON.parse(match[1]);
        assert.ok(report.checks >= 35, JSON.stringify(report));
        assert.equal(report.imported, 2);
        assert.equal(report.saved, 2);
        assert.deepEqual(report.editedDimensions, [480, 320]);
        assert.ok(report.largeCrop.sourceBytes < 16 * 1024 * 1024);
        assert.ok(report.largeCrop.pngBytes > 16 * 1024 * 1024);
        assert.ok(report.largeCrop.editedBytes <= 16 * 1024 * 1024);
        assert.equal(report.largeCrop.extension, '.jpg');
        assert.deepEqual(report.largeCrop.dimensions, [3072, 4096]);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
});
