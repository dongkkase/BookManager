import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { readingListsRequest, hydrateReadingListRows, loadCollectionPreview, registerReadingListsIpc } from './readingLists.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-lists-'));
    const dbPath = path.join(root, 'library.db');
    const db = new LibraryDB({ dbPath });
    const folder = path.join(root, 'books_%');
    await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
    const files = ['first.epub', 'nested/second.cbz'].map(name => path.join(folder, name));
    for (const file of files) await fs.writeFile(file, 'fixture');
    t.after(async () => { await db.close(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, db, dbPath, folder, files, request: request => readingListsRequest(db, request) };
}

test('컬렉션은 파일과 폴더를 개별 항목으로 저장하고 재실행 후 복원하며 원본을 보존한다', async t => {
    const { db, dbPath, folder, files, request } = await fixture(t);
    const { id } = await request({ operation: 'create', name: 'Virtual folder' });
    await fs.writeFile(path.join(folder, 'cover.jpg'), 'image');
    await fs.mkdir(path.join(folder, '.hidden'));
    await fs.writeFile(path.join(folder, '.hidden', 'hidden.pdf'), 'hidden');
    await fs.symlink(folder, path.join(folder, 'nested', 'cycle'));
    const added = await request({ operation: 'add', id, paths: [folder, files[0]] });
    assert.equal(added.changes, 2);
    assert.equal((await request({ operation: 'add', id, paths: [folder, files[0]] })).changes, 0);
    await db.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        assert.equal((await readingListsRequest(reopened, { operation: 'overview' })).collections[0].count, 2);
        await fs.unlink(files[0]);
        const { rows } = await readingListsRequest(reopened, { operation: 'list', id });
        assert.deepEqual(rows.map(row => row.path).sort(), [folder, files[0]].sort());
        const hydrated = await hydrateReadingListRows(rows, row => row);
        assert.equal(hydrated.find(entry => entry.path === files[0]).exists, false);
        assert.equal(hydrated.find(entry => entry.path === folder).isDirectory, true);
        assert.equal(hydrated.find(entry => entry.path === folder).name, path.basename(folder));
        await readingListsRequest(reopened, { operation: 'remove', id, paths: [folder] });
        assert.equal((await readingListsRequest(reopened, { operation: 'overview' })).collections[0].count, 1);
        assert.ok((await fs.stat(folder)).isDirectory());
        assert.ok((await fs.stat(files[1])).isFile());
    } finally { await reopened.close(); }
});

test('읽고 싶은 책은 파일과 폴더 자체를 저장하고 제거할 때 선택한 항목만 삭제한다', async t => {
    const { root, db, dbPath, folder, files, request } = await fixture(t);
    const emptyFolder = path.join(root, 'empty.epub');
    const nested = path.join(folder, 'nested');
    const image = path.join(folder, 'cover.jpg');
    await fs.mkdir(emptyFolder);
    await fs.writeFile(image, 'image');
    const paths = [folder, files[0], nested, emptyFolder];
    const added = await request({ operation: 'add', id: 'want-to-read', paths: [...paths, files[0], image] });
    assert.equal(added.changes, 4);
    assert.equal(added.matchedCount, 4);
    assert.deepEqual(added.errors, []);
    assert.equal((await request({ operation: 'add', id: 'want-to-read', paths })).changes, 0);
    await db.close();
    const reopened = new LibraryDB({ dbPath });
    const wishlist = request => readingListsRequest(reopened, { id: 'want-to-read', ...request });
    try {
        const { rows } = await wishlist({ operation: 'list' });
        assert.deepEqual(rows.map(row => row.path).sort(), [...paths].sort());
        assert.equal(rows.find(row => row.path === folder).is_directory, 1);
        assert.equal(rows.find(row => row.path === files[0]).is_directory, 0);
        const hydrated = await hydrateReadingListRows(rows, row => ({ ...row, ext: '.epub', title: 'File title' }));
        for (const entry of hydrated) {
            assert.equal(entry.exists, true);
            assert.equal(entry.isDirectory, entry.path !== files[0]);
        }
        const empty = hydrated.find(entry => entry.path === emptyFolder);
        assert.equal(empty.title, 'empty.epub');
        assert.equal(empty.ext, '');
        assert.equal(empty.size, 0);
        await fs.rmdir(emptyFolder);
        await fs.unlink(files[0]);
        const missing = await hydrateReadingListRows(rows, row => row);
        assert.equal(missing.find(entry => entry.path === emptyFolder).exists, false);
        assert.equal(missing.find(entry => entry.path === emptyFolder).isDirectory, true);
        assert.equal(missing.find(entry => entry.path === files[0]).exists, false);
        assert.equal(missing.find(entry => entry.path === files[0]).isDirectory, false);
        assert.equal((await wishlist({ operation: 'remove', paths: [folder] })).changes, 1);
        assert.deepEqual((await wishlist({ operation: 'list' })).rows.map(row => row.path).sort(), paths.slice(1).sort());
        assert.equal((await wishlist({ operation: 'overview' })).wishlistCount, 3);
        assert.ok((await fs.stat(folder)).isDirectory());
        assert.ok((await fs.stat(files[1])).isFile());
    } finally { await reopened.close(); }
});

