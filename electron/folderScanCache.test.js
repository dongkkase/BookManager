import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { extractLibraryScanVisualItem } from './ipcHandlers.js';
import { scanFolder } from './tasks/folderScanTask.js';
import { SCAN_TARGET_EXTENSIONS } from './scanTargets.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

test('폴더 스캔은 썸네일 파일과 ComicInfo DB 캐시를 재사용한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-cache-'));
    const inputDir = path.join(root, 'input');
    const libraryDir = path.join(root, 'library');
    const dataDir = path.join(root, 'data');
    const thumbnailDir = path.join(dataDir, 'thumbnails');
    const dbPath = path.join(dataDir, 'library.db');
    const archivePath = path.join(libraryDir, 'Cached Book.cbz');

    try {
        fs.mkdirSync(inputDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(inputDir, '001.png'), PNG_1X1);
        fs.writeFileSync(
            path.join(inputDir, 'ComicInfo.xml'),
            '<ComicInfo><Title>Cached Title</Title><Series>Cached Series</Series><Volume>3</Volume><Writer>Writer</Writer></ComicInfo>',
        );
        const created = spawnSync(sevenZExe, ['a', '-tzip', archivePath, '*'], {
            cwd: inputDir,
            stdio: 'ignore',
        });
        assert.equal(created.status, 0);

        const first = await scanFolder(libraryDir, {
            dbPath,
            thumbnailDir,
            sevenZExe,
        });
        assert.equal(first.length, 1);
        assert.equal(first[0].cache_source, 'archive');
        assert.equal(first[0].series, 'Cached Series');
        assert.equal(first[0].has_metadata, true);
        assert.match(first[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.existsSync(first[0].thumb_path), true);
        assert.equal(path.dirname(first[0].thumb_path), thumbnailDir);

        const library = new LibraryDB({ dbPath });
        const cached = await library.getFileInfo(archivePath);
        assert.equal(cached.title, 'Cached Title');
        assert.equal(cached.series, 'Cached Series');
        assert.equal(cached.thumb_path, first[0].thumb_path);
        await library.close();

        const originalStat = fs.statSync(archivePath);
        fs.writeFileSync(archivePath, Buffer.alloc(originalStat.size));
        fs.utimesSync(archivePath, originalStat.atime, originalStat.mtime);

        const originalWarn = console.warn;
        const warnings = [];
        let second;
        try {
            console.warn = (...args) => warnings.push(args.join(' '));
            second = await scanFolder(libraryDir, {
                dbPath,
                thumbnailDir,
                sevenZExe,
            });
        } finally {
            console.warn = originalWarn;
        }
        assert.equal(second[0].cache_source, 'library');
        assert.equal(second[0].title, 'Cached Title');
        assert.equal(second[0].series, 'Cached Series');
        assert.equal(second[0].thumb_path, first[0].thumb_path);
        assert.equal(warnings.some(message => message.includes('Failed to extract archive metadata')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('큰 CBZ는 전체 파일 버퍼를 할당하지 않고 스캔한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-large-cbz-'));
    const libraryDir = path.join(root, 'library');
    const archivePath = path.join(libraryDir, 'Large Book.cbz');
    const originalWarn = console.warn;
    const warnings = [];

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.closeSync(fs.openSync(archivePath, 'w'));
        fs.truncateSync(archivePath, 257 * 1024 * 1024);
        console.warn = (...args) => warnings.push(args.join(' '));

        const files = await scanFolder(libraryDir, {
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].name, 'Large Book.cbz');
        assert.equal(warnings.some(message => message.includes('Array buffer allocation failed')), false);
    } finally {
        console.warn = originalWarn;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('폴더 스캔은 dot-folder 안의 책 파일을 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-hidden-folder-scan-'));
    const libraryDir = path.join(root, 'library');
    const hiddenDir = path.join(libraryDir, '.yacreaderlibrary');

    try {
        fs.mkdirSync(hiddenDir, { recursive: true });
        fs.writeFileSync(path.join(libraryDir, 'Visible Book.cbz'), '');
        fs.writeFileSync(path.join(hiddenDir, 'Hidden Book.cbz'), '');

        const files = await scanFolder(libraryDir, {
            sevenZExe: '',
            skipArchiveExtraction: true,
        });

        assert.deepEqual(files.map(file => file.name), ['Visible Book.cbz']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('폴더 스캔 기본 대상 확장자에는 텍스트 파일이 포함된다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-target-exts-'));
    const libraryDir = path.join(root, 'library');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(libraryDir, 'Notes.txt'), 'memo');
        fs.writeFileSync(path.join(libraryDir, 'Ignored.md'), 'memo');

        const files = await scanFolder(libraryDir, {
            sevenZExe: '',
            skipArchiveExtraction: true,
        });

        assert.equal(SCAN_TARGET_EXTENSIONS.includes('.txt'), true);
        assert.deepEqual(files.map(file => file.name), ['Notes.txt']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('폴더 스캔은 CBZ 썸네일과 ComicInfo를 외부 7z 없이 추출한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-native-scan-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const archivePath = path.join(libraryDir, 'Native Book.cbz');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(archivePath, Buffer.alloc(0));
        await replaceZipEntry(archivePath, '001.png', PNG_1X1);
        await replaceZipEntry(
            archivePath,
            'ComicInfo.xml',
            '<ComicInfo><Title>Native Title</Title><Series>Native Series</Series><Volume>5</Volume></ComicInfo>',
        );

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].cache_source, 'archive');
        assert.equal(files[0].title, 'Native Title');
        assert.equal(files[0].series, 'Native Series');
        assert.equal(files[0].has_metadata, true);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.existsSync(files[0].thumb_path), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('폴더 스캔은 비동기 썸네일 인코더의 확장자로 썸네일을 저장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-async-thumbnail-encoder-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const archivePath = path.join(libraryDir, 'Async Thumbnail.cbz');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(archivePath, Buffer.alloc(0));
        await replaceZipEntry(archivePath, '001.png', PNG_1X1);

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
            thumbnailEncoder: async imageBuffer => ({
                buffer: imageBuffer,
                extension: '.webp',
            }),
        });

        assert.equal(files.length, 1);
        assert.equal(path.extname(files[0].thumb_path), '.webp');
        assert.equal(fs.existsSync(files[0].thumb_path), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('강제 메타데이터 최적화는 유효한 캐시가 있어도 DB 메타데이터를 갱신한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-force-metadata-cache-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const archivePath = path.join(libraryDir, 'Force Metadata.cbz');
    const cachedThumbnailPath = path.join(thumbnailDir, 'cached.png');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.mkdirSync(thumbnailDir, { recursive: true });
        fs.writeFileSync(archivePath, Buffer.alloc(0));
        await replaceZipEntry(archivePath, '001.png', PNG_1X1);
        await replaceZipEntry(
            archivePath,
            'ComicInfo.xml',
            '<ComicInfo><Title>Forced Title</Title><Series>Forced Series</Series><Writer>Forced Writer</Writer><PageCount>12</PageCount></ComicInfo>',
        );
        fs.writeFileSync(cachedThumbnailPath, PNG_1X1);

        const stat = fs.statSync(archivePath);
        const library = new LibraryDB({ dbPath });
        await library.upsertFileInfo({
            path: archivePath,
            mtime: stat.mtimeMs / 1000,
            size: stat.size,
            ext: '.cbz',
            title: '',
            series: '',
            writer: '',
            thumb_path: cachedThumbnailPath,
        });
        await library.close();

        const files = await scanFolder(libraryDir, {
            dbPath,
            thumbnailDir,
            sevenZExe: '',
            force: true,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].title, 'Forced Title');
        assert.equal(files[0].series, 'Forced Series');
        const updatedLibrary = new LibraryDB({ dbPath });
        try {
            const updated = await updatedLibrary.getFileInfo(archivePath);
            assert.equal(updated.title, 'Forced Title');
            assert.equal(updated.series, 'Forced Series');
            assert.equal(updated.writer, 'Forced Writer');
            assert.equal(updated.pages, '12');
        } finally {
            await updatedLibrary.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('라이브러리 스캔 시각 항목은 캐시가 없어도 썸네일을 추출한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-visual-item-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const archivePath = path.join(libraryDir, 'Visual Book.cbz');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(archivePath, Buffer.alloc(0));
        await replaceZipEntry(archivePath, '001.png', PNG_1X1);

        const library = new LibraryDB({ dbPath });
        try {
            const file = await extractLibraryScanVisualItem(archivePath, {
                libraryDb: library,
                thumbnailDir,
                sevenZExe: '',
                allowArchiveExtraction: true,
            });

            assert.equal(file?.path, archivePath);
            assert.match(file.cover, /^bookmanager-thumbnail:\/\/cache\//);
            assert.equal(fs.existsSync(file.thumb_path), true);
            assert.equal((await library.getFileInfo(archivePath)).thumb_path, file.thumb_path);
        } finally {
            await library.close();
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('폴더 스캔은 파일별 준비 이벤트를 보낸다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-file-ready-'));
    const inputDir = path.join(root, 'input');
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const archivePath = path.join(libraryDir, 'Ready Book.cbz');
    const events = [];
    const event = {
        sender: {
            isDestroyed: () => false,
            send: (channel, payload) => events.push({ channel, payload }),
        },
    };

    try {
        fs.mkdirSync(inputDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(inputDir, '001.png'), PNG_1X1);
        const created = spawnSync(sevenZExe, ['a', '-tzip', archivePath, '*'], {
            cwd: inputDir,
            stdio: 'ignore',
        });
        assert.equal(created.status, 0);

        await scanFolder(libraryDir, {
            dbPath,
            thumbnailDir,
            sevenZExe,
            reportFileReady: true,
        }, event);

        const ready = events.find(item => item.channel === 'folder:fileReady');
        assert.equal(ready?.payload?.file?.path, archivePath);
        assert.match(ready.payload.file.cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.existsSync(ready.payload.file.thumb_path), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
