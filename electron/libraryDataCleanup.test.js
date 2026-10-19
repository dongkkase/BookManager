import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { pruneUnregisteredLibraryData } from './libraryDataCleanup.js';
import { readingListsRequest } from './readingLists.js';

async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'library-cleanup-'));
    const dbPath = path.join(root, 'library.db');
    const libraryPath = path.join(root, 'Books_%[*?]');
    const db = new LibraryDB({ dbPath, ...options });
    await fs.mkdir(libraryPath);
    t.after(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, dbPath, libraryPath, db };
}

test('라이브러리 밖 도서정보·읽기기록을 정리하고 내부 공유 메타데이터·표지와 수동 목록을 보존한다', async t => {
    const { root, db, libraryPath } = await fixture(t);
    const inside = path.join(libraryPath, 'inside.txt');
    const insideCoverUser = path.join(libraryPath, 'cover-user.cbz');
    const sharedOutside = path.join(root, 'shared.txt');
    const outside = path.join(root, 'outside.txt');
    const outsideCoverUser = path.join(root, 'outside.cbz');
    const readingOnly = path.join(root, 'reading-only.epub');
    const activityOnly = path.join(root, 'activity-only.epub');
    const sharedCover = path.join(root, 'text-thumbnails', 'shared.png');
    const orphanCover = path.join(root, 'text-thumbnails', 'orphan.png');
    const sharedThumbnail = path.join(root, 'thumbnails', 'shared.png');
    for (const file of [inside, sharedOutside, outside, sharedCover, orphanCover, sharedThumbnail]) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'original');
    }
    await db.saveTextMetadataRecord({ contentHash: 'shared', metadata: { Title: 'shared metadata' },
        record: { path: sharedOutside, thumb_path: sharedCover, cover_override_path: sharedCover }, coverPath: sharedCover });
    await db.linkTextMetadataRecord({ contentHash: 'shared', record: { path: inside, thumb_path: sharedCover } });
    await db.saveTextMetadataRecord({ contentHash: 'outside', metadata: { Title: 'outside metadata' },
        record: { path: outside, thumb_path: orphanCover }, coverPath: orphanCover });
    await db.upsertFileInfoBulk([
        { path: insideCoverUser, thumb_path: sharedThumbnail },
        { path: outsideCoverUser, cover_override_path: sharedThumbnail },
    ]);
    for (const file of [inside, outside, readingOnly]) await db.upsertReadingState(file, { pageIndex: 3, pageCount: 10 });
    const sql = db.getConnection();
    sql.prepare('INSERT INTO reading_file_activity(path, added_at, updated_at) VALUES (?, ?, ?)').run(activityOnly, '2026-10-18', '2026-10-18');
    const { id } = await readingListsRequest(db, { operation: 'create', name: 'Keep references' });
    for (const listId of ['want-to-read', id]) await readingListsRequest(db, { operation: 'add', id: listId, paths: [outside] });

    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);

    assert.equal(result.deletedFileCount, 3);
    assert.equal(result.deletedReadingStateCount, 2);
    assert.equal(result.deletedActivityCount, 4);
    assert.equal(result.deletedTextMetadataPathCount, 2);
    assert.equal(result.deletedTextMetadataCount, 1);
    assert.deepEqual(result.cachePaths, [orphanCover]);
    assert.deepEqual(sql.prepare('SELECT path FROM files ORDER BY path').all().map(row => row.path), [insideCoverUser, inside]);
    assert.deepEqual(sql.prepare('SELECT file_path FROM reading_states').all().map(row => row.file_path), [inside]);
    assert.equal((await db.getTextMetadata('shared')).metadata.Title, 'shared metadata');
    assert.equal(await db.getTextMetadata('outside'), null);
    assert.deepEqual(await db.getTextMetadataPaths('shared'), [inside]);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM reading_list_members').get().count, 2);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM reading_lists').get().count, 2);
    for (const file of [outside, sharedOutside, orphanCover, sharedCover, sharedThumbnail]) assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.equal((await pruneUnregisteredLibraryData(db, [libraryPath])).changes, 0);
});

