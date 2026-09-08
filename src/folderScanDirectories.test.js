import assert from 'node:assert/strict';
import test from 'node:test';
import { readQuickListFiles } from './hooks/useFolderScan.js';

test('렌더러의 빠른 목록은 요청한 경우 숨김 폴더를 제외한 직계 폴더를 포함한다', async t => {
    const originalWindow = globalThis.window;
    globalThis.window = {
        electronAPI: {
            readDir: async folderPath => {
                assert.equal(folderPath, '/books');
                return [
                    { name: 'Book.cbz', isFile: true, isDirectory: false },
                    { name: 'Empty folder', isFile: false, isDirectory: true },
                    { name: 'Folder.pdf', isFile: false, isDirectory: true },
                    { name: '.hidden', isFile: false, isDirectory: true },
                    { name: 'Ignored.md', isFile: true, isDirectory: false },
                ];
            },
        },
    };
    t.after(() => {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });

    const files = await readQuickListFiles('/books');
    assert.deepEqual(files.map(file => file.name), ['Book.cbz']);
    const rows = await readQuickListFiles('/books', { includeDirectories: true });
    assert.deepEqual(rows.filter(row => !row.isDirectory), files);
    const directories = rows.filter(row => row.isDirectory);
    assert.deepEqual(directories.map(row => row.name), ['Empty folder', 'Folder.pdf']);
    assert.equal(directories[1].title, 'Folder.pdf');
    assert.equal(directories[1].path, '/books/Folder.pdf');
    assert.equal(directories[1].folder_path, '/books');
    assert.equal(directories[1].is_folder, true);
    assert.equal(directories[1].ext, '');
    assert.equal(directories[1].has_metadata, false);
});

test('빠른 목록은 같은 경로가 반복되어도 한 번만 표시하고 다른 이름의 폴더는 유지한다', async t => {
    const originalWindow = globalThis.window;
    const entries = [
        { name: 'Series', isDirectory: true },
        { name: 'series', isDirectory: true },
        { name: 'Book.cbz', isFile: true },
    ];
    globalThis.window = { electronAPI: { readDir: async () => Array.from({ length: 7 }, () => entries).flat() } };
    t.after(() => {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    });

    const rows = await readQuickListFiles('/books', { includeDirectories: true });
    assert.deepEqual(rows.map(row => row.path), ['/books/Series', '/books/series', '/books/Book.cbz']);
    assert.deepEqual((await readQuickListFiles('/books')).map(row => row.path), ['/books/Book.cbz']);
});
