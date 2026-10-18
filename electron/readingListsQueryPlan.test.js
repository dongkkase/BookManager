import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { createLibraryPathScope } from './libraryPathScope.js';
import { readingListsRequest } from './readingLists.js';

test('같은 시각에 색인한 최근 목록은 범위를 먼저 적용하고 정렬 없이 최신 1000개를 조회한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-query-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const folder = path.join(root, 'books_%');
    const libraries = [folder, path.join(root, 'another-library')];
    const files = Array.from({ length: 1200 }, (_, index) => path.join(folder, `book-${String(index).padStart(4, '0')}.epub`));
    const outside = Array.from({ length: 1200 }, (_, index) => path.join(`${folder}-outside`, `book-${index}.epub`));
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const timestamp = new Date(now - 1000).toISOString();
    const newer = new Date(now).toISOString();
    const cutoff = new Date(now - 14 * 86400000).toISOString();
    const db = library.getConnection();
    const insert = db.prepare('INSERT INTO files(path, title) VALUES (?, ?)');
    const update = db.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?');
    db.transaction(() => {
        for (const filePath of [...files].reverse()) {
            insert.run(filePath, path.basename(filePath));
            update.run(timestamp, timestamp, library.normalizeFilePath(filePath));
        }
        for (const filePath of outside) {
            insert.run(filePath, path.basename(filePath));
            update.run(newer, newer, library.normalizeFilePath(filePath));
        }
    })();
    const queries = [];
    const prepare = db.prepare.bind(db);
    t.mock.method(db, 'prepare', sql => {
        if (sql.includes('SELECT files.*, activity.')) queries.push(sql);
        return prepare(sql);
    });
    const scope = createLibraryPathScope(library, libraries, 'activity.path');
    for (const [id, indexName] of [
        ['recent-added', 'idx_reading_activity_added_path'],
        ['recent-updated', 'idx_reading_activity_updated_path'],
    ]) {
        const { rows } = await readingListsRequest(library, { operation: 'list', id }, libraries);
        assert.deepEqual(rows.map(row => row.path), files.slice(0, 1000).map(filePath => library.normalizeFilePath(filePath)));
        assert.ok(rows.every(row => row.list_added_at === timestamp));
        const plan = prepare(`EXPLAIN QUERY PLAN ${queries.at(-1)}`).all(cutoff, ...scope.params, 1000);
        assert.ok(plan.some(row => row.detail.includes(indexName)), JSON.stringify(plan));
        assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')), JSON.stringify(plan));
    }
    const overview = await readingListsRequest(library, { operation: 'overview' }, libraries);
    assert.equal(overview.recentAddedCount, 1000);
    assert.equal(overview.recentUpdatedCount, 1000);
});

test('기존 최근 목록 DB의 단일 색인을 복합 색인으로 교체하면서 등록 시각을 보존한다', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-query-upgrade-'));
    const dbPath = path.join(root, 'library.db');
    const library = new LibraryDB({ dbPath });
    const reopened = new LibraryDB({ dbPath });
    t.after(async () => {
        await library.close();
        await reopened.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const libraries = [path.join(root, 'library'), path.join(root, 'another-library')];
    const filePath = path.join(libraries[0], 'book.epub');
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const timestamp = new Date(now - 86400000).toISOString();
    await library.upsertFileInfo({ path: filePath, title: 'Existing book' });
    library.getConnection().prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ?').run(timestamp, timestamp);
    library.getConnection().exec(`
        CREATE INDEX idx_reading_activity_added ON reading_file_activity(added_at DESC);
        CREATE INDEX idx_reading_activity_updated ON reading_file_activity(updated_at DESC);
        DROP INDEX idx_reading_activity_added_path;
        DROP INDEX idx_reading_activity_updated_path;
    `);
    await library.close();
    const db = reopened.getConnection();
    const queries = [];
    const prepare = db.prepare.bind(db);
    t.mock.method(db, 'prepare', sql => {
        if (sql.includes('SELECT files.*, activity.')) queries.push(sql);
        return prepare(sql);
    });
    const scope = createLibraryPathScope(reopened, libraries, 'activity.path');
    for (const column of ['added', 'updated']) {
        const indexes = db.prepare('PRAGMA index_list(reading_file_activity)').all();
        assert.ok(!indexes.some(index => index.name === `idx_reading_activity_${column}`));
        const index = indexes.find(index => index.name === `idx_reading_activity_${column}_path`);
        assert.ok(index);
        const columns = db.prepare(`PRAGMA index_xinfo(${index.name})`).all().filter(entry => entry.key);
        assert.deepEqual(columns.map(entry => [entry.name, entry.desc]), [[`${column}_at`, 1], ['path', 0]]);
        const { rows } = await readingListsRequest(reopened, { operation: 'list', id: `recent-${column}` }, libraries);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].title, 'Existing book');
        assert.equal(rows[0].list_added_at, timestamp);
        const plan = prepare(`EXPLAIN QUERY PLAN ${queries.at(-1)}`).all(new Date(now - 14 * 86400000).toISOString(), ...scope.params, 1000);
        assert.ok(plan.some(row => row.detail.includes(index.name)), JSON.stringify(plan));
        assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')), JSON.stringify(plan));
    }
    const row = db.prepare('SELECT * FROM reading_file_activity').get();
    assert.equal(row.path, reopened.normalizeFilePath(filePath));
    assert.equal(row.added_at, timestamp);
    assert.equal(row.updated_at, timestamp);
});
