import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { scanFolder } from './tasks/folderScanTask.js';

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
