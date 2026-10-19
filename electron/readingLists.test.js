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
    const controllers = [];
    const folder = path.join(root, 'books_%');
    await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
    const files = ['first.epub', 'nested/second.cbz'].map(name => path.join(folder, name));
    for (const file of files) await fs.writeFile(file, 'fixture');
    t.after(async () => {
        for (const controller of controllers) await controller.dispose();
        await db.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    const libraries = [folder];
    return { root, db, dbPath, folder, files, libraries, controllers, request: request => readingListsRequest(db, request, libraries) };
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

test('등록 여부는 정규화한 선택 경로만 조회하고 사라진 항목도 유지한다', async t => {
    const { folder, files, request } = await fixture(t);
    const membership = paths => request({ operation: 'membership', id: 'want-to-read', paths });
    assert.deepEqual(await membership([files[0]]), { totalCount: 1, memberCount: 0 });
    await request({ operation: 'add', id: 'want-to-read', paths: [files[0]] });
    assert.deepEqual(await membership([files[0]]), { totalCount: 1, memberCount: 1 });
    assert.deepEqual(await membership([folder]), { totalCount: 1, memberCount: 0 });
    await request({ operation: 'add', id: 'want-to-read', paths: [folder] });
    assert.deepEqual(await membership([files[1]]), { totalCount: 1, memberCount: 0 });
    assert.deepEqual(await membership([
        folder, `${folder}${path.sep}`, `${folder}${path.sep}nested${path.sep}..`, ...files, files[0],
    ]), { totalCount: 3, memberCount: 2 });
    const before = (await request({ operation: 'list', id: 'want-to-read' })).rows;
    await fs.unlink(files[0]);
    assert.deepEqual(await membership([files[0]]), { totalCount: 1, memberCount: 1 });
    assert.deepEqual((await request({ operation: 'list', id: 'want-to-read' })).rows, before);
    const { id } = await request({ operation: 'create', name: 'Separate membership' });
    await request({ operation: 'add', id, paths: [files[1]] });
    assert.deepEqual(await request({ operation: 'membership', id, paths: [folder, ...files] }), { totalCount: 3, memberCount: 1 });
    assert.deepEqual(await membership([folder, ...files]), { totalCount: 3, memberCount: 2 });
});

test('등록 여부 조회는 잘못된 목록과 경로를 거부한다', async t => {
    const { files, request } = await fixture(t);
    await assert.rejects(request({ operation: 'membership', id: 'missing', paths: files }), /list_not_found/);
    for (const paths of [[], ['../relative.epub'], [null], [`${files[0]}\0`], Array(10001).fill(files[0])]) {
        await assert.rejects(request({ operation: 'membership', id: 'want-to-read', paths }), /invalid_paths/);
    }
    assert.equal((await request({ operation: 'overview' })).wishlistCount, 0);
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
    sql.prepare('INSERT INTO reading_file_activity(path, added_at, updated_at) VALUES (?, ?, ?)').run('/missing-db-entry.epub', cutoff, cutoff);
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
    const outside = Array.from({ length: 1005 }, (_, index) => ({ path: path.join(`${folder}-outside`, `${index}.epub`) }));
    await db.upsertFileInfoBulk([...files, ...outside]);
    const sql = db.getConnection();
    const now = Date.now() - 3600000;
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

test('최근 목록과 배지는 현재 등록된 라이브러리 경로만 반영하며 다른 읽기 목록을 유지한다', async t => {
    const { root, db, folder, files, libraries, request } = await fixture(t);
    const outside = path.join(root, 'outside.epub');
    const sibling = path.join(`${folder}-other`, 'sibling.epub');
    await fs.writeFile(outside, 'fixture');
    await db.upsertFileInfoBulk([...files, outside, sibling].map(filePath => ({ path: filePath, mtime: Date.now() / 1000 })));
    await request({ operation: 'add', id: 'want-to-read', paths: [files[0], outside] });
    const checkRecent = async expected => {
        for (const id of ['recent-added', 'recent-updated']) {
            assert.deepEqual((await request({ operation: 'list', id })).rows.map(row => row.path).sort(), [...expected].sort());
        }
        const overview = await request({ operation: 'overview' });
        assert.equal(overview.recentAddedCount, expected.length);
        assert.equal(overview.recentUpdatedCount, expected.length);
        assert.equal(overview.wishlistCount, 2);
    };
    await checkRecent(files);
    libraries.push(path.dirname(files[1]), folder);
    await checkRecent(files);
    libraries.splice(0, libraries.length, path.dirname(files[1]));
    await checkRecent([files[1]]);
    libraries.splice(0);
    await checkRecent([]);
    assert.equal((await request({ operation: 'list', id: 'want-to-read' })).rows.length, 2);
    assert.equal(db.getConnection().prepare('SELECT COUNT(*) AS count FROM files').get().count, 4);
    libraries.push(folder);
    await checkRecent(files);
});

test('최근 목록은 운영체제 경로와 특수문자를 리터럴로 비교하고 루트 라이브러리를 지원한다', async t => {
    for (const platform of ['linux', 'darwin', 'win32']) {
        const { db } = await fixture(t);
        db.platform = platform;
        const paths = platform === 'win32' ? path.win32 : path.posix;
        const volume = platform === 'win32' ? 'C:\\' : '/';
        const folder = paths.join(volume, 'Books_100%[a]', '한글');
        const inside = paths.join(folder, 'book.epub');
        const sibling = paths.join(`${folder}-other`, 'book.epub');
        const similar = paths.join(volume, 'BooksX100x[a]', '한글', 'book.epub');
        const otherCase = paths.join(volume, 'books_100%[a]', '한글', 'case.epub');
        const filePaths = [inside, sibling, similar, otherCase];
        await db.upsertFileInfoBulk(filePaths.map(filePath => ({ path: filePath, mtime: Date.now() / 1000 })));
        const expected = (platform === 'win32' ? [inside, otherCase] : [inside]).map(filePath => db.normalizeFilePath(filePath));
        const libraries = platform === 'darwin' ? [folder.normalize('NFC'), folder.normalize('NFD')] : [`${folder}${paths.sep}`];
        for (const id of ['recent-added', 'recent-updated']) {
            const { rows } = await readingListsRequest(db, { operation: 'list', id }, libraries);
            assert.deepEqual(rows.map(row => row.path).sort(), expected.sort(), platform);
            const all = await readingListsRequest(db, { operation: 'list', id }, [volume]);
            assert.equal(all.rows.length, 4, `${platform} root`);
        }
        const overview = await readingListsRequest(db, { operation: 'overview' }, libraries);
        assert.equal(overview.recentAddedCount, expected.length);
        assert.equal(overview.recentUpdatedCount, expected.length);
        const empty = await readingListsRequest(db, { operation: 'overview' }, ['', 'relative', null]);
        assert.equal(empty.recentAddedCount, 0);
        assert.equal(empty.recentUpdatedCount, 0);
    }
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
    const { dbPath, folder, files, controllers } = await fixture(t);
    let handler;
    let broadcasts = 0;
    let normalizedRows = 0;
    const mainFrame = {};
    const sender = { mainFrame };
    controllers.push(registerReadingListsIpc({
        ipcMain: { handle: (_name, fn) => { handler = fn; } },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => new LibraryDB({ dbPath }),
        normalizeFile: row => {
            normalizedRows += 1;
            return { ...row, full_path: row.path };
        },
        loadPreview: async filePath => ({ cover: `cover:${filePath}` }),
        broadcast: () => { broadcasts += 1; },
    }));
    const event = { sender, senderFrame: mainFrame };
    await assert.rejects(handler({ sender: {} }), /untrusted_sender/);
    await assert.rejects(handler({ sender, senderFrame: {} }), /untrusted_sender/);
    assert.equal((await handler(event, { operation: 'add', id: 'want-to-read', paths: [folder, ...files] })).success, true);
    const result = await handler(event, { operation: 'list', id: 'want-to-read' });
    assert.equal(result.files.length, 3);
    assert.equal(result.files.find(file => file.path === folder).isDirectory, true);
    assert.equal(result.files.find(file => file.path === folder).exists, true);
    assert.equal(broadcasts, 1);
    assert.deepEqual(await handler(event, { operation: 'membership', id: 'want-to-read', paths: [folder, ...files, files[0]] }), {
        success: true, totalCount: 3, memberCount: 3,
    });
    assert.equal(normalizedRows, 3);
    assert.equal(broadcasts, 1);
    assert.deepEqual(await handler(event, { operation: 'membership', id: 'missing', paths: files }), {
        success: false, error: 'list_not_found',
    });
    assert.equal(broadcasts, 1);
    const { id } = await handler(event, { operation: 'create', name: 'Preview' });
    await handler(event, { operation: 'add', id, paths: [folder, files[0]] });
    assert.equal((await handler(event, { operation: 'preview', id })).file.cover, `cover:${files[0]}`);
    assert.equal(broadcasts, 3);
});

test('최근 목록 IPC는 매 요청마다 서버의 등록 라이브러리를 읽고 클라이언트 경로를 사용하지 않는다', async t => {
    const { root, db, dbPath, folder, files, controllers } = await fixture(t);
    const outside = path.join(root, 'outside.epub');
    await fs.writeFile(outside, 'fixture');
    await db.upsertFileInfoBulk([...files, outside].map(filePath => ({ path: filePath, mtime: Date.now() / 1000 })));
    let libraries = [folder];
    let handler;
    const mainFrame = {};
    const sender = { mainFrame };
    controllers.push(registerReadingListsIpc({
        ipcMain: { handle: (_name, callback) => { handler = callback; } },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => new LibraryDB({ dbPath }),
        getLibraryPaths: () => libraries,
        normalizeFile: row => row,
        broadcast: () => assert.fail('Reading queries must not broadcast changes'),
    }));
    const event = { sender, senderFrame: mainFrame };
    for (const id of ['recent-added', 'recent-updated']) {
        const result = await handler(event, { operation: 'list', id, libraries: [root], libraryPaths: [root] });
        assert.equal(result.success, true);
        assert.deepEqual(result.files.map(file => file.path).sort(), [...files].sort());
    }
    libraries = [];
    const overview = await handler(event, { operation: 'overview' });
    assert.equal(overview.recentAddedCount, 0);
    assert.equal(overview.recentUpdatedCount, 0);
    assert.deepEqual((await handler(event, { operation: 'list', id: 'recent-added' })).files, []);
    libraries = [root];
    assert.equal((await handler(event, { operation: 'list', id: 'recent-updated' })).files.length, 3);
});
