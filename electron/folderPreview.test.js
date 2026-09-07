import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { inspectFolderFile, scanFolder } from './tasks/folderScanTask.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

function createFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-preview-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const folderPath = path.join(root, 'Book folder');
    fs.mkdirSync(folderPath);
    return {
        root,
        folderPath,
        options: {
            dbPath: path.join(root, 'library.db'),
            thumbnailDir: path.join(root, 'thumbnails'),
            sevenZExe: '',
        },
    };
}

async function createComic(filePath, withCover = true) {
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await replaceZipEntry(
        filePath,
        'ComicInfo.xml',
        '<ComicInfo><Title>File title</Title><Series>File series</Series><Writer>File writer</Writer></ComicInfo>',
    );
    if (withCover) await replaceZipEntry(filePath, '001.png', PNG_1X1);
}

test('폴더 미리보기는 직계 지원 파일을 자연정렬해 첫 파일의 썸네일만 사용한다', async t => {
    const { root, folderPath, options } = createFixture(t);
    const firstPath = path.join(folderPath, 'Book 2.CBZ');
    const secondPath = path.join(folderPath, 'Book 10.cbz');
    await createComic(secondPath);
    await createComic(firstPath);
    fs.writeFileSync(path.join(folderPath, 'Book 1.png'), PNG_1X1);
    const folderStats = fs.statSync(folderPath);
    const fileStats = fs.statSync(firstPath);

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.isDirectory, true);
    assert.equal(preview.is_folder, true);
    assert.equal(preview.path, folderPath);
    assert.equal(preview.full_path, folderPath);
    assert.equal(preview.folder_path, root);
    assert.equal(preview.name, 'Book folder');
    assert.equal(preview.title, 'Book folder');
    assert.equal(preview.size, 0);
    assert.equal(preview.mtime, folderStats.mtimeMs);
    assert.equal(preview.has_metadata, false);
    assert.equal(preview.series, undefined);
    assert.equal(preview.writer, undefined);
    assert.equal(preview.ext, '');
    assert.equal(preview.cover_file_path, firstPath);
    assert.equal(preview.cover_file_mtime, fileStats.mtimeMs);
    assert.equal(preview.cover_file_size, fileStats.size);
    assert.match(preview.cover, /^bookmanager-thumbnail:\/\/cache\//);
    assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);

    const library = new LibraryDB({ dbPath: options.dbPath });
    try {
        assert.equal((await library.getFileInfo(firstPath)).title, 'File title');
        assert.equal((await library.getFileInfo(firstPath)).thumb_path, preview.thumb_path);
        assert.equal(await library.getFileInfo(secondPath), null);
        assert.equal(await library.getFileInfo(folderPath), null);
    } finally {
        await library.close();
    }
});

test('폴더 미리보기는 첫 파일의 유효한 썸네일 캐시를 재사용한다', async t => {
    const { folderPath, options } = createFixture(t);
    const filePath = path.join(folderPath, 'Cached.cbz');
    await createComic(filePath);
    const filePreview = await inspectFolderFile(filePath, options);
    const fileStats = fs.statSync(filePath);
    fs.writeFileSync(filePath, Buffer.alloc(fileStats.size));
    fs.utimesSync(filePath, fileStats.atime, fileStats.mtime);

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.cover_file_path, filePath);
    assert.equal(preview.thumb_path, filePreview.thumb_path);
    assert.equal(preview.cover, filePreview.cover);
    assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);
});

for (const contents of ['empty', 'unsupported', 'hidden']) {
    test(`폴더 미리보기는 탐색할 지원 파일이 없으면 빈 표지를 반환한다 (${contents})`, async t => {
        const { folderPath, options } = createFixture(t);
        if (contents === 'unsupported') {
            fs.writeFileSync(path.join(folderPath, 'cover.png'), PNG_1X1);
            fs.writeFileSync(path.join(folderPath, 'notes.md'), 'notes');
        } else if (contents === 'hidden') {
            const nestedPath = path.join(folderPath, '.hidden');
            fs.mkdirSync(nestedPath);
            await createComic(path.join(nestedPath, 'Book.cbz'));
        }

        const preview = await inspectFolderFile(folderPath, options);

        assert.equal(preview.isDirectory, true);
        assert.equal(preview.path, folderPath);
        assert.equal(preview.cover, '');
        assert.equal(preview.thumb_path, '');
        assert.equal(preview.cover_file_path, '');
        assert.equal(preview.cover_file_mtime, 0);
        assert.equal(preview.cover_file_size, 0);
        assert.equal(fs.existsSync(options.dbPath), false);
        assert.equal(fs.existsSync(options.thumbnailDir), false);
    });
}

