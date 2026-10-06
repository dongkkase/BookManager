import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { readingListsRequest } from './readingLists.js';
import { ReadiveService } from './readive/service.js';
import { openReaderAsset } from './readive/readers.js';
import { buildOpdsApp } from './servers/opdsServer.js';

async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'shared-reading-')));
    const firstLibrary = path.join(root, 'First');
    const secondLibrary = path.join(root, 'Second');
    const folder = path.join(firstLibrary, 'Series');
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(secondLibrary);
    const first = path.join(firstLibrary, 'one.txt');
    const child = path.join(folder, 'child.txt');
    const second = path.join(secondLibrary, 'two.txt');
    const outside = path.join(root, 'private.txt');
    for (const file of [first, child, second, outside]) await fs.writeFile(file, path.basename(file));
    const dbPath = path.join(root, 'library.db');
    const db = new LibraryDB({ dbPath });
    await fs.mkdir(path.join(root, 'thumbnails'));
    const thumbnail = path.join(root, 'thumbnails', 'one.png');
    await fs.writeFile(thumbnail, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFAAAAAASUVORK5CYII=', 'base64'));
    for (const [index, file] of [first, child, second, outside].entries()) {
        const stat = await fs.stat(file);
        await db.upsertFileInfo({ path: file, title: path.basename(file), size: stat.size, mtime: stat.mtimeMs, thumb_path: file === first ? thumbnail : '' });
        db.getConnection().prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?')
            .run(`2026-01-0${index + 1}`, `2026-02-0${4 - index}`, file);
        await db.upsertReadingState(file, { format: 'text', lastReadAt: `2026-03-0${index + 1}T00:00:00.000Z` });
    }
    const request = value => readingListsRequest(db, value);
    const { id: collectionId } = await request({ operation: 'create', name: 'Weekend & Books' });
    for (const id of ['want-to-read', collectionId]) await request({ operation: 'add', id, paths: [folder, first, second, outside] });
    const configured = [{ path: firstLibrary, alias: 'First library' }, { path: secondLibrary, alias: 'Second library' }];
    t.after(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, db, dbPath, firstLibrary, secondLibrary, folder, first, child, second, outside, thumbnail, collectionId, configured, request };
}

async function readiveFixture(t) {
    const data = await fixture(t);
    const local = { address: '192.168.5.10', netmask: '255.255.255.0' };
    const service = new ReadiveService({
        directory: path.join(data.root, 'state'), interfaces: () => [local],
        getRegisteredLibraries: () => data.configured, getLibraryDb: async () => data.db,
    });
    service.localInterface = local;
    service.port = 19421;
    service.server = {};
    service.certificateSha256 = 'a'.repeat(64);
    let token;
    const dispatch = (route, { method = 'GET', body, auth = token } = {}) => {
        const url = new URL(`/readive/v1${route}`, 'https://readive.invalid');
        return service.dispatch({ method, pathname: url.pathname, query: url.searchParams, body, token: auth, remoteAddress: '192.168.5.20', localAddress: local.address });
    };
    const api = async (...args) => (await dispatch(...args)).json;
    const ticket = JSON.parse((await service.pairing()).ticket);
    token = (await api('/pair', { method: 'POST', body: { secret: ticket.secret, deviceId: 'test-phone', deviceName: 'Phone' } })).token;
    t.after(async () => {
        service.readers.clear();
        service.scanController?.abort();
        await Promise.all([...service.preparations.values()].map(item => item.promise));
    });
    return { ...data, service, api, dispatch };
}

