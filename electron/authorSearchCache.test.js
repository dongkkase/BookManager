import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { AUTHOR_SEARCH_CACHE_TTL_MS, createAuthorSearchCache } from './authorSearchCache.js';
import { clearApiCache, openApiCache, setCachedApiResults } from './database/apiCache.js';
import { createAuthorProfileService } from './authorProfiles.js';
import { registerAuthorPhotoSearchIpc } from './authorPhotoSearch.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'author-search-cache-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const dbPath = path.join(directory, '.api_cache.db');
    let timestamp = Date.UTC(2026, 9, 27);
    const create = () => createAuthorSearchCache({ getDbPath: () => dbPath, now: () => timestamp });
    return { dbPath, create, advance: duration => { timestamp += duration; }, now: () => timestamp };
}

test('저자 검색 결과는 재실행 후 복원하고 조회로 연장하지 않으며 정확히 7일에 만료한다', async t => {
    const h = await fixture(t);
    const value = [{ id: 'aladin:49154', name: '한강' }];
    await h.create().set('author-profiles-v1', 'aladin:한강', value);
    const expiresAt = h.now() + AUTHOR_SEARCH_CACHE_TTL_MS;
    h.advance(AUTHOR_SEARCH_CACHE_TTL_MS - 1);
    assert.deepEqual(await h.create().get('author-profiles-v1', 'aladin:한강'), { value, expiresAt });
    h.advance(1);
    assert.equal(await h.create().get('author-profiles-v1', 'aladin:한강'), null);
    const db = openApiCache(h.dbPath);
    try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM search_cache').get().count, 0); }
    finally { db.close(); }
});

test('프로필·사진·페이지 캐시는 분리하고 빈 검색 결과도 복원한다', async t => {
    const h = await fixture(t);
    const cache = h.create();
    await cache.set('author-profiles-v1', 'all:작가', []);
    await cache.set('naver-photos', '작가:1', { items: [{ title: '사진' }], nextStart: 21 });
    await cache.set('naver-photos', '작가:21', { items: [], nextStart: null });
    assert.deepEqual((await h.create().get('author-profiles-v1', 'all:작가')).value, []);
    assert.equal((await cache.get('naver-photos', '작가:1')).value.nextStart, 21);
    assert.deepEqual((await cache.get('naver-photos', '작가:21')).value.items, []);
    assert.equal(await cache.get('author-profiles-v1', 'kyobo:작가'), null);
});

test('만료된 저자 검색만 정리하고 기존 API 캐시 삭제에 함께 포함된다', async t => {
    const h = await fixture(t);
    await h.create().set('author-profiles-v1', 'old', []);
    const db = openApiCache(h.dbPath);
    try { setCachedApiResults(db, 'unrelated-provider', 'old', [{ id: 1 }], new Date(h.now())); }
    finally { db.close(); }
    h.advance(AUTHOR_SEARCH_CACHE_TTL_MS);
    await h.create().set('naver-photos', 'fresh', []);
    const reopened = openApiCache(h.dbPath);
    try {
        assert.deepEqual(reopened.prepare('SELECT api FROM search_cache ORDER BY api').all().map(row => row.api),
            ['author-search:naver-photos', 'unrelated-provider']);
    } finally { reopened.close(); }
    assert.equal(clearApiCache(h.dbPath).deletedRows, 2);
    assert.equal(await h.create().get('naver-photos', 'fresh'), null);
});

test('손상된 캐시와 저장소 읽기·쓰기 실패는 검색용 캐시 미스로 처리한다', async t => {
    const h = await fixture(t);
    const cache = h.create();
    await cache.set('author-profiles-v1', 'author', []);
    const db = openApiCache(h.dbPath);
    try { db.prepare('UPDATE search_cache SET results = ?').run(JSON.stringify([{ version: 99, value: [] }])); }
    finally { db.close(); }
    assert.equal(await cache.get('author-profiles-v1', 'author'), null);
    const unavailable = createAuthorSearchCache({ getDbPath: () => { throw new Error('Unavailable directory'); } });
    assert.equal(await unavailable.get('naver-photos', 'author'), null);
    await assert.doesNotReject(unavailable.set('naver-photos', 'author', []));
    await fs.writeFile(h.dbPath, 'not a sqlite database');
    assert.equal(await cache.get('author-profiles-v1', 'author'), null);
    await assert.doesNotReject(cache.set('author-profiles-v1', 'author', []));
});