test('첫 지원 파일에 표지가 없으면 하위 폴더보다 다음 직계 지원 파일을 우선한다', async t => {
    const { folderPath, options } = createFixture(t);
    const firstPath = path.join(folderPath, 'Book 2.cbz');
    const secondPath = path.join(folderPath, 'Book 10.cbz');
    await createComic(firstPath, false);
    await createComic(secondPath);
    const childPath = path.join(folderPath, 'Child');
    fs.mkdirSync(childPath);
    await createComic(path.join(childPath, 'Book.cbz'));

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.isDirectory, true);
    assert.equal(preview.cover_file_path, secondPath);
    assert.equal(preview.cover_file_mtime, fs.statSync(secondPath).mtimeMs);
    assert.equal(preview.cover_file_size, fs.statSync(secondPath).size);
    assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);
});

test('첫 지원 파일이 손상되어도 다음 지원 파일에서 표지를 찾는다', async t => {
    const { folderPath, options } = createFixture(t);
    const firstPath = path.join(folderPath, 'Book 2.cbz');
    const secondPath = path.join(folderPath, 'Book 10.cbz');
    fs.writeFileSync(firstPath, 'invalid archive');
    await createComic(secondPath);

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.isDirectory, true);
    assert.equal(preview.path, folderPath);
    assert.equal(preview.cover_file_path, secondPath);
    assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);
});

for (const depth of [3, 4]) {
    test(`폴더 미리보기의 하위 폴더 탐색은 3단계로 제한한다 (depth=${depth})`, async t => {
        const { folderPath, options } = createFixture(t);
        const nestedPath = path.join(folderPath, ...Array.from({ length: depth }, (_, index) => `Depth ${index + 1}`));
        const filePath = path.join(nestedPath, 'Book.cbz');
        fs.mkdirSync(nestedPath, { recursive: true });
        await createComic(filePath);

        const preview = await inspectFolderFile(folderPath, options);

        assert.equal(preview.isDirectory, true);
        assert.equal(preview.path, folderPath);
        assert.equal(preview.title, 'Book folder');
        assert.equal(preview.size, 0);
        assert.equal(preview.has_metadata, false);
        if (depth === 3) {
            assert.equal(preview.cover_file_path, filePath);
            assert.equal(preview.cover_file_mtime, fs.statSync(filePath).mtimeMs);
            assert.equal(preview.cover_file_size, fs.statSync(filePath).size);
            assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);
        } else {
            assert.equal(preview.cover, '');
            assert.equal(preview.thumb_path, '');
            assert.equal(preview.cover_file_path, '');
            assert.equal(fs.existsSync(options.dbPath), false);
        }
    });
}

test('폴더 미리보기는 이름순으로 앞선 먼 폴더보다 가까운 폴더의 표지를 선택한다', async t => {
    const { folderPath, options } = createFixture(t);
    const deeperPath = path.join(folderPath, 'Folder 2', 'Deep', 'Book.cbz');
    const nearerPath = path.join(folderPath, 'Folder 10', 'Book.cbz');
    for (const filePath of [deeperPath, nearerPath]) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await createComic(filePath);
    }

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.cover_file_path, nearerPath);
    const library = new LibraryDB({ dbPath: options.dbPath });
    try {
        assert.equal(await library.getFileInfo(deeperPath), null);
        assert.equal(await library.getFileInfo(folderPath), null);
    } finally {
        await library.close();
    }
});

