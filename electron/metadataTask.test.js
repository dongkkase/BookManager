import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
    analyzeMetadataInputs,
    createComicInfoXml,
    loadMetadataCover,
    metadataWriteSupport,
    parseComicInfo,
    saveMetadataItems,
} from './tasks/metadataTask.js';
import {
    listZipEntries,
    readZipEntry,
    replaceZipEntry,
} from './core/zipArchive.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

test('ComicInfo XML preserves supported fields and ignores removed comic fields', () => {
    const xml = createComicInfoXml({
        Series: 'A & B',
        AlternateSeries: '다른 시리즈',
        AlternateNumber: '2',
        AlternateCount: '10',
        Translator: '번역자',
        Teams: '팀',
        Locations: '장소',
        BlackAndWhite: 'Yes',
        CommunityRating: '4.5',
        ISBN: '97800000000',
    });

    assert.match(xml, /xmlns:xsi=/);
    assert.match(xml, /<Series>A &amp; B<\/Series>/);
    assert.match(xml, /<BlackAndWhite>Yes<\/BlackAndWhite>/);
    assert.match(xml, /<ComicZipAddedDate>/);
    assert.match(xml, /<ComicZipModifiedDate>/);
    assert.doesNotMatch(xml, /<AlternateSeries>/);
    assert.doesNotMatch(xml, /<AlternateNumber>/);
    assert.doesNotMatch(xml, /<AlternateCount>/);
    assert.doesNotMatch(xml, /<Translator>/);
    assert.doesNotMatch(xml, /<Teams>/);
    assert.doesNotMatch(xml, /<Locations>/);
    assert.doesNotMatch(xml, /<ISBN>/);
});

test('ComicInfo XML parsing is case insensitive and preserves added date', () => {
    const parsed = parseComicInfo(`
        <ComicInfo>
            <series>작품</series>
            <Translator>번역자</Translator>
            <Teams>팀</Teams>
            <Locations>장소</Locations>
            <ComicZipAddedDate>2024-01-02 03:04:05</ComicZipAddedDate>
        </ComicInfo>
    `);

    assert.equal(parsed.Series, '작품');
    assert.equal(parsed.Translator, undefined);
    assert.equal(parsed.Teams, undefined);
    assert.equal(parsed.Locations, undefined);
    assert.equal(parsed.ComicZipAddedDate, '2024-01-02 03:04:05');
});

test('RAR과 CBR 메타데이터 쓰기 제한을 명확히 안내한다', () => {
    assert.equal(metadataWriteSupport('book.rar').supported, false);
    assert.equal(metadataWriteSupport('BOOK.CBR').supported, false);
    assert.equal(metadataWriteSupport('book.epub').supported, true);
    assert.match(metadataWriteSupport('book.rar').message, /CBZ|ZIP/);
    assert.equal(metadataWriteSupport('book.cbz').supported, true);
});

