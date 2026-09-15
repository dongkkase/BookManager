import assert from 'node:assert/strict';
import test from 'node:test';
import { BOOK_EXTENSIONS } from './metadata/metadataTypes.js';
import {
    SUPPORTED_VIEWER_DROP_EXTENSIONS,
    classifyDroppedEntries,
    isSupportedAudioDropPath,
    isSupportedArchivePath,
    isSupportedDocumentDropPath,
    isSupportedDroppedFilePath,
    isSupportedTextDropPath,
    isSupportedViewerDropPath,
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
    assert.equal(isSupportedDocumentDropPath('book.txt'), true);
    assert.equal(isSupportedDocumentDropPath('book.TXT'), true);
    assert.equal(isSupportedDroppedFilePath('book.pdf'), false);
    assert.equal(isSupportedDroppedFilePath('book.pdf', { includeDocuments: true }), true);
});

test('오디오북 드롭 확장자는 메타데이터와 폴더 탭에서 지원한다', () => {
    for (const filePath of ['book.MP3', 'book.m4b', 'book.flac', 'book.opus', 'book.wave']) {
        assert.equal(isSupportedAudioDropPath(filePath), true);
        assert.equal(isSupportedDroppedFilePath(filePath), false);
        assert.equal(isSupportedDroppedFilePath(filePath, { includeDocuments: true }), true);
    }
    assert.equal(isSupportedAudioDropPath('book.mp4'), false);
});

test('폴더 탭 뷰어 드롭은 내부 뷰어가 지원하는 파일 형식을 모두 허용한다', () => {
    const viewerPaths = [
        'comic.cb7',
        'book.epub',
        'book.pdf',
        'notes.txt',
        'notes.text',
        'notes.log',
        'notes.md',
        'audio.m4b',
    ];

    for (const filePath of viewerPaths) {
        assert.equal(isSupportedViewerDropPath(filePath), true, filePath);
        assert.equal(isSupportedDroppedFilePath(filePath, { includeViewerFiles: true }), true, filePath);
    }
    assert.equal(isSupportedTextDropPath('notes.MD '), true);
    assert.equal(isSupportedViewerDropPath('cover.jpg'), false);
});

test('메타데이터 TXT 지원은 다른 작업 탭과 뷰어 전용 형식의 드롭 범위를 넓히지 않는다', () => {
    for (const filePath of ['comic.cb7', 'notes.txt', 'notes.md']) {
        assert.equal(isSupportedDroppedFilePath(filePath), false, filePath);
    }
    assert.equal(isSupportedDroppedFilePath('notes.txt', { includeDocuments: true }), true);
    for (const filePath of ['comic.cb7', 'notes.text', 'notes.log', 'notes.md']) {
        assert.equal(isSupportedDroppedFilePath(filePath, { includeDocuments: true }), false, filePath);
    }
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
        { path: '/books/audio.m4b', isFile: true },
        { path: '/books/readme.txt', isFile: true },
    ], { includeDocuments: true }), {
        folders: ['/books'],
        files: ['/books/a.cbz', '/books/book.epub', '/books/book.pdf', '/books/audio.m4b', '/books/readme.txt'],
        unsupported: [],
    });
});

test('메타데이터 분석기가 지원하는 문서는 드롭 검사에서도 허용한다', () => {
    for (const extension of BOOK_EXTENSIONS) {
        assert.equal(isSupportedDroppedFilePath(`book${extension}`, { includeDocuments: true }), true, extension);
    }
    assert.equal(new Set(SUPPORTED_VIEWER_DROP_EXTENSIONS).size, SUPPORTED_VIEWER_DROP_EXTENSIONS.length);
});

test('한글 TXT 드롭은 개별 파일과 부모 폴더 선택을 통해 메타데이터 분석 경로로 전달된다', () => {
    const directory = '/Volumes/drive2/_test_txt/9클래스 마스터 검술러';
    const filePath = `${directory}/9클래스 마스터 검술러 (완).txt`;
    for (const normalization of ['NFC', 'NFD']) {
        const droppedPath = filePath.normalize(normalization);
        const classified = classifyDroppedEntries([{ path: droppedPath, isFile: true }], {
            includeDocuments: true,
            includeViewerFiles: false,
        });
        assert.deepEqual(classified.unsupported, []);
        assert.deepEqual(classified.files, [droppedPath]);
        assert.deepEqual(resolveMetadataDropPaths(classified, 'no'), [droppedPath]);
        assert.deepEqual(resolveMetadataDropPaths(classified, 'yes'), [directory.normalize(normalization)]);
        assert.deepEqual(resolveMetadataDropPaths(classified, 'cancel'), []);
    }
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

test('드롭 영역의 위쪽 30%만 교체하며 경계와 영역 밖은 추가로 처리한다', async () => {
    const { resolveTaskDropMode } = await import('./dropPolicy.js');
    for (const tab of ['organizer', 'renamer', 'metadata']) {
        for (const bounds of [{ top: 100, height: 600 }, { top: 75, height: 250 }]) {
            assert.equal(resolveTaskDropMode(tab, bounds.top - 1, bounds), 'append');
            assert.equal(resolveTaskDropMode(tab, bounds.top, bounds), 'replace');
            assert.equal(resolveTaskDropMode(tab, bounds.top + bounds.height * 0.3 - 0.01, bounds), 'replace');
            assert.equal(resolveTaskDropMode(tab, bounds.top + bounds.height * 0.3, bounds), 'append');
            assert.equal(resolveTaskDropMode(tab, bounds.top + bounds.height + 1, bounds), 'append');
        }
        assert.equal(resolveTaskDropMode(tab, 0, null), 'append');
        assert.equal(resolveTaskDropMode(tab, 0, { top: 0, height: 0 }), 'append');
        assert.equal(resolveTaskDropMode(tab, NaN, { top: 0, height: 500 }), 'append');
    }
    for (const tab of ['folder', 'sharing', 'releases']) {
        assert.equal(resolveTaskDropMode(tab, 100, { top: 100, height: 600 }), 'append');
    }
});
