import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOLDER_GROUP_KEYS,
    FOLDER_SORT_KEYS,
    filterFolderFiles,
    hasArchiveMetadata,
    normalizeSavedLayouts,
} from './folderToolbarState.js';

test('그룹과 정렬 항목은 원본 순서를 유지한다', () => {
    assert.deepEqual(FOLDER_GROUP_KEYS.slice(0, 5), ['none', 'folder_path', 'ext', 'series', 'author_series']);
    assert.deepEqual(FOLDER_SORT_KEYS, ['name', 'size', 'modified', 'ext', 'series', 'title', 'author']);
});

test('메타데이터 없음 필터와 검색을 함께 적용한다', () => {
    const files = [
        { name: 'Alpha.cbz', series: 'Alpha', has_metadata: false },
        { name: 'Beta.cbz', series: 'Beta', has_metadata: true },
    ];
    assert.deepEqual(
        filterFolderFiles(files, { query: 'alpha', metadataMissingOnly: true }),
        [files[0]],
    );
    assert.equal(hasArchiveMetadata({ publisher: 'Publisher' }), true);

    files[0].name = 'Gamma.cbz';
    files[0].series = 'Gamma';
    assert.deepEqual(filterFolderFiles(files, { query: 'gamma' }), [files[0]]);
    assert.deepEqual(filterFolderFiles(files, { query: 'alpha' }), []);
});

test('필터 조건이 없으면 기존 파일 목록을 재사용한다', () => {
    const files = [{ name: 'Alpha.cbz' }];
    assert.equal(filterFolderFiles(files), files);
});

test('검색에는 폴더를 포함하고 메타데이터 없음 필터에는 파일만 포함한다', () => {
    const files = [
        { name: 'Alpha 폴더', path: '/Alpha 폴더', isDirectory: true, has_metadata: false },
        { name: 'Beta 폴더', path: '/Beta 폴더', isDirectory: true },
        { name: 'Alpha.cbz', has_metadata: false },
        { name: 'Alpha 2.cbz', has_metadata: true },
        { name: 'Beta.cbz' },
    ];

    assert.equal(filterFolderFiles(files), files);
    assert.deepEqual(filterFolderFiles(files, { query: 'alpha' }), [files[0], files[2], files[3]]);
    assert.deepEqual(filterFolderFiles(files, { query: '폴더' }), [files[0], files[1]]);
    assert.deepEqual(filterFolderFiles(files, { metadataMissingOnly: true }), [files[2], files[4]]);
    assert.deepEqual(filterFolderFiles(files, { query: 'alpha', metadataMissingOnly: true }), [files[2]]);
});

test('저장 레이아웃 이름을 배열과 객체 형식에서 읽는다', () => {
    assert.deepEqual(normalizeSavedLayouts([{ name: '기본' }, '간단']), ['기본', '간단']);
    assert.deepEqual(normalizeSavedLayouts({ 기본: {}, 상세: {} }), ['기본', '상세']);
});
