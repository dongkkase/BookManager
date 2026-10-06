import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { readFolderDetails } from './folderDetails.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-details-'));
    const folder = path.join(root, '책_100%');
    fs.mkdirSync(folder);
    const library = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    t.after(async () => {
        await library.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const add = async (name, metadata = null) => {
        const filePath = path.join(folder, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'fixture');
        if (metadata) await library.upsertFileInfo({ path: filePath, ...metadata });
        return filePath;
    };
    return { root, folder, library, add };
}

test('폴더 상세 집계는 하위 폴더, 모든 일반 파일, 확인된 페이지와 오디오 시간을 합산한다', async t => {
    const { folder, library, add } = fixture(t);
    await add('Book.cbz', { page_count: '120' });
    await add('하위/Book.pdf', { page_count: '80' });
    await add('하위/더 아래/Audio.MP3', { duration_seconds: 3600 });
    await add('notes.nfo');
    fs.mkdirSync(path.join(folder, '빈 폴더'));

    assert.deepEqual(await readFolderDetails(folder, { libraryDb: library }), {
        fileCount: 4,
        folderCount: 3,
        pageCount: 200,
        unknownPageFileCount: 0,
        estimatedReadingSeconds: 7600,
        unknownReadingTimeFileCount: 0,
        unreadableFolderCount: 0,
        secondsPerPage: 20,
    });
});

test('미확인 페이지와 오디오 시간은 0으로 확정하지 않으며 삭제된 캐시 파일은 합산하지 않는다', async t => {
    const { folder, library, add } = fixture(t);
    await add('known.cbz', { page_count: 10 });
    await add('missing.cbz');
    await add('invalid.pdf', { page_count: 'unknown' });
    await add('zero.epub', { page_count: 0 });
    await add('audio.mp3');
    const deleted = await add('deleted.cbz', { page_count: 900 });
    fs.unlinkSync(deleted);

    const result = await readFolderDetails(folder, { libraryDb: library });
    assert.equal(result.fileCount, 5);
    assert.equal(result.pageCount, 10);
    assert.equal(result.unknownPageFileCount, 3);
    assert.equal(result.unknownReadingTimeFileCount, 4);
    assert.equal(result.estimatedReadingSeconds, 200);
});

test('폴더 상세 집계는 빈 폴더에서 실제 0을 반환하고 숨김 항목과 심볼릭 링크를 따라가지 않는다', async t => {
    const { root, folder, library, add } = fixture(t);
    await add('.hidden/Book.cbz', { page_count: 50 });
    await add('.DS_Store');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'Book.cbz'), 'fixture');
    try {
        fs.symlinkSync(outside, path.join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    }
    const result = await readFolderDetails(folder, { libraryDb: library });
    assert.equal(result.fileCount, 0);
    assert.equal(result.folderCount, 0);
    assert.equal(result.pageCount, 0);
    assert.equal(result.estimatedReadingSeconds, 0);
    assert.equal(result.unknownPageFileCount, 0);
});

test('폴더 메타데이터 조회는 경로의 %, _와 형제 폴더를 구분한다', async t => {
    const { root, folder, library, add } = fixture(t);
    const expectedPath = await add('Book.cbz', { page_count: 15 });
    await library.upsertFileInfo({ path: path.join(root, '책x100other', 'Book.cbz'), page_count: 999 });
    await library.upsertFileInfo({ path: path.join(root, '책_100% extra', 'Book.cbz'), page_count: 999 });
    const rows = await library.getFolderDetailMetadata(folder);
    assert.deepEqual(rows.map(row => row.path), [library.normalizeFilePath(expectedPath)]);
    assert.equal((await readFolderDetails(folder, { libraryDb: library })).pageCount, 15);
});

test('선택 변경으로 취소된 집계는 폴더를 더 읽지 않는다', async t => {
    const { folder, library } = fixture(t);
    await assert.rejects(readFolderDetails(folder, {
        libraryDb: library,
        shouldCancel: () => true,
    }), { code: 'TASK_CANCELLED' });
    let cancelled = false;
    const getMetadata = library.getFolderDetailMetadata.bind(library);
    t.mock.method(library, 'getFolderDetailMetadata', async value => {
        const rows = await getMetadata(value);
        cancelled = true;
        return rows;
    });
    await assert.rejects(readFolderDetails(folder, {
        libraryDb: library,
        shouldCancel: () => cancelled,
    }), { code: 'TASK_CANCELLED' });
});

test('읽을 수 없는 하위 폴더는 부분 집계로 표시하고 루트 폴더 오류는 전달한다', async t => {
    const { folder, library, add } = fixture(t);
    await add('known.cbz', { page_count: 20 });
    const blocked = path.join(folder, 'blocked');
    fs.mkdirSync(blocked);
    const readdir = fs.promises.readdir;
    t.mock.method(fs.promises, 'readdir', async (value, ...args) => {
        if (value === blocked) throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
        return readdir(value, ...args);
    });
    const result = await readFolderDetails(folder, { libraryDb: library });
    assert.equal(result.unreadableFolderCount, 1);
    assert.equal(result.folderCount, 1);
    assert.equal(result.pageCount, 20);
    await assert.rejects(readFolderDetails(path.join(folder, 'missing'), { libraryDb: library }), { code: 'ENOENT' });
});
