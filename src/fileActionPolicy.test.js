import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fileOperationErrorKind,
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
