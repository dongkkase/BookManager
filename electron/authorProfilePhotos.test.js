import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { registerAuthorProfilePhotosIpc } from './authorProfilePhotos.js';
import { downloadCoverImage } from './coverImageSearch.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const ID = createHash('sha256').update(PNG).digest('hex');
const wikiUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg';
const wiki = () => ({ provider: 'wikidata', id: 'Q1', name: 'Author', photoUrl: wikiUrl });
const openLibrary = () => ({ id: 'OL1A', name: 'Author' });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness(t, overrides = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-profile-photo-'));
    const photoDirectory = path.join(directory, 'author-photos');
    const handlers = new Map();
    const sender = new EventEmitter();
    sender.mainFrame = {};
    sender.isDestroyed = () => false;
    const event = { sender, senderFrame: sender.mainFrame };
    const window = { isDestroyed: () => false, webContents: sender };
    const downloads = [];
    const sizes = [];
    const api = registerAuthorProfilePhotosIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getMainWindow: () => window,
        getPhotoDirectory: () => photoDirectory,
        tempRoot: directory,
        resizeImage: async (buffer, size) => { sizes.push(size); return { buffer, width: 1, height: 1, mimeType: 'image/png' }; },
        downloadImage: async (url, options) => {
            downloads.push({ url, options });
            const cleanupDirectory = await fs.mkdtemp(path.join(directory, 'download-'));
            return { ...await options.normalizeImage(PNG), sourceUrl: url, cleanupDirectory };
        },
        ...overrides,
    });
    t.after(async () => { api.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
    return { directory, photoDirectory, event, sender, window, downloads, sizes, api,
        invoke: (profile, from = event, options) => handlers.get('authors:saveProfilePhoto')(from, profile, options),
        importPhoto: (value, from = event) => handlers.get('authors:importPhoto')(from, value) };
}

test('profile photos are saved as private hashed PNG files and survive a new IPC service', async t => {
    for (const profile of [wiki(), openLibrary()]) {
        const h = await harness(t);
        const sourceUrl = profile.photoUrl || 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false';
        const saved = await h.invoke(profile);
        assert.deepEqual(saved, { success: true, photo: { id: ID, sourceUrl } });
        const file = path.join(h.photoDirectory, `${ID}.png`);
        assert.deepEqual(await fs.readFile(file), PNG);
        assert.deepEqual(h.sizes, [512]);
        assert.equal(h.downloads[0].options.maxBytes, 8 * 1024 * 1024);
        assert.deepEqual(await fs.readdir(h.directory), ['author-photos']);
        if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        h.api.dispose();
        const restarted = await harness(t, { getPhotoDirectory: () => h.photoDirectory });
        assert.deepEqual(await restarted.invoke({ ...profile, storedPhoto: saved.photo }), saved);
        assert.equal(restarted.downloads.length, 0, 'Saved files must be reused without fetching the source again');
        assert.deepEqual(await fs.readFile(file), PNG);
    }
});

test('existing Naver photos reuse the same permanent folder without accepting arbitrary new downloads', async t => {
    const h = await harness(t);
    await fs.mkdir(h.photoDirectory);
    await fs.writeFile(path.join(h.photoDirectory, `${ID}.png`), PNG);
    const photoOverride = { id: ID, sourceUrl: 'https://images.example.com/photo.jpg', query: 'Author' };
    const profile = { provider: 'naver', id: ID, name: 'Author', photoOverride };
    assert.deepEqual(await h.invoke(profile), { success: true, photo: { id: ID, sourceUrl: photoOverride.sourceUrl } });
    assert.deepEqual(await h.invoke({ ...wiki(), storedPhoto: { id: 'a'.repeat(64), sourceUrl: wikiUrl }, photoOverride }), {
        success: true, photo: { id: ID, sourceUrl: photoOverride.sourceUrl },
    });
    assert.equal(h.downloads.length, 0);
    await fs.rm(path.join(h.photoDirectory, `${ID}.png`));
    assert.equal((await h.invoke(profile)).code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    assert.equal(h.downloads.length, 0);
});

test('remote profile URLs and stored filenames are validated before accessing storage or the network', async t => {
    const h = await harness(t);
    const invalid = [
        null, {}, { ...wiki(), id: 'Q0' }, { ...wiki(), photoUrl: 'http://127.0.0.1/photo.jpg' },
        { ...wiki(), photoUrl: 'https://attacker.example/Author.jpg' },
        { ...wiki(), photoUrl: 'https://upload.wikimedia.org:444/wikipedia/commons/a/ab/Author.jpg' },
        { ...wiki(), photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Author.jpg?x=1' },
        { ...wiki(), storedPhoto: { id: '../private', sourceUrl: wikiUrl } },
        { ...wiki(), storedPhoto: { id: ID, sourceUrl: 'https://attacker.example/photo.jpg' } },
        { ...openLibrary(), storedPhoto: { id: ID, sourceUrl: 'https://covers.openlibrary.org/a/olid/OL2A-M.jpg?default=false' } },
    ];
    for (const profile of invalid) assert.equal((await h.invoke(profile)).code, 'AUTHOR_PHOTO_INVALID_PROFILE');
    assert.equal(h.downloads.length, 0);
    assert.deepEqual(await fs.readdir(h.directory), []);
});

test('only the main library window top-level frame can save profile photos', async t => {
    const h = await harness(t);
    for (const event of [{ sender: {} }, { sender: h.sender }, { ...h.event, senderFrame: {} }]) {
        assert.equal((await h.invoke(wiki(), event)).code, 'AUTHOR_PHOTO_UNTRUSTED_SENDER');
    }
    h.sender.isDestroyed = () => true;
    assert.equal((await h.invoke(wiki())).code, 'AUTHOR_PHOTO_UNTRUSTED_SENDER');
    assert.equal(h.downloads.length, 0);
});

test('concurrent photo saves share identical requests and download one image at a time', async t => {
    const pending = [];
    let active = 0;
    let maximum = 0;
    const h = await harness(t, { downloadImage: async (url, options) => {
        active += 1;
        maximum = Math.max(maximum, active);
        try {
            await new Promise(resolve => pending.push({ url, resolve }));
            return { ...await options.normalizeImage(PNG), sourceUrl: url };
        } finally { active -= 1; }
    } });
    const first = h.invoke(wiki());
    const duplicate = h.invoke(wiki());
    const second = h.invoke(openLibrary());
    await tick();
    assert.equal(pending.length, 1);
    pending[0].resolve();
    assert.deepEqual(await first, await duplicate);
    await tick();
    assert.equal(pending.length, 2);
    pending[1].resolve();
    assert.equal((await second).success, true);
    assert.equal(maximum, 1);
});

test('missing or corrupt saved profile images are repaired from their original URL without a new profile search', async t => {
    const h = await harness(t);
    const profile = { ...wiki(), storedPhoto: { id: ID, sourceUrl: wikiUrl } };
    assert.equal((await h.invoke(profile)).success, true);
    assert.equal(h.downloads.length, 1);
    await fs.writeFile(path.join(h.photoDirectory, `${ID}.png`), PNG.subarray(0, 20));
    assert.equal((await h.invoke(profile)).success, true);
    assert.equal(h.downloads.length, 2);
    assert.deepEqual(await fs.readFile(path.join(h.photoDirectory, `${ID}.png`)), PNG);
});

test('a failed or cancelled file write leaves no partial photo and never removes an existing saved photo', async t => {
    let fail = true;
    const h = await harness(t, { writePhotoFile: async (file, bytes, options) => {
        await fs.writeFile(file, fail ? bytes.subarray(0, 10) : bytes, options);
        if (fail) throw new Error('Disk full');
    } });
    assert.equal((await h.invoke(wiki())).code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    assert.deepEqual(await fs.readdir(h.photoDirectory), []);
    fail = false;
    assert.equal((await h.invoke(wiki())).success, true);
    fail = true;
    assert.equal((await h.invoke(wiki())).code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    assert.deepEqual(await fs.readdir(h.photoDirectory), [`${ID}.png`]);
    assert.deepEqual(await fs.readFile(path.join(h.photoDirectory, `${ID}.png`)), PNG);

    const cancelled = await harness(t, { writePhotoFile: async (file, bytes, options) => {
        await fs.writeFile(file, bytes, options);
        cancelled.sender.emit('did-start-navigation', {}, 'app://reload', false, true);
    } });
    assert.equal((await cancelled.invoke(wiki())).code, 'AUTHOR_PHOTO_CANCELLED');
    assert.deepEqual(await fs.readdir(cancelled.photoDirectory), []);
});

test('invalid, oversized or unconstrained decoder output is rejected before publication', async t => {
    for (const image of [
        { buffer: Buffer.from('<svg>'), width: 1, height: 1 },
        { buffer: Buffer.alloc(2 * 1024 * 1024 + 1), width: 1, height: 1 },
        { buffer: PNG, width: 513, height: 1 },
        { buffer: PNG, width: 0, height: 1 },
    ]) {
        const h = await harness(t, { downloadImage: async () => image });
        assert.equal((await h.invoke(wiki())).code, 'AUTHOR_PHOTO_IMAGE_FAILED');
        assert.deepEqual(await fs.readdir(h.directory), []);
    }
});

test('window destruction aborts active and queued photo work', async t => {
    let downloads = 0;
    const h = await harness(t, { downloadImage: async (_url, options) => {
        downloads += 1;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    } });
    const first = h.invoke(wiki());
    const second = h.invoke(openLibrary());
    await tick();
    h.sender.emit('destroyed');
    assert.equal((await first).code, 'AUTHOR_PHOTO_CANCELLED');
    assert.equal((await second).code, 'AUTHOR_PHOTO_CANCELLED');
    assert.equal(downloads, 1);
});

test('a timed-out download releases the queue for the next author', async t => {
    let downloads = 0;
    const h = await harness(t, { timeoutMs: 5, downloadImage: async (_url, options) => {
        downloads += 1;
        if (downloads === 1) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
        return options.normalizeImage(PNG);
    } });
    const first = h.invoke(wiki());
    const second = h.invoke(openLibrary());
    assert.equal((await first).code, 'AUTHOR_PHOTO_TIMEOUT');
    assert.equal((await second).success, true);
});

function responseRequest(response) {
    return (_url, _options, callback) => {
        const request = new EventEmitter();
        request.end = () => queueMicrotask(() => {
            const stream = new PassThrough();
            stream.statusCode = response.status || 200;
            stream.headers = response.headers || {};
            callback(stream);
            if (!stream.destroyed) stream.end(response.body || PNG);
        });
        return request;
    };
}

test('the shared downloader rejects private DNS and private redirects for approved profile hosts', async t => {
    for (const redirect of [false, true]) {
        let requests = 0;
        const h = await harness(t, { downloadImage: (url, options) => downloadCoverImage(url, {
            ...options,
            lookup: async () => [{ address: redirect ? '93.184.216.34' : '127.0.0.1', family: 4 }],
            request: (...args) => {
                requests += 1;
                return responseRequest({ status: 302, headers: { location: 'http://127.0.0.1/private' } })(...args);
            },
        }) });
        assert.equal((await h.invoke(wiki())).code, 'AUTHOR_PHOTO_IMAGE_FAILED');
        assert.equal(requests, redirect ? 1 : 0);
        assert.deepEqual(await fs.readdir(h.directory), []);
    }
});

test('a public redirect retains the original approved source URL for later local-file restoration', async t => {
    let requests = 0;
    const h = await harness(t, { downloadImage: (url, options) => downloadCoverImage(url, {
        ...options,
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        request: (...args) => responseRequest(++requests === 1
            ? { status: 302, headers: { location: 'https://thumb.wikimedia.org/wikipedia/commons/a/ab/Author.jpg' } }
            : { body: PNG })(...args),
        loadImage: async (file, imageOptions) => imageOptions.normalizeImage(await fs.readFile(file)),
    }) });
    assert.deepEqual(await h.invoke(wiki()), { success: true, photo: { id: ID, sourceUrl: wikiUrl } });
    assert.equal(requests, 2);
    assert.deepEqual(await fs.readdir(h.directory), ['author-photos']);
});

test('photo selection can request editable pixels and retain profile image attribution', async t => {
    const h = await harness(t);
    const profile = { ...wiki(), imageSourceUrl: 'https://commons.wikimedia.org/wiki/File:Author.jpg', imageArtist: 'Photographer', imageLicense: 'CC BY 4.0' };
    const saved = await h.invoke(profile, h.event, { includeDataUrl: true });
    assert.equal(saved.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.deepEqual(saved.photo, { id: ID, sourceUrl: wikiUrl, source: 'wikidata', query: 'Author',
        imageSourceUrl: profile.imageSourceUrl, imageArtist: 'Photographer', imageLicense: 'CC BY 4.0' });
    assert.deepEqual((await h.importPhoto({ dataUrl: saved.dataUrl, photo: saved.photo })).photo, saved.photo);
});

test('uploaded and edited photos are normalized, privately stored, and reusable after restart', async t => {
    const h = await harness(t);
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
    const saved = await h.importPhoto({ dataUrl });
    assert.deepEqual(saved, { success: true, photo: { source: 'local', sourceUrl: '', query: '', id: ID }, dataUrl });
    assert.deepEqual(h.sizes, [512]);
    assert.equal(h.downloads.length, 0);
    assert.deepEqual(await fs.readFile(path.join(h.photoDirectory, `${ID}.png`)), PNG);
    const restarted = await harness(t, { getPhotoDirectory: () => h.photoDirectory });
    const profile = { provider: 'local', id: ID, name: 'Author', photoOverride: saved.photo };
    assert.deepEqual(await restarted.invoke(profile), { success: true, photo: { id: ID, sourceUrl: '' } });
    assert.deepEqual(await restarted.invoke(profile, restarted.event, { includeDataUrl: true }), saved);
    assert.equal(restarted.downloads.length, 0);
});

test('photo imports reject invalid data, oversized input, untrusted senders and unsafe provenance before storage', async t => {
    const h = await harness(t);
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
    for (const value of [{}, { dataUrl: 'file:///private/image.png' }, { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
        { dataUrl: dataUrl.replace('image/png', 'image/jpeg') },
        { dataUrl, photo: { id: ID, sourceUrl: 'http://127.0.0.1/private', query: 'Author' } }]) {
        assert.equal((await h.importPhoto(value)).success, false);
    }
    assert.equal((await h.importPhoto({ dataUrl: 'a'.repeat(Math.ceil(16 * 1024 * 1024 / 3) * 4 + 65) })).code, 'AUTHOR_PHOTO_TOO_LARGE');
    assert.equal((await h.importPhoto({ dataUrl }, { ...h.event, senderFrame: {} })).code, 'AUTHOR_PHOTO_UNTRUSTED_SENDER');
    assert.equal(h.sizes.length, 0);
    assert.deepEqual(await fs.readdir(h.directory), []);
});

test('cancelled or failed photo imports clean up partial files and preserve existing photos', async t => {
    const dataUrl = `data:image/png;base64,${PNG.toString('base64')}`;
    const failed = await harness(t, { writePhotoFile: async (file, bytes, options) => {
        await fs.writeFile(file, bytes.subarray(0, 10), options);
        throw new Error('Disk full');
    } });
    await fs.mkdir(failed.photoDirectory);
    await fs.writeFile(path.join(failed.photoDirectory, `${ID}.png`), PNG);
    assert.equal((await failed.importPhoto({ dataUrl })).code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    assert.deepEqual(await fs.readdir(failed.photoDirectory), [`${ID}.png`]);
    assert.deepEqual(await fs.readFile(path.join(failed.photoDirectory, `${ID}.png`)), PNG);
    const cancelled = await harness(t, { resizeImage: async buffer => {
        cancelled.sender.emit('did-start-navigation', {}, 'app://reload', false, true);
        return { buffer, width: 1, height: 1 };
    } });
    assert.equal((await cancelled.importPhoto({ dataUrl })).code, 'AUTHOR_PHOTO_CANCELLED');
    assert.deepEqual(await fs.readdir(cancelled.directory), []);
});
