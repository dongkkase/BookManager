import assert from 'node:assert/strict';
import test from 'node:test';
import {
    groupFolderFiles,
    normalizeViewMode,
    normalizeViewScales,
} from './folderViewState.js';

test('모든 보기 모드는 동일한 정렬과 그룹 순서를 사용한다', () => {
    const groups = groupFolderFiles([
        { name: '10.cbz', series: 'B' },
        { name: '2.cbz', series: 'A' },
        { name: '1.cbz', series: 'A' },
    ], 'series', 'name', 'asc');
    assert.deepEqual(groups.map(group => group.name), ['A', 'B']);
    assert.deepEqual(groups[0].files.map(file => file.name), ['1.cbz', '2.cbz']);
});

test('보기 모드와 보기별 크기를 안전한 값으로 복원한다', () => {
    assert.equal(normalizeViewMode('invalid'), 'table');
    assert.deepEqual(normalizeViewScales({ table: 5, tile: 120, thumbnail: 70 }), {
        table: 10,
        tile: 100,
        thumbnail: 70,
    });
});
