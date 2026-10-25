import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { ReadiveService } from './readive/service.js';
import { readingListsRequest } from './readingLists.js';

async function fixture(t) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-dates-')));
    const root = path.join(directory, 'Books');
    const folder = path.join(root, 'Series_%');
    await fs.mkdir(folder, { recursive: true });
    const db = new LibraryDB({ dbPath: path.join(directory, 'library.db') });
    const files = [path.join(root, 'one.txt'), path.join(root, 'unread.txt'), path.join(folder, 'child.txt')];
    for (const file of files) {
        await fs.writeFile(file, 'book');
        const stat = await fs.stat(file);
        await db.upsertFileInfo({ path: file, title: path.basename(file), size: stat.size, mtime: stat.mtimeMs, genre: 'Fantasy' });
    }
    await db.upsertReadingState(files[0], { format: 'text', lastReadAt: '2026-03-01T00:00:00.000Z' });
    await db.upsertReadingState(files[2], { format: 'text', lastReadAt: '2026-03-03T00:00:00.000Z' });
    const local = { address: '192.168.5.10', netmask: '255.255.255.0' };
    const service = new ReadiveService({ directory: path.join(directory, 'state'), interfaces: () => [local],
        getRegisteredLibraries: () => [{ path: root, alias: 'Books' }], getLibraryDb: async () => db });
    service.localInterface = local;
    service.port = 19421;
    service.server = {};
    service.certificateSha256 = 'a'.repeat(64);
    let token;
    const api = async (route, body) => {
        const url = new URL(`/readive/v1${route}`, 'https://readive.invalid');
        return (await service.dispatch({ method: body ? 'POST' : 'GET', pathname: url.pathname, query: url.searchParams,
            body, token, remoteAddress: '192.168.5.20', localAddress: local.address })).json;
    };
    const ticket = JSON.parse((await service.pairing()).ticket);
    token = (await api('/pair', { secret: ticket.secret, deviceId: 'test-phone', deviceName: 'Phone' })).token;
    const libraryId = (await api('/libraries')).libraries.find(item => item.name === 'Books').id;
    t.after(async () => { await db.close(); await fs.rm(directory, { recursive: true, force: true }); });
    return { directory, root, folder, files, db, service, api, libraryId };
}

test('직접 연결은 실제 생성일과 마지막 읽음을 파일·폴더에 제공하며 읽지 않은 파일은 null로 둔다', async t => {
    const { folder, files, db, api, libraryId } = await fixture(t);
    const excluded = path.join(path.dirname(folder), 'Series_AB', 'private.txt');
    await db.upsertReadingState(excluded, { format: 'text', lastReadAt: '2026-04-01T00:00:00.000Z' });
    const result = await api(`/libraries/${libraryId}/entries`);
    for (const [name, file, lastOpenedAt] of [
        ['one.txt', files[0], '2026-03-01T00:00:00.000Z'],
        ['unread.txt', files[1], null], ['Series_%', folder, '2026-03-03T00:00:00.000Z'],
    ]) {
        const entry = result.entries.find(item => item.name === name);
        assert.equal(entry.createdAt, new Date((await fs.stat(file)).birthtimeMs).toISOString());
        assert.equal(entry.lastOpenedAt, lastOpenedAt);
        assert.equal(JSON.stringify(entry).includes(path.dirname(folder)), false);
    }
    db.getConnection().prepare('UPDATE reading_states SET deleted_at = ? WHERE file_path = ?')
        .run('2026-04-02T00:00:00.000Z', db.normalizeFilePath(files[2]));
    assert.equal((await api(`/libraries/${libraryId}/entries`)).entries.find(item => item.name === 'Series_%').lastOpenedAt, null);
});

