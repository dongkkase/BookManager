import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeDirectoryPathForRead,
  normalizeWindowsDriveRoot,
  parseWindowsLogicalDiskRoots,
} from './fsRoots.js';

test('Windows drive roots are normalized to absolute root paths', () => {
  assert.equal(normalizeWindowsDriveRoot('C:'), 'C:\\');
  assert.equal(normalizeWindowsDriveRoot('c:'), 'C:\\');
  assert.equal(normalizeWindowsDriveRoot('D:\\'), 'D:\\');
  assert.equal(normalizeWindowsDriveRoot('E:/'), 'E:\\');
  assert.equal(normalizeWindowsDriveRoot('C:\\Books'), '');
});

test('WMIC logical disk output is parsed as absolute drive roots', () => {
  const output = 'Name\r\r\nC:\r\r\nD:\r\r\n\r\r\n';
  assert.deepEqual(parseWindowsLogicalDiskRoots(output), ['C:\\', 'D:\\']);
});

test('readDir normalizes bare Windows drive letters before reading', () => {
  assert.equal(normalizeDirectoryPathForRead('C:', 'win32'), 'C:\\');
  assert.equal(normalizeDirectoryPathForRead('C:\\Books', 'win32'), 'C:\\Books');
  assert.equal(normalizeDirectoryPathForRead('/Users/books', 'darwin'), '/Users/books');
});