test('PDF/EPUB/TXT 도서 파일도 메타데이터 작업 리스트에 포함한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-books-'));
    try {
        const source = path.join(root, '소설책 01권.epub');
        fs.writeFileSync(source, Buffer.from('book'));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].bookType, 'book');
        assert.equal(analyzed.items[0].metadata.Format, 'Novel');
        assert.equal(analyzed.items[0].metadata.Manga, '');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('메타데이터 분석은 표지를 지연 로드할 수 있다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-lazy-cover-'));
    try {
        const source = path.join(root, '느린 표지 01.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'ComicInfo.xml', createComicInfoXml({
            Series: '느린 표지',
            Title: '느린 표지 01',
        }));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));

        const analyzed = await analyzeMetadataInputs([source], { includeCovers: false });
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].metadata.Series, '느린 표지');
        assert.equal(analyzed.items[0].coverDataUrl, '');

        const coverDataUrl = await loadMetadataCover(source, {});
        assert.match(coverDataUrl, /^data:image\/jpeg;base64,/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('메타데이터 분석은 DB 출판사 후보와 설정 언어 기본값을 반환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-publishers-'));
    try {
        const source = path.join(root, '소설책 02권.txt');
        fs.writeFileSync(source, 'book');
        const analyzed = await analyzeMetadataInputs([source], {
            lang: 'ja',
            libraryDb: {
                async getDistinctPublishers() {
                    return [
                        { publisher: '민음사', count: 3 },
                        { publisher: '황금가지', count: 1 },
                        { publisher: '민음사', count: 1 },
                    ];
                },
                async getFileInfo() {
                    return null;
                },
            },
        });

        assert.deepEqual(analyzed.publisherOptions, ['민음사', '황금가지']);
        assert.equal(analyzed.items[0].metadata.LanguageISO, 'ja');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB OPF 메타데이터는 항목별로 읽고 시리즈 번호의 좌측 0을 제거한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-opf-'));
    try {
        const source = path.join(root, '왕좌의 게임 02권.epub');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(
            source,
            'META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        );
        await replaceZipEntry(
            source,
            'OEBPS/content.opf',
            [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xmlns:dc="http://purl.org/dc/elements/1.1/">',
                '  <metadata>',
                '    <dc:identifier id="uid">97800000000</dc:identifier>',
                '    <dc:title>왕좌의 게임 02권 - 왕들의 전쟁권(title)</dc:title>',
                '    <dc:creator>조지 R. R. 마틴</dc:creator>',
                '    <dc:language>ko</dc:language>',
                '    <dc:publisher>은행나무</dc:publisher>',
                '    <dc:date>2000-04-13</dc:date>',
                '    <dc:description>&lt;div&gt;&lt;p&gt;&lt;b&gt;출간 20주년 기념 전면 개정판',
                '    <dc:subject>장르소설.판타지</dc:subject>',
                '    <dc:subject>category1</dc:subject>',
                '    <dc:subject>tag1</dc:subject>',
                '    <meta name="calibre:series" content="시리즈 이름"/>',
                '    <meta name="calibre:series_index" content="002.0"/>',
                '    <meta name="calibre:rating" content="4.5"/>',
                '  </metadata>',
                '  <manifest/>',
                '  <spine/>',
                '</package>',
            ].join('\n'),
        );

        const analyzed = await analyzeMetadataInputs([source], {});
        const metadata = analyzed.items[0].metadata;
        assert.equal(metadata.Title, '왕좌의 게임 02권 - 왕들의 전쟁권(title)');
        assert.equal(metadata.Writer, '조지 R. R. 마틴');
        assert.equal(metadata.Publisher, '은행나무');
        assert.equal(metadata.LanguageISO, 'ko');
        assert.equal(metadata.ISBN, '97800000000');
        assert.equal(metadata.Year, '2000');
        assert.equal(metadata.Month, '04');
        assert.equal(metadata.Day, '13');
        assert.equal(metadata.Summary, '출간 20주년 기념 전면 개정판');
        assert.equal(metadata.Genre, '장르소설.판타지');
        assert.equal(metadata.Tags, 'category1, tag1');
        assert.equal(metadata.Series, '시리즈 이름');
        assert.equal(metadata.Volume, '2');
        assert.equal(metadata.CommunityRating, '4.5');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 메타데이터는 OPF 패키지 문서에서 분석하고 저장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-'));
    try {
        const source = path.join(root, '기존 EPUB.epub');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(
            source,
            'META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        );
        await replaceZipEntry(
            source,
            'OEBPS/content.opf',
            [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<package version="3.0" unique-identifier="pub-id" xmlns:dc="http://purl.org/dc/elements/1.1/">',
                '    <metadata>',
                '        <dc:identifier id="pub-id">97800000000</dc:identifier>',
                '        <dc:title>기존 제목</dc:title>',
                '        <dc:language>en</dc:language>',
                '        <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>',
                '        <dc:creator>기존 작가</dc:creator>',
                '        <dc:publisher>기존 출판사</dc:publisher>',
                '        <dc:date>2000-04-13</dc:date>',
                '        <dc:description>&lt;div&gt;&lt;p&gt;&lt;b&gt;책 설명&lt;/b&gt;&lt;/p&gt;&lt;p&gt;본문 설명입니다.&lt;/p&gt;&lt;/div&gt;</dc:description>',
                '        <dc:subject>기존 장르</dc:subject>',
                '        <dc:subject>category1</dc:subject>',
                '        <dc:subject>tag1</dc:subject>',
                '        <meta name="cover" content="cover-id"/>',
                '        <meta name="calibre:rating" content="1.0"/>',
                '        <meta property="belongs-to-collection" id="series">기존 시리즈</meta>',
                '        <meta refines="#series" property="collection-type">series</meta>',
                '        <meta refines="#series" property="group-position">001</meta>',
                '    </metadata>',
                '    <manifest>',
                '        <item id="cover-id" properties="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>',
                '    </manifest>',
                '    <spine/>',
                '</package>',
            ].join('\n'),
        );
        await replaceZipEntry(source, 'OEBPS/images/cover.jpg', Buffer.from('cover'));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].metadata.Title, '기존 제목');
        assert.equal(analyzed.items[0].metadata.Writer, '기존 작가');
        assert.equal(analyzed.items[0].metadata.Publisher, '기존 출판사');
        assert.equal(analyzed.items[0].metadata.LanguageISO, 'en');
        assert.equal(analyzed.items[0].metadata.ISBN, '97800000000');
        assert.equal(analyzed.items[0].metadata.Year, '2000');
        assert.equal(analyzed.items[0].metadata.Month, '04');
        assert.equal(analyzed.items[0].metadata.Day, '13');
        assert.equal(analyzed.items[0].metadata.Summary, '책 설명\n본문 설명입니다.');
        assert.equal(analyzed.items[0].metadata.Genre, '기존 장르');
        assert.equal(analyzed.items[0].metadata.Tags, 'category1, tag1');
        assert.equal(analyzed.items[0].metadata.Series, '기존 시리즈');
        assert.equal(analyzed.items[0].metadata.Volume, '1');
        assert.equal(analyzed.items[0].metadata.CommunityRating, '1.0');
        assert.equal(analyzed.items[0].metadata.ComicZipModifiedDate, '2024-01-01T00:00:00Z');
        assert.match(analyzed.items[0].coverDataUrl, /^data:image\/jpeg;base64,/);

        analyzed.items[0].metadata = {
            ...analyzed.items[0].metadata,
            Title: '변경된 제목',
            Writer: '새 작가',
            Translator: '번역자',
            Publisher: '새 출판사',
            Summary: '변경된 줄거리',
            Genre: '판타지',
            Tags: '모험, 마법',
            ISBN: '9791111111111',
            LanguageISO: 'ko',
            Series: '새 시리즈',
            Volume: '2',
            CommunityRating: '4.5',
            Year: '2026',
            Month: '6',
            Day: '23',
        };
        const persistedRecords = [];
        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
            libraryDb: {
                async getFileInfo() {
                    return null;
                },
                async upsertFileInfo(record) {
                    persistedRecords.push(record);
                },
            },
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.equal(persistedRecords[0].rating, '4.5');

        const buffer = fs.readFileSync(source);
        const opfEntry = listZipEntries(buffer).find(entry => entry.name === 'OEBPS/content.opf');
        assert.ok(opfEntry);
        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        assert.match(opfXml, /<dc:identifier id="pub-id">9791111111111<\/dc:identifier>/);
        assert.match(opfXml, /<dc:title>변경된 제목<\/dc:title>/);
        assert.match(opfXml, /<dc:language>ko<\/dc:language>/);
        assert.match(opfXml, /<meta property="dcterms:modified">[^<]+Z<\/meta>/);
        assert.match(opfXml, /<dc:creator>새 작가<\/dc:creator>/);
        assert.match(opfXml, /<dc:contributor id="bookmanager-translator-1">번역자<\/dc:contributor>/);
        assert.match(opfXml, /<dc:publisher>새 출판사<\/dc:publisher>/);
        assert.match(opfXml, /<dc:description>변경된 줄거리<\/dc:description>/);
        assert.match(opfXml, /<dc:subject>판타지<\/dc:subject>/);
        assert.match(opfXml, /<dc:subject>모험<\/dc:subject>/);
        assert.match(opfXml, /<dc:subject>마법<\/dc:subject>/);
        assert.match(opfXml, /<dc:date>2026-06-23<\/dc:date>/);
        assert.match(opfXml, /<meta property="schema:ratingValue">4.5<\/meta>/);
        assert.doesNotMatch(opfXml, /calibre:rating/);
        assert.doesNotMatch(opfXml, /content="1.0"/);
        assert.match(opfXml, /<meta property="belongs-to-collection" id="bookmanager-series">새 시리즈<\/meta>/);
        assert.match(opfXml, /<meta refines="#bookmanager-series" property="group-position">2<\/meta>/);
        assert.match(opfXml, /<meta name="cover" content="cover-id"\/>/);

        const reanalyzed = await analyzeMetadataInputs([source], {});
        assert.equal(reanalyzed.items[0].metadata.Title, '변경된 제목');
        assert.equal(reanalyzed.items[0].metadata.Translator, '번역자');
        assert.equal(reanalyzed.items[0].metadata.Series, '새 시리즈');
        assert.equal(reanalyzed.items[0].metadata.Volume, '2');
        assert.equal(reanalyzed.items[0].metadata.CommunityRating, '4.5');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB OPF 네임스페이스 접두사가 있어도 메타데이터를 분석하고 저장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-prefix-'));
    try {
        const source = path.join(root, '접두사 EPUB.epub');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(
            source,
            'META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        );
        await replaceZipEntry(
            source,
            'OEBPS/content.opf',
            [
                "<?xml version='1.0' encoding='utf-8'?>",
                '<ns0:package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ns0="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">',
                '  <ns0:metadata>',
                '    <dc:identifier id="BookId">urn:isbn:97800000000</dc:identifier>',
                '    <dc:creator ns0:role="aut">조지 R. R. 마틴</dc:creator>',
                '    <dc:contributor id="translator" ns0:role="trl">번역자</dc:contributor>',
                '    <dc:publisher>은행나무</dc:publisher>',
                '    <dc:date>2017-05-25T15:00:00+00:00</dc:date>',
                '    <dc:subject>장르소설.판타지</dc:subject>',
                '    <dc:subject>tag1</dc:subject>',
                '    <dc:description>&lt;div&gt;&lt;p&gt;책 설명&lt;/p&gt;&lt;/div&gt;</dc:description>',
                '    <dc:language>ko</dc:language>',
                '    <ns0:meta property="dcterms:modified">2025-02-03T04:05:06Z</ns0:meta>',
                '    <ns0:meta name="cover" content="cover-id" />',
                '    <ns0:meta property="belongs-to-collection" id="series">얼음과 불의 노래</ns0:meta>',
                '    <ns0:meta refines="#series" property="collection-type">series</ns0:meta>',
                '    <ns0:meta refines="#series" property="group-position">002.0</ns0:meta>',
                '    <dc:title>왕좌의 게임 02권 - 왕들의 전쟁권</dc:title>',
                '  </ns0:metadata>',
                '  <ns0:manifest>',
                '    <ns0:item id="cover-id" properties="cover-image" href="Images/cover.jpg" media-type="image/jpeg" />',
                '  </ns0:manifest>',
                '  <ns0:spine/>',
                '</ns0:package>',
            ].join('\n'),
        );
        await replaceZipEntry(source, 'OEBPS/Images/cover.jpg', Buffer.from('cover'));

        const analyzed = await analyzeMetadataInputs([source], {});
        const metadata = analyzed.items[0].metadata;
        assert.equal(metadata.Title, '왕좌의 게임 02권 - 왕들의 전쟁권');
        assert.equal(metadata.Writer, '조지 R. R. 마틴');
        assert.equal(metadata.Translator, '번역자');
        assert.equal(metadata.Publisher, '은행나무');
        assert.equal(metadata.LanguageISO, 'ko');
        assert.equal(metadata.ISBN, '97800000000');
        assert.equal(metadata.Year, '2017');
        assert.equal(metadata.Month, '05');
        assert.equal(metadata.Day, '25');
        assert.equal(metadata.Summary, '책 설명');
        assert.equal(metadata.Genre, '장르소설.판타지');
        assert.equal(metadata.Tags, 'tag1');
        assert.equal(metadata.Series, '얼음과 불의 노래');
        assert.equal(metadata.Volume, '2');
        assert.equal(metadata.ComicZipModifiedDate, '2025-02-03T04:05:06Z');
        assert.match(analyzed.items[0].coverDataUrl, /^data:image\/jpeg;base64,/);

        analyzed.items[0].metadata = {
            ...metadata,
            Title: '변경된 제목',
            Series: '변경된 시리즈',
            Volume: '3',
        };
        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const opfEntry = listZipEntries(buffer).find(entry => entry.name === 'OEBPS/content.opf');
        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        assert.match(opfXml, /<ns0:metadata>/);
        assert.match(opfXml, /<dc:title>변경된 제목<\/dc:title>/);
        assert.match(opfXml, /<ns0:meta property="dcterms:modified">[^<]+Z<\/ns0:meta>/);
        assert.match(opfXml, /<ns0:meta property="belongs-to-collection" id="bookmanager-series">변경된 시리즈<\/ns0:meta>/);
        assert.match(opfXml, /<ns0:meta refines="#bookmanager-series" property="group-position">3<\/ns0:meta>/);
        assert.match(opfXml, /<ns0:meta name="cover" content="cover-id" \/>/);

        const reanalyzed = await analyzeMetadataInputs([source], {});
        assert.equal(reanalyzed.items[0].metadata.Title, '변경된 제목');
        assert.equal(reanalyzed.items[0].metadata.Series, '변경된 시리즈');
        assert.equal(reanalyzed.items[0].metadata.Volume, '3');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 메타데이터 분석과 저장은 외부 7z 없이 처리한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-native-'));
    try {
        const source = path.join(root, '작품명 02권.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));
        await replaceZipEntry(source, 'ComicInfo.xml', createComicInfoXml({
            Series: '기존 작품',
            Title: '기존 제목',
        }));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].metadata.Series, '기존 작품');
        assert.equal(analyzed.items[0].hasComicInfo, true);
        assert.equal(analyzed.items[0].pageCount, 1);

        analyzed.items[0].metadata.Series = '변경된 작품';
        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const comicInfoEntry = listZipEntries(buffer).find(entry => entry.name === 'ComicInfo.xml');
        assert.ok(comicInfoEntry);
        const xml = readZipEntry(buffer, comicInfoEntry).toString('utf8');
        assert.match(xml, /<Series>변경된 작품<\/Series>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('메타데이터 저장은 백업 후 원본 경로를 원자적으로 교체한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input);
        fs.writeFileSync(path.join(input, '001.jpg'), Buffer.from('page'));
        const source = path.join(root, '작품명 01권.CBZ');
        assert.equal(spawnSync(sevenZExe, ['a', '-tzip', source, '*'], {
            cwd: input,
            stdio: 'ignore',
        }).status, 0);
        const original = fs.readFileSync(source);

        const analyzed = await analyzeMetadataInputs([source], { sevenZExe });
        assert.equal(analyzed.items.length, 1);
        analyzed.items[0].metadata.Series = '변경된 작품명';
        const saved = await saveMetadataItems(analyzed.items, {
            sevenZExe,
            backup_on: true,
            shouldCancel: () => false,
        });

        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(path.join(root, 'bak', path.basename(source))), original);
        const xml = spawnSync(sevenZExe, ['x', '-so', source, 'ComicInfo.xml']).stdout.toString('utf8');
        assert.match(xml, /<Series>변경된 작품명<\/Series>/);
        assert.deepEqual(
            fs.readdirSync(root).filter(name => name.includes('bookmanager_metadata') || name.endsWith('.bookmanager.metadata.old')),
            [],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
