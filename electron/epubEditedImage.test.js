import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { deflateSync } from 'node:zlib';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { assetFilename, MAX_PROJECT_BYTES } from './epubEditor/model.js';
import { validateEditedImage, MAX_EDITED_IMAGE_BYTES } from './epubEditor/editedImage.js';
import { crc32, listZipEntries, readZipEntry } from './core/zipArchive.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data = Buffer.alloc(0)) {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write(type, 4, 'ascii');
    data.copy(result, 8);
    result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4);
    return result;
}

function png({ width = 6, height = 4, color = 6, value = 150, raw, headerOnly = false, idat } = {}) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = color;
    const channels = color === 2 ? 3 : 4;
    const stride = width * channels + 1;
    const pixels = raw || Buffer.alloc(headerOnly ? 1 : stride * height, value);
    if (!raw && !headerOnly) for (let row = 0; row < height; row += 1) pixels[row * stride] = 0;
    return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', idat || deflateSync(pixels)), chunk('IEND')]);
}

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-edited-image-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const state = await service.create(1, 'blank', 'ko');
    const original = png();
    const sourcePath = path.join(root, '원본.png');
    await fs.writeFile(sourcePath, original);
    const { asset: source } = await service.addAsset(1, state.sessionId, sourcePath, 'image');
    const session = service.session(state.sessionId, 1);
    return {
        root, service, state, source, sourcePath, original, session,
        edit: data => service.editImage(1, state.sessionId, source.id, data),
        files: () => fs.readdir(session.assetDirectory),
    };
}

test('edited image registers a separate PNG and leaves the source and document untouched', async t => {
    const f = await fixture(t);
    const before = structuredClone(f.state.project);
    const output = png({ width: 3, height: 2, value: 30 });
    const { asset } = await f.edit(new Uint8Array(output));
    assert.notEqual(asset.id, f.source.id);
    assert.deepEqual(asset, { id: asset.id, extension: 'png', mime: 'image/png', kind: 'image', name: '원본-edited.png', size: output.length });
    assert.deepEqual((await f.service.asset(1, f.state.sessionId, asset.id)).data, output);
    assert.deepEqual((await f.service.asset(1, f.state.sessionId, f.source.id)).data, f.original);
    assert.deepEqual(await fs.readFile(f.sourcePath), f.original);
    assert.deepEqual(f.state.project, before);
    assert.equal(f.session.catalog.size, 2);
});

test('edited image accepts an ArrayBuffer and respects a Uint8Array slice', async t => {
    const f = await fixture(t);
    const output = png({ color: 2 });
    const padded = new Uint8Array(output.length + 20);
    padded.set(output, 10);
    for (const data of [new Uint8Array(output).buffer, padded.subarray(10, 10 + output.length)]) {
        const { asset } = await f.edit(data);
        assert.deepEqual((await f.service.asset(1, f.state.sessionId, asset.id)).data, output);
    }
});

test('edited image rejects non-binary payloads, wrong formats and oversized input without writing', async t => {
    const f = await fixture(t);
    for (const input of [null, 'data:image/png;base64,AA==', [137, 80], { type: 'Buffer', data: [...f.original] }, new DataView(new ArrayBuffer(10)), new Uint8Array(new SharedArrayBuffer(10)), new Uint8Array(), Buffer.from([255, 216, 255, ...Array(20).fill(0)])]) {
        await assert.rejects(f.edit(input), { code: 'INVALID_ASSET' });
    }
    await assert.rejects(f.edit(new Uint8Array(MAX_EDITED_IMAGE_BYTES + 1)), { code: 'ASSET_TOO_LARGE' });
    assert.deepEqual(await f.files(), [assetFilename(f.source)]);
    assert.equal(f.session.catalog.size, 1);
});

