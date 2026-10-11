import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { registerCoverEditorSourceIpc } from './coverEditorSourceIpc.js';
import { loadCoverEditorImage } from './coverEditor.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');

function fixture(overrides = {}) {
    const handlers = new Map();
    const removed = [];
    const sender = new EventEmitter();
    sender.id = 1;
    sender.isDestroyed = () => false;
    const sources = registerCoverEditorSourceIpc({ handle: (name, handler) => handlers.set(name, handler) }, {
        getOptions: async () => ({ normalizeImage: 'normalize' }),
        getParentWindow: value => value.id,
        getLanguage: () => 'ko',
        removeDirectory: async directory => { removed.push(directory); },
        loadImage: async () => preview(),
        ...overrides,
    });
    return { sender, removed, sources, invoke: (channel, request, owner = sender) => handlers.get(`coverEditor:${channel}`)({ sender: owner }, request) };
}

function preview() {
    return { imagePath: '/temp/selected/cover.png', imageVersion: 'hash', dataUrl: 'data:image/png;base64,test', cleanupDirectory: '/temp/selected', buffer: Buffer.from('image') };
}

async function metadataFixture(t, overrides = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-metadata-cover-test-'));
    const cacheDirectory = path.join(directory, 'cache');
    const tempRoot = path.join(directory, 'previews');
    await fs.mkdir(cacheDirectory);
    await fs.mkdir(tempRoot);
    const cachePath = path.join(cacheDirectory, 'cached.png');
    await fs.writeFile(cachePath, PNG);
    const requestedUrls = [];
    const value = fixture({
        tempRoot,
        getOptions: async () => ({ normalizeImage: async buffer => ({ buffer, mimeType: 'image/png', width: 1, height: 1 }) }),
        getMetadataCoverPath: async imageUrl => { requestedUrls.push(imageUrl); return cachePath; },
        removeDirectory: target => fs.rm(target, { recursive: true, force: true }),
        ...overrides,
    });
    t.after(async () => {
        await value.invoke('releaseImages');
        await fs.rm(directory, { recursive: true, force: true });
    });
    return { ...value, directory, cacheDirectory, cachePath, tempRoot, requestedUrls };
}

function clipboardBitmap(buffer = PNG, width = 1, height = 1) {
    return { isEmpty: () => false, getSize: () => ({ width, height }), toPNG: () => buffer };
}

test('native clipboard images use the same normalized owned snapshot and stored hash as imported image bytes', async t => {
    let reads = 0;
    const value = await metadataFixture(t, {
        getClipboardImage: async () => { reads += 1; return clipboardBitmap(); },
        getOptions: async () => ({ normalizeImage: async buffer => {
            assert.deepEqual(buffer, PNG);
            return { buffer: OTHER_PNG, mimeType: 'image/png', width: 2, height: 3 };
        } }),
    });
    assert.equal(reads, 0);
    const image = await value.invoke('clipboardImage');
    assert.equal(reads, 1);
    assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
    assert.equal(image.imageVersion, createHash('sha256').update(OTHER_PNG).digest('hex'));
    assert.equal(image.dataUrl, `data:image/png;base64,${OTHER_PNG.toString('base64')}`);
    assert.equal(image.width, 2);
    assert.equal(image.height, 3);
    assert.equal(image.buffer, undefined);
    assert.equal(image.cleanupDirectory, undefined);
    const other = new EventEmitter();
    other.id = 2;
    await value.invoke('releaseImages', { imagePath: image.imagePath }, other);
    assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
    await value.invoke('releaseImages', { imagePath: image.imagePath });
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
});

