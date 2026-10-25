import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { hydrateReadingListRows, readingListsRequest, registerReadingListsIpc } from './readingLists.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-reading-catalog-'));
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    const folder = path.join(root, 'books_%[a]');
    t.after(async () => {
        await library.close();
        await fs.rm(root, { recursive: true, force: true });
    });
    return { root, library, folder };
}

test('라이브러리 카탈로그는 전체 기간의 지원 도서를 중복 없이 조회하고 표시 정보와 추가일을 보존한다', async t => {
    const { root, library, folder } = await fixture(t);
    const records = Array.from({ length: 1003 }, (_, index) => ({
        path: path.join(folder, 'nested', `${String(index).padStart(4, '0')}.epub`),
        title: `Book ${index}`,
        series: 'A series',
        writer: 'Writer One, Writer Two',
        creators: '[{"name":"Writer One","role":"writer"}]',
        summary: 'Book description',
        notes: 'Long notes',
        thumb_path: path.join(root, 'thumbnails', `${index}.jpg`),
        cover_override_path: path.join(root, 'custom-covers', `${index}.jpg`),
        has_metadata: 1,
        metadata_override: 1,
        size: index + 100,
        mtime: 1700000000 + index,
    }));
    const formats = ['cbz', 'cbr', 'cb7', 'PDF', 'txt', 'm4b', 'mp3'];
    const supported = formats.map(extension => ({ path: path.join(folder, `book.${extension}`) }));
    const excluded = [
        path.join(folder, 'cover.jpg'),
        path.join(folder, 'settings.json'),
        path.join(`${folder}-other`, 'sibling.epub'),
        path.join(root, 'outside.epub'),
    ];
    await library.upsertFileInfoBulk([...records, ...supported, ...excluded.map(filePath => ({ path: filePath }))]);
    const db = library.getConnection();
    const addedAt = '2020-01-02T00:00:00.000Z';
    db.prepare('UPDATE reading_file_activity SET added_at = ?, updated_at = ?').run(addedAt, addedAt);
    const withoutActivity = library.normalizeFilePath(supported[0].path);
    db.prepare('DELETE FROM reading_file_activity WHERE path = ?').run(withoutActivity);
    const { rows } = await readingListsRequest(library, { operation: 'list', id: 'library-catalog' }, [
        folder, path.join(folder, 'nested'), folder,
    ]);
    assert.equal(rows.length, records.length + supported.length);
    assert.equal(new Set(rows.map(row => row.path)).size, rows.length);
    const first = rows.find(row => row.path === library.normalizeFilePath(records[0].path));
    for (const field of ['title', 'series', 'writer', 'creators', 'thumb_path', 'cover_override_path', 'has_metadata', 'metadata_override', 'size', 'mtime']) {
        assert.equal(first[field], records[0][field], field);
    }
    assert.equal(Object.hasOwn(first, 'summary'), false);
    assert.equal(Object.hasOwn(first, 'notes'), false);
    assert.equal(first.list_added_at, addedAt);
    assert.equal(rows.find(row => row.path === withoutActivity).list_added_at, '');
    assert.ok(excluded.every(filePath => !rows.some(row => row.path === library.normalizeFilePath(filePath))));
    assert.deepEqual((await readingListsRequest(library, { operation: 'list', id: 'library-catalog' }, [])).rows, []);
    const overview = await readingListsRequest(library, { operation: 'overview' }, [folder]);
    assert.equal(overview.recentAddedCount, 0);
    assert.equal(overview.recentUpdatedCount, 0);
});

test('라이브러리 카탈로그는 운영체제별 경로 대소문자와 특수문자를 구분한다', async t => {
    for (const platform of ['linux', 'darwin', 'win32']) {
        const { library } = await fixture(t);
        library.platform = platform;
        const paths = platform === 'win32' ? path.win32 : path.posix;
        const volume = platform === 'win32' ? 'C:\\' : '/';
        const folder = paths.join(volume, 'Books_100%[a]', '한글');
        const inside = paths.join(folder, 'book.epub');
        const otherCase = paths.join(volume, 'books_100%[a]', '한글', 'case.epub');
        const filePaths = [
            inside,
            otherCase,
            paths.join(`${folder}-other`, 'sibling.epub'),
            paths.join(volume, 'BooksX100x[a]', '한글', 'similar.epub'),
        ];
        await library.upsertFileInfoBulk(filePaths.map(filePath => ({ path: filePath })));
        const libraries = platform === 'darwin' ? [folder.normalize('NFC'), folder.normalize('NFD')] : [folder];
        const { rows } = await readingListsRequest(library, { operation: 'list', id: 'library-catalog' }, libraries);
        const expected = (platform === 'win32' ? [inside, otherCase] : [inside]).map(filePath => library.normalizeFilePath(filePath));
        assert.deepEqual(rows.map(row => row.path).sort(), expected.sort(), platform);
        const all = await readingListsRequest(library, { operation: 'list', id: 'library-catalog' }, [volume]);
        assert.equal(all.rows.length, filePaths.length, `${platform} root`);
        const empty = await readingListsRequest(library, { operation: 'list', id: 'library-catalog' }, ['', 'relative', null]);
        assert.deepEqual(empty.rows, [], platform);
    }
});

