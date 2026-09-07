import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fileOperationErrorKind,
    folderEntryOperationTargets,
    protectedRenameName,
} from './fileActionPolicy.js';

test('확장자를 생략하면 원래 확장자를 보존한다', () => {
    assert.deepEqual(protectedRenameName('Book.cbz', 'Renamed'), {
        valid: true,
        protected: true,
        name: 'Renamed.cbz',
    });
});

test('확장자 변경과 빈 이름을 거부한다', () => {
    assert.equal(protectedRenameName('Book.cbz', 'Book.zip').reason, 'extension');
    assert.equal(protectedRenameName('Book.cbz', ' ').reason, 'empty');
});

test('권한 오류와 중복 오류를 구분한다', () => {
    assert.equal(fileOperationErrorKind({ code: 'EPERM' }), 'permission');
    assert.equal(fileOperationErrorKind({ code: 'EEXIST' }), 'duplicate');
    assert.equal(fileOperationErrorKind({ message: 'unknown' }), 'general');
});

test('폴더와 내부 파일을 함께 선택하면 폴더만 작업 대상으로 남긴다', () => {
    const folder = { path: '/books/Series', isDirectory: true };
    const neighbor = { path: '/books/Series 2/book.cbz' };
    assert.deepEqual(folderEntryOperationTargets([
        { path: '/books/Series/book.cbz' },
        folder,
        { path: '/books/Series/Child', isDirectory: true },
        neighbor,
        folder,
    ]), [folder, neighbor]);
});

test('Windows 경로의 대소문자와 구분자를 정규화하고 서로 다른 POSIX 경로를 보존한다', () => {
    const windowsFolder = { path: 'C:\\Books\\Series\\', isDirectory: true };
    assert.deepEqual(folderEntryOperationTargets([
        windowsFolder,
        { full_path: 'c:/books/series/book.cbz' },
        { path: 'c:/books/series' },
    ]), [windowsFolder]);
    const entries = [{ path: '/Books/book.cbz' }, { path: '/books/book.cbz' }];
    assert.deepEqual(folderEntryOperationTargets(entries), entries);
    assert.deepEqual(folderEntryOperationTargets([null, {}]), []);
});
