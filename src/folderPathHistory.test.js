import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GOTO_PATH_HISTORY_LIMIT,
    addGotoPathHistory,
    normalizeGotoPathHistory,
} from './folderPathHistory.js';

test('최근 경로는 원문을 보존하고 공백과 빈 값을 정리하며 NFC 기준으로 중복을 제거한다', () => {
    const decomposedPath = '/books/e\u0301';

    assert.deepEqual(normalizeGotoPathHistory([
        '  /books/recent  ',
        '',
        '   ',
        null,
        decomposedPath,
        '/books/\u00e9',
    ], 'darwin'), [
        '/books/recent',
        '/books/e\u0301',
    ]);
});

test('최근 경로는 입력된 최근순을 유지하며 최대 15개만 반환한다', () => {
    const paths = Array.from({ length: GOTO_PATH_HISTORY_LIMIT + 5 }, (_, index) => `/books/${index}`);
    const history = normalizeGotoPathHistory(paths, 'darwin');

    assert.equal(history.length, GOTO_PATH_HISTORY_LIMIT);
    assert.deepEqual(history, paths.slice(0, GOTO_PATH_HISTORY_LIMIT));
});

test('Windows에서는 경로 대소문자를 구분하지 않고 첫 항목을 유지한다', () => {
    assert.deepEqual(normalizeGotoPathHistory([
        'C:\\Books\\Recent',
        'c:\\books\\recent',
        'C:/Books/Recent/',
        'C:\\Books\\Other',
    ], 'win32'), [
        'C:\\Books\\Recent',
        'C:\\Books\\Other',
    ]);
});

test('동일한 폴더의 마지막 구분자 차이는 중복으로 처리한다', () => {
    assert.deepEqual(normalizeGotoPathHistory([
        '/books/recent/',
        '/books/recent',
        '/',
    ], 'darwin'), [
        '/books/recent/',
        '/',
    ]);
});

test('Windows 이외 플랫폼에서는 경로 대소문자를 구분한다', () => {
    assert.deepEqual(normalizeGotoPathHistory([
        '/Books/Recent',
        '/books/recent',
    ], 'darwin'), [
        '/Books/Recent',
        '/books/recent',
    ]);
});

test('성공한 새 경로는 기록 맨 앞에 추가되고 기존 중복은 제거된다', () => {
    assert.deepEqual(addGotoPathHistory([
        '/books/one',
        '/books/two',
        '/books/three',
    ], ' /books/two ', 'linux'), [
        '/books/two',
        '/books/one',
        '/books/three',
    ]);

    assert.deepEqual(addGotoPathHistory([
        'C:\\Books\\One',
        'C:\\Books\\Two',
    ], 'c:\\books\\one', 'win32'), [
        'c:\\books\\one',
        'C:\\Books\\Two',
    ]);
});

test('비어 있거나 잘못된 기록 입력은 안전하게 처리한다', () => {
    assert.deepEqual(normalizeGotoPathHistory(undefined, 'linux'), []);
    assert.deepEqual(addGotoPathHistory(undefined, ' /books/new ', 'linux'), ['/books/new']);
    assert.deepEqual(addGotoPathHistory(['/books/one'], '   ', 'linux'), ['/books/one']);
});