test('도서 검색 인덱스와 외부 경로를 참조하는 중복 캐시를 정리하고 현재 라이브러리 폴더 인덱스를 보존한다', async t => {
    const { root, db, libraryPath } = await fixture(t);
    const inside = path.join(libraryPath, 'inside.cbz');
    const otherInside = path.join(libraryPath, 'nested', 'second.cbz');
    const outside = path.join(`${libraryPath}-old`, 'outside.cbz');
    await db.upsertFileInfoBulk([
        { path: inside, title: 'retained-marker' },
        { path: otherInside, title: 'retained-other' },
        { path: outside, title: 'removed-marker' },
    ]);
    assert.equal((await db.searchFiles('removed-marker', [root])).length, 1);
    await db.saveDupMatch(inside, { matches: [{ full_path: outside }] });
    await db.saveDupMatch(otherInside, { matches: [{ path: inside, folder: libraryPath }] });
    await db.saveDupMatch(outside, { match_path: inside });
    await db.saveTargetIndex([
        { full_path: inside, target_folder: libraryPath },
        { full_path: outside, target_folder: root },
    ]);
    const sql = db.getConnection();
    const addState = sql.prepare('INSERT INTO library_scan_state (library_path) VALUES (?)');
    addState.run(root);
    addState.run(libraryPath);
    const addFolder = sql.prepare('INSERT INTO library_folders (library_path, folder_path) VALUES (?, ?)');
    addFolder.run(root, libraryPath);
    addFolder.run(libraryPath, libraryPath);
    addFolder.run(libraryPath, path.dirname(otherInside));
    addFolder.run(libraryPath, path.dirname(outside));

    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);

    assert.equal(result.deletedDuplicateCacheCount, 2);
    assert.equal(result.deletedDuplicateIndexCount, 1);
    assert.equal(result.deletedLibraryScanStateCount, 1);
    assert.equal(result.deletedLibraryFolderCount, 2);
    assert.deepEqual((await db.searchFiles('removed-marker', [root])), []);
    assert.equal((await db.searchFiles('retained-marker', [libraryPath])).length, 1);
    assert.equal(sql.prepare('SELECT 1 FROM files_search_ids WHERE path = ?').get(outside), undefined);
    assert.deepEqual(sql.prepare('SELECT a_path FROM dup_cache').all(), [{ a_path: otherInside }]);
    assert.deepEqual(sql.prepare('SELECT folder_path FROM library_folders ORDER BY folder_path').all().map(row => row.folder_path),
        [libraryPath, path.dirname(otherInside)]);
});

test('레거시 도서·중복 테이블에서도 외부 경로를 제거하여 재연결 후 데이터가 복원되지 않는다', async t => {
    const { root, db, dbPath, libraryPath } = await fixture(t);
    const inside = path.join(libraryPath, 'inside.cbz');
    const otherInside = path.join(libraryPath, 'second.cbz');
    const outside = path.join(root, 'outside.cbz');
    const sql = db.getConnection();
    sql.exec(`CREATE TABLE file_info (filepath TEXT, title TEXT, thumbnail TEXT);
        CREATE TABLE target_index (file_path TEXT, folder_path TEXT);
        CREATE TABLE dup_match (a_path TEXT, match_path TEXT, match_score REAL, match_time TEXT);`);
    const addFile = sql.prepare('INSERT INTO file_info VALUES (?, ?, ?)');
    const addTarget = sql.prepare('INSERT INTO target_index VALUES (?, ?)');
    for (const file of [inside, outside]) {
        addFile.run(file, path.basename(file), '');
        addTarget.run(file, path.dirname(file));
    }
    const addMatch = sql.prepare('INSERT INTO dup_match VALUES (?, ?, 100, ?)');
    addMatch.run(inside, outside, '2026-10-18');
    addMatch.run(otherInside, inside, '2026-10-18');
    addMatch.run(outside, inside, '2026-10-18');
    db.migrateLegacyTables();

    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);
    assert.equal(result.deletedLegacyRowCount, 4);
    await db.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        const connection = reopened.getConnection();
        assert.deepEqual(connection.prepare('SELECT path FROM files').all(), [{ path: inside }]);
        assert.deepEqual(connection.prepare('SELECT full_path FROM dup_target_index').all(), [{ full_path: inside }]);
        assert.deepEqual(connection.prepare('SELECT a_path FROM dup_cache').all(), [{ a_path: otherInside }]);
        assert.equal((await pruneUnregisteredLibraryData(reopened, [libraryPath])).changes, 0);
    } finally { await reopened.close(); }
});

