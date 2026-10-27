import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createFileSelectionLookup,
    folderSelectionTarget,
    nextSelectionIndex,
    selectedFilesSize,
} from './folderSelectionState.js';

test('선택 조회를 사용하지 않는 목록 갱신은 파일 인덱스를 만들지 않는다', () => {
    let pathReads = 0;
    const files = Array.from({ length: 1000 }, (_, index) => ({
        get path() { pathReads += 1; return `/book/${index}`; },
    }));
    const lookup = createFileSelectionLookup(files);
    assert.equal(pathReads, 0);
    assert.equal(lookup.getIndex('/book/0'), 0);
    const initialReads = pathReads;
    assert.equal(lookup.getFile('/book/999'), files[999]);
    assert.equal(lookup.getIndex('/missing'), undefined);
    assert.equal(lookup.getFile('/missing'), undefined);
    assert.equal(pathReads, initialReads);
});

test('선택 조회는 현재 목록의 순서와 메타데이터를 사용한다', () => {
    const original = [{ path: '/a', cover: 'old' }, { path: '/b' }];
    const before = createFileSelectionLookup(original);
    assert.equal(before.getIndex('/b'), 1);
    const updated = [{ path: '/b', cover: 'new' }, original[0]];
    const after = createFileSelectionLookup(updated);
    assert.equal(after.getIndex('/b'), 0);
    assert.equal(after.getFile('/b').cover, 'new');
    assert.equal(before.getFile('/b'), original[1]);
    assert.equal(createFileSelectionLookup([{ path: '' }, null, ...updated]).getIndex('/b'), 2);
    assert.equal(createFileSelectionLookup([original[0], updated[0], { path: '/a' }]).getIndex('/a'), 2);
});

test('키보드 선택 이동은 목록 경계를 벗어나지 않는다', () => {
    assert.equal(nextSelectionIndex(3, -1, 1), 0);
    assert.equal(nextSelectionIndex(3, 0, -1), 0);
    assert.equal(nextSelectionIndex(3, 2, 1), 2);
});

const selectionGroups = (...sizes) => sizes.map(size => ({
    files: Array.from({ length: size }, () => ({})),
}));

test('방향키 선택은 빈 목록과 방향키가 아닌 입력을 무시한다', () => {
    assert.equal(folderSelectionTarget([], -1, 'ArrowDown'), -1);
    assert.equal(folderSelectionTarget(selectionGroups(0, 0), 0, 'ArrowUp'), -1);
    assert.equal(folderSelectionTarget(null, 0, 'ArrowRight'), -1);
    assert.equal(folderSelectionTarget(selectionGroups(3), 0, 'Enter'), -1);
    assert.equal(folderSelectionTarget(selectionGroups(3), -1, ''), -1);
});

test('선택이 없거나 유효하지 않으면 모든 방향키가 첫 항목을 선택한다', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        for (const currentIndex of [-1, 3, undefined, NaN, 1.5]) {
            assert.equal(folderSelectionTarget(selectionGroups(3), currentIndex, key, 2), 0);
        }
    }
});

test('좌우 이동은 그룹과 행 경계를 넘어 표시 순서대로 선택한다', () => {
    const groups = selectionGroups(5, 2);
    assert.equal(folderSelectionTarget(groups, 0, 'ArrowLeft', 3), 0);
    assert.equal(folderSelectionTarget(groups, 2, 'ArrowRight', 3), 3);
    assert.equal(folderSelectionTarget(groups, 4, 'ArrowRight', 3), 5);
    assert.equal(folderSelectionTarget(groups, 5, 'ArrowLeft', 3), 4);
    assert.equal(folderSelectionTarget(groups, 6, 'ArrowRight', 3), 6);
});

test('그리드 상하 이동은 같은 열을 유지하고 짧은 행의 마지막 항목에서 멈춘다', () => {
    const groups = selectionGroups(8);
    assert.equal(folderSelectionTarget(groups, 1, 'ArrowDown', 3), 4);
    assert.equal(folderSelectionTarget(groups, 4, 'ArrowUp', 3), 1);
    assert.equal(folderSelectionTarget(groups, 5, 'ArrowDown', 3), 7);
    assert.equal(folderSelectionTarget(groups, 7, 'ArrowUp', 3), 4);
    assert.equal(folderSelectionTarget(groups, 2, 'ArrowUp', 3), 2);
    assert.equal(folderSelectionTarget(groups, 6, 'ArrowDown', 3), 6);
});

test('그룹마다 새 행을 시작하고 인접 그룹에서도 현재 열을 따른다', () => {
    const groups = selectionGroups(0, 5, 0, 2, 8, 0);
    assert.equal(folderSelectionTarget(groups, 4, 'ArrowDown', 3), 6);
    assert.equal(folderSelectionTarget(groups, 6, 'ArrowUp', 3), 4);
    assert.equal(folderSelectionTarget(groups, 6, 'ArrowDown', 3), 8);
    assert.equal(folderSelectionTarget(groups, 9, 'ArrowUp', 3), 6);
    assert.equal(folderSelectionTarget(groups, 3, 'ArrowDown', 3), 5);
    assert.equal(folderSelectionTarget(groups, 5, 'ArrowUp', 3), 3);
    assert.equal(folderSelectionTarget(groups, 7, 'ArrowDown', 3), 10);
});

test('한 열 목록의 상하 이동은 그룹과 관계없이 한 항목씩 이동한다', () => {
    const groups = selectionGroups(2, 0, 1, 2);
    for (let currentIndex = 0; currentIndex < 5; currentIndex += 1) {
        assert.equal(folderSelectionTarget(groups, currentIndex, 'ArrowUp'), Math.max(0, currentIndex - 1));
        assert.equal(folderSelectionTarget(groups, currentIndex, 'ArrowDown'), Math.min(4, currentIndex + 1));
    }
});

test('열 수는 양의 정수로 정규화하고 유효하지 않은 값은 한 열로 처리한다', () => {
    const groups = selectionGroups(5);
    for (const columnCount of [0, -2, NaN, Infinity, 'invalid', null]) {
        assert.equal(folderSelectionTarget(groups, 1, 'ArrowDown', columnCount), 2);
    }
    assert.equal(folderSelectionTarget(groups, 0, 'ArrowDown', 2.8), 2);
    assert.equal(folderSelectionTarget(groups, 0, 'ArrowDown', '3'), 3);
});

test('선택된 파일만 용량 합계에 포함한다', () => {
    assert.equal(selectedFilesSize([
        { path: '/a', size: 100 },
        { path: '/b', size: 250 },
    ], ['/b']), 250);
});
