import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { ReadiveService } from './readive/service.js';
import { buildOpdsApp } from './servers/opdsServer.js';
import { readTagCatalog } from './servers/shared/tagCatalog.js';

const local = { name: 'en0', address: '192.168.5.10', netmask: '255.255.255.0' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(t, { rootName = 'Books' } = {}) {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'readive-tags-')));
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
        pathname: `/readive/v1/libraries/${libraryId}/tag-search`, body: { path: relativePath, filter: null }, ...options })).json;
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


const both = { genres: ['fantasy'], tags: ['magic'], match: 'all' };

test('직접 연결 태그 검색은 공유 폴더 하위의 DB 메타데이터만 조회하고 원본과 작업을 보존한다', async t => {
    const value = await fixture(t);
    const one = await value.add('Series/Nested/One.cbz', { genre: 'Fantasy;Adventure', tags: 'Magic, Friendship', ext: '.cbz' });
    await value.add('Series/Two.pdf', { genre: 'Fantasy', tags: 'Science', book_type: 'pdf', ext: '.pdf' });
    await value.add('Elsewhere/Three.epub', { genre: 'Secret', tags: 'Hidden', ext: '.epub' });
    const outside = path.join(value.directory, 'Outside.cbz');
    await fs.writeFile(outside, 'private');
    await value.database.upsertFileInfo({ path: outside, genre: 'Private', tags: 'Private', ext: '.cbz' });
    const facets = await value.api('Series');
    assert.deepEqual(facets.genres.map(item => item.id), ['adventure', 'fantasy']);
    assert.deepEqual(facets.tags.map(item => item.id), ['friendship', 'magic', 'science']);
    assert.deepEqual(facets.entries, []);
    const query = filter => value.api('Series', { body: { path: 'Series', filter } });
    assert.deepEqual((await query(both)).entries.map(item => item.relativePath), ['Series/Nested/One.cbz']);
    assert.equal((await query({ ...both, match: 'any' })).entries.length, 2);
    assert.equal((await query({ ...both, tags: ['missing'] })).entries.length, 0);
    assert.equal(JSON.stringify(await query(both)).includes(value.root), false);
    assert.equal(await fs.readFile(one.sourcePath, 'utf8'), 'book contents');
    assert.equal(value.service.store.state.jobs.length, 0);
    assert.equal(value.service.preparations.size, 0);
    assert.equal(value.service.readers.sessions.size, 0);
});

test('직접 연결 태그 검색은 미인증·공유 해제·경로 탈출·잘못된 필터를 거절한다', async t => {
    const value = await fixture(t);
    await value.add('One.cbz', { genre: 'Fantasy', tags: 'Magic' });
    for (const options of [
        { token: 'wrong' }, { body: { path: '../', filter: both } },
        { body: { path: '', filter: { ...both, match: 'not' } } },
        { body: { path: '', filter: { ...both, tags: Array(51).fill('magic') } } },
        { body: { path: '', filter: both, root: value.directory } },
    ]) await assert.rejects(value.api('', options));
    value.configured.length = 0;
    await assert.rejects(value.api(''));
});

test('선택지는 저장된 메타데이터를 표시하되 검색 결과는 사라진 파일과 심볼릭 링크를 제외한다', async t => {
    const value = await fixture(t);
    const stale = await value.add('Stale.cbz', { genre: 'Stale' });
    await fs.unlink(stale.sourcePath);
    const linked = await value.add('Link.cbz', { genre: 'Private' });
    await fs.unlink(linked.sourcePath);
    const outside = path.join(value.directory, 'Outside.cbz');
    await fs.writeFile(outside, 'private');
    await fs.symlink(outside, linked.sourcePath);
    assert.deepEqual((await value.api('')).genres.map(item => item.id), ['private', 'stale']);
    assert.deepEqual((await value.api('', { body: { path: '', filter: { genres: ['private', 'stale'], tags: [], match: 'any' } } })).entries, []);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readTagCatalog(value.database, [value.root], null, controller.signal), { code: 'catalog_cancelled' });
});