test('알 수 없는 등록 설정을 거부하고 명시적 빈 목록에서는 앱 데이터만 정리한다', async t => {
    const { root, db, libraryPath } = await fixture(t);
    const file = path.join(libraryPath, 'book.epub');
    await fs.writeFile(file, 'original');
    await db.upsertFileInfo({ path: file });
    await db.upsertReadingState(file, { pageIndex: 5 });
    for (const invalid of [undefined, null, {}, [null], [''], ['relative'], [libraryPath, 42]]) {
        await assert.rejects(pruneUnregisteredLibraryData(db, invalid), /invalid_library_paths/);
        assert.equal(db.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 1);
    }
    const result = await pruneUnregisteredLibraryData(db, []);
    assert.equal(result.deletedFileCount, 1);
    assert.equal(result.deletedReadingStateCount, 1);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.ok((await fs.stat(root)).isDirectory());
});

test('정리 중 DB 오류가 발생하면 도서정보와 읽기기록 삭제를 함께 취소한다', async t => {
    const { root, db, libraryPath } = await fixture(t);
    const outside = path.join(root, 'outside.epub');
    await db.upsertFileInfo({ path: outside });
    await db.upsertReadingState(outside, { pageIndex: 5 });
    const sql = db.getConnection();
    sql.exec("CREATE TRIGGER cleanup_failure BEFORE DELETE ON files BEGIN SELECT RAISE(ABORT, 'cleanup blocked'); END");
    await assert.rejects(pruneUnregisteredLibraryData(db, [libraryPath]), /cleanup blocked/);
    for (const table of ['files', 'reading_states', 'reading_file_activity']) {
        assert.equal(sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
    }
});

test('변경 없는 정리의 전체 경로 검사 동안 다른 DB 연결의 쓰기를 막지 않는다', async t => {
    const { db, dbPath, libraryPath } = await fixture(t);
    const inside = path.join(libraryPath, 'inside.epub');
    await db.upsertFileInfo({ path: inside, title: 'before' });
    const writer = new LibraryDB({ dbPath });
    t.after(() => writer.close());
    const connection = writer.getConnection();
    connection.pragma('busy_timeout = 0');
    const update = connection.prepare('UPDATE files SET title = ? WHERE path = ?');
    let wroteDuringScan = false;
    db.getConnection().function('normalize_library_file_path', value => {
        if (!wroteDuringScan) {
            update.run('concurrent update', inside);
            wroteDuringScan = true;
        }
        return db.normalizeFilePath(value);
    });

    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);

    assert.equal(wroteDuringScan, true);
    assert.equal(result.changes, 0);
    assert.equal((await db.getFileInfo(inside)).title, 'concurrent update');
});

test('경로 검사 중 다른 연결이 데이터를 변경하면 오래된 삭제 계획을 원자적으로 취소한다', async t => {
    const { root, db, dbPath, libraryPath } = await fixture(t);
    const outside = path.join(root, 'outside.epub');
    const inside = path.join(libraryPath, 'inside.epub');
    await db.upsertFileInfo({ path: outside });
    await db.upsertReadingState(outside, { pageIndex: 5 });
    const writer = new LibraryDB({ dbPath });
    t.after(() => writer.close());
    const connection = writer.getConnection();
    connection.pragma('busy_timeout = 0');
    const insert = connection.prepare('INSERT INTO files(path, title) VALUES (?, ?)');
    let wroteDuringScan = false;
    db.getConnection().function('normalize_library_file_path', value => {
        if (!wroteDuringScan) {
            insert.run(inside, 'concurrent book');
            wroteDuringScan = true;
        }
        return db.normalizeFilePath(value);
    });

    await assert.rejects(pruneUnregisteredLibraryData(db, [libraryPath]), { code: 'SQLITE_BUSY_SNAPSHOT' });

    assert.equal(wroteDuringScan, true);
    assert.ok(await db.getFileInfo(outside));
    assert.equal((await db.getFileInfo(inside)).title, 'concurrent book');
    assert.equal(db.getConnection().prepare('SELECT COUNT(*) AS count FROM reading_states').get().count, 1);
    assert.equal(db.getConnection().prepare('SELECT COUNT(*) AS count FROM reading_file_activity').get().count, 2);
});

