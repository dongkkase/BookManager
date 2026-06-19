import assert from 'node:assert/strict';
import test from 'node:test';
import { isLibraryContext, resolveLastSelectedLibrary } from './libraryState.js';

test('마지막 선택 라이브러리가 현재 목록에 있으면 복원한다', () => {
    assert.equal(resolveLastSelectedLibrary(['/a', '/b'], '/b'), '/b');
});

test('마지막 선택 라이브러리가 없으면 첫 항목을 사용한다', () => {
    assert.equal(resolveLastSelectedLibrary(['/a', '/b'], '/missing'), '/a');
    assert.equal(resolveLastSelectedLibrary([], '/missing'), '');
});

test('라이브러리 컨텍스트 메뉴를 일반 폴더 메뉴와 구분한다', () => {
    assert.equal(isLibraryContext({ type: 'library', folderPath: '/books' }), true);
    assert.equal(isLibraryContext({ type: 'folder', folderPath: '/books' }), false);
});
