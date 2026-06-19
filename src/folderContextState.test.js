import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clampContextMenuPosition,
    isFavoriteFolder,
    replaceTreePath,
} from './folderContextState.js';

test('컨텍스트 메뉴를 화면 경계 안으로 이동한다', () => {
    assert.deepEqual(
        clampContextMenuPosition(990, 790, 180, 240, 1000, 800),
        { x: 812, y: 552 },
    );
    assert.deepEqual(
        clampContextMenuPosition(-20, -10, 180, 240, 1000, 800),
        { x: 8, y: 8 },
    );
});

test('폴더 이름 변경 후 선택된 하위 경로를 새 경로로 치환한다', () => {
    assert.equal(
        replaceTreePath('/Books/Old/Series', '/Books/Old', '/Books/New'),
        '/Books/New/Series',
    );
    assert.equal(
        replaceTreePath('C:\\Books\\Old\\Series', 'c:\\books\\old', 'C:\\Books\\New'),
        'C:\\Books\\New\\Series',
    );
});

test('즐겨찾기 경로는 Windows 대소문자와 구분자 차이를 무시한다', () => {
    assert.equal(isFavoriteFolder([{ path: 'C:\\Books\\Manga' }], 'c:/books/manga'), true);
    assert.equal(isFavoriteFolder(['/Books/Novel'], '/Books/Manga'), false);
});
