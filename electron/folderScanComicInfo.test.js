import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { LibraryDB } from './database/library_db.js';
import { COMICINFO_CACHE_VERSION } from './comicInfoXml.js';
import { scanFolder } from './tasks/folderScanTask.js';

async function createFixture(t, xml, otherEntries = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-comicinfo-scan-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libraryDir = path.join(root, 'library');
    const archivePath = path.join(libraryDir, 'Example.cbz');
    const dbPath = path.join(root, 'library.db');
    fs.mkdirSync(libraryDir);
    fs.writeFileSync(archivePath, Buffer.alloc(0));
    for (const [name, contents] of otherEntries) {
        await replaceZipEntry(archivePath, name, contents);
    }
    if (xml !== null) await replaceZipEntry(archivePath, 'ComicInfo.xml', xml);
    return {
        archivePath,
        dbPath,
        scan: options => scanFolder(libraryDir, { dbPath, skipCoverExtraction: true, ...options }),
    };
}

function find7z() {
    return ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']
        .find(candidate => !spawnSync(candidate, ['i'], { stdio: 'ignore' }).error) || '';
}

test('CBZ 스캔은 중첩 XML보다 루트 ComicInfo.xml을 우선한다', async t => {
    const fixture = await createFixture(t,
        '<ComicInfo><Title>Root title</Title><CommunityRating>5</CommunityRating></ComicInfo>',
        [['nested/ComicInfo.xml', '<ComicInfo><Title>Nested title</Title><CommunityRating>1</CommunityRating></ComicInfo>']],
    );
    const [file] = await fixture.scan();
    assert.equal(file.title, 'Root title');
    assert.equal(file.rating, '10');
});

test('CBZ 루트에 XML이 없으면 중첩 ComicInfo.xml을 읽는다', async t => {
    const fixture = await createFixture(t, null, [
        ['nested/COMICINFO.XML', '<ComicInfo><Title>Nested title</Title></ComicInfo>'],
    ]);
    assert.equal((await fixture.scan())[0].title, 'Nested title');
});

test('7z 스캔은 여러 XML을 연결하지 않고 루트 또는 첫 중첩 XML 하나를 읽는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-comicinfo-7z-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const withRoot of [true, false]) {
        const inputDir = path.join(root, withRoot ? 'input-root' : 'input-nested');
        const libraryDir = path.join(root, withRoot ? 'library-root' : 'library-nested');
        fs.mkdirSync(libraryDir);
        for (const directory of ['a', 'b']) {
            fs.mkdirSync(path.join(inputDir, directory), { recursive: true });
            fs.writeFileSync(path.join(inputDir, directory, 'ComicInfo.xml'), `<ComicInfo><Title>Nested ${directory}</Title></ComicInfo>`);
        }
        if (withRoot) fs.writeFileSync(path.join(inputDir, 'COMICINFO.XML'), '<ComicInfo><Title>Root title</Title></ComicInfo>');
        const archivePath = path.join(libraryDir, 'Example.cb7');
        const created = spawnSync(sevenZExe, ['a', '-t7z', archivePath, '.'], { cwd: inputDir, stdio: 'ignore' });
        assert.equal(created.status, 0);
        for (const skipCoverExtraction of [true, false]) {
            const [file] = await scanFolder(libraryDir, { sevenZExe, skipCoverExtraction });
            assert.equal(file.title, withRoot ? 'Root title' : 'Nested a');
            assert.equal(file.has_metadata, true);
        }
    }
});