test('Readive exposes five reading lists and browses collection folders with existing catalog routes', async t => {
    const { service, api, dispatch, request, collectionId, configured, firstLibrary, first } = await readiveFixture(t);
    const { libraries } = await api('/libraries');
    assert.deepEqual(libraries.map(item => item.name), ['First library', 'Second library', '최근 읽음', '최근 추가됨', '최근 업데이트 됨', '읽고 싶은 책', '컬렉션']);
    const byName = name => libraries.find(item => item.name === name).id;
    const entries = (name, relativePath = '') => api(`/libraries/${byName(name)}/entries?path=${encodeURIComponent(relativePath)}`);
    assert.deepEqual((await entries('최근 읽음')).entries.map(item => item.name), ['two.txt', 'child.txt', 'one.txt']);
    assert.deepEqual((await entries('최근 추가됨')).entries.map(item => item.name), ['two.txt', 'child.txt', 'one.txt']);
    assert.deepEqual((await entries('최근 업데이트 됨')).entries.map(item => item.name), ['one.txt', 'child.txt', 'two.txt']);
    const wishlist = await entries('읽고 싶은 책');
    assert.deepEqual(wishlist.entries.map(item => item.name).sort(), ['Series', 'one.txt', 'two.txt']);
    assert.equal(JSON.stringify(wishlist).includes(firstLibrary), false);
    const collection = (await entries('컬렉션')).entries[0];
    assert.equal(collection.name, 'Weekend & Books');
    const contents = await entries('컬렉션', collection.relativePath);
    const directory = contents.entries.find(item => item.kind === 'directory');
    const nested = await entries('컬렉션', directory.relativePath);
    assert.equal(nested.entries[0].name, 'child.txt');
    assert.equal(nested.entries[0].relativePath, `${directory.relativePath}/child.txt`);
    const file = contents.entries.find(item => item.name === 'one.txt');
    const route = `/libraries/${byName('컬렉션')}`;
    const preview = await api(`${route}/preview`, { method: 'POST', body: { path: file.relativePath } });
    assert.equal(preview.metadata.Title, 'one.txt');
    assert.ok(preview.thumbnail.base64);
    assert.equal(preview.path, file.relativePath);
    const collectionPreview = await api(`${route}/preview`, { method: 'POST', body: { path: collection.relativePath } });
    assert.equal(collectionPreview.thumbnail.sha256, preview.thumbnail.sha256);
    assert.equal(collectionPreview.metadata, null);
    const reader = await api(`${route}/read`, { method: 'POST', body: { path: nested.entries[0].relativePath } });
    const response = await dispatch(`/readers/${reader.id}/content`);
    const handle = await openReaderAsset(response.asset);
    try { assert.equal(await handle.readFile('utf8'), 'child.txt'); } finally { await handle.close(); }
    for (const invalid of ['../private.txt', `${directory.relativePath}/../one.txt`, `${directory.relativePath}/%2fprivate.txt`, 'missing']) {
        await assert.rejects(entries('컬렉션', invalid), /invalid_library_path|library_unavailable|source_changed/);
    }
    await assert.rejects(api(`${route}/entries`, { auth: '' }), /unauthorized/);
    await request({ operation: 'remove', id: collectionId, paths: [first] });
    await assert.rejects(api(`${route}/read`, { method: 'POST', body: { path: file.relativePath } }), /invalid_library_path/);
    configured.splice(0, 1);
    await assert.rejects(dispatch(`/readers/${reader.id}/content`), /library_unavailable/);
    assert.deepEqual((await entries('읽고 싶은 책')).entries.map(item => item.name), ['two.txt']);
    assert.equal(service.readingCatalog.has(byName('컬렉션')), true);
});

test('Readive transfers a collection across libraries and revokes persisted jobs when a source library is removed', async t => {
    const { api, service, configured } = await readiveFixture(t);
    const library = (await api('/libraries')).libraries.find(item => item.name === '컬렉션');
    const collection = (await api(`/libraries/${library.id}/entries`)).entries[0];
    const route = `/libraries/${library.id}`;
    const scan = await api(`${route}/prepare`, { method: 'POST', body: { paths: [collection.relativePath], manifestVersion: 2 } });
    await service.preparations.get(scan.scanId).promise;
    const ready = await api(`${route}/preparations/${scan.scanId}`);
    assert.equal(ready.state, 'ready', JSON.stringify(ready));
    assert.deepEqual(ready.manifest.files.map(file => file.name).sort(), ['child.txt', 'one.txt', 'two.txt']);
    assert.equal(ready.manifest.directories.length, 1);
    const jobRoute = `/jobs/${ready.job.id}`;
    await api(`${jobRoute}/accept`, { method: 'POST', body: { manifestId: ready.manifest.id, largeConfirmed: true } });
    const file = ready.manifest.files[0];
    await api(`${jobRoute}/resolve/${file.id}`, { method: 'POST', body: {} });
    await Promise.all([...service.fileHashRequests.values()].map(item => item.promise));
    assert.equal((await api(`${jobRoute}/resolve/${file.id}`, { method: 'POST', body: {} })).state, 'ready');
    service.store.state = null;
    await service.store.load();
    assert.equal((await api(jobRoute)).job.id, ready.job.id);
    configured.splice(0, 1);
    await assert.rejects(api(jobRoute), /library_unavailable/);
    await assert.rejects(api(`${route}/preparations/${scan.scanId}`), /library_unavailable/);
});