test('edited image checks owner and source membership before accepting bytes', async t => {
    const f = await fixture(t);
    await assert.rejects(f.service.editImage(2, f.state.sessionId, f.source.id, f.original), { code: 'SESSION_CLOSED' });
    await assert.rejects(f.service.editImage(1, 'missing', f.source.id, f.original), { code: 'SESSION_CLOSED' });
    await assert.rejects(f.service.editImage(1, f.state.sessionId, '../original.png', f.original), { code: 'ASSET_MISSING' });
    const other = await f.service.create(2, 'blank', 'ko');
    await assert.rejects(f.service.editImage(2, other.sessionId, f.source.id, f.original), { code: 'ASSET_MISSING' });
    const fontPath = path.join(f.root, 'font.otf');
    await fs.writeFile(fontPath, Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]));
    const { asset: font } = await f.service.addAsset(1, f.state.sessionId, fontPath, 'font');
    await assert.rejects(f.service.editImage(1, f.state.sessionId, font.id, f.original), { code: 'INVALID_ASSET' });
    assert.equal(f.session.catalog.size, 2);
});

test('edited image fully validates PNG chunks and scanline data before registration', async t => {
    const f = await fixture(t);
    const brokenCrc = Buffer.from(f.original);
    brokenCrc[brokenCrc.length - 1] ^= 1;
    const cases = [
        brokenCrc,
        f.original.subarray(0, -12),
        Buffer.concat([f.original, Buffer.from('trailing')]),
        png({ idat: Buffer.from('not deflate') }),
        png({ raw: Buffer.from([0]) }),
        png({ raw: Buffer.alloc(1000) }),
        png({ raw: Buffer.alloc((6 * 4 + 1) * 4, 5) }),
        png({ width: 0, headerOnly: true }),
        png({ color: 3 }),
        Buffer.concat([signature, chunk('IDAT', deflateSync(Buffer.alloc(4))), chunk('IEND')]),
        Buffer.concat([f.original.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), f.original.subarray(33)]),
    ];
    for (const input of cases) await assert.rejects(f.edit(input), { code: 'INVALID_ASSET' });
    assert.deepEqual(await f.files(), [assetFilename(f.source)]);
    assert.equal(f.session.catalog.size, 1);
});

test('edited image dimensions are bounded before decompression', async t => {
    const f = await fixture(t);
    for (const dimensions of [{ width: 8193, height: 1 }, { width: 1, height: 8193 }, { width: 8192, height: 4097 }]) {
        await assert.rejects(f.edit(png({ ...dimensions, headerOnly: true })), { code: 'IMAGE_DIMENSIONS_EXCEEDED' });
    }
    assert.deepEqual(validateEditedImage(png({ width: 8192, height: 1 })), { width: 8192, height: 1 });
    assert.deepEqual(await f.files(), [assetFilename(f.source)]);
});

