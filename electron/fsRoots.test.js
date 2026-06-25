import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getDefaultWindowsDriveRoot,
    listWindowsDriveRoots,
    normalizeDirectoryPathForRead,
    normalizeWindowsDriveRoot,
} from './fsRoots.js';

test('Windows drive roots are normalized to absolute root paths', () => {
    assert.equal(normalizeWindowsDriveRoot('C:'), 'C:\\');
    assert.equal(normalizeWindowsDriveRoot('c:'), 'C:\\');
    assert.equal(normalizeWindowsDriveRoot('D:\\'), 'D:\\');
    assert.equal(normalizeWindowsDriveRoot('E:/'), 'E:\\');
    assert.equal(normalizeWindowsDriveRoot('C:\\Books'), '');
});

test('Windows drive roots are discovered from available drive letters', () => {
    const checkedRoots = [];
    const roots = listWindowsDriveRoots({
        driveLetters: ['C', 'D', 'E'],
        existsSync: root => {
            checkedRoots.push(root);
            return root === 'C:\\' || root === 'E:\\';
        },
    });

    assert.deepEqual(roots, ['C:\\', 'E:\\']);
    assert.deepEqual(checkedRoots, ['C:\\', 'D:\\', 'E:\\']);
});

test('Windows root fallback uses SystemDrive when available', () => {
    assert.equal(getDefaultWindowsDriveRoot('D:'), 'D:\\');
    assert.equal(getDefaultWindowsDriveRoot(''), 'C:\\');
});

test('readDir normalizes bare Windows drive letters before reading', () => {
    assert.equal(normalizeDirectoryPathForRead('C:', 'win32'), 'C:\\');
    assert.equal(normalizeDirectoryPathForRead('C:\\Books', 'win32'), 'C:\\Books');
    assert.equal(normalizeDirectoryPathForRead('/Users/books', 'darwin'), '/Users/books');
});