test('an empty native clipboard reports no image without creating preview files or loading options', async t => {
    for (const image of [null, { isEmpty: () => true }]) {
        const value = await metadataFixture(t, {
            getClipboardImage: () => image,
            getOptions: () => assert.fail('empty clipboard must not load image options'),
        });
        assert.deepEqual(await value.invoke('clipboardImage'), { empty: true });
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
});

test('native clipboard images reject invalid dimensions and excessive pixels before PNG encoding', async t => {
    for (const [width, height, code] of [
        [0, 1, 'COVER_IMAGE_INVALID'],
        [1.5, 1, 'COVER_IMAGE_INVALID'],
        [8001, 8000, 'COVER_IMAGE_TOO_MANY_PIXELS'],
    ]) {
        const value = await metadataFixture(t, { getClipboardImage: () => ({
            ...clipboardBitmap(PNG, width, height),
            toPNG: () => assert.fail('invalid dimensions must be rejected before encoding'),
        }) });
        assert.equal((await value.invoke('clipboardImage')).code, code);
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
    const oversized = await metadataFixture(t, { getClipboardImage: () => clipboardBitmap(Buffer.alloc(16 * 1024 * 1024 + 1)) });
    assert.equal((await oversized.invoke('clipboardImage')).code, 'COVER_IMAGE_TOO_LARGE');
    assert.deepEqual(await fs.readdir(oversized.tempRoot), []);
});

test('native clipboard read and PNG encoding failures use localized image import error codes', async t => {
    for (const getClipboardImage of [
        () => { throw new Error('clipboard unavailable'); },
        () => ({ ...clipboardBitmap(), toPNG: () => { throw new Error('clipboard encoding failed'); } }),
    ]) {
        const value = await metadataFixture(t, { getClipboardImage });
        assert.equal((await value.invoke('clipboardImage')).code, 'COVER_IMAGE_IMPORT_FAILED');
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
});

test('closing while native clipboard reading or normalization is pending discards late image results', async t => {
    for (const phase of ['read', 'normalize']) {
        for (const cause of ['release', 'destroyed', 'did-start-navigation']) {
            let start;
            let finish;
            const started = new Promise(resolve => { start = resolve; });
            const defer = result => {
                start();
                return new Promise(resolve => { finish = () => resolve(result); });
            };
            const value = await metadataFixture(t, {
                getClipboardImage: () => phase === 'read' ? defer(clipboardBitmap()) : clipboardBitmap(),
                getOptions: async () => ({ normalizeImage: buffer => phase === 'normalize'
                    ? defer({ buffer, mimeType: 'image/png', width: 1, height: 1 }) : assert.fail('closed clipboard read must not load image') }),
            });
            const pending = value.invoke('clipboardImage');
            await started;
            if (cause === 'release') await value.invoke('releaseImages');
            else value.sender.emit(cause, {}, 'app://reload', false, true);
            finish();
            assert.deepEqual(await pending, { cancelled: true });
            assert.deepEqual(await fs.readdir(value.tempRoot), []);
        }
    }
});

test('pasted bytes and raster data URLs normalize into owned snapshots with the stored image hash', async t => {
    for (const request of [{ bytes: new Uint8Array(PNG) }, { url: `data:image/png;base64,${PNG.toString('base64')}` }]) {
        const value = await metadataFixture(t, {
            getOptions: async () => ({ normalizeImage: async buffer => {
                assert.deepEqual(buffer, PNG);
                return { buffer: OTHER_PNG, mimeType: 'image/png', width: 2, height: 3 };
            } }),
        });
        const image = await value.invoke('importImage', request);
        assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
        assert.deepEqual(await fs.readdir(path.dirname(image.imagePath)), ['imported.png']);
        assert.equal(image.imageVersion, createHash('sha256').update(OTHER_PNG).digest('hex'));
        assert.equal((await loadCoverEditorImage(image.imagePath)).imageVersion, image.imageVersion);
        assert.equal(image.dataUrl, `data:image/png;base64,${OTHER_PNG.toString('base64')}`);
        assert.equal(image.width, 2);
        assert.equal(image.height, 3);
        assert.equal(image.buffer, undefined);
        assert.equal(image.cleanupDirectory, undefined);
        assert.deepEqual(value.requestedUrls, []);
        await value.invoke('releaseImages', { imagePath: image.imagePath });
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
});

test('import requests reject ambiguous payloads, invalid image bytes, URLs, data URLs and oversize images before creating files', async t => {
    const value = await metadataFixture(t, { downloadImage: async () => { assert.fail('invalid import must not download'); } });
    const cases = [
        [null, 'COVER_IMAGE_IMPORT_FAILED'],
        [{}, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ bytes: PNG, url: 'https://example.com/cover.png' }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ bytes: PNG, extra: true }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ bytes: [...PNG] }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ bytes: PNG.buffer }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ bytes: new Uint8Array() }, 'COVER_IMAGE_INVALID'],
        [{ bytes: Buffer.from('<svg/>') }, 'COVER_IMAGE_UNSUPPORTED_FORMAT'],
        [{ bytes: new Uint8Array(16 * 1024 * 1024 + 1) }, 'COVER_IMAGE_TOO_LARGE'],
        [{ url: 'file:///tmp/cover.png' }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ url: 'http://127.0.0.1/private' }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ url: 'https://user:pass@example.com/a' }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ url: `https://example.com/${'a'.repeat(8192)}` }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ url: 123 }, 'COVER_IMAGE_IMPORT_FAILED'],
        [{ url: 'data:image/png;base64,%%%' }, 'COVER_IMAGE_INVALID'],
        [{ url: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` }, 'COVER_IMAGE_INVALID'],
        [{ url: `data:image/jpeg;base64,${PNG.toString('base64')}` }, 'COVER_IMAGE_INVALID'],
        [{ url: `data:image/png;base64,${Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64')}` }, 'COVER_IMAGE_TOO_LARGE'],
    ];
    for (const [request, code] of cases) assert.equal((await value.invoke('importImage', request)).code, code);
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
});

