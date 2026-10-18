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

test('깊은 폴더와 누락된 부모 경로의 파일 수를 한 번씩 합산한다', () => {
    const libraryRoot = path.resolve('LibraryRoot');
    const folderPaths = Array.from({ length: 80 }, (_, index) => (
        path.join(libraryRoot, ...Array.from({ length: index + 1 }, (unused, depth) => `Level ${depth}`))
    ));
    const deepestFolder = folderPaths.at(-1);
    const siblingFolder = path.join(folderPaths[20], 'Sibling');
    const filePaths = Array.from({ length: 1200 }, (_, index) => path.join(deepestFolder, `Book ${index}.cbz`));
    filePaths.push(path.join(libraryRoot, 'Root.cbz'), path.join(siblingFolder, 'Side.cbz'));

    const records = buildLibraryFolderIndexRecords(libraryRoot, [deepestFolder, siblingFolder], filePaths);
    const byPath = new Map(records.map(record => [record.folder_path, record]));

    assert.equal(records.length, 82);
    assert.equal(byPath.get(libraryRoot).direct_file_count, 1);
    assert.equal(byPath.get(libraryRoot).recursive_file_count, 1202);
    assert.equal(byPath.get(folderPaths[20]).child_folder_count, 2);
    assert.equal(byPath.get(folderPaths[20]).recursive_file_count, 1201);
    assert.equal(byPath.get(folderPaths[21]).recursive_file_count, 1200);
    assert.equal(byPath.get(deepestFolder).direct_file_count, 1200);
    assert.equal(byPath.get(deepestFolder).recursive_file_count, 1200);
    assert.equal(byPath.get(siblingFolder).recursive_file_count, 1);
});

test('중복 폴더 입력과 라이브러리 밖 경로는 집계에 영향을 주지 않는다', () => {
    const libraryRoot = path.resolve('LibraryRoot');
    const seriesFolder = path.join(libraryRoot, 'Series');
    const outsideRoot = `${libraryRoot}-outside`;
    const records = buildLibraryFolderIndexRecords(
        libraryRoot,
        [seriesFolder, seriesFolder, outsideRoot, path.dirname(libraryRoot)],
        [path.join(seriesFolder, 'Book.cbz'), path.join(outsideRoot, 'Outside.cbz')],
    );
    const byPath = new Map(records.map(record => [record.folder_path, record]));

    assert.equal(records.length, 2);
    assert.equal(byPath.get(libraryRoot).child_folder_count, 1);
    assert.equal(byPath.get(libraryRoot).recursive_file_count, 1);
    assert.equal(byPath.get(seriesFolder).direct_file_count, 1);
});

test('폴더 경로는 숫자와 한글을 포함한 기존 정렬 순서를 유지한다', () => {
    const libraryRoot = path.resolve('LibraryRoot');
    const names = ['시리즈 20', '시리즈 3', 'Series 10', 'series 2', 'Épisode', 'episode', '제목', '제목'];
    const directoryPaths = names.map(name => path.join(libraryRoot, name));
    const expected = [libraryRoot, ...directoryPaths].sort((left, right) => (
        left.localeCompare(right, 'ko', { numeric: true, sensitivity: 'base' })
    ));

    assert.deepEqual(
        buildLibraryFolderIndexRecords(libraryRoot, directoryPaths).map(record => record.folder_path),
        expected,
    );
});
