import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { ReadiveService } from './readive/service.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(t, { rootName = 'Books' } = {}) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-preview-')));
    const root = path.join(directory, rootName);
    const data = path.join(directory, 'Data');
    await fs.mkdir(root);
    await fs.mkdir(path.join(data, 'thumbnails'), { recursive: true });
    const database = new LibraryDB({ dbPath: path.join(data, 'library.db') });
    const configured = [{ path: root, alias: 'Books' }];
    const service = new ReadiveService({ directory: path.join(directory, 'state'), interfaces: () => [local],
        getRegisteredLibraries: () => configured, getLibraryDb: async () => database });
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    t.after(async () => { await service.stop(); await database.close(); await fs.rm(directory, { recursive: true, force: true }); });
    const ticket = JSON.parse((await service.pairing()).ticket);
    const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
    const paired = await service.dispatch({ ...remote, method: 'POST', pathname: '/readive/v1/pair',
        body: { secret: ticket.secret, deviceId: 'preview-phone', deviceName: 'Phone' } });
    const token = paired.json.token;
    const libraryId = (await service.status()).libraries[0].id;
    const api = async (relativePath, options = {}) => (await service.dispatch({ ...remote, token, method: 'POST',
        pathname: `/readive/v1/libraries/${libraryId}/preview`, body: { path: relativePath }, ...options })).json;
    const add = async (relativePath, overrides = {}) => {
        const sourcePath = path.join(root, relativePath);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, 'book contents');
        const stat = await fs.stat(sourcePath);
        const thumbnail = path.join(data, 'thumbnails', crypto.randomUUID() + '.png');
        await fs.writeFile(thumbnail, png);
        const record = { path: sourcePath, size: stat.size, mtime: stat.mtimeMs / 1000,
            title: 'Stored title', writer: 'Writer', page_count: 42, thumb_path: thumbnail, ...overrides };
        await database.upsertFileInfo(record);
        return { sourcePath, thumbnail, record };
    };
    return { directory, root, data, database, configured, service, api, add, token, libraryId };
}

test('Readive preview returns indexed metadata and a bounded existing thumbnail without creating downloads', async t => {
    const value = await fixture(t);
    const { sourcePath } = await value.add('book.txt', { summary: 'Description', isbn: '12345', resolution: '1000x1440' });
    const result = await value.api('book.txt');
    assert.equal(result.path, 'book.txt');
    assert.match(result.sourceVersion, /^[a-f0-9]{64}$/);
    assert.equal(result.metadata.Title, 'Stored title');
    assert.equal(result.metadata.Writer, 'Writer');
    assert.equal(Number(result.metadata.PageCount), 42);
    assert.equal(result.metadata.ISBN, '12345');
    assert.equal(result.metadata.Resolution, '1000x1440');
    assert.deepEqual(result.thumbnail, { mimeType: 'image/png', width: 1, height: 1, byteLength: png.length,
        sha256: crypto.createHash('sha256').update(png).digest('hex'), base64: png.toString('base64') });
    assert.equal(JSON.stringify(result).includes(sourcePath), false);
    assert.equal(JSON.stringify(result).includes(value.data), false);
    assert.equal(value.service.store.state.jobs.length, 0);
    assert.equal(value.service.preparations.size, 0);
    assert.equal(value.service.readers.sessions.size, 0);
    const original = await fs.readFile(sourcePath, 'utf8');
    assert.equal(original, 'book contents');
});

test('folder and library-root previews choose an indexed descendant cover without claiming its metadata', async t => {
    const value = await fixture(t);
    await value.add('Series/Nested/book.epub');
    for (const relativePath of ['Series', '']) {
        const result = await value.api(relativePath);
        assert.equal(result.path, relativePath);
        assert.equal(result.metadata, null);
        assert.equal(result.thumbnail?.base64, png.toString('base64'));
    }
    await fs.mkdir(path.join(value.root, 'Empty'));
    assert.equal((await value.api('Empty')).thumbnail, null);
});

