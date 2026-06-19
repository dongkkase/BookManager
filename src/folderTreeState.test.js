import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ancestorPathsBetween,
    chooseTreeRoot,
    isSameOrDescendantPath,
    joinTreePath,
    parentTreePath,
    resolveSelectionAfterDelete,
} from './folderTreeState.js';

test('Windows와 POSIX 트리 자식 경로를 네이티브 구분자로 결합한다', () => {
    assert.equal(joinTreePath('C:\\Books', 'Manga'), 'C:\\Books\\Manga');
    assert.equal(joinTreePath('/Volumes/NAS', '漫画'), '/Volumes/NAS/漫画');
});

test('선택 경로까지 확장할 조상 경로를 계산한다', () => {
    assert.deepEqual(
        ancestorPathsBetween('/books', '/books/manga/action'),
        ['/books', '/books/manga', '/books/manga/action'],
    );
});

test('선택 경로를 포함하는 가장 구체적인 루트를 선택한다', () => {
    assert.deepEqual(chooseTreeRoot([
        { path: '/' },
        { path: '/books' },
    ], '/books/manga'), { path: '/books' });
});

test('Windows 경로의 하위 여부는 대소문자를 무시한다', () => {
    assert.equal(isSameOrDescendantPath('C:\\BOOKS\\Manga', 'c:\\books'), true);
});

test('POSIX 루트는 모든 절대 경로의 조상으로 처리한다', () => {
    assert.equal(isSameOrDescendantPath('/Users/books', '/'), true);
});

test('상위 폴더 경로를 계산할 때 파일 시스템 루트를 보존한다', () => {
    assert.equal(parentTreePath('/Users/books'), '/Users');
    assert.equal(parentTreePath('/Users'), '/');
    assert.equal(parentTreePath('C:\\Books'), 'C:\\');
});

test('삭제 후 다음, 이전, 상위 폴더 순서로 선택한다', () => {
    const siblings = ['/Books/A', '/Books/B', '/Books/C'];
    assert.equal(resolveSelectionAfterDelete('/Books/B', siblings), '/Books/C');
    assert.equal(resolveSelectionAfterDelete('/Books/C', siblings), '/Books/B');
    assert.equal(resolveSelectionAfterDelete('/Books/Only', ['/Books/Only']), '/Books');
});