test('Readive reading-list pages reject tampered or stale cursors and omit missing and symlinked members', async t => {
    const { api, service, request, firstLibrary, db, outside, first } = await readiveFixture(t);
    const paths = Array.from({ length: 205 }, (_, index) => path.join(firstLibrary, `book-${index}.txt`));
    await Promise.all(paths.map(file => fs.writeFile(file, 'book')));
    await request({ operation: 'add', id: 'want-to-read', paths });
    const link = path.join(firstLibrary, 'link.txt');
    await fs.symlink(outside, link);
    db.getConnection().prepare('INSERT INTO reading_list_members (list_id, path, added_at, is_directory) VALUES (?, ?, ?, 0)').run('want-to-read', link, '2026-01-01');
    await fs.unlink(first);
    const library = (await api('/libraries')).libraries.find(item => item.name === '읽고 싶은 책');
    const route = `/libraries/${library.id}/entries`;
    const page = await api(route);
    assert.equal(page.entries.length, 200);
    const last = await api(`${route}?cursor=${encodeURIComponent(page.nextCursor)}`);
    assert.equal(last.entries.length, 7);
    assert.ok(![...page.entries, ...last.entries].some(item => ['link.txt', 'one.txt', 'private.txt'].includes(item.name)));
    await assert.rejects(api(`${route}?cursor=${encodeURIComponent(page.nextCursor + 'a')}`), /invalid_cursor/);
    const otherId = service.readingCatalog.descriptors().find(item => item.listId === 'recent-added').id;
    await assert.rejects(api(`/libraries/${otherId}/entries?cursor=${encodeURIComponent(page.nextCursor)}`), /invalid_cursor/);
    await request({ operation: 'remove', id: 'want-to-read', paths: [paths[0]] });
    await assert.rejects(api(`${route}?cursor=${encodeURIComponent(page.nextCursor)}`), /catalog_changed/);
});

test('OPDS serves all reading feeds, collection folders, covers and downloads within shared libraries', async t => {
    const { dbPath, configured, collectionId, first, outside, folder, thumbnail, request } = await fixture(t);
    const app = buildOpdsApp({ library_entries: configured }, () => {}, { dbPath, thumbnailDir: path.dirname(thumbnail) });
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const read = async route => {
        const response = await fetch(base + route);
        assert.equal(response.status, 200, route);
        return response.text();
    };
    const root = await read('/opds');
    for (const title of ['First library', 'Second library', '최근 읽음', '최근 추가됨', '최근 업데이트 됨', '읽고 싶은 책', '컬렉션']) assert.ok(root.includes(title), title);
    for (const id of ['recent-reading', 'recent-added', 'recent-updated', 'want-to-read']) {
        const xml = await read(`/opds?list=${id}`);
        assert.ok(xml.includes('one.txt') && xml.includes('two.txt'));
        assert.ok(!xml.includes('private.txt'));
        assert.match(xml, /rel="up"[^>]*href="\/opds"/);
    }
    const recent = await read('/opds?list=recent-reading');
    assert.ok(recent.indexOf('two.txt') < recent.indexOf('one.txt'));
    const collections = await read('/opds?list=collections');
    assert.ok(collections.includes('Weekend &amp; Books'));
    const collectionRoute = `/opds?list=collections&collection=${collectionId}`;
    const contents = await read(collectionRoute);
    assert.ok(contents.includes('Series') && contents.includes('one.txt'));
    assert.ok(!contents.includes('child.txt') && !contents.includes('private.txt'));
    assert.ok((await read(`/opds?dir=${encodeURIComponent(folder)}`)).includes('child.txt'));
    assert.equal(await read(`/download?file=${encodeURIComponent(first)}`), 'one.txt');
    assert.equal((await fetch(`${base}/download?file=${encodeURIComponent(outside)}`)).status, 404);
    const cover = await fetch(`${base}/reading-thumbnail?collection=${collectionId}`);
    assert.equal(cover.status, 200);
    assert.deepEqual(Buffer.from(await cover.arrayBuffer()), await fs.readFile(thumbnail));
    for (const route of ['/opds?list=unknown', '/opds?list=want-to-read&collection=unknown', '/opds?list=collections&collection=missing', '/opds?list=want-to-read&list=collections']) {
        assert.equal((await fetch(base + route)).status, 404, route);
    }
    await request({ operation: 'remove', id: collectionId, paths: [first] });
    assert.ok(!(await read(collectionRoute)).includes('one.txt'));
    await request({ operation: 'delete', id: collectionId });
    assert.equal((await fetch(base + collectionRoute)).status, 404);
    assert.equal((await fetch(`${base}/reading-thumbnail?collection=${collectionId}`)).status, 404);
});
