import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { isComicVineImageUrl } from './comicVineSearch.js';
import { detectImageMimeType } from './imageMagic.js';

const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const coverUrl = 'https://comicvine.gamespot.com/a/uploads/scale_large/1/2/cover.jpg';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');

function sourceFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return (source.slice(start - 6, start) === 'async ' ? 'async ' : '')
        + source.slice(start, source.indexOf('\n}', start) + 2);
}

function imageCacheHarness(response) {
    const calls = [];
    const scope = vm.createContext({
        fs, path, crypto, Buffer, URL, isComicVineImageUrl, detectImageMimeType,
        originalMunpiaCoverUrl: url => url,
        requestBufferGeneric: async url => { calls.push(url); return response; },
    });
    vm.runInContext([
        'fetchImageCacheFileFromUrl', 'apiCoverCacheFileFromProtocolUrl', 'findApiCoverCacheFile',
        'ensureApiCoverCompatibleCacheFile', 'isEpubCoverCompatibleImage', 'normalizeApiCoverImageBuffer',
        'imageMimeTypeFromPath', 'mimeFromUrl', 'imageExtensionFromMime',
    ].map(sourceFunction).join('\n'), scope);
    return { fetch: scope.fetchImageCacheFileFromUrl, calls };
}

test('Comic Vine HTML responses cannot become persistent JPEG cover files', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-vine-image-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const h = imageCacheHarness({ buffer: Buffer.from('<html>Unavailable</html>'), contentType: 'text/html' });
    await assert.rejects(h.fetch(coverUrl, directory), /INVALID_COVER_IMAGE/);
    assert.deepEqual(fs.readdirSync(directory), []);
});

test('invalid old Comic Vine cover cache is replaced with verified image bytes and reused', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-vine-image-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const hash = crypto.createHash('sha1').update(coverUrl).digest('hex');
    const oldPath = path.join(directory, `${hash}.jpg`);
    fs.writeFileSync(oldPath, '<html>Old cached error</html>');
    const h = imageCacheHarness({ buffer: png, contentType: 'image/jpeg' });
    const filePath = await h.fetch(coverUrl, directory);
    assert.equal(filePath, path.join(directory, `${hash}.png`));
    assert.equal(fs.existsSync(oldPath), false);
    assert.deepEqual(fs.readFileSync(filePath), png);
    assert.equal(await h.fetch(coverUrl, directory), filePath);
    assert.deepEqual(h.calls, [coverUrl]);
});

test('result image fallback preserves metadata and updates the URL used when applying a cover', async () => {
    const fallback = coverUrl.replace('scale_large', 'scale_small');
    const calls = [];
    const scope = vm.createContext({
        fetchImageCacheUrlFromUrl: async url => {
            calls.push(url);
            if (url === coverUrl) throw new Error('HTTP 404');
            return 'bookmanager-thumbnail://api-cover/valid.jpg';
        },
    });
    vm.runInContext(['stripTransientApiImageFields', 'stripTransientApiImageFieldsFromResults', 'enrichResultImages']
        .map(sourceFunction).join('\n'), scope);
    const item = { id: '42', coverUrl, CoverUrl: coverUrl, CoverUrls: [coverUrl, fallback], metadata: { Title: 'Sample' } };
    const [result] = await scope.enrichResultImages([item], '/cache');
    assert.deepEqual(calls, [coverUrl, fallback]);
    assert.equal(result.coverUrl, fallback);
    assert.equal(result.CoverUrl, fallback);
    assert.equal(result.coverCacheUrl, 'bookmanager-thumbnail://api-cover/valid.jpg');
    assert.equal(result.metadata, item.metadata);
    assert.equal(item.coverUrl, coverUrl);
});

test('failed cover alternatives are bounded and leave the result usable', async () => {
    const calls = [];
    const scope = vm.createContext({
        fetchImageCacheUrlFromUrl: async url => { calls.push(url); throw new Error('HTTP 404'); },
    });
    vm.runInContext(['stripTransientApiImageFields', 'stripTransientApiImageFieldsFromResults', 'enrichResultImages']
        .map(sourceFunction).join('\n'), scope);
    const [result] = await scope.enrichResultImages([{ coverUrl, CoverUrls: ['second', 'third', 'fourth'], title: 'Sample' }]);
    assert.equal(calls.length, 3);
    assert.equal(result.title, 'Sample');
    assert.equal(result.coverUrl, coverUrl);
    assert.equal(result.coverCacheUrl, '');
});