test('한글·와일드카드 폴더는 인접 폴더와 섞이지 않고 NFC/NFD 경로를 찾는다', async t => {
    const value = await fixture(t, { rootName: '한글 서재_%' });
    await value.add('시리즈_%/책.cbz', { genre: '판타지', tags: '마법' });
    await value.add('시리즈AB/숨김.cbz', { genre: '숨김' });
    const result = await value.api('시리즈_%', { body: { path: '시리즈_%', filter: { genres: ['판타지'], tags: [], match: 'all' } } });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].relativePath.normalize('NFC'), '시리즈_%/책.cbz');
    assert.equal(result.genres.length, 1);
});

test('OPDS 기능 링크와 인증 외부 앱에 사용할 태그 조회는 현재 공유 경로를 유지한다', async t => {
    const value = await fixture(t);
    await value.add('Series/Nested/One.cbz', { title: 'Tagged One', genre: 'Fantasy', tags: 'Magic', ext: '.cbz' });
    await value.add('Other/Two.epub', { title: 'Other Two', genre: 'Fantasy', tags: 'Magic', ext: '.epub' });
    const app = buildOpdsApp({ dup_check_folders: [value.root] }, () => {}, { dbPath: path.join(value.data, 'library.db') });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const dir = encodeURIComponent(path.join(value.root, 'Series'));
    const xml = await (await fetch(`${base}/opds?dir=${dir}`)).text();
    assert.match(xml, /urn:readive:tag-filter/);
    t.mock.method(LibraryDB.prototype, 'createTables', () => { throw new Error('태그 조회가 DB 초기화를 반복하면 안 된다'); });
    const query = (suffix = '', filter = both) => fetch(`${base}/opds/tags?dir=${dir}${suffix}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter }),
    });
    const response = await query();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.feed, /Tagged One/);
    assert.doesNotMatch(result.feed, /Other Two/);
    assert.match(result.feed, /http:\/\/opds-spec.org\/acquisition/);
    assert.equal((await query('&root=private')).status, 400);
    assert.equal((await query('', { ...both, tags: ['\n'] })).status, 400);
    assert.equal((await fetch(`${base}/opds/tags?dir=${encodeURIComponent(value.directory)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: both }),
    })).status, 404);
});


test('대량 태그 선택지는 파일마다 stat하지 않고 검색 결과만 크기를 읽는다', async t => {
    const value = await fixture(t);
    for (let index = 0; index < 120; index += 1) {
        await value.add(`Series/Book${index}.cbz`, { genre: 'Fantasy', tags: index === 0 ? 'Unique' : 'Common' });
    }
    let inspections = 0;
    const lstat = fs.lstat;
    const stat = fs.stat;
    t.mock.method(fs, 'lstat', async (...args) => { if (String(args[0]).endsWith('.cbz')) inspections += 1; return lstat(...args); });
    t.mock.method(fs, 'stat', async (...args) => { if (String(args[0]).endsWith('.cbz')) inspections += 1; return stat(...args); });
    const facets = await value.api('Series');
    assert.equal(facets.genres[0].count, 120);
    assert.equal(inspections, 0, '선택지 조회는 책 파일마다 stat하지 않는다');
    inspections = 0;
    const result = await value.api('Series', { body: { path: 'Series', filter: { genres: [], tags: ['unique'], match: 'all' } } });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].size, Buffer.byteLength('book contents'));
    assert.equal(result.genres[0].count, 120);
    assert.equal(inspections, 1, '검색에 일치한 책의 실제 크기만 확인한다');
});

