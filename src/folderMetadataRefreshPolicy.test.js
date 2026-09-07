import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMetadataSavedPathForFolder } from './folderMetadataRefreshPolicy.js';

const macSelectedFolder = `/도서/${'오디오북'.normalize('NFD')}`;
const macSavedFolder = macSelectedFolder.normalize('NFC');

test('macOS direct 모드는 NFC 저장 경로와 NFD 선택 폴더를 같은 폴더로 판단한다', () => {
    assert.equal(hasMetadataSavedPathForFolder({
        paths: [`${macSavedFolder}/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: false,
        platform: 'darwin',
    }), true);
});

test('macOS includeSubfolders 모드는 NFC 저장 경로의 하위 폴더를 포함한다', () => {
    assert.equal(hasMetadataSavedPathForFolder({
        paths: [`${macSavedFolder}/시리즈/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: true,
        platform: 'darwin',
    }), true);
});

test('macOS에서는 선택 폴더 밖의 저장 경로를 제외한다', () => {
    const paths = ['/도서/다른 폴더/책.m4a'];

    assert.equal(hasMetadataSavedPathForFolder({
        paths,
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: false,
        platform: 'darwin',
    }), false);
    assert.equal(hasMetadataSavedPathForFolder({
        paths,
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: true,
        platform: 'darwin',
    }), false);
});

test('Linux에서는 NFC 저장 경로와 NFD 선택 폴더를 별개로 판단한다', () => {
    assert.equal(hasMetadataSavedPathForFolder({
        paths: [`${macSavedFolder}/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: false,
        platform: 'linux',
    }), false);
    assert.equal(hasMetadataSavedPathForFolder({
        paths: [`${macSavedFolder}/시리즈/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        includeSubfolders: true,
        platform: 'linux',
    }), false);
});

test('폴더 표지는 직계 하위 폴더 안의 파일을 저장했을 때 갱신한다', () => {
    const options = {
        paths: [`${macSavedFolder}/시리즈/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        platform: 'darwin',
    };

    assert.equal(hasMetadataSavedPathForFolder(options), false);
    assert.equal(hasMetadataSavedPathForFolder({ ...options, includeFolderPreviews: true }), true);
});

test('폴더 표지는 표시 폴더 내부의 0~3단계 하위 파일을 저장했을 때 갱신한다', () => {
    for (let depth = 0; depth <= 3; depth += 1) {
        const nestedFolders = Array.from({ length: depth }, (_, index) => `part${index + 1}`);
        const filePath = ['/books', 'series', ...nestedFolders, 'book.cbz'].join('/');
        const options = {
            paths: [filePath],
            selectedFolderPath: '/books',
            platform: 'linux',
        };

        assert.equal(hasMetadataSavedPathForFolder({ ...options, includeFolderPreviews: true }), true);
        assert.equal(hasMetadataSavedPathForFolder(options), false);
    }
});

test('폴더 표지 갱신은 탐색 범위 밖의 4단계 하위 파일과 다른 폴더를 제외한다', () => {
    for (const filePath of [
        '/books/series/part1/part2/part3/part4/book.cbz',
        '/books-other/series/book.cbz',
        '/other/books/series/book.cbz',
    ]) {
        assert.equal(hasMetadataSavedPathForFolder({
            paths: [filePath],
            selectedFolderPath: '/books',
            includeFolderPreviews: true,
            platform: 'linux',
        }), false);
    }
});

test('Windows 폴더 표지는 경로 대소문자와 구분자를 정규화한다', () => {
    assert.equal(hasMetadataSavedPathForFolder({
        paths: ['c:\\BOOKS\\Series\\Part1\\Part2\\Part3\\Book.cbz'],
        selectedFolderPath: 'C:/Books',
        includeFolderPreviews: true,
        platform: 'win32',
    }), true);
});

test('macOS 폴더 표지의 최대 탐색 깊이에서도 Unicode 경로를 정규화한다', () => {
    assert.equal(hasMetadataSavedPathForFolder({
        paths: [`${macSavedFolder}/시리즈/부분1/부분2/부분3/책.m4a`],
        selectedFolderPath: macSelectedFolder,
        includeFolderPreviews: true,
        platform: 'darwin',
    }), true);
});

test('하위 폴더 포함 모드는 폴더 표지의 탐색 깊이 제한을 적용하지 않는다', () => {
    const options = {
        paths: ['/books/series/part1/part2/part3/part4/book.cbz'],
        selectedFolderPath: '/books',
        includeSubfolders: true,
        platform: 'linux',
    };

    assert.equal(hasMetadataSavedPathForFolder(options), true);
    assert.equal(hasMetadataSavedPathForFolder({ ...options, includeFolderPreviews: true }), true);
});
