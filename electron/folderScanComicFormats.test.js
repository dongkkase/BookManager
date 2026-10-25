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

function find7z() {
    return ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']
        .find(candidate => !spawnSync(candidate, ['i'], { stdio: 'ignore' }).error) || '';
}

async function createFixture(t, entries, sevenZExe = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-comic-formats-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const libraryDir = path.join(root, 'library');
    const archivePath = path.join(libraryDir, `Example.${sevenZExe ? '7z' : 'cbz'}`);
    const dbPath = path.join(root, 'library.db');
    fs.mkdirSync(libraryDir);
    if (sevenZExe) {
        const inputDir = path.join(root, 'input');
        for (const [name, contents] of entries) {
            const target = path.join(inputDir, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, contents);
        }
        const created = spawnSync(sevenZExe, ['a', '-t7z', archivePath, '.'], {
            cwd: inputDir,
            stdio: 'ignore',
        });
        assert.equal(created.status, 0);
    } else {
        fs.writeFileSync(archivePath, Buffer.alloc(0));
        for (const [name, contents] of entries) await replaceZipEntry(archivePath, name, contents);
    }
    return {
        archivePath,
        dbPath,
        scan: options => scanFolder(libraryDir, { dbPath, sevenZExe, skipCoverExtraction: true, ...options }),
    };
}

test('ComicBook.xml만 있는 CBZ는 상세 보기의 공통 필드와 평점을 읽는다', async t => {
    const fixture = await createFixture(t, [['ComicBook.xml', [
        '<ComicBook>',
        '<Title>Book &#38; Title</Title><Series>Book Series</Series><Number>002AU</Number><Volume>3</Volume>',
        '<Writer>Book Writer</Writer><Penciller>Book Artist</Penciller><Publisher>Book Publisher</Publisher>',
        '<Summary><![CDATA[Book <summary>]]></Summary><CommunityRating>2</CommunityRating><Rating>5</Rating>',
        '<PageCount>24</PageCount><Count>8</Count><Year>2024</Year><Month>6</Month><Day>7</Day>',
        '<Genre>Fantasy</Genre><Tags>Magic</Tags><AgeRating>Teen</AgeRating><Web>https://example.com/book</Web>',
        '</ComicBook>',
    ].join('')]]);
    const before = fs.readFileSync(fixture.archivePath);
    for (const file of [(await fixture.scan())[0], (await fixture.scan())[0]]) {
        assert.equal(file.has_metadata, true);
        assert.equal(file.title, 'Book & Title');
        assert.equal(file.series, 'Book Series');
        assert.equal(file.chapter, '002AU');
        assert.equal(file.volume, '3');
        assert.equal(file.writer, 'Book Writer');
        assert.equal(file.penciller, 'Book Artist');
        assert.equal(file.publisher, 'Book Publisher');
        assert.equal(file.description, 'Book <summary>');
        assert.equal(file.rating, '4');
        assert.equal(file.page_count, '24');
        assert.equal(file.total_volume, '8');
        assert.equal(file.date, '2024-6-7');
        assert.equal(file.genre, 'Fantasy');
        assert.equal(file.tags, 'Magic');
        assert.equal(file.age_rating, 'Teen');
        assert.equal(file.link, 'https://example.com/book');
    }
    assert.deepEqual(fs.readFileSync(fixture.archivePath), before);
});

test('CoMet.xml의 반복 작가와 연령 등급은 상세 보기 필드로 연결한다', async t => {
    const fixture = await createFixture(t, [['nested/COMET.XML', [
        '<comet>',
        '<title>CoMet Title</title><series>CoMet Series</series><issue>01AU</issue>',
        '<writer>First Writer</writer><writer>Second Writer</writer><publisher>CoMet Publisher</publisher>',
        '<description><![CDATA[CoMet <summary>]]></description><pages>32</pages><date>2025-02-03</date>',
        '<rating>Teen</rating><readingDirection>rtl</readingDirection>',
        '</comet>',
    ].join('')]]);
    for (const file of [(await fixture.scan())[0], (await fixture.scan())[0]]) {
        assert.equal(file.has_metadata, true);
        assert.equal(file.title, 'CoMet Title');
        assert.equal(file.series, 'CoMet Series');
        assert.equal(file.chapter, '01AU');
        assert.equal(file.writer, 'First Writer, Second Writer');
        assert.equal(file.publisher, 'CoMet Publisher');
        assert.equal(file.description, 'CoMet <summary>');
        assert.equal(file.page_count, '32');
        assert.equal(file.date, '2025-2-3');
        assert.equal(file.age_rating, 'Teen');
        assert.equal(file.rating, '');
        assert.equal(file.manga, 'YesAndRightToLeft');
    }
});