test('macOS folder previews compare NFC shared paths with NFD database paths consistently', { skip: process.platform !== 'darwin' }, async t => {
    for (const rootName of ['Books', '한글 서재']) {
        await t.test(rootName === 'Books' ? 'NFC folder under an ASCII root' : 'NFC library root and folder', async t => {
            const value = await fixture(t, { rootName });
            const relativePath = '시리즈/하위/책.txt';
            const item = await value.add(relativePath);
            const record = await value.database.getFileInfo(item.sourcePath);
            assert.equal(record.path, item.sourcePath.normalize('NFD'));
            assert.notEqual(record.path, item.sourcePath);
            assert.ok((await value.api(relativePath)).thumbnail, 'The same indexed file already has a usable cover.');
            for (const folderPath of ['시리즈', '시리즈/하위', '']) {
                const preview = await value.api(folderPath);
                assert.equal(preview.thumbnail?.base64, png.toString('base64'));
                assert.equal(preview.metadata, null);
                assert.equal(preview.path, folderPath, 'The response retains the requested path form.');
            }
        });
    }
});

test('preview denies unpaired, traversal, symlink, unsupported files and removed libraries', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt');
    await assert.rejects(value.api('one.txt', { token: '' }), /unauthorized/);
    await assert.rejects(value.api('one.txt', { remoteAddress: '192.168.6.20' }), /lan_only/);
    await fs.symlink(item.sourcePath, path.join(value.root, 'link.txt'));
    for (const relativePath of ['../one.txt', '/one.txt', 'link.txt', '.git/config', 'one.txt/../one.txt']) {
        await assert.rejects(value.api(relativePath), /invalid_library_path|source_changed/);
    }
    await assert.rejects(value.api('one.txt', { body: { path: 'one.txt', file: '/private' } }), /invalid_library_path/);
    value.configured.splice(0);
    await assert.rejects(value.api('one.txt'), /library_unavailable/);
});

test('preview ignores missing, outside-owned-cache and symlinked thumbnails', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt');
    const outside = path.join(value.directory, 'private.png');
    await fs.writeFile(outside, png);
    const link = path.join(value.data, 'thumbnails', 'link.png');
    await fs.symlink(outside, link);
    for (const thumbnail of [outside, link, path.join(value.data, 'thumbnails', 'missing.png')]) {
        await value.database.upsertFileInfo({ ...item.record, thumb_path: thumbnail });
        const result = await value.api('one.txt');
        assert.equal(result.thumbnail, null);
        assert.equal(result.metadata.Title, 'Stored title');
    }
});

test('preview limits thumbnail bytes, dimensions and image types', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt');
    const largeDimensions = Buffer.from(png);
    largeDimensions.writeUInt32BE(2049, 16);
    for (const bytes of [Buffer.alloc(512 * 1024 + 1), largeDimensions, Buffer.from('<svg width="20" height="20"/>'), Buffer.from('not an image')]) {
        await fs.writeFile(item.thumbnail, bytes);
        assert.equal((await value.api('one.txt')).thumbnail, null);
    }
});

test('preview reuses relocated cache filenames like the PC thumbnail protocol without reading the previous cache', async t => {
    const value = await fixture(t);
    const item = await value.add('Series/book.epub');
    for (const cacheName of ['thumbnails', 'text-thumbnails']) {
        const filename = path.basename(item.thumbnail);
        const current = path.join(value.data, cacheName, filename);
        await fs.mkdir(path.dirname(current), { recursive: true });
        await fs.writeFile(current, png);
        const previous = path.join(value.directory, 'previous-install', cacheName, filename);
        await value.database.upsertFileInfo({ ...item.record, thumb_path: previous });
        assert.equal((await value.api('Series/book.epub')).thumbnail?.base64, png.toString('base64'));
        assert.equal((await value.api('Series')).thumbnail?.base64, png.toString('base64'));
        assert.equal((await value.api('')).thumbnail?.base64, png.toString('base64'));

        await fs.mkdir(path.dirname(previous), { recursive: true });
        await fs.writeFile(previous, png);
        await fs.rm(current);
        assert.equal((await value.api('Series/book.epub')).thumbnail, null, 'An existing previous path is not authorized for reading.');
        await fs.symlink(previous, current);
        assert.equal((await value.api('Series/book.epub')).thumbnail, null, 'A current cache symlink cannot escape to the previous cache.');
        await fs.rm(current);
    }
});