test('태그 없는 10만 개 이상의 DB 항목이 장르·태그 조회를 막지 않는다', async t => {
    const value = await fixture(t);
    await value.add('Tagged.cbz', { genre: 'Fantasy', tags: 'Magic' });
    const db = value.database.getConnection();
    const insert = db.prepare('INSERT INTO files (path, genre, tags) VALUES (?, ?, ?)');
    db.transaction(() => {
        for (let index = 0; index < 100001; index += 1) {
            insert.run(path.join(value.root, `Untagged${index}.cbz`), index % 2 ? null : '', null);
        }
    })();
    const result = await value.api('');
    assert.deepEqual(result.genres, [{ id: 'fantasy', label: 'Fantasy', count: 1 }]);
    assert.deepEqual(result.tags, [{ id: 'magic', label: 'Magic', count: 1 }]);
});


test('태그 검색 결과는 심볼릭 링크 부모와 사라진 폴더를 제외하고 진행 중 취소를 전파한다', async t => {
    const value = await fixture(t);
    const outside = path.join(value.directory, 'Outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'Private.cbz'), 'private');
    await fs.symlink(outside, path.join(value.root, 'Linked'));
    await value.database.upsertFileInfo({ path: path.join(value.root, 'Linked/Private.cbz'), genre: 'Private' });
    await value.database.upsertFileInfo({ path: path.join(value.root, 'Missing/Book.cbz'), genre: 'Stale' });
    await value.add('Visible/One.cbz', { genre: 'Fantasy' });
    const filter = { genres: ['fantasy', 'private', 'stale'], tags: [], match: 'any' };
    assert.deepEqual((await value.api('', { body: { path: '', filter } })).entries.map(item => item.relativePath), ['Visible/One.cbz']);
    const controller = new AbortController();
    const lstat = fs.lstat;
    t.mock.method(fs, 'lstat', async (...args) => {
        const result = await lstat(...args);
        if (String(args[0]).endsWith('One.cbz')) controller.abort();
        return result;
    });
    await assert.rejects(readTagCatalog(value.database, [value.root], filter, controller.signal), { code: 'catalog_cancelled' });
});


test('태그 선택지는 하위 저장소를 읽지 않고 조건 검색은 일치한 책의 경로만 확인한다', async t => {
    const value = await fixture(t);
    const one = await value.add('Selected/One.cbz', { genre: 'Fantasy', tags: 'Unique' });
    for (let index = 0; index < 40; index += 1) {
        await value.add(`Other${index}/Book.cbz`, { genre: 'Fantasy', tags: 'Common' });
    }
    const reads = [];
    for (const method of ['lstat', 'stat', 'readdir']) {
        const original = fs[method];
        t.mock.method(fs, method, async (...args) => {
            reads.push({ method, path: String(args[0]) });
            return original(...args);
        });
    }
    const facets = await readTagCatalog(value.database, [value.root]);
    assert.equal(facets.genres[0].count, 41);
    assert.equal(reads.filter(item => item.method === 'readdir' || item.path.startsWith(value.root + path.sep)).length, 0,
        '선택지 표시에 하위 디스크 탐색을 기다리지 않는다');
    reads.length = 0;
    const result = await readTagCatalog(value.database, [value.root], { genres: [], tags: ['unique'], match: 'all' });
    assert.deepEqual(result.matches.map(item => item.path), [one.sourcePath]);
    assert.ok(reads.every(item => !item.path.startsWith(value.root + path.sep)
        || [one.sourcePath, path.dirname(one.sourcePath)].includes(item.path)), '일치하지 않는 책과 폴더는 검사하지 않는다');
    assert.equal(reads.filter(item => item.method === 'readdir').length, 0);
    reads.length = 0;
    assert.equal((await readTagCatalog(value.database, [value.root], { genres: [], tags: ['missing'], match: 'all' })).matches.length, 0);
    assert.equal(reads.filter(item => item.path.startsWith(value.root + path.sep)).length, 0);
    await value.database.upsertFileInfo({ ...one.record, tags: 'Updated' });
    const refreshed = await readTagCatalog(value.database, [value.root]);
    assert.equal(refreshed.tags.some(item => item.id === 'unique'), false);
    assert.equal(refreshed.tags.some(item => item.id === 'updated'), true);
});


test('추가 메타데이터만 있는 책도 검색하고 네 작가 역할을 합쳐 책별 한 번만 집계한다', async t => {
    const value = await fixture(t);
    await value.add('Series/One.cbz', { writer: 'Alex', penciller: 'Alex; Bea', inker: 'Chris', colorist: 'Dana',
        publisher: 'Press', characters: 'Hero', publish_date: '2024-06-10' });
    await value.add('Series/Two.epub', { writer: 'Bea', publisher: 'Other Press', publish_date: '2023' });
    await value.add('Other/Hidden.cbz', { writer: 'Hidden', publisher: 'Private', characters: 'Secret', publish_date: '2001' });
    const facets = await value.api('Series');
    assert.deepEqual(facets.authors.map(item => [item.id, item.count]), [['alex', 1], ['bea', 2], ['chris', 1], ['dana', 1]]);
    assert.deepEqual(facets.years.map(item => item.id), ['2023', '2024']);
    assert.deepEqual(facets.characters.map(item => item.id), ['hero']);
    const search = filter => value.api('Series', { body: { path: 'Series', filter: { genres: [], tags: [], match: 'all', ...filter } } });
    for (const [field, id] of [['publishers', 'press'], ['authors', 'chris'], ['authors', 'dana'], ['characters', 'hero'], ['years', '2024']]) {
        assert.deepEqual((await search({ [field]: [id] })).entries.map(item => item.name), ['One.cbz']);
    }
    assert.deepEqual((await search({ authors: ['alex', 'bea', 'chris', 'dana'], publishers: ['press'], characters: ['hero'], years: ['2024'] })).entries.map(item => item.name), ['One.cbz']);
    assert.deepEqual((await search({ authors: ['dana'], years: ['2023'] })).entries, []);
    assert.deepEqual((await search({ authors: ['dana'], years: ['2023'], match: 'any' })).entries.map(item => item.name), ['One.cbz', 'Two.epub']);
    for (const field of ['publishers', 'authors', 'characters', 'years']) {
        await assert.rejects(search({ [field]: Array(51).fill('2024') }), { code: 'invalid_tag_filter' });
        await assert.rejects(search({ [field]: null }), { code: 'invalid_tag_filter' });
    }
    await assert.rejects(search({ years: ['2024,2023'] }), { code: 'invalid_tag_filter' });
});

test('OPDS는 추가 범주 선택지를 반환하고 작가·출판사·등장인물·연도로 같은 책을 검색한다', async t => {
    const value = await fixture(t);
    await value.add('Series/One.cbz', { title: 'Extended Metadata', writer: '', colorist: 'Color Artist',
        publisher: 'Press', characters: 'Hero', publish_date: '2024-01-01', ext: '.cbz' });
    await value.add('Other/Hidden.cbz', { title: 'Hidden Book', writer: 'Hidden', ext: '.cbz' });
    const app = buildOpdsApp({ dup_check_folders: [value.root] }, () => {}, { dbPath: path.join(value.data, 'library.db') });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const url = `http://127.0.0.1:${server.address().port}/opds/tags?dir=${encodeURIComponent(path.join(value.root, 'Series'))}`;
    const query = async filter => {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter }) });
        assert.equal(response.status, 200);
        return response.json();
    };
    const facets = await query(null);
    assert.deepEqual(facets.authors, [{ id: 'color artist', label: 'Color Artist', count: 1 }]);
    assert.deepEqual(facets.publishers.map(item => item.id), ['press']);
    assert.deepEqual(facets.characters.map(item => item.id), ['hero']);
    assert.deepEqual(facets.years.map(item => item.id), ['2024']);
    const result = await query({ genres: [], tags: [], authors: ['color artist'], publishers: ['press'], characters: ['hero'], years: ['2024'], match: 'all' });
    assert.match(result.feed, /Extended Metadata/);
    assert.doesNotMatch(result.feed, /Hidden Book/);
});