test('Windows 경로의 대소문자와 구분자를 유지하고 비슷한 이름의 외부 폴더를 정리한다', async t => {
    const { db } = await fixture(t, { platform: 'win32' });
    const root = 'C:\\Books_%';
    const inside = 'c:\\books_%\\inside.cbz';
    const outside = 'C:\\Books_%_old\\outside.cbz';
    await db.upsertFileInfoBulk([{ path: inside }, { path: outside }]);
    const sql = db.getConnection();
    sql.prepare('INSERT INTO library_scan_state (library_path) VALUES (?)').run(root);
    sql.prepare('INSERT INTO library_folders (library_path, folder_path) VALUES (?, ?)').run(root, root);
    await pruneUnregisteredLibraryData(db, [root]);
    assert.deepEqual(sql.prepare('SELECT path FROM files').all(), [{ path: inside }]);
    assert.deepEqual(sql.prepare('SELECT folder_path FROM library_folders').all(), [{ folder_path: root }]);
    assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM library_scan_state').get().count, 1);
});

test('정리 전 도서·TXT·레거시·중복 인덱스의 원본 경로는 표지 삭제 후보에서 제외한다', async t => {
    const { root, db, libraryPath } = await fixture(t);
    const directory = path.join(root, 'thumbnails');
    await fs.mkdir(directory);
    const originals = ['a', 'b', 'c', 'd', 'e'].map(character => path.join(directory, `${character.repeat(32)}.png`));
    const disposableCover = path.join(directory, `${'f'.repeat(32)}.png`);
    for (const file of [...originals, disposableCover]) await fs.writeFile(file, 'original');
    await db.upsertFileInfo({ path: `${directory}/unused/../${path.basename(originals[0])}` });
    await db.upsertFileInfoBulk([...originals, disposableCover].map((cover, index) => ({
        path: path.join(root, `consumer-${index}.cbz`), thumb_path: cover,
    })));
    const sql = db.getConnection();
    sql.prepare('INSERT INTO text_metadata VALUES (?, ?, ?, ?, ?)').run('original', '{}', '{}', '', '2026-10-18');
    sql.prepare('INSERT INTO text_metadata_paths VALUES (?, ?)').run(originals[1], 'original');
    sql.exec('CREATE TABLE file_info (filepath TEXT); CREATE TABLE target_index (full_path TEXT)');
    sql.prepare('INSERT INTO file_info VALUES (?)').run(originals[2]);
    sql.prepare('INSERT INTO target_index VALUES (?)').run(originals[3]);
    sql.prepare('INSERT INTO dup_target_index (full_path, target_folder) VALUES (?, ?)').run(originals[4], directory);

    const result = await pruneUnregisteredLibraryData(db, [libraryPath]);

    assert.deepEqual(result.cachePaths, [disposableCover]);
    for (const table of ['files', 'text_metadata_paths', 'file_info', 'target_index', 'dup_target_index']) {
        assert.equal(sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    for (const file of originals) assert.equal(await fs.readFile(file, 'utf8'), 'original');
});

test('삭제되는 원본이 다른 디렉터리 별칭으로 등록되어 있어도 같은 표지를 삭제 후보에서 제외한다',
    { skip: process.platform === 'win32' }, async t => {
        const { root, db, libraryPath } = await fixture(t);
        const directory = path.join(root, 'thumbnails');
        const alias = path.join(root, 'alias-thumbnails');
        await fs.mkdir(directory);
        await fs.symlink(directory, alias, 'dir');
        const filename = `${'a'.repeat(32)}.png`;
        const cover = path.join(directory, filename);
        await fs.writeFile(cover, 'original');
        await db.upsertFileInfoBulk([
            { path: path.join(alias, filename) },
            { path: path.join(root, 'outside.cbz'), thumb_path: cover },
        ]);
        const result = await pruneUnregisteredLibraryData(db, [libraryPath]);
        assert.equal(result.deletedFileCount, 2);
        assert.deepEqual(result.cachePaths, []);
        assert.equal(await fs.readFile(cover, 'utf8'), 'original');
    });
