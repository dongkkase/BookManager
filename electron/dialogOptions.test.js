import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ARCHIVE_FILTER,
    createArchiveDialogOptions,
    createFolderDialogOptions,
    normalizeArchiveDialogResult,
    normalizeFileDialogResult,
    normalizeFilesDialogResult,
    normalizeFolderDialogResult,
    normalizeSaveDialogResult,
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

test('모든 선택기 결과에 공통 경로 정규화를 적용한다', () => {
    assert.equal(
        normalizeFolderDialogResult({ filePaths: ['//NAS/공유/만화'] }, 'win32'),
        '\\\\NAS\\공유\\만화',
    );
    assert.equal(
        normalizeFileDialogResult({ filePaths: ['C:/도구/뷰어.exe'] }, 'win32'),
        'C:\\도구\\뷰어.exe',
    );
    assert.deepEqual(
        normalizeFilesDialogResult({ filePaths: ['C:/책/a.cbz', 'c:\\책\\a.cbz'] }, 'win32'),
        ['C:\\책\\a.cbz'],
    );
    assert.equal(
        normalizeSaveDialogResult({ filePath: `/tmp/${'한글'.normalize('NFD')}.csv` }, 'darwin'),
        '/tmp/한글.csv',
    );
});

test('일반 선택기 취소도 기존 상태를 변경하지 않는 값으로 반환한다', () => {
    assert.equal(normalizeFileDialogResult({ canceled: true, filePaths: ['/tmp/a'] }), null);
    assert.deepEqual(normalizeFilesDialogResult({ canceled: true, filePaths: ['/tmp/a'] }), []);
    assert.equal(normalizeSaveDialogResult({ canceled: true, filePath: '/tmp/a' }), null);
});
