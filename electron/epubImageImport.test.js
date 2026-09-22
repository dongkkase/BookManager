import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const font = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]);

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-image-import-'));
    let handler;
    let selected = { canceled: false, filePaths: [] };
    const dialogs = [];
    const controller = registerEpubEditorIpc({
        ipcMain: { handle: (_channel, fn) => { handler = fn; } },
        app: { getPath: () => root },
        BrowserWindow: { fromWebContents: () => null },
        dialog: { showOpenDialog: async (_window, options) => { dialogs.push(options); return selected; } },
    });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: () => {} });
    const state = await handler({ sender }, { action: 'create', template: 'blank', language: 'ko' });
    assert.equal(state.ok, true);
    return {
        root, dialogs, state,
        select: value => { selected = value; },
        invoke: (request = {}, source = sender) => handler({ sender: source }, { action: 'addAsset', sessionId: state.sessionId, kind: 'image', multiple: true, ...request }),
        files: () => fs.readdir(path.join(root, 'epub-editor', state.sessionId, 'assets')),
        write: async (name, data = png) => {
            const filePath = path.join(root, name);
            await fs.writeFile(filePath, data);
            return filePath;
        },
    };
}

test('image import selects multiple images, preserves selection order and ignores duplicate paths', async t => {
    const f = await fixture(t);
    const first = await f.write('첫 번째.png');
    const second = await f.write('두 번째.png');
    f.select({ canceled: false, filePaths: [second, first, second] });
    const result = await f.invoke();
    assert.equal(result.ok, true);
    assert.deepEqual(f.dialogs, [{ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }] }]);
    assert.deepEqual(result.assets.map(asset => asset.name), ['두 번째.png', '첫 번째.png']);
    assert.ok(result.assets.every(asset => asset.kind === 'image'));
    assert.deepEqual(result.rejected, []);
    assert.equal((await f.files()).length, 2);
    assert.equal('asset' in result, false);
    for (const asset of result.assets) {
        const stored = await f.invoke({ action: 'asset', assetId: asset.id });
        assert.equal(stored.ok, true);
        assert.deepEqual(stored.data, png);
    }
});

test('image import rejects corrupt and disguised non-image files while keeping valid images', async t => {
    const f = await fixture(t);
    const first = await f.write('first.png');
    const corrupt = await f.write('broken.png', Buffer.from('invalid image contents'));
    const disguised = await f.write('font.png', font);
    const last = await f.write('last.png');
    f.select({ canceled: false, filePaths: [first, corrupt, disguised, last] });
    const result = await f.invoke();
    assert.equal(result.ok, true);
    assert.deepEqual(result.assets.map(asset => asset.name), ['first.png', 'last.png']);
    assert.deepEqual(result.rejected, [{ name: 'broken.png', code: 'INVALID_ASSET' }, { name: 'font.png', code: 'INVALID_ASSET' }]);
    assert.equal((await f.files()).length, 2);
});

test('canceled and empty image selections do not register assets', async t => {
    const f = await fixture(t);
    const file = await f.write('image.png');
    for (const selected of [{ canceled: true, filePaths: [file] }, { canceled: false, filePaths: [] }]) {
        f.select(selected);
        assert.deepEqual(await f.invoke(), { ok: true, canceled: true });
        assert.deepEqual(await f.files(), []);
    }
});

test('image import checks session ownership before opening the file picker', async t => {
    const f = await fixture(t);
    const other = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false, send: () => {} });
    for (const multiple of [true, false]) {
        const unauthorized = await f.invoke({ multiple }, other);
        assert.equal(unauthorized.ok, false);
        assert.equal(unauthorized.error.code, 'SESSION_CLOSED');
        const missing = await f.invoke({ multiple, sessionId: 'missing' });
        assert.equal(missing.error.code, 'SESSION_CLOSED');
    }
    assert.deepEqual(f.dialogs, []);
    assert.deepEqual(await f.files(), []);
});

test('image import accepts 100 files and rejects larger batches before adding any files', async t => {
    const f = await fixture(t);
    const paths = [];
    for (let index = 0; index < 100; index += 1) paths.push(await f.write(`image-${index}.png`));
    f.select({ canceled: false, filePaths: [...paths, paths[0]] });
    const tooMany = await f.invoke();
    assert.equal(tooMany.ok, false);
    assert.equal(tooMany.error.code, 'INVALID_ASSET_BATCH');
    assert.deepEqual(await f.files(), []);
    f.select({ canceled: false, filePaths: paths });
    const accepted = await f.invoke();
    assert.equal(accepted.ok, true);
    assert.equal(accepted.assets.length, 100);
    assert.deepEqual(accepted.rejected, []);
    assert.equal((await f.files()).length, 100);
});

test('single image insertion and font imports retain the single-asset response', async t => {
    const f = await fixture(t);
    const image = await f.write('image.png');
    f.select({ canceled: false, filePaths: [image] });
    const inserted = await f.invoke({ multiple: undefined });
    assert.equal(inserted.ok, true);
    assert.equal(inserted.asset.name, 'image.png');
    assert.equal('assets' in inserted, false);
    assert.deepEqual(f.dialogs[0].properties, ['openFile']);
    const fontPath = await f.write('font.otf', font);
    f.select({ canceled: false, filePaths: [fontPath] });
    const imported = await f.invoke({ kind: 'font' });
    assert.equal(imported.ok, true);
    assert.equal(imported.asset.kind, 'font');
    assert.equal('assets' in imported, false);
    assert.deepEqual(f.dialogs[1], { properties: ['openFile'], filters: [{ name: 'Font', extensions: ['ttf', 'otf', 'woff', 'woff2'] }] });
});
