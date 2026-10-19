import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { fileActivityDates } from './readingFileActivity.js';
import { readingListsRequest } from './readingLists.js';

const oldCreated = Date.parse('2020-07-01T01:00:00.000Z');
const oldModified = Date.parse('2020-07-20T01:00:00.000Z');
const iso = value => new Date(value).toISOString();

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-activity-'));
    const dbPath = path.join(root, 'library.db');
    const library = new LibraryDB({ dbPath });
    const filePath = path.join(root, 'book.epub');
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return {
        root, dbPath, library, filePath,
        activity: () => library.getConnection().prepare('SELECT * FROM reading_file_activity WHERE path = ?').get(filePath),
        list: id => readingListsRequest(library, { operation: 'list', id }, [root]),
    };
}

test('파일 생성일을 사용하고 생성일이 없을 때만 수정일로 대체한다', () => {
    assert.deepEqual(fileActivityDates({ birthtimeMs: oldCreated, mtimeMs: oldModified }), {
        addedAt: iso(oldCreated), modifiedAt: iso(oldModified),
    });
    for (const birthtimeMs of [0, -1, undefined, null, NaN, Infinity, 1e30]) {
        assert.deepEqual(fileActivityDates({ birthtimeMs, mtime: oldModified }), {
            addedAt: iso(oldModified), modifiedAt: iso(oldModified),
        });
    }
    assert.deepEqual(fileActivityDates({ birthtimeMs: 0, mtimeMs: 0 }), { addedAt: '', modifiedAt: '' });
});

test('오래된 파일의 스캔과 메타데이터 추출은 최근 이력을 만들지 않는다', async t => {
    const value = await fixture(t);
    const stat = { path: value.filePath, birthtimeMs: oldCreated, mtimeMs: oldModified };
    await value.library.syncReadingFileActivity([stat]);
    await value.library.upsertFileInfo({ path: value.filePath, mtime: oldModified / 1000, title: 'Discovered' }, { activitySource: 'scan' });
    await value.library.upsertFileInfo({ path: value.filePath, mtime: oldModified / 1000, title: 'Extracted metadata' }, { activitySource: 'scan' });
    assert.deepEqual(value.activity(), {
        path: value.filePath, added_at: iso(oldCreated), updated_at: iso(oldModified), metadata_updated_at: '',
    });
    assert.deepEqual((await value.list('recent-added')).rows, []);
    assert.deepEqual((await value.list('recent-updated')).rows, []);
    assert.equal((await value.library.syncReadingFileActivity([stat])).changes, 0);
    assert.equal((await value.library.getFileInfo(value.filePath)).mtime, oldModified / 1000);
});

test('NAS의 새 생성일과 실제 수정일을 서로 독립적으로 반영한다', async t => {
    const value = await fixture(t);
    const now = Date.now();
    await value.library.upsertFileInfo({ path: value.filePath, mtime: oldModified / 1000, title: 'NAS book' }, { activitySource: 'scan' });
    await value.library.syncReadingFileActivity([{ full_path: value.filePath, birthtimeMs: now, mtime: oldModified }]);
    assert.equal((await value.list('recent-added')).rows.length, 1);
    assert.equal((await value.list('recent-updated')).rows.length, 0);
    await value.library.syncReadingFileActivity([{ path: value.filePath, birthtimeMs: oldCreated, mtimeMs: now }]);
    assert.equal((await value.list('recent-added')).rows.length, 0);
    assert.equal((await value.list('recent-updated')).rows.length, 1);
    assert.equal((await value.library.getFileInfo(value.filePath)).mtime, oldModified / 1000);
});

