import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mergeFolderFileCacheUpdate,
    mergeFolderFilePreservingCover,
    mergeFolderScanResults,
} from './hooks/useFolderScan.js';

const directory = {
    path: '/books/Series',
    name: 'Series',
    title: 'Series',
    isDirectory: true,
    is_folder: true,
    size: 0,
    mtime: 2000,
    cover: 'file:///cache/first.jpg',
    thumb_path: '/cache/first.jpg',
    cover_file_path: '/books/Series/1.cbz',
    cover_file_mtime: 1000,
    cover_file_size: 300,
};

test('일반 폴더 스캔은 먼저 조회된 표지와 원본 파일 정보를 함께 유지한다', () => {
    const merged = mergeFolderFilePreservingCover(directory, {
        path: directory.path,
        isDirectory: true,
        is_folder: true,
        mtime: 2000,
        cover: '',
        thumb_path: '',
        cache_source: 'directory',
    });

    assert.deepEqual(merged, { ...directory, cache_source: 'directory' });
    assert.equal(merged.title, 'Series');
    assert.equal(merged.size, 0);
});

test('빠른 목록의 알 수 없는 수정 시각은 폴더 표지의 유효성 정보를 지우지 않는다', () => {
    const merged = mergeFolderFilePreservingCover(directory, {
        path: directory.path,
        isDirectory: true,
        mtime: 0,
        cover: '',
        thumb_path: '',
    });

    assert.equal(merged.mtime, 2000);
    assert.equal(merged.cover, directory.cover);
    assert.equal(merged.cover_file_path, directory.cover_file_path);
});

test('폴더 내용이 바뀌면 이전 표지와 원본 파일 정보를 해제한다', () => {
    const merged = mergeFolderFilePreservingCover(directory, {
        path: directory.path,
        isDirectory: true,
        mtime: 3000,
        cover: '',
        thumb_path: '',
    });

    assert.equal(merged.mtime, 3000);
    assert.equal(merged.cover, '');
    assert.equal(merged.thumb_path, '');
    assert.equal(merged.cover_file_path, '');
    assert.equal(merged.cover_file_mtime, 0);
    assert.equal(merged.cover_file_size, 0);
});

test('새 폴더 표지는 새 원본 파일 정보만 사용한다', () => {
    const merged = mergeFolderFilePreservingCover(directory, {
        path: directory.path,
        isDirectory: true,
        mtime: 3000,
        cover: 'file:///cache/second.jpg',
        thumb_path: '/cache/second.jpg',
        cover_file_path: '/books/Series/2.cbz',
        cover_file_mtime: 2500,
        cover_file_size: 500,
    });

    assert.equal(merged.cover, 'file:///cache/second.jpg');
    assert.equal(merged.thumb_path, '/cache/second.jpg');
    assert.equal(merged.cover_file_path, '/books/Series/2.cbz');
    assert.equal(merged.cover_file_mtime, 2500);
    assert.equal(merged.cover_file_size, 500);
    assert.equal(merged.isDirectory, true);
    assert.equal(merged.name, 'Series');
});

test('표지가 없다는 폴더 조회 결과는 이전 표지를 다시 사용하지 않는다', () => {
    const merged = mergeFolderFilePreservingCover(directory, {
        path: directory.path,
        isDirectory: true,
        mtime: 2000,
        cover: '',
        thumb_path: '',
        cover_file_path: '',
        cover_file_mtime: 0,
        cover_file_size: 0,
    });

    assert.equal(merged.cover, '');
    assert.equal(merged.thumb_path, '');
    assert.equal(merged.cover_file_path, '');
    assert.equal(merged.cover_file_mtime, 0);
    assert.equal(merged.cover_file_size, 0);
});

test('이전 수정 시각의 폴더 조회 결과는 최신 표지를 덮지 않는다', () => {
    assert.equal(mergeFolderFilePreservingCover(directory, {
        ...directory,
        mtime: 1000,
        cover: '',
        thumb_path: '',
        cover_file_path: '',
    }), directory);
});