test('직접 연결 태그 검색과 읽기 목록은 동일한 생성일·마지막읽음 날짜를 보존한다', async t => {
    const { directory, root, files, db, api, libraryId } = await fixture(t);
    const tags = await api(`/libraries/${libraryId}/tag-search`, { path: '', filter: { genres: ['fantasy'], tags: [], match: 'all' } });
    assert.equal(tags.entries.find(entry => entry.name === 'one.txt').lastOpenedAt, '2026-03-01T00:00:00.000Z');
    assert.equal(tags.entries.find(entry => entry.name === 'one.txt').createdAt, new Date((await fs.stat(files[0])).birthtimeMs).toISOString());
    const libraries = (await api('/libraries')).libraries;
    const recent = await api(`/libraries/${libraries.find(item => item.name === '최근 읽음').id}/entries`);
    assert.equal(recent.entries.find(entry => entry.name === 'one.txt').lastOpenedAt, '2026-03-01T00:00:00.000Z');
    const { id } = await readingListsRequest(db, { operation: 'create', name: 'Shelf' });
    const outside = path.join(directory, 'outside.txt');
    await fs.writeFile(outside, 'private');
    await db.upsertReadingState(outside, { format: 'text', lastReadAt: '2026-04-01T00:00:00.000Z' });
    await readingListsRequest(db, { operation: 'add', id, paths: [files[0], files[2], outside] });
    const collectionsId = libraries.find(item => item.name === '컬렉션').id;
    const collection = (await api(`/libraries/${collectionsId}/entries`)).entries[0];
    assert.equal(collection.createdAt, db.getConnection().prepare('SELECT created_at FROM reading_lists WHERE id = ?').get(id).created_at);
    assert.equal(collection.lastOpenedAt, '2026-03-03T00:00:00.000Z');
    const contents = await api(`/libraries/${collectionsId}/entries?path=${collection.relativePath}`);
    assert.equal(contents.entries.find(entry => entry.name === 'one.txt').createdAt, new Date((await fs.stat(files[0])).birthtimeMs).toISOString());
    const rootCollection = await readingListsRequest(db, { operation: 'create', name: 'Whole library' });
    await readingListsRequest(db, { operation: 'add', id: rootCollection.id, paths: [root] });
    const withRoot = (await api(`/libraries/${collectionsId}/entries`)).entries.find(entry => entry.name === 'Whole library');
    assert.equal(withRoot.lastOpenedAt, '2026-03-03T00:00:00.000Z');
    const volumeRoot = path.parse(root).root;
    db.getConnection().prepare('INSERT INTO reading_list_members (list_id, path, added_at, is_directory) VALUES (?, ?, ?, 1)')
        .run(rootCollection.id, volumeRoot, new Date().toISOString());
    const { readCollectionReadingDates } = await import('./servers/shared/catalogDates.js');
    const volumeDates = await readCollectionReadingDates(db, [rootCollection], [volumeRoot]);
    assert.equal(volumeDates.get(rootCollection.id), '2026-04-01T00:00:00.000Z');
});

test('독서 DB가 없는 서버도 생성일을 제공하고 마지막읽음은 null로 유지한다', async t => {
    const { api, service, libraryId } = await fixture(t);
    service.getLibraryDb = async () => null;
    const result = await api(`/libraries/${libraryId}/entries`);
    assert.ok(result.entries.every(entry => Number.isFinite(Date.parse(entry.createdAt)) && entry.lastOpenedAt === null));
});

test('날짜 변경은 읽기 목록의 기존 다음 페이지 커서를 만료시키지 않는다', async () => {
    const { ReadiveReadingCatalog } = await import('./readive/readingCatalog.js');
    const catalog = new ReadiveReadingCatalog({});
    const entries = Array.from({ length: 201 }, (_, index) => ({ id: String(index), name: `book-${index}.txt`,
        relativePath: String(index), kind: 'file', size: 4, format: 'txt', createdAt: null, lastOpenedAt: null }));
    const first = catalog.page(entries, 'library', '', '', 'secret');
    entries[0].lastOpenedAt = '2026-04-01T00:00:00.000Z';
    const next = catalog.page(entries, 'library', '', first.nextCursor, 'secret');
    assert.equal(next.entries[0].id, '200');
});

test('날짜 조회는 500개씩 묶고 잘못된 시각과 취소 이후 응답을 버린다', async () => {
    const { catalogCreatedAt, catalogDate, catalogPathKey, readCatalogReadingDates } = await import('./servers/shared/catalogDates.js');
    for (const birthtimeMs of [undefined, null, 0, -1, Infinity, NaN, 8640000000000001]) assert.equal(catalogCreatedAt({ birthtimeMs }), null);
    assert.equal(catalogDate('bad'), null);
    const paths = Array.from({ length: 1001 }, (_, index) => path.resolve(os.tmpdir(), `book-${index}.txt`));
    const calls = [];
    const library = { listReadingStatesByPaths: async batch => {
        calls.push(batch.length);
        return batch.map((filePath, index) => ({ filePath, lastReadAt: index ? 'bad' : '2026-03-01T09:00:00+09:00' }));
    } };
    const dates = await readCatalogReadingDates(library, paths);
    assert.deepEqual(calls, [500, 500, 1]);
    assert.equal(dates.size, 3);
    assert.equal(dates.get(catalogPathKey(paths[0])), '2026-03-01T00:00:00.000Z');
    const controller = new AbortController();
    let requests = 0;
    await assert.rejects(readCatalogReadingDates({ listReadingStatesByPaths: async () => {
        requests += 1;
        controller.abort();
        return [];
    } }, paths, controller.signal), { code: 'catalog_cancelled' });
    assert.equal(requests, 1);
});
