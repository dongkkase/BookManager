import assert from 'node:assert/strict';
import test from 'node:test';

import {
    addPendingOpenFiles,
    resolveLaunchFilePaths,
} from './openFileLaunchPolicy.js';

const fileStats = { isFile: () => true };

test('launch arguments keep existing supported files and ignore switches', () => {
    const paths = resolveLaunchFilePaths([
        'BookManager.exe',
        '--original-process-start-time=123',
        'books/My Book.cbz',
        'books/tool.exe',
    ], {
        workingDirectory: '/library',
        platform: 'win32',
        existsSync: candidate => candidate.endsWith('.cbz') || candidate.endsWith('.exe'),
        statSync: () => fileStats,
    });

    assert.deepEqual(paths, ['/library/books/My Book.cbz']);
});

test('launch arguments accept quoted absolute paths and reject directories', () => {
    const paths = resolveLaunchFilePaths(['"/library/Book.epub"', '/library/folder.pdf'], {
        platform: 'darwin',
        existsSync: () => true,
        statSync: candidate => ({ isFile: () => candidate.endsWith('.epub') }),
    });

    assert.deepEqual(paths, ['/library/Book.epub']);
});

test('pending queue de-duplicates Windows paths case-insensitively', () => {
    const queue = ['C:\\Books\\One.cbz'];
    addPendingOpenFiles(queue, ['c:\\books\\ONE.cbz', 'C:\\Books\\Two.epub'], 'win32');
    assert.deepEqual(queue, ['C:\\Books\\One.cbz', 'C:\\Books\\Two.epub']);
});