test('라이브러리 카탈로그 IPC는 stat 없이 정규화하고 현재 등록 경로 변경을 반영한다', async t => {
    const { root, library, folder } = await fixture(t);
    const record = {
        path: path.join(folder, 'book.epub'),
        title: 'A book',
        writer: 'An author',
        thumb_path: path.join(root, 'cached.jpg'),
        size: 123,
        mtime: 1700000000,
    };
    const outside = path.join(root, 'outside.epub');
    await library.upsertFileInfoBulk([record, { path: outside, title: 'Outside' }]);
    const addedAt = '2026-01-02T00:00:00.000Z';
    library.getConnection().prepare('UPDATE reading_file_activity SET added_at = ?').run(addedAt);
    const handlers = new Map();
    const sender = { mainFrame: {} };
    let libraries = [folder];
    const controller = registerReadingListsIpc({
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        getMainWindow: () => ({ webContents: sender, isDestroyed: () => false }),
        createLibrary: () => library,
        getLibraryPaths: () => libraries,
        normalizeFile: row => ({
            ...row,
            full_path: row.path,
            cover: `cached:${row.thumb_path}`,
            description: 'Detailed metadata is loaded when a book is selected',
            duplicate_matches: [],
        }),
        broadcast: () => assert.fail('Catalog reads must not broadcast changes'),
    });
    const stat = t.mock.method(fs, 'stat', () => assert.fail('Catalog reads must not access original files'));
    const request = () => handlers.get('reading:lists')({ sender, senderFrame: sender.mainFrame }, {
        operation: 'list', id: 'library-catalog', libraryPaths: [root],
    });
    try {
        const result = await request();
        assert.equal(result.success, true);
        assert.equal(result.files.length, 1);
        const file = result.files[0];
        assert.equal(file.full_path, library.normalizeFilePath(record.path));
        assert.equal(file.writer, record.writer);
        assert.equal(file.cover, `cached:${record.thumb_path}`);
        assert.equal(file.size, record.size);
        assert.equal(file.mtime, record.mtime);
        assert.equal(file.readingListAddedAt, addedAt);
        assert.equal(Object.hasOwn(file, 'list_added_at'), false);
        assert.equal(Object.hasOwn(file, 'description'), false);
        assert.equal(Object.hasOwn(file, 'duplicate_matches'), false);
        assert.equal(Object.hasOwn(file, 'exists'), false);
        assert.equal(file.isDirectory, false);
        libraries = [];
        assert.deepEqual((await request()).files, []);
        libraries = [root];
        assert.equal((await request()).files.length, 2);
        assert.equal(stat.mock.callCount(), 0);
    } finally {
        await controller.dispose();
    }
});

test('대량 카탈로그 정규화 중에도 이벤트 루프를 양보하고 도서 순서와 표시 정보를 유지한다', async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => ({
        path: `/books/${index}.epub`,
        title: `Book ${index}`,
        writer: `Author ${index % 10}`,
        list_added_at: '2026-01-02T00:00:00.000Z',
    }));
    let processed = 0;
    const event = new Promise(resolve => setImmediate(() => resolve(processed)));
    const pending = hydrateReadingListRows(rows, row => {
        processed += 1;
        return { ...row, full_path: row.path, cover: `cached:${row.path}` };
    }, { verifyPresence: false, catalog: true });
    const beforeCompletion = await event;
    assert.ok(beforeCompletion > 0 && beforeCompletion < rows.length, 'Window and IPC events must run before catalog hydration completes');
    const files = await pending;
    assert.equal(processed, rows.length);
    assert.deepEqual(files.map(file => file.path), rows.map(row => row.path));
    for (const index of [0, 499, 500, rows.length - 1]) {
        assert.equal(files[index].title, rows[index].title);
        assert.equal(files[index].writer, rows[index].writer);
        assert.equal(files[index].cover, `cached:${rows[index].path}`);
        assert.equal(files[index].readingListAddedAt, rows[index].list_added_at);
    }
});
