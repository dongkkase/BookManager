import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { registerAuthorPhotoSearchIpc, requestNaverImages } from './authorPhotoSearch.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const keys = { id: 'test-client-id', secret: 'test-client-secret' };
const items = (count = 20) => Array.from({ length: count }, (_, index) => ({
    title: `<b>작가</b> &amp; ${index}`,
    link: `https://images.example.com/photo-${index}.jpg`,
    thumbnail: `https://thumb.example.com/photo-${index}.jpg`,
    sizewidth: '800',
    sizeheight: '1200',
}));

function getFixture(entry, calls = []) {
    return (url, options, callback) => {
        const request = new EventEmitter();
        request.destroy = () => { request.destroyed = true; };
        calls.push({ url: url.href, options, request });
        if (entry.error) queueMicrotask(() => request.emit('error', new Error(entry.error)));
        else if (!entry.hang) queueMicrotask(() => {
            const response = new PassThrough();
            response.statusCode = entry.status || 200;
            response.headers = entry.headers || {};
            callback(response);
            for (const chunk of entry.chunks || [JSON.stringify(entry.data || { items: [] })]) {
                if (!response.destroyed) response.write(chunk);
            }
            if (!response.destroyed) response.end();
        });
        return request;
    };
}

async function harness(t, overrides = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-author-photo-test-'));
    const handlers = new Map();
    const sender = new EventEmitter();
    sender.isDestroyed = () => false;
    sender.mainFrame = {};
    const event = { sender, senderFrame: sender.mainFrame };
    const window = { isDestroyed: () => false, webContents: sender };
    const searches = [];
    const downloads = [];
    const sizes = [];
    const api = registerAuthorPhotoSearchIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getMainWindow: () => window,
        getConfig: () => ({ api_keys: { naver_client_id: keys.id, naver_client_secret: keys.secret } }),
        getPhotoDirectory: async () => path.join(directory, 'author-photos'),
        tempRoot: directory,
        requestJson: async request => { searches.push(request); return { items: items(), total: 55 }; },
        resizeImage: async (buffer, size) => { sizes.push(size); return { buffer, width: 1, height: 1, mimeType: 'image/png' }; },
        downloadImage: async (url, options) => {
            downloads.push({ url, options });
            const cleanupDirectory = await fs.mkdtemp(path.join(directory, 'download-'));
            return { ...await options.normalizeImage(PNG), sourceUrl: url, cleanupDirectory };
        },
        ...overrides,
    });
    t.after(async () => { api.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
    const invoke = (name, args, from = event) => handlers.get(`authors:${name}`)(from, args);
    return { invoke, sender, window, event, searches, downloads, sizes, directory, api };
}

test('Naver credentials are sent only to the fixed API HUB endpoint using its authentication headers', async () => {
    for (const api of [undefined, 'hub', 'legacy', 'https://attacker.example', 'constructor', '', null]) {
        const calls = [];
        const data = await requestNaverImages({ query: '홍길동 작가', start: 21, keys, api }, { get: getFixture({ data: { items: [] } }, calls) });
        assert.deepEqual(data, { items: [] });
        assert.equal(calls.length, 1);
        const url = new URL(calls[0].url);
        assert.equal(`${url.origin}${url.pathname}`, 'https://naverapihub.apigw.ntruss.com/search/v1/image');
        assert.equal(url.searchParams.get('query'), '홍길동 작가');
        assert.equal(url.searchParams.get('start'), '21');
        assert.equal(url.searchParams.get('display'), '20');
        assert.equal(url.searchParams.get('sort'), 'sim');
        assert.ok(!url.href.includes(keys.id));
        assert.ok(!url.href.includes(keys.secret));
        assert.deepEqual(calls[0].options.headers, {
            Accept: 'application/json',
            'Accept-Encoding': 'identity',
            'User-Agent': 'BookManager author photo search',
            'X-NCP-APIGW-API-KEY-ID': keys.id,
            'X-NCP-APIGW-API-KEY': keys.secret,
        });
    }
});

test('API HUB rejects redirects, authentication, permission and quota errors without fallback or secret disclosure', async () => {
    for (const [status, code] of [[302, 'AUTHOR_PHOTO_REQUEST_FAILED'], [401, 'AUTHOR_PHOTO_INVALID_KEYS'], [403, 'AUTHOR_PHOTO_INVALID_KEYS'], [429, 'AUTHOR_PHOTO_RATE_LIMIT'], [500, 'AUTHOR_PHOTO_REQUEST_FAILED']]) {
        const calls = [];
        await assert.rejects(requestNaverImages({ query: 'author', start: 1, keys }, {
            get: getFixture({ status, headers: { location: 'https://attacker.example/credentials' }, data: { error: { errorCode: String(status), message: `${keys.id} ${keys.secret}` } } }, calls),
        }), error => error.code === code && !error.message.includes(keys.id) && !error.message.includes(keys.secret));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].request.destroyed, true);
    }
});