test('사용자가 수정한 도서 정보의 날짜는 이후 스캔에서 보존하고 같은 값 저장은 제외한다', async t => {
    const value = await fixture(t);
    const record = { path: value.filePath, mtime: oldModified / 1000, title: 'Original' };
    await value.library.upsertFileInfo(record, { activitySource: 'scan' });
    await value.library.upsertFileInfo(record);
    assert.equal(value.activity().metadata_updated_at, '');
    await value.library.upsertFileInfo({ ...record, title: 'User edit' });
    const userDate = value.activity().metadata_updated_at;
    assert.ok(userDate);
    await value.library.syncReadingFileActivity([{ path: value.filePath, birthtimeMs: oldCreated, mtimeMs: oldModified }]);
    assert.equal(value.activity().updated_at, userDate);
    assert.equal(value.activity().added_at, iso(oldCreated));
    await value.library.upsertFileInfo({ ...record, title: 'Metadata cache refreshed' }, { activitySource: 'scan' });
    assert.equal(value.activity().metadata_updated_at, userDate);
    assert.equal((await value.list('recent-updated')).rows.length, 1);
});

test('기존 스캔 시각 이력을 한 번 보정하고 이후 사용자 수정과 생성일을 재실행 때 유지한다', async t => {
    const value = await fixture(t);
    await value.library.upsertFileInfo({ path: value.filePath, mtime: oldModified / 1000, title: 'Keep this metadata' });
    const sql = value.library.getConnection();
    sql.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ?').run(iso(Date.now()), iso(Date.now()));
    sql.exec(`
        DELETE FROM library_meta WHERE key = 'reading_file_activity_dates_version';
        DROP TRIGGER reading_activity_insert;
        DROP TRIGGER reading_activity_update;
        ALTER TABLE reading_file_activity DROP COLUMN metadata_updated_at;
        CREATE TRIGGER reading_activity_update AFTER UPDATE ON files BEGIN
            UPDATE reading_file_activity SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE path = new.path;
        END;
    `);
    await value.library.close();
    assert.equal(value.activity().added_at, iso(oldModified));
    assert.equal(value.activity().updated_at, iso(oldModified));
    assert.equal(value.activity().metadata_updated_at, '');
    assert.equal((await value.library.getFileInfo(value.filePath)).title, 'Keep this metadata');
    await value.library.syncReadingFileActivity([{ path: value.filePath, birthtimeMs: oldCreated, mtimeMs: oldModified }]);
    await value.library.setFileRating(value.filePath, 8);
    const saved = value.activity();
    await value.library.close();
    assert.deepEqual(value.activity(), saved);
    await value.library.setFileRating(value.filePath, 8);
    assert.deepEqual(value.activity(), saved);
});

test('텍스트 메타데이터 연결과 일괄 스캔은 사용자 변경 날짜를 갱신하지 않는다', async t => {
    const value = await fixture(t);
    const record = { path: value.filePath, mtime: oldModified / 1000, title: 'Original' };
    await value.library.upsertFileInfoBulk([record], { activitySource: 'scan' });
    await value.library.saveTextMetadataRecord({ contentHash: 'hash', metadata: {}, record, activitySource: 'scan' });
    await value.library.linkTextMetadataRecord({ contentHash: 'hash', record: { ...record, title: 'Linked' } });
    assert.equal(value.activity().metadata_updated_at, '');
    await value.library.saveTextMetadataRecord({ contentHash: 'hash', metadata: {}, record: { ...record, title: 'Saved by user' } });
    assert.ok(value.activity().metadata_updated_at);
    const before = value.activity();
    await value.library.linkTextMetadataRecord({ contentHash: 'hash', record: { ...record, title: 'Linked again' } });
    assert.deepEqual(value.activity(), before);
});

test('표지 편집과 경로 이동은 실제 사용자 변경 날짜를 유지한다', async t => {
    const value = await fixture(t);
    await fs.writeFile(value.filePath, 'fixture');
    await value.library.upsertFileInfo({ path: value.filePath, mtime: oldModified / 1000, cover_override_path: 'old-cover' }, { activitySource: 'scan' });
    await value.library.commitCoverFileEdit(value.filePath, { mtime: oldModified / 1000, size: 7 });
    assert.ok(value.activity().metadata_updated_at);
    const before = value.activity();
    const destination = path.join(value.root, 'renamed.epub');
    await fs.rename(value.filePath, destination);
    await value.library.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: value.filePath, dest: destination }] });
    assert.equal(value.activity(), undefined);
    const moved = value.library.getConnection().prepare('SELECT * FROM reading_file_activity WHERE path = ?').get(destination);
    assert.deepEqual(moved, { ...before, path: destination });
});