test('edited image enforces the project byte budget and serializes concurrent asset limits', async t => {
    const f = await fixture(t);
    f.session.catalog.set('a_quota', { size: MAX_PROJECT_BYTES - f.source.size });
    await assert.rejects(f.edit(f.original), { code: 'PROJECT_TOO_LARGE' });
    f.session.catalog.delete('a_quota');
    for (let index = 1; index < 999; index += 1) f.session.catalog.set(`a_limit_${index}`, { size: 1 });
    const results = await Promise.allSettled([f.edit(f.original), f.edit(f.original)]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(results[1].reason.code, 'TOO_MANY_ASSETS');
    assert.equal(f.session.catalog.size, 1000);
    assert.equal((await f.files()).length, 2);
});

test('a failed edited-image write removes the partial file and leaves the catalog intact', async t => {
    const f = await fixture(t);
    const open = fs.open;
    t.mock.method(fs, 'open', async (filePath, flags, ...args) => {
        const handle = await open(filePath, flags, ...args);
        if (flags === 'wx' && filePath.startsWith(f.session.assetDirectory)) {
            const writeFile = handle.writeFile.bind(handle);
            handle.writeFile = async data => {
                await writeFile(data.subarray(0, 20));
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            };
        }
        return handle;
    });
    await assert.rejects(f.edit(f.original), { code: 'ENOSPC' });
    assert.deepEqual(await f.files(), [assetFilename(f.source)]);
    assert.equal(f.session.catalog.size, 1);
});

test('closing a session while its edited image is validated does not leave a new asset', async t => {
    const f = await fixture(t);
    let validated;
    const ready = new Promise(resolve => { validated = resolve; });
    let resume;
    const gate = new Promise(resolve => { resume = resolve; });
    const runWorker = f.service.runWorker.bind(f.service);
    f.service.runWorker = async (...args) => {
        const result = await runWorker(...args);
        validated();
        await gate;
        return result;
    };
    const edit = f.edit(f.original);
    const rejected = assert.rejects(edit, { code: 'SESSION_CLOSED' });
    await ready;
    await f.service.close(1, f.state.sessionId);
    resume();
    await rejected;
    assert.deepEqual(await f.files(), [assetFilename(f.source)]);
    assert.equal(f.session.catalog.size, 1);
});

test('edited PNG survives recovery, project save/reopen and EPUB export alongside the original', async t => {
    const f = await fixture(t);
    const output = png({ width: 4, height: 2, value: 20 });
    const { asset: edited } = await f.edit(output);
    const project = structuredClone(f.state.project);
    project.assets = [f.source, edited];
    project.chapters[0].content.content = [
        { type: 'image', attrs: { assetId: edited.id, alt: '편집한 이미지', caption: '이미지 설명', width: 75, align: 'center' } },
        { type: 'image', attrs: { assetId: f.source.id, alt: '원본 이미지', caption: '', width: 100, align: 'left' } },
    ];
    project.revision += 1;
    await f.service.recovery(1, f.state.sessionId, project);
    await f.service.close(1, f.state.sessionId);
    const restored = await f.service.restore(1, f.state.sessionId);
    assert.deepEqual(restored.project, project);
    const target = path.join(f.root, 'edited.bmepub');
    await f.service.write(1, restored.sessionId, project, target, 'save', 'edited-save');
    const reopened = await f.service.open(2, target, 'edited-open');
    assert.deepEqual(reopened.project, project);
    assert.deepEqual((await f.service.asset(2, reopened.sessionId, edited.id)).data, output);
    assert.deepEqual((await f.service.asset(2, reopened.sessionId, f.source.id)).data, f.original);
    const epub = path.join(f.root, 'edited.epub');
    await f.service.write(2, reopened.sessionId, reopened.project, epub, 'export', 'edited-export');
    const bytes = await fs.readFile(epub);
    const entries = listZipEntries(bytes);
    const read = name => readZipEntry(bytes, entries.find(entry => entry.name === name));
    assert.deepEqual(read(`EPUB/assets/${assetFilename(edited)}`), output);
    assert.deepEqual(read(`EPUB/assets/${assetFilename(f.source)}`), f.original);
    const xhtml = read(`EPUB/text/${project.chapters[0].id}.xhtml`).toString();
    assert.ok(xhtml.includes(`../assets/${assetFilename(edited)}`));
    assert.ok(xhtml.includes('편집한 이미지'));
    assert.ok(xhtml.includes('이미지 설명'));
});

test('editImage IPC only accepts bytes for an image in the sender-owned session', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-edited-ipc-'));
    let handler;
    const filePath = path.join(root, 'source.png');
    const original = png();
    await fs.writeFile(filePath, original);
    const controller = registerEpubEditorIpc({
        ipcMain: { handle: (_channel, fn) => { handler = fn; } },
        app: { getPath: () => root },
        BrowserWindow: { fromWebContents: () => null },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }) },
    });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: () => {} });
    const invoke = request => handler({ sender }, request);
    const state = await invoke({ action: 'create', template: 'blank' });
    const { asset: source } = await invoke({ action: 'addAsset', sessionId: state.sessionId, kind: 'image' });
    const request = { action: 'editImage', sessionId: state.sessionId, assetId: source.id, data: new Uint8Array(png({ value: 30 })) };
    const response = await invoke(request);
    assert.equal(response.ok, true);
    assert.notEqual(response.asset.id, source.id);
    assert.equal('project' in response, false);
    assert.deepEqual((await invoke({ action: 'asset', sessionId: state.sessionId, assetId: response.asset.id })).data, Buffer.from(request.data));
    assert.deepEqual(await fs.readFile(filePath), original);
    const other = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false, send: () => {} });
    assert.equal((await handler({ sender: other }, request)).error.code, 'SESSION_CLOSED');
    assert.equal((await invoke({ ...request, data: undefined, filePath })).error.code, 'INVALID_ASSET');
});