test('기존 읽고 싶은 책의 파일 항목과 등록 시각을 유지하며 폴더 구분 열을 추가한다', async t => {
    const { db, dbPath, files, request } = await fixture(t);
    await request({ operation: 'add', id: 'want-to-read', paths: files });
    const before = (await request({ operation: 'list', id: 'want-to-read' })).rows;
    db.getConnection().exec('ALTER TABLE reading_list_members DROP COLUMN is_directory');
    await db.close();
    const reopened = new LibraryDB({ dbPath });
    try {
        const { rows } = await readingListsRequest(reopened, { operation: 'list', id: 'want-to-read' });
        assert.deepEqual(rows, before);
        assert.ok(rows.every(row => row.is_directory === 0));
    } finally { await reopened.close(); }
});

test('컬렉션 생성, 중복 이름 검사, 이름 수정, 항목 제거와 삭제는 다른 목록에 영향을 주지 않는다', async t => {
    const { db, files, request } = await fixture(t);
    const { id } = await request({ operation: 'create', name: ' Weekend ' });
    await request({ operation: 'add', id, paths: files });
    await request({ operation: 'add', id: 'want-to-read', paths: files });
    await assert.rejects(request({ operation: 'create', name: 'weekend' }), /duplicate_name/);
    await assert.rejects(request({ operation: 'create', name: '  ' }), /invalid_name/);
    await assert.rejects(request({ operation: 'rename', id: 'want-to-read', name: 'Changed' }), /list_not_found/);
    await request({ operation: 'rename', id, name: 'Favorites' });
    assert.equal((await request({ operation: 'overview' })).collections[0].name, 'Favorites');
    await request({ operation: 'remove', id, paths: [files[0]] });
    assert.equal((await request({ operation: 'list', id })).rows.length, 1);
    await request({ operation: 'delete', id });
    assert.equal(db.getConnection().prepare('SELECT COUNT(*) AS count FROM reading_list_members WHERE list_id = ?').get(id).count, 0);
    assert.equal((await request({ operation: 'overview' })).wishlistCount, 2);
    assert.ok((await fs.stat(files[0])).isFile());
    await assert.rejects(request({ operation: 'add', id, paths: files }), /list_not_found/);
});

test('잘못된 경로는 거부하고 접근 불가 항목은 부분 실패로 보고한다', async t => {
    const { root, files, request } = await fixture(t);
    await assert.rejects(request({ operation: 'add', id: 'want-to-read', paths: [...files, '../relative.pdf'] }), /invalid_paths/);
    assert.equal((await request({ operation: 'overview' })).wishlistCount, 0);
    const result = await request({ operation: 'add', id: 'want-to-read', paths: [...files, path.join(root, 'missing.pdf')] });
    assert.equal(result.changes, 2);
    assert.equal(result.errors.length, 1);
});

