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