test('같은 경로의 폴더가 파일로 바뀌면 폴더 정보와 표지를 전달하지 않는다', () => {
    const replacement = { path: directory.path, is_folder: false, mtime: 1000, cover: '' };
    assert.equal(mergeFolderFilePreservingCover(directory, replacement), replacement);
});

test('일반 파일의 메타데이터 갱신은 기존 표지 유지 동작을 보존한다', () => {
    const current = { path: '/books/1.cbz', mtime: 1000, cover: 'first', thumb_path: '/cache/first.jpg' };
    assert.deepEqual(mergeFolderFilePreservingCover(current, {
        path: current.path,
        mtime: 2000,
        cover: '',
        thumb_path: '',
        title: 'New title',
    }), { ...current, mtime: 2000, title: 'New title' });
});

test('표지 조회의 캐시 갱신은 뒤늦게 도착한 오래된 폴더 결과를 무시한다', () => {
    assert.equal(mergeFolderFileCacheUpdate(directory, {
        ...directory,
        mtime: 1000,
        cover: 'file:///cache/old.jpg',
        thumb_path: '/cache/old.jpg',
        cover_file_path: '/books/Series/old.cbz',
    }), directory);
    assert.equal(mergeFolderFileCacheUpdate(directory, undefined), directory);
});

test('표지 조회의 캐시 갱신은 최신 폴더 표지가 없으면 기존 표지를 해제한다', () => {
    const updated = {
        ...directory,
        mtime: 3000,
        cover: '',
        thumb_path: '',
        cover_file_path: '',
        cover_file_mtime: 0,
        cover_file_size: 0,
    };
    assert.deepEqual(mergeFolderFileCacheUpdate(directory, updated), updated);
});

test('일반 파일의 직접 캐시 갱신은 수정 시각과 빈 표지를 그대로 반영한다', () => {
    const current = { path: '/books/1.cbz', mtime: 2000, cover: 'first', thumb_path: '/cache/first.jpg' };
    const updated = { path: current.path, mtime: 1000, cover: '', thumb_path: '', title: 'Updated title' };
    assert.deepEqual(mergeFolderFileCacheUpdate(current, updated), updated);
});

test('일반 재스캔 완료는 폴더 표지를 유지하며 파일 데이터와 목록을 새 결과로 교체한다', () => {
    const currentFile = { path: '/books/1.cbz', mtime: 1000, cover: 'first', title: 'Old title' };
    const scannedFile = { path: currentFile.path, mtime: 2000, cover: '', title: 'New title' };
    const scannedDirectory = {
        path: directory.path,
        isDirectory: true,
        mtime: directory.mtime,
        cover: '',
        thumb_path: '',
    };
    const deletedDirectory = { ...directory, path: '/books/Deleted' };
    const result = mergeFolderScanResults(
        [scannedFile, scannedDirectory],
        [directory, deletedDirectory, currentFile],
        { force: false },
    );

    assert.equal(result.length, 2);
    assert.equal(result[0], scannedFile);
    assert.deepEqual(result[1], directory);
});

test('강제 재스캔 완료는 폴더의 이전 표지를 다시 사용하지 않는다', () => {
    const incoming = [{
        path: directory.path,
        isDirectory: true,
        mtime: directory.mtime,
        cover: '',
        thumb_path: '',
    }];
    const result = mergeFolderScanResults(incoming, [directory], { force: true });

    assert.equal(result, incoming);
    assert.equal(result[0].cover, '');
    assert.equal(result[0].cover_file_path, undefined);
});

test('일반 재스캔에서도 수정된 폴더의 이전 표지는 해제한다', () => {
    const result = mergeFolderScanResults([{
        path: directory.path,
        isDirectory: true,
        mtime: 3000,
        cover: '',
        thumb_path: '',
    }], [directory]);

    assert.equal(result[0].mtime, 3000);
    assert.equal(result[0].cover, '');
    assert.equal(result[0].cover_file_path, '');
    assert.equal(result[0].cover_file_mtime, 0);
    assert.equal(result[0].cover_file_size, 0);
});