test('API response bodies are size bounded and malformed responses are rejected', async () => {
    for (const entry of [
        { headers: { 'content-length': String(1024 * 1024 + 1) } },
        { chunks: [Buffer.alloc(1024 * 1024), Buffer.from('x')] },
        { chunks: ['not json'] },
        { error: `unexpected ${keys.secret}` },
    ]) {
        await assert.rejects(requestNaverImages({ query: 'author', start: 1, keys }, { get: getFixture(entry) }), error => (
            error.code === 'AUTHOR_PHOTO_REQUEST_FAILED' && !error.message.includes(keys.secret)
        ));
    }
});

test('API requests time out and can be aborted without following redirects', async () => {
    await assert.rejects(requestNaverImages({ query: 'author', start: 1, keys }, { get: getFixture({ hang: true }), timeoutMs: 5 }), { code: 'AUTHOR_PHOTO_TIMEOUT' });
    const controller = new AbortController();
    const request = requestNaverImages({ query: 'author', start: 1, keys, signal: controller.signal }, { get: getFixture({ hang: true }) });
    controller.abort();
    await assert.rejects(request, { code: 'AUTHOR_PHOTO_CANCELLED' });
});

test('all author photo IPC methods reject other windows and subframes', async t => {
    const h = await harness(t);
    for (const name of ['searchPhotos', 'previewPhoto', 'selectPhoto', 'releasePhotos']) {
        for (const event of [{ sender: {} }, { ...h.event, senderFrame: {} }, { sender: h.sender }]) {
            assert.equal((await h.invoke(name, { query: 'Author' }, event)).code, 'AUTHOR_PHOTO_UNTRUSTED_SENDER');
        }
    }
    assert.equal(h.searches.length, 0);
    assert.equal(h.downloads.length, 0);
});

test('missing keys and malformed keys or search parameters fail before a network request', async t => {
    let config = {};
    const h = await harness(t, { getConfig: () => config });
    assert.equal((await h.invoke('searchPhotos', { query: 'Author' })).code, 'AUTHOR_PHOTO_MISSING_KEYS');
    config = { api_keys: { naver_client_id: keys.id, naver_client_secret: 'secret\r\nInjected: header' } };
    assert.equal((await h.invoke('searchPhotos', { query: 'Author' })).code, 'AUTHOR_PHOTO_INVALID_KEYS');
    for (const request of [{ query: '' }, { query: '<b></b>' }, { query: 'a'.repeat(201) }, { query: 'a\u0000' }, { query: 'a', start: 0 }, { query: 'a', start: 1.5 }, { query: 'a', start: 1001 }]) {
        assert.equal((await h.invoke('searchPhotos', request)).code, 'AUTHOR_PHOTO_INVALID_QUERY');
    }
    assert.equal(h.searches.length, 0);
});

test('Naver credentials accept the settings limit and reject longer values', async t => {
    let secret = 'x'.repeat(1024);
    const h = await harness(t, { getConfig: () => ({ api_keys: { naver_client_id: keys.id, naver_client_secret: secret } }) });
    assert.equal((await h.invoke('searchPhotos', { query: 'Author' })).success, true);
    assert.equal(h.searches[0].keys.secret.length, 1024);
    secret += 'x';
    assert.equal((await h.invoke('searchPhotos', { query: 'Author' })).code, 'AUTHOR_PHOTO_INVALID_KEYS');
    assert.equal(h.searches.length, 1);
});

