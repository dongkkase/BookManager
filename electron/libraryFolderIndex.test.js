import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    buildLibraryFolderIndexRecords,
    normalizeLibraryFolderForRenderer,
} from './libraryFolderIndex.js';

test('라이브러리 폴더 인덱스 계산은 직계 폴더와 파일 수를 기록한다', () => {
    const libraryRoot = path.resolve('LibraryRoot');
    const emptyFolder = path.join(libraryRoot, 'Empty');
    const seriesFolder = path.join(libraryRoot, 'Series');
    const nestedFolder = path.join(seriesFolder, 'Volume');
    const firstFile = path.join(seriesFolder, 'Book 01.cbz');
    const nestedFile = path.join(nestedFolder, 'Book 02.cbz');

    const records = buildLibraryFolderIndexRecords(
        libraryRoot,
        [emptyFolder],
        [firstFile, nestedFile],
    );
    const byPath = new Map(records.map(record => [record.folder_path, record]));

    assert.equal(byPath.get(libraryRoot).child_folder_count, 2);
    assert.equal(byPath.get(libraryRoot).recursive_file_count, 2);
    assert.equal(byPath.get(emptyFolder).direct_file_count, 0);
    assert.equal(byPath.get(seriesFolder).child_folder_count, 1);
    assert.equal(byPath.get(seriesFolder).direct_file_count, 1);
    assert.equal(byPath.get(seriesFolder).recursive_file_count, 2);
    assert.equal(byPath.get(nestedFolder).direct_file_count, 1);
});

test('라이브러리 폴더 렌더러 변환은 DB 컬럼명을 UI 필드명으로 바꾼다', () => {
    const row = {
        folder_path: path.resolve('LibraryRoot', 'Series'),
        name: 'Series',
        child_folder_count: 3,
        direct_file_count: 4,
        recursive_file_count: 9,
        last_seen_at: '2026-07-02T00:00:00.000Z',
    };

    assert.deepEqual(normalizeLibraryFolderForRenderer(row), {
        name: 'Series',
        path: row.folder_path,
        isFolder: true,
        childFolderCount: 3,
        directFileCount: 4,
        recursiveFileCount: 9,
        lastSeenAt: '2026-07-02T00:00:00.000Z',
    });
});