test('각 XML 형식은 대소문자와 관계없이 루트를 우선하고 없으면 중첩 파일을 읽는다', async t => {
    for (const [name, makeXml] of [
        ['ComicBook.xml', title => `<ComicBook><Title>${title}</Title></ComicBook>`],
        ['CoMet.xml', title => `<comet><title>${title}</title></comet>`],
    ]) {
        for (const withRoot of [true, false]) {
            await t.test(`${name} ${withRoot ? 'root' : 'nested'}`, async child => {
                const entries = [[`nested/${name}`, makeXml('Nested')]];
                if (withRoot) entries.push([name.toUpperCase(), makeXml('Root')]);
                const fixture = await createFixture(child, entries);
                assert.equal((await fixture.scan())[0].title, withRoot ? 'Root' : 'Nested');
            });
        }
    }
});

test('중첩 ComicInfo.xml도 다른 형식보다 우선하고 생략된 필드를 보충하지 않는다', async t => {
    const fixture = await createFixture(t, [
        ['ComicBook.xml', '<ComicBook><Title>Book</Title><Writer>Old writer</Writer><CommunityRating>5</CommunityRating></ComicBook>'],
        ['CoMet.xml', '<comet><title>CoMet</title><publisher>Old publisher</publisher></comet>'],
        ['nested/ComicInfo.xml', '<ComicInfo><Title>Current</Title></ComicInfo>'],
    ]);
    const [file] = await fixture.scan();
    assert.equal(file.title, 'Current');
    assert.equal(file.writer, '');
    assert.equal(file.publisher, '');
    assert.equal(file.rating, '');
    assert.equal(file.has_metadata, true);
});

test('ComicInfo.xml이 없으면 중첩 ComicBook.xml이 루트 CoMet.xml보다 우선한다', async t => {
    const fixture = await createFixture(t, [
        ['CoMet.xml', '<comet><title>CoMet</title><publisher>Old publisher</publisher></comet>'],
        ['nested/ComicBook.xml', '<ComicBook><Title>Book</Title></ComicBook>'],
    ]);
    const [file] = await fixture.scan();
    assert.equal(file.title, 'Book');
    assert.equal(file.publisher, '');
});

test('손상된 우선 XML을 다른 형식으로 대체하거나 원본을 수정하지 않는다', async t => {
    for (const name of ['ComicInfo.xml', 'ComicBook.xml', 'CoMet.xml']) {
        await t.test(name, async child => {
            const entries = [['CoMet.xml', '<comet><title>Fallback</title></comet>']];
            if (name === 'ComicInfo.xml') entries.push(['ComicBook.xml', '<ComicBook><Title>Fallback</Title></ComicBook>']);
            const invalid = name === 'CoMet.xml' ? '<comet><title>Broken</comet>' : '<ComicBook><Title>Broken</ComicBook>';
            const selected = entries.filter(([entryName]) => entryName !== name);
            selected.push([name, invalid]);
            const fixture = await createFixture(child, selected);
            const before = fs.readFileSync(fixture.archivePath);
            const [file] = await fixture.scan();
            assert.equal(file.title, 'Example');
            assert.equal(file.has_metadata, false);
            assert.deepEqual(fs.readFileSync(fixture.archivePath), before);
            const library = new LibraryDB({ dbPath: fixture.dbPath });
            try {
                const cached = await library.getFileInfo(fixture.archivePath);
                assert.notEqual(cached.comicinfo_version, COMICINFO_CACHE_VERSION);
            } finally {
                await library.close();
            }
        });
    }
});

