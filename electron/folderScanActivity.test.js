import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { LibraryDB } from './database/library_db.js';
import { readingListsRequest } from './readingLists.js';
import { scanFolder } from './tasks/folderScanTask.js';

const DAY_MS = 86400000;

async function fixture(t) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bookmanager-scan-activity-'));
    const folder = path.join(root, 'books');
    await fs.promises.mkdir(folder);
    const db = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    const now = Math.floor(Date.now() / 1000) * 1000;
    const old = now - 90 * DAY_MS;
    const recent = now - 3600000;
    const birthtimes = new Map();
    const originalStat = fs.promises.stat;
    t.mock.method(fs.promises, 'stat', async (filePath, ...args) => {
        const stats = await originalStat(filePath, ...args);
        const birthtime = birthtimes.get(filePath);
        if (birthtime !== undefined) {
            Object.defineProperties(stats, {
                birthtimeMs: { value: birthtime, configurable: true },
                birthtime: { value: new Date(birthtime), configurable: true },
            });
        }
        return stats;
    });
    t.after(async () => {
        await db.close();
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    async function writeBook(filePath, title, modifiedAt) {
        await replaceZipEntry(filePath, 'ComicInfo.xml', `<ComicInfo><Title>${title}</Title><Series>Scan activity</Series><Writer>Writer</Writer></ComicInfo>`);
        await fs.promises.utimes(filePath, modifiedAt / 1000, modifiedAt / 1000);
    }

    return {
        db, now, old, recent,
        async book(name, { born = old, modified = old } = {}) {
            const filePath = path.join(folder, `${name}.cbz`);
            await fs.promises.writeFile(filePath, '');
            await writeBook(filePath, name, modified);
            birthtimes.set(filePath, born);
            return filePath;
        },
        writeBook,
        scan: options => scanFolder(folder, {
            libraryDb: db,
            skipCoverExtraction: true,
            suppressEvents: true,
            ...options,
        }),
        activity: filePath => db.getConnection().prepare('SELECT * FROM reading_file_activity WHERE path = ?').get(filePath),
        request: request => readingListsRequest(db, request, [folder]),
    };
}

async function listPaths(value, id) {
    return (await value.request({ operation: 'list', id })).rows.map(row => row.path);
}

test('오늘 처음 스캔한 오래된 파일은 제외하고 파일 생성·수정 날짜에 맞는 최근 목록에만 표시한다', async t => {
    const value = await fixture(t);
    const oldBook = await value.book('Old book');
    const copiedBook = await value.book('New copy with original modification date', { born: value.recent });
    const updatedBook = await value.book('Externally updated old book', { modified: value.recent });
    const files = await value.scan();

    assert.equal(files.length, 3);
    assert.ok(files.every(file => file.cache_source === 'archive'));
    assert.deepEqual(await listPaths(value, 'recent-added'), [copiedBook]);
    assert.deepEqual(await listPaths(value, 'recent-updated'), [updatedBook]);
    assert.equal(value.activity(oldBook).added_at, new Date(value.old).toISOString());
    assert.equal(value.activity(oldBook).updated_at, new Date(value.old).toISOString());
    const overview = await value.request({ operation: 'overview' });
    assert.equal(overview.recentAddedCount, 1);
    assert.equal(overview.recentUpdatedCount, 1);
});

test('캐시 재사용과 전체 강제 스캔은 오래된 파일의 최근 추가·업데이트 날짜를 바꾸지 않는다', async t => {
    const value = await fixture(t);
    const filePath = await value.book('Unchanged book');
    await value.scan();
    const before = value.activity(filePath);
    const saveMetadata = t.mock.method(value.db, 'upsertFileInfo');

    const cached = await value.scan();
    assert.equal(cached[0].title, 'Unchanged book');
    assert.equal(saveMetadata.mock.callCount(), 0);
    assert.deepEqual(value.activity(filePath), before);
    const forced = await value.scan({ force: true });
    assert.equal(forced[0].cache_source, 'archive');
    assert.equal(saveMetadata.mock.callCount(), 1);
    assert.deepEqual(value.activity(filePath), before);
    assert.deepEqual(await listPaths(value, 'recent-added'), []);
    assert.deepEqual(await listPaths(value, 'recent-updated'), []);
});

test('외부에서 수정한 압축 파일을 다시 스캔하면 생성 날짜를 유지하고 실제 수정 날짜를 반영한다', async t => {
    const value = await fixture(t);
    const filePath = await value.book('Externally modified book');
    await value.scan();
    const before = value.activity(filePath);

    await value.writeBook(filePath, 'Changed outside BookManager', value.recent);
    const rescanned = await value.scan();
    assert.equal(rescanned[0].title, 'Changed outside BookManager');
    assert.equal(rescanned[0].cache_source, 'archive');
    const after = value.activity(filePath);
    assert.equal(after.added_at, before.added_at);
    assert.equal(after.updated_at, new Date(value.recent).toISOString());
    assert.equal(after.metadata_updated_at, '');
    assert.deepEqual(await listPaths(value, 'recent-added'), []);
    assert.deepEqual(await listPaths(value, 'recent-updated'), [filePath]);
});

test('앱에서 바꾼 평점과 그 변경 날짜는 캐시 재사용 및 전체 강제 스캔 후에도 유지한다', async t => {
    const value = await fixture(t);
    const filePath = await value.book('Rated book');
    await value.scan();
    await value.db.setFileRating(filePath, 9);
    const rated = value.activity(filePath);
    assert.ok(rated.metadata_updated_at);
    assert.equal(rated.updated_at, rated.metadata_updated_at);

    for (const options of [{}, { force: true }]) {
        const rescanned = await value.scan(options);
        assert.equal(Number(rescanned[0].rating), 9);
        assert.deepEqual(value.activity(filePath), rated);
    }
    assert.deepEqual(await listPaths(value, 'recent-added'), []);
    assert.deepEqual(await listPaths(value, 'recent-updated'), [filePath]);
});

test('기존 스캔 시각으로 오염된 날짜는 메타데이터 캐시를 재사용하는 스캔에서도 바로잡는다', async t => {
    const value = await fixture(t);
    const filePath = await value.book('Legacy scan timestamp');
    await value.scan();
    const timestamp = new Date(value.recent).toISOString();
    value.db.getConnection().prepare(`
        UPDATE reading_file_activity SET added_at = ?, updated_at = ?, metadata_updated_at = '' WHERE path = ?
    `).run(timestamp, timestamp, filePath);
    assert.deepEqual(await listPaths(value, 'recent-added'), [filePath]);
    assert.deepEqual(await listPaths(value, 'recent-updated'), [filePath]);

    const saveMetadata = t.mock.method(value.db, 'upsertFileInfo');
    const rescanned = await value.scan();
    assert.equal(rescanned[0].title, 'Legacy scan timestamp');
    assert.equal(saveMetadata.mock.callCount(), 0);
    assert.equal(value.activity(filePath).added_at, new Date(value.old).toISOString());
    assert.equal(value.activity(filePath).updated_at, new Date(value.old).toISOString());
    assert.deepEqual(await listPaths(value, 'recent-added'), []);
    assert.deepEqual(await listPaths(value, 'recent-updated'), []);
});
