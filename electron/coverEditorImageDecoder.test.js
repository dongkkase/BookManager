import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { convertCoverEditorRaster, decodeCoverEditorImage } from './coverEditorImageDecoder.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function nativeFixture(width = 1, height = 1) {
    const calls = [];
    const result = { isEmpty: () => false, getSize: () => ({ width, height }) };
    const nativeImage = { createFromBuffer: buffer => {
        calls.push(buffer);
        return buffer.subarray(0, 8).equals(PNG) ? result : { isEmpty: () => true };
    } };
    return { nativeImage, result, calls };
}

function browserFixture(overrides = {}) {
    const state = { windows: [], requests: [] };
    class Window extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.destroyed = false;
            this.webContents = new EventEmitter();
            this.webContents.session = {
                setPermissionRequestHandler: handler => { state.requestPermission = handler; },
                setPermissionCheckHandler: handler => { state.checkPermission = handler; },
                webRequest: { onBeforeRequest: handler => { state.beforeRequest = handler; } },
            };
            this.webContents.setWindowOpenHandler = handler => { state.openWindow = handler; };
            this.webContents.executeJavaScript = async script => {
                state.script = script;
                if (overrides.execute) return overrides.execute(this);
                return { dataUrl: `data:image/png;base64,${PNG.toString('base64')}`, width: 1, height: 1 };
            };
            state.windows.push(this);
        }
        async loadURL(url) {
            this.url = url;
            if (overrides.loadURL) await overrides.loadURL(this);
        }
        isDestroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; this.emit('closed'); }
    }
    return { state, electron: { BrowserWindow: Window } };
}

test('native PNG decoding avoids a conversion window and preserves image dimensions', async () => {
    const fixture = nativeFixture(750, 1076);
    const image = await decodeCoverEditorImage(PNG, { nativeImage: fixture.nativeImage, convertRaster: () => assert.fail('PNG must not require raster conversion') });
    assert.equal(image, fixture.result);
    assert.deepEqual(image.getSize(), { width: 750, height: 1076 });
});

test('WebP and GIF fall back to the isolated raster converter when nativeImage cannot decode them', async () => {
    for (const [buffer, mimeType] of [[WEBP, 'image/webp'], [GIF, 'image/gif']]) {
        const fixture = nativeFixture();
        const image = await decodeCoverEditorImage(buffer, {
            nativeImage: fixture.nativeImage,
            convertRaster: async (source, type) => {
                assert.equal(source, buffer);
                assert.equal(type, mimeType);
                return PNG;
            },
        });
        assert.equal(image, fixture.result);
        assert.deepEqual(fixture.calls, [buffer, PNG]);
    }
});

test('raster input length, magic and dimensions are checked before starting an image decoder', async () => {
    const oversizedWebp = Buffer.alloc(30);
    oversizedWebp.write('RIFF', 0);
    oversizedWebp.write('WEBPVP8X', 8);
    oversizedWebp.writeUIntLE(8000, 24, 3);
    oversizedWebp.writeUIntLE(8000, 27, 3);
    for (const [buffer, code] of [
        [Buffer.alloc(0), 'COVER_IMAGE_INVALID'],
        [Buffer.alloc(16 * 1024 * 1024 + 1), 'COVER_IMAGE_TOO_LARGE'],
        [Buffer.from('<svg/>'), 'COVER_IMAGE_UNSUPPORTED_FORMAT'],
        [oversizedWebp, 'COVER_IMAGE_TOO_MANY_PIXELS'],
    ]) {
        await assert.rejects(decodeCoverEditorImage(buffer, { nativeImage: { createFromBuffer: () => assert.fail('input should be rejected first') } }), { code });
    }
    for (const [width, height, code] of [[0, 1, 'COVER_IMAGE_INVALID'], [8001, 8000, 'COVER_IMAGE_TOO_MANY_PIXELS']]) {
        await assert.rejects(decodeCoverEditorImage(PNG, { nativeImage: nativeFixture(width, height).nativeImage }), { code });
    }
});

test('the raster converter uses a hidden sandbox with a static document and no remote access', async () => {
    const { state, electron } = browserFixture();
    assert.deepEqual(await convertCoverEditorRaster(WEBP, 'image/webp', { electron }), PNG);
    const window = state.windows[0];
    assert.equal(window.options.show, false);
    assert.equal(window.options.webPreferences.partition, 'cover-editor-image-decoder');
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.webSecurity, true);
    assert.equal(window.options.webPreferences.webviewTag, false);
    assert.equal(window.options.webPreferences.preload, undefined);
    assert.match(decodeURIComponent(window.url), /default-src 'none'; script-src 'none'; connect-src 'none'/);
    for (const url of ['https://example.com/image.webp', 'file:///tmp/image.webp', 'data:text/html,unexpected', 'blob:unexpected']) {
        state.beforeRequest({ url }, result => assert.equal(result.cancel, true));
    }
    state.beforeRequest({ url: window.url }, result => assert.equal(result.cancel, false));
    assert.equal(state.checkPermission(), false);
    state.requestPermission(null, 'clipboard-read', allowed => assert.equal(allowed, false));
    assert.deepEqual(state.openWindow(), { action: 'deny' });
    for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
        let prevented = false;
        window.webContents.emit(event, { preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true);
    }
    assert.match(state.script, /createImageBitmap/);
    assert.match(state.script, /image\?\.close\(\)/);
    assert.equal(window.destroyed, true);
});