test('legacy thumbnails below 2048 pixels remain available and metadata keeps canonical ComicInfo keys', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt', { publish_date: '2025-07-09', genre: 'Fiction', language: 'ko', notes: 'Notes' });
    const legacy = Buffer.from(png);
    legacy.writeUInt32BE(1000, 16);
    legacy.writeUInt32BE(1440, 20);
    await fs.writeFile(item.thumbnail, legacy);
    const result = await value.api('one.txt');
    assert.equal(result.thumbnail.width, 1000);
    assert.equal(result.thumbnail.height, 1440);
    assert.equal(result.metadata.Year, '2025');
    assert.equal(result.metadata.Month, '07');
    assert.equal(result.metadata.Day, '09');
    assert.equal(result.metadata.LanguageISO, 'ko');
    assert.equal(result.metadata.Genre, 'Fiction');
    assert.equal(result.metadata.Notes, 'Notes');
    assert.equal('thumb_path' in result.metadata, false);
});

test('folder preview candidate queries escape wildcard names, stay bounded and never traverse symlinks', async t => {
    const value = await fixture(t);
    await fs.mkdir(path.join(value.root, 'Exact_%'));
    await value.add('Exact_OTHER/outside.txt');
    assert.equal((await value.api('Exact_%')).thumbnail, null);
    const linked = await value.add('Outside/book.txt');
    await fs.symlink(path.dirname(linked.sourcePath), path.join(value.root, 'Exact_%', 'Linked'));
    await value.database.upsertFileInfo({ ...linked.record, path: path.join(value.root, 'Exact_%', 'Linked', 'book.txt') });
    assert.equal((await value.api('Exact_%')).thumbnail, null);
    const item = await value.add('Bounded/valid.txt');
    for (let index = 0; index < 32; index += 1) {
        await value.database.upsertFileInfo({ ...item.record, path: path.join(value.root, 'Bounded', `0missing-${String(index).padStart(2, '0')}.txt`) });
    }
    assert.equal((await value.api('Bounded')).thumbnail, null, 'Only the first 32 indexed cover candidates are inspected.');
});

test('preview limits concurrent work independently of catalog paging and releases slots after cancellation', async t => {
    const value = await fixture(t);
    await value.add('one.txt');
    const read = value.database.getFileInfo.bind(value.database);
    const releases = [];
    value.database.getFileInfo = input => new Promise(resolve => releases.push(() => resolve(read(input))));
    const requests = Array.from({ length: 4 }, () => value.api('one.txt'));
    while (releases.length < 4) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(value.api('one.txt'), /catalog_busy/);
    assert.equal(value.service.catalogCache.activeRequests.size, 0);
    releases.forEach(release => release());
    await Promise.all(requests);
    assert.equal(value.service.previewRequests.active.size, 0);
    value.database.getFileInfo = read;
    assert.ok((await value.api('one.txt')).thumbnail);
});

test('preview bounds indexed metadata and never reads source content or accepts a thumbnail directory symlink', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt', { summary: 'description'.repeat(20000), title: 'name'.repeat(5000) });
    const result = await value.api('one.txt');
    assert.ok(Buffer.byteLength(JSON.stringify(result.metadata)) <= 64 * 1024);
    assert.ok(result.metadata.Summary.length <= 8192);
    assert.ok(result.metadata.Title.length <= 2048);
    const moved = path.join(value.directory, 'MovedThumbnails');
    await fs.rename(path.dirname(item.thumbnail), moved);
    await fs.symlink(moved, path.dirname(item.thumbnail));
    assert.equal((await value.api('one.txt')).thumbnail, null);
});