test('최근 추가 시점은 재스캔으로 바뀌지 않고 최근 변경에는 메타데이터 수정도 반영한다', async t => {
    const { db, files, request } = await fixture(t);
    await db.upsertFileInfo({ path: files[0], mtime: 2000, title: 'Original' });
    await db.upsertFileInfo({ path: files[1], mtime: 1000 });
    const sql = db.getConnection();
    const earlier = new Date(Date.now() - 2 * 86400000).toISOString();
    const later = new Date(Date.now() - 86400000).toISOString();
    sql.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?').run(earlier, earlier, files[0]);
    sql.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?').run(later, later, files[1]);
    await db.upsertFileInfo({ path: files[0], mtime: 2000, title: 'Original' });
    assert.equal(sql.prepare('SELECT updated_at FROM reading_file_activity WHERE path = ?').get(files[0]).updated_at, earlier);
    await db.upsertFileInfo({ path: files[0], mtime: 2000, title: 'Changed' });
    assert.equal(sql.prepare('SELECT added_at FROM reading_file_activity WHERE path = ?').get(files[0]).added_at, earlier);
    assert.deepEqual((await request({ operation: 'list', id: 'recent-added' })).rows.map(file => file.path), [files[1], files[0]]);
    assert.deepEqual((await request({ operation: 'list', id: 'recent-updated' })).rows.map(file => file.path), files);
});

test('최근 목록과 배지는 14일 경계를 포함하고 오래되거나 기록이 없는 항목을 제외한다', async t => {
    const { db, files, request } = await fixture(t);
    for (const file of files) await db.upsertFileInfo({ path: file });
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const cutoff = new Date(now - 14 * 86400000).toISOString();
    const older = new Date(now - 14 * 86400000 - 1).toISOString();
    const sql = db.getConnection();
    const update = sql.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?');
    update.run(cutoff, older, files[0]);
    update.run(older, cutoff, files[1]);
    sql.prepare('INSERT INTO reading_file_activity VALUES (?, ?, ?)').run('/missing-db-entry.epub', cutoff, cutoff);
    assert.deepEqual((await request({ operation: 'list', id: 'recent-added' })).rows.map(file => file.path), [files[0]]);
    assert.deepEqual((await request({ operation: 'list', id: 'recent-updated' })).rows.map(file => file.path), [files[1]]);
    const overview = await request({ operation: 'overview' });
    assert.equal(overview.recentAddedCount, 1);
    assert.equal(overview.recentUpdatedCount, 1);
    update.run('', '', files[0]);
    update.run('', '', files[1]);
    assert.equal((await request({ operation: 'list', id: 'recent-added' })).rows.length, 0);
    assert.equal((await request({ operation: 'list', id: 'recent-updated' })).rows.length, 0);
    assert.equal((await request({ operation: 'overview' })).recentAddedCount, 0);
});

test('최근 목록과 배지는 각각 최신 1000개로 제한한다', async t => {
    const { db, folder, request } = await fixture(t);
    const files = Array.from({ length: 1005 }, (_, index) => ({ path: path.join(folder, `${index}.epub`) }));
    await db.upsertFileInfoBulk(files);
    const sql = db.getConnection();
    const now = Date.now();
    const update = sql.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ? WHERE path = ?');
    sql.transaction(() => files.forEach((file, index) => update.run(
        new Date(now - index * 1000).toISOString(),
        new Date(now - (files.length - index) * 1000).toISOString(),
        file.path,
    )))();
    const added = (await request({ operation: 'list', id: 'recent-added' })).rows;
    const updated = (await request({ operation: 'list', id: 'recent-updated' })).rows;
    assert.deepEqual(added.map(file => file.path), files.slice(0, 1000).map(file => file.path));
    assert.deepEqual(updated.map(file => file.path), files.slice(5).reverse().map(file => file.path));
    const overview = await request({ operation: 'overview' });
    assert.equal(overview.recentAddedCount, added.length);
    assert.equal(overview.recentUpdatedCount, updated.length);
});