test('CBZ 스캔은 XML 문자 참조와 CDATA, 표준 평점과 기존 DB 메타데이터 필드를 읽는다', async t => {
    const fixture = await createFixture(t, [
        '<ComicInfo>',
        '<Title>A &#38; B &#xD55C;</Title>',
        '<Series>Example</Series>',
        '<Summary><![CDATA[A <B> & C]]></Summary>',
        '<CommunityRating>4.5</CommunityRating>',
        '<Teams>Team &#38; Co.</Teams>',
        '<Locations><![CDATA[City & Village]]></Locations>',
        '<Tags>Fantasy, Adventure</Tags>',
        '<StoryArc>First Arc</StoryArc>',
        '<GTIN>9781234567890</GTIN>',
        '</ComicInfo>',
    ].join(''));

    const [file] = await fixture.scan();
    assert.equal(file.title, 'A & B 한');
    assert.equal(file.description, 'A <B> & C');
    assert.equal(file.rating, '9');
    assert.equal(file.teams, 'Team & Co.');
    assert.equal(file.locations, 'City & Village');
    assert.equal(file.tags, 'Fantasy, Adventure');
    assert.equal(file.story_arc, 'First Arc');
    assert.equal(file.isbn, '9781234567890');

    const [cached] = await fixture.scan();
    assert.equal(cached.rating, '9');
    assert.equal(cached.teams, file.teams);
    assert.equal(cached.locations, file.locations);
    assert.equal(cached.isbn, file.isbn);
});

test('CBZ의 5점 평점은 10점으로 변환하고 기존 5점 초과 평점은 유지한다', async t => {
    for (const [xmlRating, appRating] of [['0', '0'], ['2.5', '5'], ['5', '10'], ['8', '8']]) {
        await t.test(xmlRating, async child => {
            const fixture = await createFixture(child, `<ComicInfo><CommunityRating>${xmlRating}</CommunityRating></ComicInfo>`);
            const [file] = await fixture.scan();
            const [cached] = await fixture.scan();
            assert.equal(file.rating, appRating);
            assert.equal(cached.rating, appRating);
        });
    }
});

test('이전 ComicInfo 캐시는 원본을 한 번 다시 읽고 새 평점 캐시는 재변환하지 않는다', async t => {
    const fixture = await createFixture(t, '<ComicInfo><Title>A &#38; B</Title><CommunityRating>5</CommunityRating></ComicInfo>');
    const stats = fs.statSync(fixture.archivePath);
    const library = new LibraryDB({ dbPath: fixture.dbPath });
    try {
        await library.upsertFileInfo({
            path: fixture.archivePath,
            mtime: stats.mtimeMs / 1000,
            size: stats.size,
            title: 'A &#38; B',
            rating: '5',
        });
    } finally {
        await library.close();
    }

    const [refreshed] = await fixture.scan();
    assert.equal(refreshed.title, 'A & B');
    assert.equal(refreshed.rating, '10');
    const updatedLibrary = new LibraryDB({ dbPath: fixture.dbPath });
    try {
        const cached = await updatedLibrary.getFileInfo(fixture.archivePath);
        assert.equal(cached.comicinfo_version, COMICINFO_CACHE_VERSION);
        assert.equal(cached.rating, '10');
        updatedLibrary.getConnection().prepare('UPDATE files SET title = ? WHERE path = ?')
            .run('Cached title', fixture.archivePath);
    } finally {
        await updatedLibrary.close();
    }

    const [cached] = await fixture.scan();
    assert.equal(cached.title, 'Cached title');
    assert.equal(cached.rating, '10');
});

test('ComicInfo 캐시 갱신과 강제 재스캔은 앱의 로컬 평점을 보존한다', async t => {
    const fixture = await createFixture(t, '<ComicInfo><CommunityRating>5</CommunityRating></ComicInfo>');
    const stats = fs.statSync(fixture.archivePath);
    const library = new LibraryDB({ dbPath: fixture.dbPath });
    try {
        await library.upsertFileInfo({
            path: fixture.archivePath,
            mtime: stats.mtimeMs / 1000,
            size: stats.size,
            rating: '5',
        });
        await library.setFileRating(fixture.archivePath, 7);
    } finally {
        await library.close();
    }

    assert.equal((await fixture.scan())[0].rating, '7');
    assert.equal((await fixture.scan({ force: true }))[0].rating, '7');
});