test('캐시 항목 크기·네임스페이스를 제한하고 키 원문을 저장하지 않는다', async t => {
    const h = await fixture(t);
    const cache = h.create();
    await cache.set('naver-photos', 'private-key-scope', [{ title: '사진' }]);
    await cache.set('naver-photos', 'oversized', 'x'.repeat(1024 * 1024));
    await cache.set('../invalid', 'author', []);
    const cycle = {}; cycle.self = cycle;
    await assert.doesNotReject(cache.set('naver-photos', 'cycle', cycle));
    assert.equal(await cache.get('naver-photos', 'oversized'), null);
    const db = openApiCache(h.dbPath);
    try {
        const rows = db.prepare('SELECT query FROM search_cache').all();
        assert.equal(rows.length, 1);
        assert.match(rows[0].query, /^[a-f0-9]{64}$/);
        assert.ok(!JSON.stringify(rows).includes('private-key-scope'));
    } finally { db.close(); }
});

test('실제 DB의 프로필·사진 검색 결과는 서비스 재생성 후 재사용하고 7일 뒤 다시 조회한다', async t => {
    const h = await fixture(t);
    let profileRequests = 0;
    let photoRequests = 0;
    const profiles = () => createAuthorProfileService({
        resultCache: h.create(), now: h.now, sleep: async () => {},
        requestJson: async () => { profileRequests += 1; return { docs: [{ key: 'OL1A', name: 'Author' }] }; },
    });
    const photos = () => {
        const handlers = new Map();
        const sender = new EventEmitter();
        sender.isDestroyed = () => false;
        sender.mainFrame = {};
        const api = registerAuthorPhotoSearchIpc({
            ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
            getMainWindow: () => ({ isDestroyed: () => false, webContents: sender }),
            getConfig: () => ({ api_keys: { naver_client_id: 'fixture-id', naver_client_secret: 'fixture-secret' } }),
            getPhotoDirectory: () => path.join(path.dirname(h.dbPath), 'author-photos'),
            resultCache: h.create(), now: h.now,
            requestJson: async () => {
                photoRequests += 1;
                return { items: [{ title: 'Author', link: 'https://images.example.com/photo.jpg', thumbnail: 'https://images.example.com/thumb.jpg' }], total: 1 };
            },
        });
        t.after(() => api.dispose());
        return () => handlers.get('authors:searchPhotos')({ sender, senderFrame: sender.mainFrame }, { query: 'Author' });
    };
    const original = await profiles().search('Author', { source: 'openlibrary' });
    const firstPhoto = await photos()();
    assert.equal(firstPhoto.success, true);
    h.advance(AUTHOR_SEARCH_CACHE_TTL_MS - 1);
    assert.deepEqual(await profiles().search('Author', { source: 'openlibrary' }), original);
    const reopenedPhotos = photos();
    const cachedPhoto = await reopenedPhotos();
    assert.equal(cachedPhoto.success, true);
    assert.notEqual(cachedPhoto.results[0].id, firstPhoto.results[0].id);
    assert.equal(profileRequests, 1);
    assert.equal(photoRequests, 1);
    const db = openApiCache(h.dbPath);
    try {
        const stored = JSON.stringify(db.prepare('SELECT api, query, results FROM search_cache').all());
        assert.ok(!stored.includes('fixture-secret') && !stored.includes(firstPhoto.results[0].id));
    } finally { db.close(); }
    h.advance(1);
    await profiles().search('Author', { source: 'openlibrary' });
    assert.equal((await reopenedPhotos()).success, true);
    assert.equal(profileRequests, 2);
    assert.equal(photoRequests, 2);
});
