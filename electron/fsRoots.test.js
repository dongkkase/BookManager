import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    getDefaultWindowsDriveRoot,
    listWindowsDriveRoots,
    normalizeDirectoryPathForRead,
    normalizeWindowsDriveRoot,
} from './fsRoots.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const ipcSource = readFileSync(path.join(root, 'ipcHandlers.js'), 'utf8');

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

test('readDir IPC는 폴더 트리 이동 중 메인 프로세스 동기 readdir을 사용하지 않는다', () => {
    assert.match(ipcSource, /ipcMain\.handle\('fs:readDir',\s*async/);
    assert.match(ipcSource, /await fs\.promises\.readdir\(safeDirPath,\s*\{\s*withFileTypes:\s*true\s*\}\)/);
    assert.doesNotMatch(ipcSource, /readdirSync\(safeDirPath/);
});
