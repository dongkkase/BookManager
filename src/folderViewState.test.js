import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildVirtualGridLayout,
    buildVirtualTableRows,
    groupFolderFiles,
    normalizeViewMode,
    normalizeViewScales,
    shouldVirtualizeFolderItems,
    sortFolderFiles,
    visibleVirtualRows,
} from './folderViewState.js';

test('혼합 목록은 정렬 방향과 관계없이 폴더를 먼저 표시하고 폴더 이름을 자연정렬한다', () => {
    const files = [
        { name: '3.cbz', size: 30 },
        { name: '폴더 10', isDirectory: true },
        { name: '1.cbz', size: 10 },
        { name: '폴더 2', isDirectory: true },
        { name: '2.cbz', size: 20 },
    ];

    assert.deepEqual(sortFolderFiles(files, 'size', 'asc').map(file => file.name), [
        '폴더 2', '폴더 10', '1.cbz', '2.cbz', '3.cbz',
    ]);
    assert.deepEqual(sortFolderFiles(files, 'size', 'desc').map(file => file.name), [
        '폴더 10', '폴더 2', '3.cbz', '2.cbz', '1.cbz',
    ]);
    assert.equal(files[0].name, '3.cbz');
});

test('파일 그룹 앞에 폴더를 헤더 없이 표시하고 모든 보기의 항목 순서를 유지한다', () => {
    const groups = groupFolderFiles([
        { name: '폴더 10', path: '/폴더 10', isDirectory: true, series: 'B' },
        { name: '2.cbz', path: '/2.cbz', series: 'A' },
        { name: '폴더 2', path: '/폴더 2', isDirectory: true },
        { name: '1.cbz', path: '/1.cbz' },
    ], 'series', 'name', 'asc', { fallbackGroupName: '분류 없음' });

    assert.deepEqual(groups.map(group => group.name), ['', '분류 없음', 'A']);
    assert.deepEqual(groups[0].files.map(file => file.name), ['폴더 2', '폴더 10']);
    assert.deepEqual(groups[1].files.map(file => file.name), ['1.cbz']);
    const tableRows = buildVirtualTableRows(groups);
    const gridRows = buildVirtualGridLayout(groups, { columnCount: 2 }).rows;
    for (const rows of [tableRows, gridRows]) {
        assert.deepEqual(rows.map(row => row.type), ['file', 'file', 'group', 'file', 'group', 'file']);
        assert.deepEqual(rows.filter(row => row.type === 'file').map(row => [row.file.name, row.fileIndex]), [
            ['폴더 2', 0], ['폴더 10', 1], ['1.cbz', 2], ['2.cbz', 3],
        ]);
    }
});

test('폴더만 있는 목록은 파일 그룹을 만들지 않고 그룹 해제 시에도 폴더 순서를 유지한다', () => {
    const directories = [
        { name: '폴더 10', isDirectory: true },
        { name: '폴더 2', isDirectory: true },
    ];
    const expected = [{ name: '', files: [directories[1], directories[0]] }];

    assert.deepEqual(groupFolderFiles(directories, 'author_series'), expected);
    assert.deepEqual(groupFolderFiles(directories, 'none'), expected);
});

test('모든 보기 모드는 동일한 정렬과 그룹 순서를 사용한다', () => {
    const groups = groupFolderFiles([
        { name: '10.cbz', series: 'B' },
        { name: '2.cbz', series: 'A' },
        { name: '1.cbz', series: 'A' },
    ], 'series', 'name', 'asc');
    assert.deepEqual(groups.map(group => group.name), ['A', 'B']);
    assert.deepEqual(groups[0].files.map(file => file.name), ['1.cbz', '2.cbz']);
});

test('작가와 시리즈를 조합해 그룹화한다', () => {
    const groups = groupFolderFiles([
        { name: '1.cbz', author: '작가 A', series: '시리즈 1' },
        { name: '2.cbz', writer: '작가 A', series: '시리즈 1' },
        { name: '3.cbz', creators: ['작가 B'], series: '시리즈 1' },
        { name: '4.cbz', series: '시리즈 2' },
    ], 'author_series', 'name', 'asc', { fallbackGroupName: '분류 없음' });

    assert.deepEqual(groups.map(group => group.name), [
        '분류 없음 / 시리즈 2',
        '작가 A / 시리즈 1',
        '작가 B / 시리즈 1',
    ]);
    assert.deepEqual(groups[1].files.map(file => file.name), ['1.cbz', '2.cbz']);
});

test('보기 모드와 보기별 크기를 안전한 값으로 복원한다', () => {
    assert.equal(normalizeViewMode('invalid'), 'table');
    assert.deepEqual(normalizeViewScales({ table: 5, tile: 120, thumbnail: 70 }), {
        table: 10,
        tile: 120,
        thumbnail: 70,
    });
    assert.deepEqual(normalizeViewScales({ table: 5, tile: 170, thumbnail: 170 }), {
        table: 10,
        tile: 150,
        thumbnail: 150,
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

test('가상 그리드 표시 행은 화면 밖 행을 건너뛰고 같은 행의 셀을 유지한다', () => {
    const layout = buildVirtualGridLayout([{
        name: '',
        files: Array.from({ length: 12 }, (_, index) => ({ path: `/a/${index}.cbz` })),
    }], {
        columnCount: 3,
        rowHeight: 100,
        columnWidth: 50,
        horizontalGap: 10,
        padding: 0,
        itemWidth: 50,
    });

    assert.deepEqual(
        visibleVirtualRows(layout.rows, 150, 80, 0).map(row => row.file.path),
        [
            '/a/3.cbz',
            '/a/4.cbz',
            '/a/5.cbz',
            '/a/6.cbz',
            '/a/7.cbz',
            '/a/8.cbz',
        ],
    );
});
