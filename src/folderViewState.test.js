import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVirtualGridLayout,
    buildVirtualTableRows,
    groupFolderFiles,
    normalizeViewMode,
    normalizeViewScales,
    shouldVirtualizeFolderItems,
    visibleVirtualRows,
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

test('대량 그룹 목록은 그룹 헤더를 포함해 가상화 행으로 변환한다', () => {
    const groupA = Array.from({ length: 1001 }, (_, index) => ({ path: `/a/${index}.cbz` }));
    const groups = [
        { name: 'A', files: groupA },
        { name: 'B', files: [{ path: '/b/1.cbz' }] },
    ];

    assert.equal(shouldVirtualizeFolderItems(groups), true);

    const tableRows = buildVirtualTableRows(groups);
    assert.equal(tableRows[0].type, 'group');
    assert.equal(tableRows[1].type, 'file');
    assert.equal(tableRows[1].fileIndex, 0);
    assert.equal(tableRows[1002].type, 'group');
});

test('가상 그리드 레이아웃은 그룹 헤더와 파일 좌표를 유지한다', () => {
    const layout = buildVirtualGridLayout([{
        name: 'A',
        files: [
            { path: '/a/1.cbz' },
            { path: '/a/2.cbz' },
            { path: '/a/3.cbz' },
        ],
    }], {
        columnCount: 2,
        rowHeight: 100,
        columnWidth: 50,
        horizontalGap: 10,
        padding: 5,
        headerHeight: 20,
        itemWidth: 50,
    });

    assert.equal(layout.rows[0].type, 'group');
    assert.deepEqual(
        layout.rows.slice(1).map(row => [row.file.path, row.left, row.top]),
        [
            ['/a/1.cbz', 5, 25],
            ['/a/2.cbz', 65, 25],
            ['/a/3.cbz', 5, 125],
        ],
    );
    assert.deepEqual(
        visibleVirtualRows(layout.rows, 0, 30, 0).map(row => row.type),
        ['group', 'file', 'file'],
    );
});