test('the raster converter closes its window after invalid results, renderer failures or timeout', async () => {
    for (const [overrides, code] of [
        [{ execute: async () => ({ code: 'COVER_IMAGE_TOO_MANY_PIXELS' }) }, 'COVER_IMAGE_TOO_MANY_PIXELS'],
        [{ execute: async () => ({ dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 }) }, 'COVER_IMAGE_CONVERSION_FAILED'],
        [{ execute: async () => { throw new Error('renderer failed'); } }, 'COVER_IMAGE_CONVERSION_FAILED'],
        [{ loadURL: async () => { throw new Error('load failed'); } }, 'COVER_IMAGE_CONVERSION_FAILED'],
        [{ execute: window => { window.webContents.emit('render-process-gone'); return new Promise(() => {}); } }, 'COVER_IMAGE_CONVERSION_FAILED'],
        [{ execute: () => new Promise(() => {}) }, 'COVER_IMAGE_CONVERSION_FAILED'],
    ]) {
        const { state, electron } = browserFixture(overrides);
        await assert.rejects(convertCoverEditorRaster(WEBP, 'image/webp', { electron, timeoutMs: 10 }), { code });
        assert.equal(state.windows[0].destroyed, true);
    }
});

test('real Electron converts WebP, GIF and BMP covers into validated PNG snapshots', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron decoder.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-decode-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const decoderUrl = new URL('./coverEditorImageDecoder.js', import.meta.url).href;
    const sourcesUrl = new URL('./coverEditorSourceIpc.js', import.meta.url).href;
    const coverUrl = new URL('./coverEditor.js', import.meta.url).href;
    const scriptPath = path.join(directory, 'main.cjs');
    await fs.writeFile(scriptPath, `
const { app, nativeImage, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const { decodeCoverEditorImage } = await import(${JSON.stringify(decoderUrl)});
    const { registerCoverEditorSourceIpc } = await import(${JSON.stringify(sourcesUrl)});
    const { loadCoverEditorImage } = await import(${JSON.stringify(coverUrl)});
    const normalizeImage = async (buffer, mimeType) => {
        const image = await decodeCoverEditorImage(buffer, { nativeImage });
        return { buffer: ['image/jpeg', 'image/png'].includes(mimeType) ? buffer : image.toPNG(), mimeType: ['image/jpeg', 'image/png'].includes(mimeType) ? mimeType : 'image/png', ...image.getSize() };
    };
    const bmp = Buffer.alloc(58);
    bmp.write('BM'); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(4, 34);
    const samples = [Buffer.from(${JSON.stringify(WEBP.toString('base64'))}, 'base64'), Buffer.from(${JSON.stringify(GIF.toString('base64'))}, 'base64'), bmp];
    const handlers = new Map();
    const sender = new EventEmitter(); sender.id = 1; sender.isDestroyed = () => false;
    const tempRoot = ${JSON.stringify(path.join(directory, 'images'))};
    await fs.mkdir(tempRoot);
    registerCoverEditorSourceIpc({ handle: (name, handler) => handlers.set(name, handler) }, { tempRoot, getOptions: async () => ({ normalizeImage }) });
    for (const bytes of samples) {
        const image = await handlers.get('coverEditor:importImage')({ sender }, { bytes });
        assert.equal(image.error, undefined);
        assert.equal(image.mimeType, 'image/png');
        assert.equal(image.width, 1); assert.equal(image.height, 1);
        const saved = await fs.readFile(image.imagePath);
        assert.equal(image.imageVersion, createHash('sha256').update(saved).digest('hex'));
        assert.equal((await loadCoverEditorImage(image.imagePath, { normalizeImage })).imageVersion, image.imageVersion);
    }
    await handlers.get('coverEditor:releaseImages')({ sender });
    assert.deepEqual(await fs.readdir(tempRoot), []);
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    console.log('COVER_DECODER_OK=3'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
    const require = createRequire(import.meta.url);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [scriptPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const timer = setTimeout(() => { child.kill(); reject(new Error('Cover decoder test timed out: ' + output)); }, 45000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /COVER_DECODER_OK=3/);
});