test('browser image URL imports use the bounded downloader and persist its normalized buffer', async t => {
    let downloadOptions;
    const value = await metadataFixture(t, {
        downloadImage: async (url, options) => {
            assert.equal(url, 'https://images.example.com/cover');
            downloadOptions = options;
            const directory = await fs.mkdtemp(path.join(options.tempRoot, 'download-'));
            const imagePath = path.join(directory, 'original.png');
            await fs.writeFile(imagePath, PNG);
            const image = await options.loadImage(imagePath, { normalizeImage: options.normalizeImage });
            return { ...image, cleanupDirectory: directory };
        },
        getOptions: async () => ({ normalizeImage: async () => ({ buffer: OTHER_PNG, mimeType: 'image/png', width: 2, height: 3 }) }),
    });
    const image = await value.invoke('importImage', { url: 'https://images.example.com/cover' });
    assert.equal(downloadOptions.signal.aborted, false);
    assert.deepEqual(await fs.readFile(image.imagePath), OTHER_PNG);
    assert.equal(image.imageVersion, createHash('sha256').update(OTHER_PNG).digest('hex'));
    assert.deepEqual(await fs.readdir(path.dirname(image.imagePath)), ['imported.png']);
    await value.invoke('releaseImages');
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
});

test('import failures preserve image validation codes and remove temporary source files', async t => {
    for (const code of ['COVER_IMAGE_TOO_MANY_PIXELS', 'COVER_IMAGE_INVALID', 'COVER_IMAGE_CONVERSION_FAILED']) {
        const value = await metadataFixture(t, {
            getOptions: async () => ({ normalizeImage: async () => { throw Object.assign(new Error('image rejected'), { code }); } }),
        });
        assert.deepEqual(await value.invoke('importImage', { bytes: PNG }), { error: 'image rejected', code });
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
    const value = await metadataFixture(t, { downloadImage: async () => { throw new Error('network failure'); } });
    assert.equal((await value.invoke('importImage', { url: 'https://images.example.com/cover' })).code, 'COVER_IMAGE_IMPORT_FAILED');
});

test('closing during import normalization discards late results and cleans their temporary source', async t => {
    for (const cause of ['release', 'destroyed', 'did-start-navigation']) {
        let start;
        let finish;
        const started = new Promise(resolve => { start = resolve; });
        const value = await metadataFixture(t, {
            getOptions: async () => ({ normalizeImage: buffer => {
                start();
                return new Promise(resolve => { finish = () => resolve({ buffer, mimeType: 'image/png', width: 1, height: 1 }); });
            } }),
        });
        const pending = value.invoke('importImage', { bytes: PNG });
        await started;
        if (cause === 'release') await value.invoke('releaseImages');
        else value.sender.emit(cause, {}, 'app://reload', false, true);
        finish();
        assert.deepEqual(await pending, { cancelled: true });
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
    }
});

test('closing the owner aborts all pending image downloads without affecting a replacement owner', async t => {
    const requests = [];
    const value = await metadataFixture(t, { downloadImage: (_url, options) => new Promise((_resolve, reject) => {
        requests.push(options);
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }) });
    const first = value.invoke('importImage', { url: 'https://images.example.com/one' });
    const second = value.invoke('importImage', { url: 'https://images.example.com/two' });
    await new Promise(resolve => setImmediate(resolve));
    await value.invoke('releaseImages');
    assert.equal(requests.length, 2);
    assert.equal(requests.every(request => request.signal.aborted), true);
    const replacement = await value.invoke('importImage', { bytes: PNG });
    assert.deepEqual(await first, { cancelled: true });
    assert.deepEqual(await second, { cancelled: true });
    assert.deepEqual(await fs.readFile(replacement.imagePath), PNG);
});

test('imported snapshots can only be released by their owner and remain available until an active save completes', async t => {
    const value = await metadataFixture(t);
    const image = await value.invoke('importImage', { bytes: PNG });
    const other = new EventEmitter();
    other.id = 2;
    await value.invoke('releaseImages', { imagePath: image.imagePath }, other);
    assert.deepEqual(await fs.readFile(image.imagePath), PNG);
    let finish;
    const pending = value.sources.withImage(value.sender, image.imagePath, async () => {
        await new Promise(resolve => { finish = resolve; });
        return fs.readFile(image.imagePath);
    });
    await value.invoke('releaseImages');
    assert.deepEqual(await fs.readFile(image.imagePath), PNG);
    finish();
    assert.deepEqual(await pending, PNG);
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
});

test('both preload entry points expose the same imported cover image API', async () => {
    for (const fileName of ['preload.js', 'preload.cjs']) {
        const source = await fs.readFile(new URL(fileName, import.meta.url), 'utf8');
        assert.match(source, /previewCoverEditorImportedImage: request => ipcRenderer\.invoke\('coverEditor:importImage', request\)/);
        assert.match(source, /previewCoverEditorClipboardImage: \(\) => ipcRenderer\.invoke\('coverEditor:clipboardImage'\)/);
    }
});

test('metadata cover selection uses the existing cache service and owns only its preview snapshot', async t => {
    const value = await metadataFixture(t);
    const imageUrl = 'https://img.ridicdn.net/cover/123/original';
    const result = await value.invoke('metadataImage', { imageUrl });
    assert.deepEqual(value.requestedUrls, [imageUrl]);
    assert.notEqual(result.imagePath, value.cachePath);
    assert.equal(path.dirname(path.dirname(result.imagePath)), value.tempRoot);
    assert.match(path.basename(path.dirname(result.imagePath)), /^bookmanager-cover-source-/);
    assert.deepEqual(await fs.readFile(result.imagePath), PNG);
    assert.equal(result.buffer, undefined);
    assert.equal(result.cleanupDirectory, undefined);
    assert.equal(result.width, 1);
    const other = new EventEmitter();
    other.id = 2;
    await value.invoke('releaseImages', { imagePath: result.imagePath }, other);
    assert.deepEqual(await fs.readFile(result.imagePath), PNG);
    await value.invoke('releaseImages', { imagePath: result.imagePath });
    await assert.rejects(fs.stat(result.imagePath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(value.cachePath), PNG);
});

test('metadata cover normalization hashes the stored snapshot so it passes the save version check', async t => {
    const value = await metadataFixture(t, {
        getOptions: async () => ({ normalizeImage: async buffer => {
            assert.deepEqual(buffer, PNG);
            return { buffer: OTHER_PNG, mimeType: 'image/png', width: 2, height: 3 };
        } }),
    });
    const result = await value.invoke('metadataImage', { imageUrl: 'bookmanager-thumbnail://api-cover/cached.png?v=1' });
    assert.deepEqual(await fs.readFile(result.imagePath), OTHER_PNG);
    assert.equal(result.imageVersion, createHash('sha256').update(OTHER_PNG).digest('hex'));
    assert.notEqual(result.imageVersion, createHash('sha256').update(PNG).digest('hex'));
    assert.equal((await loadCoverEditorImage(result.imagePath)).imageVersion, result.imageVersion);
    assert.equal(result.dataUrl, `data:image/png;base64,${OTHER_PNG.toString('base64')}`);
    assert.deepEqual(await fs.readFile(value.cachePath), PNG);
});

test('base64 metadata covers are validated and normalized into owned snapshots without using the cache', async t => {
    const value = await metadataFixture(t);
    const result = await value.invoke('metadataImage', { imageUrl: `data:image/png;base64,${PNG.toString('base64')}` });
    assert.deepEqual(value.requestedUrls, []);
    assert.deepEqual(await fs.readFile(result.imagePath), PNG);
    assert.deepEqual(await fs.readdir(path.dirname(result.imagePath)), ['cover.png']);
    await value.invoke('releaseImages');
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
    assert.deepEqual(await fs.readFile(value.cachePath), PNG);
});

test('missing, malformed, non-raster, mismatched, and oversized metadata data URLs leave no preview files', async t => {
    const value = await metadataFixture(t);
    for (const imageUrl of [
        '', '   ', null, 42,
        'data:image/png;base64,AA=A', 'data:image/png;base64,%%%%',
        `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
        `data:image/jpeg;base64,${PNG.toString('base64')}`,
        `data:image/png;base64,${Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64')}`,
    ]) {
        const result = await value.invoke('metadataImage', { imageUrl });
        assert.equal(result.code, 'COVER_METADATA_IMAGE_UNAVAILABLE');
    }
    assert.deepEqual(value.requestedUrls, []);
    assert.deepEqual(await fs.readdir(value.tempRoot), []);
    assert.deepEqual(await fs.readFile(value.cachePath), PNG);
});

test('metadata cache or normalization failures clean only owned temporary files and preserve error codes', async t => {
    const unavailable = await metadataFixture(t, { getMetadataCoverPath: async () => '' });
    assert.equal((await unavailable.invoke('metadataImage', { imageUrl: 'https://example.com/cover.png' })).code, 'COVER_METADATA_IMAGE_UNAVAILABLE');
    const invalid = await metadataFixture(t, {
        getOptions: async () => ({ normalizeImage: async () => { throw Object.assign(new Error('invalid image'), { code: 'INVALID_IMAGE' }); } }),
    });
    for (const imageUrl of ['https://example.com/cover.png', `data:image/png;base64,${PNG.toString('base64')}`]) {
        assert.deepEqual(await invalid.invoke('metadataImage', { imageUrl }), { error: 'invalid image', code: 'INVALID_IMAGE' });
        assert.deepEqual(await fs.readdir(invalid.tempRoot), []);
        assert.deepEqual(await fs.readFile(invalid.cachePath), PNG);
    }
});

test('closing during metadata image normalization discards late snapshots and keeps the cache', async t => {
    for (const cause of ['release', 'destroyed', 'did-start-navigation']) {
        let start;
        let finish;
        const started = new Promise(resolve => { start = resolve; });
        const value = await metadataFixture(t, {
            getOptions: async () => ({ normalizeImage: buffer => {
                start();
                return new Promise(resolve => { finish = () => resolve({ buffer, mimeType: 'image/png', width: 1, height: 1 }); });
            } }),
        });
        const pending = value.invoke('metadataImage', { imageUrl: `data:image/png;base64,${PNG.toString('base64')}` });
        await started;
        if (cause === 'release') await value.invoke('releaseImages');
        else value.sender.emit(cause, {}, 'app://reload', false, true);
        finish();
        assert.deepEqual(await pending, { cancelled: true });
        assert.deepEqual(await fs.readdir(value.tempRoot), []);
        assert.deepEqual(await fs.readFile(value.cachePath), PNG);
    }
});

test('metadata snapshots survive cache clearing and editor release until their save lease finishes', async t => {
    const value = await metadataFixture(t);
    const image = await value.invoke('metadataImage', { imageUrl: 'https://example.com/cover.png' });
    let continueSave;
    const pending = value.sources.withImage(value.sender, image.imagePath, async () => {
        await new Promise(resolve => { continueSave = resolve; });
        const savingImage = await loadCoverEditorImage(image.imagePath);
        assert.equal(savingImage.imageVersion, image.imageVersion);
        return savingImage.buffer;
    });
    await fs.rm(value.cachePath);
    await value.invoke('releaseImages');
    assert.deepEqual(await fs.readFile(image.imagePath), PNG);
    continueSave();
    assert.deepEqual(await pending, PNG);
    await assert.rejects(fs.stat(image.imagePath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(value.cacheDirectory), []);
});

test('archive previews hide backend data and release only images owned by the sender', async () => {
    const value = fixture();
    const result = await value.invoke('archiveImage', { entryName: 'cover.png' });
    assert.equal(result.imagePath, preview().imagePath);
    assert.equal(result.cleanupDirectory, undefined);
    assert.equal(result.buffer, undefined);
    const other = new EventEmitter();
    other.id = 2;
    await value.invoke('releaseImages', { imagePath: result.imagePath }, other);
    await value.invoke('releaseImages', { imagePath: '/books/user-image.png' });
    assert.deepEqual(value.removed, []);
    await value.invoke('releaseImages', { imagePath: result.imagePath });
    assert.deepEqual(value.removed, ['/temp/selected']);
    await value.invoke('releaseImages');
    assert.equal(value.sender.listenerCount('destroyed'), 0);
    assert.equal(value.sender.listenerCount('did-start-navigation'), 0);
});

test('closing the editor discards and cleans an archive preview still being extracted', async () => {
    let resolve;
    const value = fixture({ loadImage: () => new Promise(done => { resolve = done; }) });
    const pending = value.invoke('archiveImage', {});
    await new Promise(done => setImmediate(done));
    await value.invoke('releaseImages');
    resolve(preview());
    assert.deepEqual(await pending, { cancelled: true });
    assert.deepEqual(value.removed, ['/temp/selected']);
});

test('Google search receives the parent and language, prevents duplicates and aborts on close', async () => {
    let request;
    let resolve;
    const value = fixture({ searchImage: input => {
        request = input;
        return new Promise(done => { resolve = done; });
    } });
    const pending = value.invoke('googleImage', { query: '책 제목' });
    await new Promise(done => setImmediate(done));
    assert.equal(request.parentWindow, 1);
    assert.equal(request.query, '책 제목');
    assert.equal(request.language, 'ko');
    assert.equal(request.normalizeImage, 'normalize');
    assert.match((await value.invoke('googleImage', { query: 'other' })).error, /already open/);
    await value.invoke('releaseImages');
    assert.equal(request.signal.aborted, true);
    resolve(preview());
    assert.deepEqual(await pending, { cancelled: true });
    assert.deepEqual(value.removed, ['/temp/selected']);
});

test('renderer destruction and main frame reload clean retained images', async () => {
    for (const cause of ['destroyed', 'did-start-navigation']) {
        const value = fixture();
        await value.invoke('archiveImage', {});
        value.sender.emit('did-start-navigation', {}, 'https://example.com', false, false);
        assert.deepEqual(value.removed, []);
        value.sender.emit(cause, {}, 'app://reload', false, true);
        await new Promise(done => setImmediate(done));
        assert.deepEqual(value.removed, ['/temp/selected']);
        assert.equal(value.sender.listenerCount('destroyed'), 0);
    }
});

test('source errors preserve codes and options reach the archive list service', async () => {
    const value = fixture({
        listImages: async (request, options) => ({ entries: [{ name: request.filter }], total: 1, normalized: options.normalizeImage }),
        loadImage: async () => { throw Object.assign(new Error('changed'), { code: 'COVER_SOURCE_CHANGED' }); },
    });
    assert.deepEqual(await value.invoke('archiveImages', { filter: 'page.png' }), { entries: [{ name: 'page.png' }], total: 1, normalized: 'normalize' });
    assert.deepEqual(await value.invoke('archiveImage', {}), { error: 'changed', code: 'COVER_SOURCE_CHANGED' });
    await value.invoke('releaseImages');
});

test('saving retains its source until completion even when the renderer closes or releases it', async () => {
    for (const cause of ['destroyed', 'did-start-navigation', 'release']) {
        for (const failed of [false, true]) {
            const value = fixture();
            const image = await value.invoke('archiveImage', {});
            let finish;
            const pending = value.sources.withImage(value.sender, image.imagePath, () => new Promise((resolve, reject) => {
                finish = () => failed ? reject(new Error('save failed')) : resolve('saved');
            }));
            if (cause === 'release') await value.invoke('releaseImages', { imagePath: image.imagePath });
            else value.sender.emit(cause, {}, 'app://reload', false, true);
            assert.deepEqual(value.removed, []);
            finish();
            if (failed) await assert.rejects(pending, /save failed/);
            else assert.equal(await pending, 'saved');
            assert.deepEqual(value.removed, ['/temp/selected']);
            await value.invoke('releaseImages');
            assert.deepEqual(value.removed, ['/temp/selected']);
        }
    }
});

test('archive thumbnail batches forward options without retaining temporary images', async () => {
    const entries = [{ name: 'page.png', thumbnailDataUrl: 'data:image/png;base64,thumbnail', width: 1080, height: 1920 }];
    const value = fixture({ loadThumbnails: async (request, options) => {
        assert.deepEqual(request.entryNames, ['page.png']);
        assert.equal(options.normalizeImage, 'normalize');
        assert.equal(options.shouldCancel(), false);
        return { entries };
    } });
    assert.deepEqual(await value.invoke('archiveThumbnails', { entryNames: ['page.png'] }), { entries });
    await value.invoke('releaseImages');
    assert.deepEqual(value.removed, []);
});

test('archive thumbnail batches serialize extraction and skip superseded requests', async () => {
    let finish;
    let firstOptions;
    const loaded = [];
    const value = fixture({ loadThumbnails: async (request, options) => {
        loaded.push(request.page);
        if (request.page === 1) {
            firstOptions = options;
            await new Promise(resolve => { finish = resolve; });
        }
        return { entries: [{ name: `page-${request.page}.png` }] };
    } });
    const first = value.invoke('archiveThumbnails', { page: 1 });
    await new Promise(resolve => setImmediate(resolve));
    const second = value.invoke('archiveThumbnails', { page: 2 });
    const third = value.invoke('archiveThumbnails', { page: 3 });
    assert.equal(firstOptions.shouldCancel(), true);
    assert.deepEqual(loaded, [1]);
    finish();
    assert.deepEqual(await first, { cancelled: true });
    assert.deepEqual(await second, { cancelled: true });
    assert.deepEqual(await third, { entries: [{ name: 'page-3.png' }] });
    assert.deepEqual(loaded, [1, 3]);
    await value.invoke('releaseImages');
});

test('closing the editor cancels outstanding archive thumbnails', async () => {
    let finish;
    let imageOptions;
    const value = fixture({ loadThumbnails: async (_request, options) => {
        imageOptions = options;
        await new Promise(resolve => { finish = resolve; });
        return { entries: [{ name: 'page.png' }] };
    } });
    const pending = value.invoke('archiveThumbnails', {});
    await new Promise(resolve => setImmediate(resolve));
    await value.invoke('releaseImages');
    assert.equal(imageOptions.shouldCancel(), true);
    finish();
    assert.deepEqual(await pending, { cancelled: true });
    assert.deepEqual(value.removed, []);
});
