import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyDroppedEntries,
    isSupportedArchivePath,
    isSupportedDocumentDropPath,
    isSupportedDroppedFilePath,
    resolveMetadataDropPaths,
} from './dropPolicy.js';

test('지원 아카이브 확장자는 대소문자와 관계없이 인식한다', () => {
    for (const filePath of ['a.zip', 'a.CBZ', 'a.cbr', 'a.7z', 'a.RAR']) {
        assert.equal(isSupportedArchivePath(filePath), true);
    }
    assert.equal(isSupportedArchivePath('/books/HERO - 아카기의 유지를 잇는 남자 1-13 .zip '), true);
    assert.equal(isSupportedArchivePath('/books/HERO - 아카기의 유지를 잇는 남자 1-13 .zip\u200b'), true);
    assert.equal(isSupportedArchivePath('a.pdf'), false);
});

test('문서 드롭 확장자는 메타데이터와 폴더 탭에서만 지원 파일로 취급한다', () => {
    assert.equal(isSupportedDocumentDropPath('book.epub'), true);
    assert.equal(isSupportedDocumentDropPath('book.PDF '), true);
    assert.equal(isSupportedDocumentDropPath('book.txt'), false);
    assert.equal(isSupportedDroppedFilePath('book.pdf'), false);
    assert.equal(isSupportedDroppedFilePath('book.pdf', { includeDocuments: true }), true);
});

test('드롭 항목을 폴더·지원 파일·미지원 파일로 순서대로 분류한다', () => {
    assert.deepEqual(classifyDroppedEntries([
        { path: '/books', isDirectory: true },
        { path: '/books/a.cbz', isFile: true },
        { path: '/books/book.epub', isFile: true },
        { path: '/books/readme.txt', isFile: true },
    ]), {
        folders: ['/books'],
        files: ['/books/a.cbz'],
        unsupported: ['/books/book.epub', '/books/readme.txt'],
    });
    assert.deepEqual(classifyDroppedEntries([
        { path: '/books', isDirectory: true },
        { path: '/books/a.cbz', isFile: true },
        { path: '/books/book.epub', isFile: true },
        { path: '/books/book.pdf', isFile: true },
        { path: '/books/readme.txt', isFile: true },
    ], { includeDocuments: true }), {
        folders: ['/books'],
        files: ['/books/a.cbz', '/books/book.epub', '/books/book.pdf'],
        unsupported: ['/books/readme.txt'],
    });
});

test('메타데이터 드롭 예는 파일 부모 폴더를 중복 없이 추가한다', () => {
    assert.deepEqual(resolveMetadataDropPaths({
        folders: ['/other'],
        files: ['/books/a.cbz', '/books/b.zip', '/books/c.epub'],
    }, 'yes'), ['/other', '/books']);
});

test('메타데이터 드롭 아니오는 개별 파일과 폴더를 유지한다', () => {
    assert.deepEqual(resolveMetadataDropPaths({
        folders: ['/other'],
        files: ['/books/a.cbz', '/books/c.pdf'],
    }, 'no'), ['/books/a.cbz', '/books/c.pdf', '/other']);
});

test('메타데이터 드롭 취소는 아무 경로도 전달하지 않는다', () => {
    assert.deepEqual(resolveMetadataDropPaths({
        folders: ['/other'],
        files: ['/books/a.cbz'],
    }, 'cancel'), []);
});