test('폴더 이동 후 컬렉션과 읽고 싶은 책의 경로 및 추가 시점을 보존한다', async t => {
    const { root, db, folder, files, request } = await fixture(t);
    await db.upsertFileInfo({ path: files[0], title: 'First' });
    const { id } = await request({ operation: 'create', name: 'Moved' });
    await request({ operation: 'add', id, paths: [folder, files[0]] });
    await request({ operation: 'add', id: 'want-to-read', paths: [folder, files[0]] });
    const before = (await request({ operation: 'list', id })).rows;
    const wishlistBefore = (await request({ operation: 'list', id: 'want-to-read' })).rows;
    const destination = path.join(root, 'moved');
    await fs.rename(folder, destination);
    await db.applyLibraryMoveIndexChanges({ fileInfoMoves: [{ src: folder, dest: destination, recursive: true }] });
    const after = (await request({ operation: 'list', id })).rows;
    assert.deepEqual(after.map(row => row.path).sort(), [destination, path.join(destination, 'first.epub')].sort());
    assert.equal(after.find(row => row.path === destination).is_directory, 1);
    assert.deepEqual(after.map(row => row.list_added_at).sort(), before.map(row => row.list_added_at).sort());
    const wishlistAfter = (await request({ operation: 'list', id: 'want-to-read' })).rows;
    assert.deepEqual(wishlistAfter.map(row => row.path).sort(), [destination, path.join(destination, 'first.epub')].sort());
    assert.deepEqual(wishlistAfter.map(row => row.list_added_at).sort(), wishlistBefore.map(row => row.list_added_at).sort());
    assert.equal(wishlistAfter.find(row => row.path === destination).is_directory, 1);
    assert.equal((await request({ operation: 'overview' })).wishlistCount, 2);
});

test('컬렉션 표지는 등록 파일을 우선 사용하고 읽을 수 없는 표지는 건너뛴다', async t => {
    const { folder, files, request } = await fixture(t);
    const { id } = await request({ operation: 'create', name: 'Covers' });
    await request({ operation: 'add', id, paths: [folder, ...files] });
    const previews = async () => (await request({ operation: 'preview', id })).previewRows;
    const rows = await previews();
    assert.deepEqual(rows.map(row => row.path), [...files, folder]);
    const loaded = [];
    const load = async filePath => {
        loaded.push(filePath);
        return { path: filePath, name: 'Member name', cover: `cover:${filePath}`, mtime: 42, size: 10 };
    };
    const first = await loadCollectionPreview(rows, load);
    assert.equal(first.cover, `cover:${files[0]}`);
    assert.equal(first.cover_file_path, files[0]);
    assert.equal(first.isDirectory, true);
    assert.equal(first.name, undefined);
    assert.deepEqual(loaded, [files[0]]);
    const fallback = await loadCollectionPreview(rows, async filePath => {
        if (filePath === files[0]) throw new Error('Unreadable');
        return load(filePath);
    });
    assert.equal(fallback.cover, `cover:${files[1]}`);
    await request({ operation: 'remove', id, paths: files });
    const folderCover = await loadCollectionPreview(await previews(), async filePath => ({
        ...await load(filePath), cover_file_path: files[1],
    }));
    assert.equal(folderCover.cover_file_path, files[1]);
    assert.equal((await loadCollectionPreview(rows, async () => ({ cover: '' }))).cover, '');
    await request({ operation: 'remove', id, paths: [folder] });
    assert.equal((await loadCollectionPreview(await previews(), load)).cover, '');
    await assert.rejects(request({ operation: 'preview', id: 'want-to-read' }), /list_not_found/);
});

test('IPC는 다른 창과 서브프레임을 거부하고 저장 성공을 알린다', async t => {
    const { dbPath, folder, files } = await fixture(t);
    let handler;
    let broadcasts = 0;
    const mainFrame = {};
    const sender = { mainFrame };
    registerReadingListsIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => new LibraryDB({ dbPath }),
        normalizeFile: row => ({ ...row, full_path: row.path }),
        loadPreview: async filePath => ({ cover: `cover:${filePath}` }),
        broadcast: () => { broadcasts += 1; },
    });
    const event = { sender, senderFrame: mainFrame };
    await assert.rejects(handler({ sender: {} }), /untrusted_sender/);
    await assert.rejects(handler({ sender, senderFrame: {} }), /untrusted_sender/);
    assert.equal((await handler(event, { operation: 'add', id: 'want-to-read', paths: [folder, ...files] })).success, true);
    const result = await handler(event, { operation: 'list', id: 'want-to-read' });
    assert.equal(result.files.length, 3);
    assert.equal(result.files.find(file => file.path === folder).isDirectory, true);
    assert.equal(result.files.find(file => file.path === folder).exists, true);
    assert.equal(broadcasts, 1);
    const { id } = await handler(event, { operation: 'create', name: 'Preview' });
    await handler(event, { operation: 'add', id, paths: [folder, files[0]] });
    assert.equal((await handler(event, { operation: 'preview', id })).file.cover, `cover:${files[0]}`);
    assert.equal(broadcasts, 3);
});