test('버전 1 만화 캐시는 새 형식을 한 번 읽고 버전 2 캐시와 로컬 평점을 유지한다', async t => {
    const fixture = await createFixture(t, [['ComicBook.xml', '<ComicBook><Title>New title</Title><CommunityRating>2</CommunityRating></ComicBook>']]);
    const stats = fs.statSync(fixture.archivePath);
    const library = new LibraryDB({ dbPath: fixture.dbPath });
    try {
        await library.upsertFileInfo({
            path: fixture.archivePath,
            mtime: stats.mtimeMs / 1000,
            size: stats.size,
            title: 'Old title',
            writer: 'Stale writer',
            comicinfo_version: 1,
            has_metadata: 0,
        });
        await library.setFileRating(fixture.archivePath, 7);
    } finally {
        await library.close();
    }
    const [refreshed] = await fixture.scan();
    assert.equal(refreshed.title, 'New title');
    assert.equal(refreshed.writer, '');
    assert.equal(refreshed.rating, '7');
    assert.equal(refreshed.has_metadata, true);
    const updatedLibrary = new LibraryDB({ dbPath: fixture.dbPath });
    try {
        const cached = await updatedLibrary.getFileInfo(fixture.archivePath);
        assert.equal(cached.comicinfo_version, 2);
        assert.equal(cached.rating_override, '7');
        updatedLibrary.getConnection().prepare('UPDATE files SET title = ? WHERE path = ?')
            .run('Cached title', fixture.archivePath);
    } finally {
        await updatedLibrary.close();
    }
    const [cached] = await fixture.scan();
    assert.equal(cached.title, 'Cached title');
    assert.equal(cached.rating, '7');
});

test('7z도 XML 하나만 선택하며 ComicBook과 CoMet의 루트 우선 및 중첩 읽기를 지원한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) return t.skip('7z executable is not available');
    for (const [name, makeXml] of [
        ['ComicBook.xml', title => `<ComicBook><Title>${title}</Title><CommunityRating>2</CommunityRating></ComicBook>`],
        ['CoMet.xml', title => `<comet><title>${title}</title></comet>`],
    ]) {
        for (const withRoot of [true, false]) {
            await t.test(`${name} ${withRoot ? 'root' : 'nested'}`, async child => {
                const entries = [[`a/${name}`, makeXml('Nested A')], [`b/${name}`, makeXml('Nested B')]];
                if (withRoot) entries.push([name.toUpperCase(), makeXml('Root')]);
                const fixture = await createFixture(child, entries, sevenZExe);
                for (const skipCoverExtraction of [true, false]) {
                    const [file] = await fixture.scan({ force: true, skipCoverExtraction });
                    assert.equal(file.title, withRoot ? 'Root' : 'Nested A');
                    assert.equal(file.has_metadata, true);
                    assert.equal(file.rating, name === 'ComicBook.xml' ? '4' : '');
                }
            });
        }
    }
    await t.test('ComicInfo priority over legacy files and XML-named directories', async child => {
        const fixture = await createFixture(child, [
            ['ComicBook.xml', '<ComicBook><Title>Book</Title><Writer>Old writer</Writer></ComicBook>'],
            ['CoMet.xml', '<comet><title>CoMet</title></comet>'],
            ['ComicInfo.xml/placeholder.txt', 'Directory is not metadata'],
            ['nested/ComicInfo.xml', '<ComicInfo><Title>Current</Title></ComicInfo>'],
        ], sevenZExe);
        const [file] = await fixture.scan();
        assert.equal(file.title, 'Current');
        assert.equal(file.writer, '');
    });
    await t.test('Leading-hyphen metadata path is an entry name, not a switch', async child => {
        const fixture = await createFixture(child, [
            ['-legacy/ComicBook.xml', '<ComicBook><Title>Hyphen path</Title></ComicBook>'],
        ], sevenZExe);
        const [file] = await fixture.scan();
        assert.equal(file.title, 'Hyphen path');
        assert.equal(file.has_metadata, true);
    });
});
