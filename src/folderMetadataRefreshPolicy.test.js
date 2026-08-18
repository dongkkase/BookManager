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