test('preview accepts bounded JPEG, WebP, GIF and BMP cached files by signature', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt');
    const images = {
        'image/webp': 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=',
        'image/gif': 'R0lGODdhAQABAIEAAP///wAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==',
        'image/bmp': 'Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAADEDgAAxA4AAAAAAAAAAAAA////AA==',
        'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
    };
    for (const [mimeType, base64] of Object.entries(images)) {
        await fs.writeFile(item.thumbnail, Buffer.from(base64, 'base64'));
        const thumbnail = (await value.api('one.txt')).thumbnail;
        assert.equal(thumbnail?.mimeType, mimeType);
        assert.equal(thumbnail.width, 1);
        assert.equal(thumbnail.height, 1);
    }
});

test('HTTP preview uses exact JSON lengths and no-store, rejects queries and requires the paired bearer token', async t => {
    const value = await fixture(t);
    await value.add('one.txt');
    const request = async ({ query = '', token = value.token, body = { path: 'one.txt' } } = {}) => {
        const data = Buffer.from(JSON.stringify(body));
        const req = Readable.from([data]);
        req.method = 'POST';
        req.url = `/readive/v1/libraries/${value.libraryId}/preview${query}`;
        req.headers = { 'content-length': data.length, authorization: `Bearer ${token}` };
        req.socket = { remoteAddress: '192.168.5.20', localAddress: local.address };
        const chunks = [];
        const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
        res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true; };
        await value.service.handleRequest(req, res);
        const bytes = Buffer.concat(chunks);
        return { status: res.status, headers: res.headers, bytes, json: JSON.parse(bytes) };
    };
    const preview = await request();
    assert.equal(preview.status, 200);
    assert.equal(preview.headers['Content-Length'], preview.bytes.length);
    assert.equal(preview.headers['Cache-Control'], 'no-store');
    assert.equal(preview.json.metadata.Title, 'Stored title');
    assert.equal((await request({ token: '' })).status, 401);
    assert.equal((await request({ query: '?path=one.txt' })).json.error, 'query_not_allowed');
    assert.equal((await request({ body: { path: 'one.txt', absolutePath: '/private' } })).json.error, 'invalid_library_path');
});

test('preview version changes when indexed metadata or thumbnail content changes', async t => {
    const value = await fixture(t);
    const item = await value.add('one.txt');
    const first = await value.api('one.txt');
    await value.database.upsertFileInfo({ ...item.record, title: 'New title' });
    const second = await value.api('one.txt');
    assert.notEqual(second.sourceVersion, first.sourceVersion);
    assert.equal(second.metadata.Title, 'New title');
    await fs.writeFile(item.thumbnail, Buffer.from('invalid'));
    const third = await value.api('one.txt');
    assert.notEqual(third.sourceVersion, second.sourceVersion);
    assert.equal(third.thumbnail, null);
});

test('unindexed and stale indexed source files do not expose another version metadata or thumbnail', async t => {
    const value = await fixture(t);
    await fs.writeFile(path.join(value.root, 'unindexed.txt'), 'unindexed');
    const unindexed = await value.api('unindexed.txt');
    assert.equal(unindexed.metadata, null);
    assert.equal(unindexed.thumbnail, null);
    const item = await value.add('one.txt');
    await fs.writeFile(item.sourcePath, 'different source content');
    const changed = await value.api('one.txt');
    assert.equal(changed.metadata, null);
    assert.equal(changed.thumbnail, null);
});

test('preview rechecks device, library, source and cancellation after delayed DB reads', async t => {
    for (const mutation of ['revoke', 'remove', 'change', 'abort', 'stop']) {
        const value = await fixture(t);
        const item = await value.add('one.txt');
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const read = value.database.getFileInfo.bind(value.database);
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        value.database.getFileInfo = async input => { entered(); await gate; return read(input); };
        const controller = new AbortController();
        const pending = value.api('one.txt', { signal: controller.signal });
        await reading;
        if (mutation === 'revoke') await value.service.revoke({ deviceId: 'preview-phone' });
        if (mutation === 'remove') value.configured.splice(0);
        if (mutation === 'change') await fs.writeFile(item.sourcePath, 'changed while loading');
        if (mutation === 'abort') controller.abort();
        if (mutation === 'stop') await value.service.stop();
        release();
        await assert.rejects(pending, /unauthorized|library_unavailable|source_changed|catalog_cancelled|lan_only/);
    }
});
