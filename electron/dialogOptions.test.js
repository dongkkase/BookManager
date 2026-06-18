import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ARCHIVE_FILTER,
    createArchiveDialogOptions,
    createFolderDialogOptions,
    normalizeArchiveDialogResult,
    normalizeFolderDialogResult,
} from './dialogOptions.js';

test('폴더 선택기는 디렉터리만 선택한다', () => {
    assert.deepEqual(createFolderDialogOptions('Select Directory'), {
        title: 'Select Directory',
        properties: ['openDirectory'],
    });
});

test('아카이브 선택기는 지원 확장자와 다중 선택을 제공한다', () => {
    assert.deepEqual(ARCHIVE_FILTER.extensions, ['zip', 'cbz', 'cbr', '7z', 'rar']);
    assert.deepEqual(createArchiveDialogOptions('Select Archives'), {
        title: 'Select Archives',
        properties: ['openFile', 'multiSelections'],
        filters: [ARCHIVE_FILTER],
    });
});

test('폴더 선택 취소는 null을 반환한다', () => {
    assert.equal(normalizeFolderDialogResult({ canceled: true, filePaths: ['/tmp/book'] }), null);
    assert.equal(normalizeFolderDialogResult({ canceled: false, filePaths: [] }), null);
});

test('아카이브 선택 취소는 빈 목록을 반환한다', () => {
    assert.deepEqual(
        normalizeArchiveDialogResult({ canceled: true, filePaths: ['/tmp/book.cbz'] }),
        [],
    );
    assert.deepEqual(
        normalizeArchiveDialogResult({
            canceled: false,
            filePaths: ['/tmp/a.cbz', '/tmp/b.zip'],
        }),
        ['/tmp/a.cbz', '/tmp/b.zip'],
    );
});
