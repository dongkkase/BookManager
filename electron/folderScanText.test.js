import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { inspectFolderFile, scanFolder } from './tasks/folderScanTask.js';
import { saveTextMetadata } from './textMetadataStore.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA7sAAAAASUVORK5CYII=',
    'base64',
);

function createFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-text-scan-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const filePath = path.join(libraryDir, 'Filename Series 12.txt');
    const coverPath = path.join(root, 'cover.png');
    fs.mkdirSync(libraryDir);
    fs.writeFileSync(filePath, 'original text book contents');
    fs.writeFileSync(coverPath, PNG_1X1);
    const libraryDb = new LibraryDB({ dbPath: path.join(root, 'library.db') });
    t.after(async () => {
        await libraryDb.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    return { root, libraryDir, thumbnailDir, filePath, coverPath, libraryDb };
}

test('TXT는 외부 이동과 캐시 초기화 후에도 메타데이터와 전용 표지를 검색 인덱스에 복원한다', async t => {
    const fixture = createFixture(t);
    const { root, filePath, coverPath, libraryDb, thumbnailDir } = fixture;
    const saved = await saveTextMetadata(filePath, {
        libraryDb,
        metadata: { Title: 'Stored Title', Series: 'Stored Series', Writer: 'Distinctive Writer' },
        record: { title: 'Stored Title', series: 'Stored Series', writer: 'Distinctive Writer' },
        coverChange: { type: 'file', filePath: coverPath },
    });
    await libraryDb.prepareSearchIndex();
    const movedDir = path.join(root, 'moved');
    const movedPath = path.join(movedDir, 'Different Filename 99.TXT');
    fs.mkdirSync(movedDir);
    fs.renameSync(filePath, movedPath);
    libraryDb.getConnection().exec('DELETE FROM files');
    fs.rmSync(thumbnailDir, { recursive: true, force: true });

    const files = await scanFolder(movedDir, {
        libraryDb,
        thumbnailDir,
        force: true,
        skipCoverExtraction: true,
    });

    assert.equal(files.length, 1);
    assert.equal(files[0].title, 'Stored Title');
    assert.equal(files[0].series, 'Stored Series');
    assert.equal(files[0].writer, 'Distinctive Writer');
    assert.equal(files[0].has_metadata, true);
    assert.equal(files[0].cache_source, 'library');
    assert.equal(files[0].thumb_path, saved.coverPath);
    assert.equal(files[0].cover_override_path, saved.coverPath);
    assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/text-cover\//);
    assert.equal(path.dirname(saved.coverPath), path.join(root, 'text-thumbnails'));
    assert.deepEqual(fs.readFileSync(saved.coverPath), PNG_1X1);
    const matches = await libraryDb.searchFiles('Distinctive Writer', [movedDir]);
    assert.deepEqual(matches.map(row => row.path), [movedPath]);
    assert.equal(matches[0].thumb_path, saved.coverPath);
});

test('TXT 강제 스캔과 캐시 우회는 사용자가 비운 필드를 파일명으로 다시 채우지 않는다', async t => {
    const { filePath, libraryDir, libraryDb } = createFixture(t);
    await saveTextMetadata(filePath, {
        libraryDb,
        metadata: { Title: '', Series: '', Volume: '', Writer: '', Teams: 'A Team', Locations: 'A Place' },
        record: { title: '', series: '', volume: '', writer: '', teams: 'A Team', locations: 'A Place' },
    });

    for (const options of [{ force: true }, { skipArchiveExtraction: true }, { skipLibraryCache: true }]) {
        const files = await scanFolder(libraryDir, { dbPath: libraryDb.dbPath, ...options });
        assert.equal(files[0].title, '');
        assert.equal(files[0].series, '');
        assert.equal(files[0].volume, '');
        assert.equal(files[0].writer, '');
        assert.equal(files[0].teams, 'A Team');
        assert.equal(files[0].locations, 'A Place');
        assert.equal(files[0].has_metadata, true);
        const indexed = await libraryDb.getFileInfo(filePath);
        assert.equal(indexed.title, '');
        assert.equal(indexed.series, '');
        assert.equal(indexed.volume, '');
        assert.equal(indexed.metadata_override, 1);
    }
});

test('같은 경로의 TXT 내용이 바뀌면 크기와 수정 시각이 같아도 이전 메타데이터를 분리한다', async t => {
    const { filePath, libraryDir, libraryDb } = createFixture(t);
    fs.writeFileSync(filePath, 'alpha');
    const stat = fs.statSync(filePath);
    await saveTextMetadata(filePath, {
        libraryDb,
        metadata: { Title: 'Private Stored Title', Writer: 'Distinctive Writer' },
        record: { title: 'Private Stored Title', writer: 'Distinctive Writer' },
    });
    await libraryDb.prepareSearchIndex();
    fs.writeFileSync(filePath, 'bravo');
    fs.utimesSync(filePath, stat.atime, stat.mtime);

    const replaced = await inspectFolderFile(filePath, { libraryDb, skipArchiveExtraction: true });
    assert.equal(replaced.title, 'Filename Series 12');
    assert.equal(replaced.writer, '');
    assert.equal(replaced.has_metadata, false);
    assert.deepEqual(await libraryDb.searchFiles('Distinctive Writer', [libraryDir]), []);

    const originalPath = path.join(libraryDir, 'Restored Original.txt');
    fs.writeFileSync(originalPath, 'alpha');
    const restored = await inspectFolderFile(originalPath, { libraryDb, force: true });
    assert.equal(restored.title, 'Private Stored Title');
    assert.equal(restored.writer, 'Distinctive Writer');
});

test('메타데이터가 없는 TXT를 반복 스캔해도 파일명 추론을 저장된 메타데이터로 취급하지 않는다', async t => {
    const { filePath, libraryDir, libraryDb } = createFixture(t);
    await scanFolder(libraryDir, { libraryDb });
    const files = await scanFolder(libraryDir, { libraryDb });

    assert.equal(files[0].title, 'Filename Series 12');
    assert.equal(files[0].has_metadata, false);
    assert.equal(await libraryDb.getTextMetadataPathHash(filePath), '');
});

test('TXT 메타데이터 수정은 기존 검색 인덱스와 스캔 결과에 반영된다', async t => {
    const { filePath, libraryDir, libraryDb } = createFixture(t);
    await saveTextMetadata(filePath, {
        libraryDb,
        metadata: { Title: 'Previous Title' },
        record: { title: 'Previous Title' },
    });
    assert.equal((await libraryDb.searchFiles('Previous Title', [libraryDir])).length, 1);
    await saveTextMetadata(filePath, {
        libraryDb,
        metadata: { Title: 'Revised Title' },
        record: { title: 'Revised Title' },
    });

    const files = await scanFolder(libraryDir, { libraryDb });
    assert.equal(files[0].title, 'Revised Title');
    assert.deepEqual(await libraryDb.searchFiles('Previous Title', [libraryDir]), []);
    assert.deepEqual((await libraryDb.searchFiles('Revised Title', [libraryDir])).map(row => row.path), [filePath]);
});