test('같은 깊이의 폴더는 이름을 자연정렬해 표지를 선택한다', async t => {
    const { folderPath, options } = createFixture(t);
    for (const directoryName of ['Folder 10', 'Folder 2']) {
        const childPath = path.join(folderPath, directoryName);
        fs.mkdirSync(childPath);
        await createComic(path.join(childPath, 'Book.cbz'));
    }

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.cover_file_path, path.join(folderPath, 'Folder 2', 'Book.cbz'));
});

test('현재 폴더의 지원 파일에 표지가 없으면 하위 폴더에서 표지를 찾는다', async t => {
    const { folderPath, options } = createFixture(t);
    const firstPath = path.join(folderPath, 'Book 2.cbz');
    const secondPath = path.join(folderPath, 'Book 10.cbz');
    const childPath = path.join(folderPath, 'Child');
    const nestedFilePath = path.join(childPath, 'Book.cbz');
    await createComic(firstPath, false);
    await createComic(secondPath, false);
    fs.mkdirSync(childPath);
    await createComic(nestedFilePath);

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.cover_file_path, nestedFilePath);
    assert.deepEqual(fs.readFileSync(preview.thumb_path), PNG_1X1);
    const library = new LibraryDB({ dbPath: options.dbPath });
    try {
        assert.equal((await library.getFileInfo(firstPath)).title, 'File title');
        assert.equal((await library.getFileInfo(nestedFilePath)).thumb_path, preview.thumb_path);
        assert.equal((await library.getFileInfo(secondPath)).title, 'File title');
        assert.equal(await library.getFileInfo(childPath), null);
        assert.equal(await library.getFileInfo(folderPath), null);
    } finally {
        await library.close();
    }
});

test('폴더 미리보기는 파일과 폴더 심볼릭 링크를 따라가지 않는다', async t => {
    const { root, folderPath, options } = createFixture(t);
    const externalPath = path.join(root, 'External');
    fs.mkdirSync(externalPath);
    const filePath = path.join(externalPath, 'Book.cbz');
    await createComic(filePath);
    try {
        fs.symlinkSync(externalPath, path.join(folderPath, 'Linked folder'), process.platform === 'win32' ? 'junction' : 'dir');
        fs.symlinkSync(filePath, path.join(folderPath, 'Linked file.cbz'), 'file');
    } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') {
            t.skip('Symbolic links require permission on this Windows host');
            return;
        }
        throw error;
    }

    const preview = await inspectFolderFile(folderPath, options);

    assert.equal(preview.cover, '');
    assert.equal(preview.cover_file_path, '');
    assert.equal(fs.existsSync(options.dbPath), false);
});

test('폴더 표지 탐색 중 취소되면 다음 폴더의 파일을 읽지 않는다', async t => {
    const { folderPath, options } = createFixture(t);
    const firstPath = path.join(folderPath, 'Folder 2', 'Book.cbz');
    const secondPath = path.join(folderPath, 'Folder 10', 'Book.cbz');
    for (const filePath of [firstPath, secondPath]) {
        fs.mkdirSync(path.dirname(filePath));
        await createComic(filePath, false);
    }
    let cancelled = false;
    const readPaths = [];
    await assert.rejects(inspectFolderFile(folderPath, {
        ...options,
        shouldCancel: () => cancelled,
        libraryDb: {
            async getFileInfo(filePath) {
                readPaths.push(filePath);
                cancelled = true;
                return null;
            },
            async upsertFileInfo() {},
        },
    }), { code: 'TASK_CANCELLED' });

    assert.deepEqual(readPaths, [firstPath]);
});

test('폴더 목록 스캔은 하위 폴더의 표지를 미리 추출하지 않는다', async t => {
    const { root, folderPath, options } = createFixture(t);
    await createComic(path.join(folderPath, 'Book.cbz'));
    const lookups = [];
    const rows = await scanFolder(root, {
        ...options,
        includeDirectories: true,
        includeSubfolders: false,
        libraryDb: {
            async getFileInfo(filePath) {
                lookups.push(filePath);
                return null;
            },
        },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, folderPath);
    assert.equal(rows[0].cover, '');
    assert.equal(Object.hasOwn(rows[0], 'cover_file_path'), false);
    assert.deepEqual(lookups, []);
    assert.equal(fs.existsSync(options.thumbnailDir), false);
});