test('IPC reloads credentials but ignores retired service settings and renderer overrides while preserving pagination', async t => {
    let config = { naver_photo_api: 'hub', api_keys: { naver_client_id: keys.id, naver_client_secret: keys.secret } };
    const calls = [];
    const h = await harness(t, {
        getConfig: () => config,
        requestJson: request => requestNaverImages(request, { get: getFixture({ data: { items: items(), total: 55 } }, calls) }),
    });
    const first = await h.invoke('searchPhotos', { query: '작가 이름', api: 'legacy', keys: { id: 'renderer-id', secret: 'renderer-secret' } });
    assert.equal(first.success, true);
    assert.equal(first.results.length, 20);
    assert.equal(first.nextStart, 21);
    const second = await h.invoke('searchPhotos', { query: '작가 이름', start: first.nextStart });
    assert.equal(second.nextStart, 41);
    assert.equal((await h.invoke('previewPhoto', first.results[0].id)).success, true);
    assert.equal(new URL(calls[1].url).searchParams.get('start'), '21');
    assert.equal(new URL(calls[0].url).hostname, 'naverapihub.apigw.ntruss.com');
    assert.equal(calls[0].options.headers['X-NCP-APIGW-API-KEY-ID'], keys.id);
    assert.equal(calls[0].options.headers['X-NCP-APIGW-API-KEY'], keys.secret);
    assert.equal(calls[0].options.headers['X-Naver-Client-Id'], undefined);
    config = { naver_photo_api: 'legacy', api_keys: { naver_client_id: 'updated-id', naver_client_secret: 'updated-secret' } };
    assert.equal((await h.invoke('searchPhotos', { query: '작가 이름', api: 'https://attacker.example', keys: { id: 'renderer-id', secret: 'renderer-secret' } })).success, true);
    assert.equal(new URL(calls[2].url).hostname, 'naverapihub.apigw.ntruss.com');
    assert.equal(calls[2].options.headers['X-NCP-APIGW-API-KEY-ID'], 'updated-id');
    assert.equal(calls[2].options.headers['X-NCP-APIGW-API-KEY'], 'updated-secret');
    assert.equal(calls[2].options.headers['X-Naver-Client-Id'], undefined);
    assert.equal(calls[2].options.headers['X-Naver-Client-Secret'], undefined);
    assert.equal((await h.invoke('previewPhoto', first.results[0].id)).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
    assert.equal(calls.length, 3);
});

test('IPC passes credentials saved before service selection existed without an API selector', async t => {
    const h = await harness(t);
    assert.equal((await h.invoke('searchPhotos', { query: 'Author', api: 'hub' })).success, true);
    assert.equal(Object.hasOwn(h.searches[0], 'api'), false);
    assert.deepEqual(h.searches[0].keys, keys);
});

test('search results contain opaque IDs and clean display data, never credentials or arbitrary URLs', async t => {
    const h = await harness(t);
    const result = await h.invoke('searchPhotos', { query: '  작가  ' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 20);
    assert.deepEqual(Object.keys(result.results[0]), ['id', 'title', 'width', 'height']);
    assert.match(result.results[0].id, /^[\da-f-]{36}$/);
    assert.equal(result.results[0].title, '작가 & 0');
    assert.equal(result.results[0].width, 800);
    assert.equal(result.results[0].height, 1200);
    assert.equal(result.hasNext, true);
    assert.equal(result.nextStart, 21);
    assert.equal(h.searches[0].query, '작가');
    assert.ok(!JSON.stringify(result).includes(keys.secret));
    assert.equal((await h.invoke('previewPhoto', 'https://localhost/private')).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
    assert.equal((await h.invoke('selectPhoto', { candidateId: 'missing', url: 'https://attacker.example/photo' })).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
});

test('unsafe returned image addresses are excluded and short pages stop pagination', async t => {
    const h = await harness(t, { requestJson: async () => ({ total: 100, items: [
        { ...items(1)[0], link: 'http://127.0.0.1/private' },
        { ...items(1)[0], thumbnail: 'file:///secret' },
        { ...items(1)[0], link: 'https://user:secret@images.example.com/image' },
        items(1)[0],
    ] }) });
    const result = await h.invoke('searchPhotos', { query: 'Author' });
    assert.equal(result.results.length, 1);
    assert.equal(result.hasNext, false);
    assert.equal(result.nextStart, null);
});

test('candidate source URLs satisfy the stored photo contract before and after URL normalization', async t => {
    const invalidUrls = [
        `https://images.example.com/${'a'.repeat(2048)}`,
        `https://images.example.com/${'한'.repeat(240)}`,
        'https://[2606:4700:4700::1111]/photo.jpg',
        'https://images.example.lan/photo.jpg',
        'https://images.example.com/pho\nto.jpg',
        'https://images.example.com/\\photo.jpg',
    ];
    const h = await harness(t, { requestJson: async () => ({ total: 20, items: [
        ...invalidUrls.map(link => ({ ...items(1)[0], link })),
        { ...items(1)[0], thumbnail: `https://thumb.example.com/${'a'.repeat(3000)}` },
    ] }) });
    const result = await h.invoke('searchPhotos', { query: 'Author' });
    assert.equal(result.results.length, 1);
    assert.equal((await h.invoke('previewPhoto', result.results[0].id)).success, true);
});

test('a redirected image with an unsupported source URL is rejected before persistence', async t => {
    for (const sourceUrl of [`https://images.example.com/${'a'.repeat(2048)}`, 'https://[2606:4700:4700::1111]/photo.jpg']) {
        const h = await harness(t, { downloadImage: async (_url, options) => ({ ...await options.normalizeImage(PNG), sourceUrl }) });
        const id = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
        assert.equal((await h.invoke('selectPhoto', { candidateId: id })).code, 'AUTHOR_PHOTO_IMAGE_FAILED');
        assert.deepEqual(await fs.readdir(h.directory), []);
    }
});

test('pagination stops before the API maximum start position is exceeded', async t => {
    const h = await harness(t, { requestJson: async () => ({ items: items(), total: 50000 }) });
    const penultimate = await h.invoke('searchPhotos', { query: 'Author', start: 961 });
    assert.equal(penultimate.hasNext, true);
    assert.equal(penultimate.nextStart, 981);
    const last = await h.invoke('searchPhotos', { query: 'Author', start: penultimate.nextStart });
    assert.equal(last.hasNext, false);
    assert.equal(last.nextStart, null);
});

test('pagination preserves candidates while a new search, release or expiry invalidates them', async t => {
    let clock = 1;
    const h = await harness(t, { now: () => clock });
    let result = await h.invoke('searchPhotos', { query: 'Author' });
    const first = result.results[0].id;
    await h.invoke('searchPhotos', { query: 'Author', start: 21 });
    assert.equal((await h.invoke('previewPhoto', first)).success, true);
    await h.invoke('searchPhotos', { query: 'Other author' });
    assert.equal((await h.invoke('previewPhoto', first)).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
    result = await h.invoke('searchPhotos', { query: 'Author' });
    clock += 10 * 60 * 1000;
    assert.equal((await h.invoke('selectPhoto', { candidateId: result.results[0].id })).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
    result = await h.invoke('searchPhotos', { query: 'Author' });
    assert.deepEqual(await h.invoke('releasePhotos'), { success: true });
    assert.equal((await h.invoke('previewPhoto', result.results[0].id)).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
});

test('candidate storage is bounded across pagination', async t => {
    const h = await harness(t);
    const first = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    let latest;
    for (let page = 1; page <= 10; page += 1) latest = await h.invoke('searchPhotos', { query: 'Author', start: 1 + page * 20 });
    assert.equal((await h.invoke('previewPhoto', first)).code, 'AUTHOR_PHOTO_INVALID_CANDIDATE');
    assert.equal((await h.invoke('previewPhoto', latest.results[0].id)).success, true);
});

test('previews are normalized to small PNG data URLs, deduplicated and temporary downloads cleaned', async t => {
    const h = await harness(t);
    const id = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    const [first, duplicate] = await Promise.all([h.invoke('previewPhoto', id), h.invoke('previewPhoto', id)]);
    assert.deepEqual(first, duplicate);
    assert.equal(first.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.deepEqual(await h.invoke('previewPhoto', id), first);
    assert.equal(h.downloads.length, 1);
    assert.deepEqual(h.sizes, [160]);
    assert.equal(h.downloads[0].options.maxBytes, 8 * 1024 * 1024);
    assert.equal(h.downloads[0].options.headers, undefined);
    assert.deepEqual(await fs.readdir(h.directory), []);
});

test('unavailable thumbnail URLs fall back to the original image with the same preview bounds', async t => {
    const requests = [];
    const h = await harness(t, { downloadImage: async (url, options) => {
        requests.push(url);
        if (url.includes('thumb.')) throw new Error('Thumbnail no longer available');
        return { ...await options.normalizeImage(PNG), sourceUrl: url };
    } });
    const id = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    assert.equal((await h.invoke('previewPhoto', id)).success, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(h.sizes, [160]);
});

test('selected images persist as a hashed PNG, independent from released search results', async t => {
    const h = await harness(t);
    const id = (await h.invoke('searchPhotos', { query: '작가 사진' })).results[0].id;
    const result = await h.invoke('selectPhoto', { candidateId: id });
    assert.deepEqual(result, { success: true, photo: {
        id: createHash('sha256').update(PNG).digest('hex'), sourceUrl: 'https://images.example.com/photo-0.jpg', query: '작가 사진',
    } });
    assert.deepEqual(h.sizes, [512]);
    const saved = path.join(h.directory, 'author-photos', `${result.photo.id}.png`);
    assert.deepEqual(await fs.readFile(saved), PNG);
    assert.equal((await h.invoke('selectPhoto', { candidateId: id })).success, true);
    await h.invoke('releasePhotos');
    assert.deepEqual(await fs.readFile(saved), PNG);
    assert.deepEqual(await fs.readdir(h.directory), ['author-photos']);
});

test('partial writes are cleaned and a retry replaces a previously corrupt hashed photo atomically', async t => {
    let writes = 0;
    const h = await harness(t, { writePhotoFile: async (filePath, buffer, options) => {
        writes += 1;
        if (writes === 1) {
            await fs.writeFile(filePath, buffer.subarray(0, 10), options);
            throw Object.assign(new Error('Disk is full'), { code: 'ENOSPC' });
        }
        await fs.writeFile(filePath, buffer, options);
    } });
    const candidateId = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    assert.equal((await h.invoke('selectPhoto', { candidateId })).code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    const directory = path.join(h.directory, 'author-photos');
    assert.deepEqual(await fs.readdir(directory), []);
    const filename = `${createHash('sha256').update(PNG).digest('hex')}.png`;
    await fs.writeFile(path.join(directory, filename), PNG.subarray(0, 10));
    assert.equal((await h.invoke('selectPhoto', { candidateId })).success, true);
    assert.deepEqual(await fs.readFile(path.join(directory, filename)), PNG);
    assert.deepEqual(await fs.readdir(directory), [filename]);
});

test('cancelling after a temporary photo is written removes it before publication', async t => {
    const h = await harness(t, { writePhotoFile: async (filePath, buffer, options) => {
        await fs.writeFile(filePath, buffer, options);
        await h.invoke('releasePhotos');
    } });
    const candidateId = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    assert.equal((await h.invoke('selectPhoto', { candidateId })).code, 'AUTHOR_PHOTO_CANCELLED');
    assert.deepEqual(await fs.readdir(path.join(h.directory, 'author-photos')), []);
});

test('preview downloads run at most three at once and navigation cancels running and queued work', async t => {
    let active = 0;
    let maximum = 0;
    let requested = 0;
    const h = await harness(t, { downloadImage: async (_url, { signal }) => {
        active += 1;
        requested += 1;
        maximum = Math.max(maximum, active);
        try { await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
        finally { active -= 1; }
    } });
    const results = (await h.invoke('searchPhotos', { query: 'Author' })).results;
    const pending = results.map(item => h.invoke('previewPhoto', item.id));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requested, 3);
    assert.equal(maximum, 3);
    h.sender.emit('did-start-navigation', {}, 'file:///app/index.html', false, true);
    const finished = await Promise.all(pending);
    assert.ok(finished.every(result => result.code === 'AUTHOR_PHOTO_CANCELLED'));
    assert.equal(active, 0);
    assert.equal(requested, 3);
});

test('new queries cancel stale API responses before their candidates can be returned', async t => {
    const h = await harness(t, { requestJson: async ({ query, signal }) => {
        if (query === 'old') await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        return { items: items(1), total: 1 };
    } });
    const stale = h.invoke('searchPhotos', { query: 'old' });
    await new Promise(resolve => setImmediate(resolve));
    const fresh = await h.invoke('searchPhotos', { query: 'new' });
    assert.equal(fresh.success, true);
    assert.equal((await stale).code, 'AUTHOR_PHOTO_CANCELLED');
});

test('image download deadlines cancel work without persisting an incomplete selection', async t => {
    const h = await harness(t, { timeoutMs: 5, downloadImage: async (_url, { signal }) => {
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const id = (await h.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    assert.equal((await h.invoke('selectPhoto', { candidateId: id })).code, 'AUTHOR_PHOTO_TIMEOUT');
    assert.deepEqual(await fs.readdir(h.directory), []);
});

test('image normalization and persistence failures do not expose raw errors or leave temporary files', async t => {
    const invalid = await harness(t, { resizeImage: async () => ({ buffer: Buffer.from('not an image'), width: 1, height: 1 }) });
    const invalidId = (await invalid.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    assert.equal((await invalid.invoke('selectPhoto', { candidateId: invalidId })).code, 'AUTHOR_PHOTO_IMAGE_FAILED');
    assert.deepEqual(await fs.readdir(invalid.directory), []);
    const unavailable = await harness(t, { getPhotoDirectory: () => { throw new Error(`private directory ${keys.secret}`); } });
    const unavailableId = (await unavailable.invoke('searchPhotos', { query: 'Author' })).results[0].id;
    const result = await unavailable.invoke('selectPhoto', { candidateId: unavailableId });
    assert.equal(result.code, 'AUTHOR_PHOTO_STORAGE_FAILED');
    assert.ok(!result.error.includes(keys.secret));
    assert.deepEqual(await fs.readdir(unavailable.directory), []);
});
