import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
    analyzeMetadataInputs,
    createComicInfoXml,
    listMetadataEpubImages,
    loadMetadataCover,
    loadMetadataEpubImage,
    loadLatestSeriesMetadata,
    metadataWriteSupport,
    parseComicInfo,
    saveMetadataItems,
} from './tasks/metadataTask.js';
import { LibraryDB } from './database/library_db.js';
import {
    listZipEntries,
    readZipEntry,
    replaceZipEntry,
} from './core/zipArchive.js';

function pdfObject(number, body) {
    return {
        number,
        buffer: Buffer.isBuffer(body)
            ? Buffer.concat([Buffer.from(`${number} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')])
            : Buffer.from(`${number} 0 obj\n${body}\nendobj\n`, 'latin1'),
    };
}

function pdfStreamObject(number, dict, data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
    return pdfObject(number, Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${buffer.length} >>\nstream\n`, 'latin1'),
        buffer,
        Buffer.from('\nendstream', 'latin1'),
    ]));
}

function buildPdf(objects, trailer) {
    const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const offsets = new Map([[0, 0]]);
    for (const object of objects) {
        offsets.set(object.number, chunks.reduce((total, chunk) => total + chunk.length, 0));
        chunks.push(object.buffer);
    }
    const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const size = Math.max(...objects.map(object => object.number)) + 1;
    const xrefLines = ['xref', `0 ${size}`, '0000000000 65535 f '];
    for (let number = 1; number < size; number += 1) {
        xrefLines.push(`${String(offsets.get(number) || 0).padStart(10, '0')} 00000 n `);
    }
    chunks.push(Buffer.from([
        xrefLines.join('\n'),
        'trailer',
        `<< /Size ${size} ${trailer} >>`,
        'startxref',
        String(xrefOffset),
        '%%EOF',
        '',
    ].join('\n'), 'latin1'));
    return Buffer.concat(chunks);
}

function createPdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> /MediaBox [0 0 300 420] /Contents 5 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 300 /Height 420 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'cover'),
        pdfStreamObject(5, '', 'q 300 0 0 420 0 0 cm /Im0 Do Q'),
        pdfObject(6, "<< /Title (Old PDF) /Author (Old Author) /Subject (Old Subject) /Keywords (old, tag) /Creator (Old Creator) /Producer (Old Producer) /CreationDate (D:20240102030405+09'00') /ModDate (D:20240102030405+09'00') /Trapped /False >>"),
    ], '/Root 1 0 R /Info 6 0 R');
}

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

async function createEpubCoverFixture(source) {
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
            '        <meta name="cover" content="cover-id"/>',
            '    </metadata>',
            '    <manifest>',
            '        <item id="cover-id" properties="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>',
            '        <item id="alt-id" href="images/alt.png" media-type="image/png"/>',
            '    </manifest>',
            '    <spine/>',
            '</package>',
        ].join('\n'),
    );
    await replaceZipEntry(source, 'OEBPS/images/cover.jpg', Buffer.from('cover'));
    await replaceZipEntry(source, 'OEBPS/images/alt.png', Buffer.from('alt cover'));
}

async function createEpubWebpCoverWithJpegAlternateFixture(source) {
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
            '        <meta name="cover" content="bookmanager-cover" />',
            '    </metadata>',
            '    <manifest>',
            '        <item id="bookmanager-cover" href="images/bookmanager-cover.webp" media-type="image/webp" properties="cover-image" />',
            '        <item id="bookmanager-cover-2" href="images/bookmanager-cover.jpg" media-type="image/jpeg" />',
            '        <item id="bookmanager-cover-page" href="bookmanager-cover.xhtml" media-type="application/xhtml+xml" />',
            '    </manifest>',
            '    <spine>',
            '        <itemref idref="bookmanager-cover-page" linear="yes" />',
            '    </spine>',
            '    <guide>',
            '        <reference type="cover" title="Cover" href="bookmanager-cover.xhtml" />',
            '    </guide>',
            '</package>',
        ].join('\n'),
    );
    await replaceZipEntry(
        source,
        'OEBPS/bookmanager-cover.xhtml',
        [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<html xmlns="http://www.w3.org/1999/xhtml">',
            '<body>',
            '    <img src="images/bookmanager-cover.webp" alt="Cover" />',
            '</body>',
            '</html>',
            '',
        ].join('\n'),
    );
    await replaceZipEntry(source, 'OEBPS/images/bookmanager-cover.webp', Buffer.from('webp cover'));
    await replaceZipEntry(source, 'OEBPS/images/bookmanager-cover.jpg', Buffer.from('jpg cover'));
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
    assert.equal(metadataWriteSupport('book.pdf').supported, true);
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

test('메타데이터 분석은 DB의 전역 후보와 설정 언어 기본값을 반환한다', async () => {
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
                async getDistinctSeriesGroups() {
                    return [
                        { series_group: '판타지 세계관', count: 4 },
                        { series_group: '현대물', count: 2 },
                        { series_group: '판타지 세계관', count: 1 },
                    ];
                },
                async getFileInfo() {
                    return null;
                },
            },
        });

        assert.deepEqual(analyzed.publisherOptions, ['민음사', '황금가지']);
        assert.deepEqual(analyzed.seriesGroupOptions, ['판타지 세계관', '현대물']);
        assert.equal(analyzed.items[0].metadata.LanguageISO, 'ja');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('A 파일에 저장한 시리즈 그룹은 B 파일 분석에서도 전역 후보로 반환한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-series-groups-'));
    try {
        const dbPath = path.join(root, 'library.db');
        const first = path.join(root, 'A 라이브러리', 'A 책.txt');
        const second = path.join(root, 'B 라이브러리', 'B 책.txt');
        fs.mkdirSync(path.dirname(first), { recursive: true });
        fs.mkdirSync(path.dirname(second), { recursive: true });
        fs.writeFileSync(first, 'first');
        fs.writeFileSync(second, 'second');

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: first,
            name: path.basename(first),
            metadata: {
                Title: 'A 책',
                SeriesGroup: '공유 세계관',
            },
        }], {
            dbPath,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const analyzed = await analyzeMetadataInputs([second], { dbPath });
        assert.deepEqual(analyzed.seriesGroupOptions, ['공유 세계관']);
        assert.equal(analyzed.items[0].filepath, second);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('최신권 메타데이터는 라이브러리 DB의 다른 폴더에서 같은 기본 제목의 가장 높은 숫자 권을 읽는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-latest-series-'));
    let library = null;
    try {
        const dbPath = path.join(root, 'library.db');
        const baseTitle = '별의 100%_여행';
        const currentSeries = '현재 권 시리즈';
        const decimalSeries = '소수 권 시리즈';
        const latestSeries = '최신 권 시리즈';
        const currentPath = path.join(root, '편집 중', `${baseTitle} 11권.cbz`);
        const decimalPath = path.join(root, '기존 권', `${baseTitle} 9.5권.cbz`);
        const latestPath = path.join(root, '다른 라이브러리 폴더', `${baseTitle} 10권.cbz`);
        const lowerChapterPath = path.join(root, '낮은 화수', `${baseTitle} 10권 99화.cbz`);
        const similarPath = path.join(root, '유사 제목', `${baseTitle} 외전 99권.cbz`);

        const createArchive = async (filePath, metadata) => {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, Buffer.alloc(0));
            await replaceZipEntry(filePath, 'ComicInfo.xml', createComicInfoXml(metadata));
        };

        await createArchive(currentPath, {
            Series: currentSeries,
            SeriesGroup: '현재 권 세계관',
            Title: `${baseTitle} 11권`,
            Volume: '11',
            Publisher: '현재 파일 출판사',
        });
        await createArchive(decimalPath, {
            Series: decimalSeries,
            SeriesGroup: '소수 권 세계관',
            Title: `${baseTitle} 9.5권`,
            Volume: '9.5',
            Publisher: '소수 권 출판사',
        });
        await createArchive(latestPath, {
            Series: latestSeries,
            SeriesGroup: '최신 권 세계관',
            Title: `${baseTitle} 10권`,
            Volume: '10',
            Number: '100',
            PageCount: '240',
            Writer: '최신권 글 작가',
            Penciller: '최신권 그림 작가',
            Inker: '최신권 잉커',
            Colorist: '최신권 컬러리스트',
            Letterer: '최신권 레터러',
            CoverArtist: '최신권 표지 작가',
            Editor: '최신권 편집자',
            Publisher: '실제 최신권 출판사',
        });
        await createArchive(lowerChapterPath, {
            Series: '낮은 화수 시리즈',
            SeriesGroup: '낮은 화수 세계관',
            Title: `${baseTitle} 10권`,
            Volume: '10',
            Number: '99',
            Publisher: '낮은 화수 출판사',
        });
        await createArchive(similarPath, {
            Series: latestSeries,
            SeriesGroup: '최신 권 세계관',
            Title: `${baseTitle} 외전 99권`,
            Volume: '99',
            Publisher: '유사 제목 출판사',
        });

        library = new LibraryDB({ dbPath });
        await library.upsertFileInfoBulk([
            {
                path: currentPath,
                series: currentSeries,
                series_group: '현재 권 세계관',
                title: `${baseTitle} 11권`,
                volume: '11',
                publisher: 'DB 현재 파일 출판사',
                mtime: 400,
                book_type: 'comic',
            },
            {
                path: decimalPath,
                series: decimalSeries,
                series_group: '소수 권 세계관',
                title: `${baseTitle} 9.5권`,
                volume: '9.5',
                publisher: 'DB 소수 권 출판사',
                mtime: 300,
                book_type: 'comic',
            },
            {
                path: latestPath,
                series: latestSeries,
                series_group: '최신 권 세계관',
                title: `${baseTitle} 10권`,
                volume: '10',
                number: '100',
                publisher: 'DB 캐시 출판사',
                mtime: 100,
                book_type: 'comic',
            },
            {
                path: lowerChapterPath,
                series: '낮은 화수 시리즈',
                series_group: '낮은 화수 세계관',
                title: `${baseTitle} 10권`,
                volume: '10',
                number: '99',
                publisher: 'DB 낮은 화수 출판사',
                mtime: 700,
                book_type: 'comic',
            },
            {
                path: similarPath,
                series: latestSeries,
                series_group: '최신 권 세계관',
                title: `${baseTitle} 외전 99권`,
                volume: '99',
                publisher: 'DB 유사 제목 출판사',
                mtime: 500,
                book_type: 'comic',
            },
        ]);
        await library.close();
        library = null;

        const latest = await loadLatestSeriesMetadata({
            title: `${baseTitle} 11권`,
            bookType: 'comic',
            currentPath,
        }, { dbPath });

        assert.ok(latest);
        assert.equal(latest.sourcePath, latestPath);
        assert.equal(latest.sourceName, path.basename(latestPath));
        assert.equal(latest.metadata.Series, latestSeries);
        assert.equal(latest.metadata.SeriesGroup, '최신 권 세계관');
        assert.equal(latest.metadata.Volume, '10');
        assert.equal(latest.metadata.Publisher, '실제 최신권 출판사');
        assert.equal(latest.metadata.Writer, '최신권 글 작가');
        assert.equal(latest.metadata.Penciller, '최신권 그림 작가');
        assert.equal(latest.metadata.Inker, '최신권 잉커');
        assert.equal(latest.metadata.Colorist, '최신권 컬러리스트');
        assert.equal(latest.metadata.Letterer, '최신권 레터러');
        assert.equal(latest.metadata.CoverArtist, '최신권 표지 작가');
        assert.equal(latest.metadata.Editor, '최신권 편집자');
    } finally {
        await library?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('최신권 메타데이터는 누락 파일과 ComicInfo가 없는 상위 후보를 건너뛴다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-latest-fallback-'));
    let library = null;
    try {
        const dbPath = path.join(root, 'library.db');
        const baseTitle = '달의 기록';
        const missingPath = path.join(root, '누락 후보', `${baseTitle} 12권.cbz`);
        const noMetadataPath = path.join(root, '메타데이터 없음', `${baseTitle} 11권.cbz`);
        const validPath = path.join(root, '유효 후보', `${baseTitle} 10권.cbz`);

        fs.mkdirSync(path.dirname(noMetadataPath), { recursive: true });
        fs.writeFileSync(noMetadataPath, Buffer.alloc(0));
        await replaceZipEntry(noMetadataPath, '001.jpg', Buffer.from('cover without metadata'));

        fs.mkdirSync(path.dirname(validPath), { recursive: true });
        fs.writeFileSync(validPath, Buffer.alloc(0));
        await replaceZipEntry(validPath, 'ComicInfo.xml', createComicInfoXml({
            Series: '유효 후보 시리즈',
            SeriesGroup: '유효 후보 세계관',
            Title: `${baseTitle} 10권`,
            Volume: '10',
            Publisher: '유효 후보 출판사',
        }));

        library = new LibraryDB({ dbPath });
        await library.upsertFileInfoBulk([
            {
                path: missingPath,
                series: '누락 후보 시리즈',
                series_group: '누락 후보 세계관',
                title: `${baseTitle} 12권`,
                volume: '12',
                mtime: 300,
                book_type: 'comic',
            },
            {
                path: noMetadataPath,
                series: '메타데이터 없는 후보 시리즈',
                series_group: '메타데이터 없는 후보 세계관',
                title: `${baseTitle} 11권`,
                volume: '11',
                mtime: 200,
                book_type: 'comic',
            },
            {
                path: validPath,
                series: '유효 후보 시리즈',
                series_group: '유효 후보 세계관',
                title: `${baseTitle} 10권`,
                volume: '10',
                mtime: 100,
                book_type: 'comic',
            },
        ]);
        await library.close();
        library = null;

        const latest = await loadLatestSeriesMetadata({
            title: `${baseTitle} 1권`,
            bookType: 'comic',
        }, { dbPath });

        assert.ok(latest);
        assert.equal(latest.sourcePath, validPath);
        assert.equal(latest.sourceName, path.basename(validPath));
        assert.equal(latest.metadata.Volume, '10');
        assert.equal(latest.metadata.Publisher, '유효 후보 출판사');
    } finally {
        await library?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('최신권 메타데이터에는 DB 캐시와 파일명 추론값이 섞이지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-latest-embedded-only-'));
    let library = null;
    try {
        const dbPath = path.join(root, 'library.db');
        const baseTitle = '실제 정보만';
        const sourcePath = path.join(root, `${baseTitle} 10권.cbz`);
        fs.writeFileSync(sourcePath, Buffer.alloc(0));
        await replaceZipEntry(sourcePath, 'ComicInfo.xml', createComicInfoXml({
            Publisher: '파일 내부 출판사',
        }));

        library = new LibraryDB({ dbPath });
        await library.upsertFileInfo({
            path: sourcePath,
            series: 'DB 분류용 시리즈',
            series_group: 'DB 분류용 세계관',
            title: `${baseTitle} 10권`,
            volume: '10',
            publisher: 'DB 캐시 출판사',
            format: 'DB 캐시 형식',
            mtime: 100,
            book_type: 'comic',
        });
        await library.close();
        library = null;

        const latest = await loadLatestSeriesMetadata({
            title: `${baseTitle} 1권`,
            bookType: 'comic',
        }, { dbPath });

        assert.ok(latest);
        assert.equal(latest.metadata.Publisher, '파일 내부 출판사');
        assert.equal(latest.metadata.Series, undefined);
        assert.equal(latest.metadata.Title, undefined);
        assert.equal(latest.metadata.Volume, undefined);
        assert.equal(latest.metadata.Format, undefined);
        assert.equal(latest.metadata.Manga, undefined);
        assert.equal(latest.metadata.LanguageISO, undefined);
    } finally {
        await library?.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('최신권 메타데이터는 NFC 제목으로 macOS NFD 저장 후보를 조회한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-latest-nfd-'));
    let library = null;
    try {
        const dbPath = path.join(root, 'library.db');
        const baseTitle = '용사의 기록';
        const storedTitle = `${baseTitle} 10권`.normalize('NFD');
        const sourcePath = path.join(root, `${storedTitle}.cbz`);
        assert.notEqual(storedTitle, storedTitle.normalize('NFC'));

        fs.writeFileSync(sourcePath, Buffer.alloc(0));
        await replaceZipEntry(sourcePath, 'ComicInfo.xml', createComicInfoXml({
            Title: storedTitle,
            Volume: '10',
            Publisher: 'NFD 후보 출판사',
        }));

        library = new LibraryDB({ dbPath });
        await library.upsertFileInfo({
            path: sourcePath,
            title: storedTitle,
            volume: '10',
            mtime: 100,
            book_type: 'comic',
        });
        await library.close();
        library = null;

        const latest = await loadLatestSeriesMetadata({
            title: `${baseTitle} 1권`,
            bookType: 'comic',
        }, { dbPath });

        assert.ok(latest);
        assert.equal(latest.sourcePath.normalize('NFC'), sourcePath.normalize('NFC'));
        assert.equal(latest.metadata.Title.normalize('NFC'), `${baseTitle} 10권`);
        assert.equal(latest.metadata.Publisher, 'NFD 후보 출판사');
    } finally {
        await library?.close();
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

test('EPUB 표지는 내부 이미지 선택으로 OPF cover 참조를 교체한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-entry-'));
    try {
        const source = path.join(root, '표지 선택 EPUB.epub');
        await createEpubCoverFixture(source);

        const images = await listMetadataEpubImages(source);
        assert.equal(images.images.length, 2);
        assert.equal(images.coverEntryName, 'OEBPS/images/cover.jpg');
        assert.equal(images.images.find(image => image.name === 'OEBPS/images/cover.jpg')?.isCover, true);
        assert.match(await loadMetadataEpubImage(source, 'OEBPS/images/alt.png'), /^data:image\/png;base64,/);

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '표지 변경 제목' },
            epubCoverChange: {
                type: 'entry',
                entryName: 'OEBPS/images/alt.png',
            },
        }], {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const opfEntry = entries.find(entry => entry.name === 'OEBPS/content.opf');
        const coverPageEntry = entries.find(entry => entry.name === 'OEBPS/bookmanager-cover.xhtml');
        assert.ok(coverPageEntry);
        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        const coverPageXml = readZipEntry(buffer, coverPageEntry).toString('utf8');
        const coverItem = opfXml.match(/<item\b[^>]*id="cover-id"[^>]*>/)?.[0] || '';
        const altItem = opfXml.match(/<item\b[^>]*id="alt-id"[^>]*>/)?.[0] || '';
        assert.match(coverPageXml, /<img src="images\/alt.png" alt="Cover" \/>/);
        assert.match(opfXml, /<meta name="cover" content="alt-id" \/>/);
        assert.doesNotMatch(coverItem, /cover-image/);
        assert.match(altItem, /properties="cover-image"/);
        assert.match(altItem, /media-type="image\/png"/);
        assert.match(opfXml, /<item id="bookmanager-cover-page" href="bookmanager-cover.xhtml" media-type="application\/xhtml\+xml" \/>/);
        assert.match(opfXml, /<spine>\s*<itemref idref="bookmanager-cover-page" linear="yes" \/>/);
        assert.match(opfXml, /<guide>\s*<reference type="cover" title="Cover" href="bookmanager-cover.xhtml" \/>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 표지는 로컬 이미지 파일을 EPUB 내부에 추가해 저장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-file-'));
    try {
        const source = path.join(root, '로컬 표지 EPUB.epub');
        const coverFile = path.join(root, 'new-cover.png');
        await createEpubCoverFixture(source);
        fs.writeFileSync(coverFile, Buffer.from('new cover'));

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '로컬 표지 제목' },
            epubCoverChange: {
                type: 'file',
                filePath: coverFile,
            },
        }], {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const coverEntry = entries.find(entry => entry.name === 'OEBPS/images/cover.png');
        const coverPageEntry = entries.find(entry => entry.name === 'OEBPS/bookmanager-cover.xhtml');
        const opfEntry = entries.find(entry => entry.name === 'OEBPS/content.opf');
        assert.ok(coverEntry);
        assert.ok(coverPageEntry);
        assert.deepEqual(readZipEntry(buffer, coverEntry), Buffer.from('new cover'));

        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        const coverPageXml = readZipEntry(buffer, coverPageEntry).toString('utf8');
        const coverItem = opfXml.match(/<item\b[^>]*id="cover-id"[^>]*>/)?.[0] || '';
        const newItem = opfXml.match(/<item\b[^>]*id="cover-image"[^>]*>/)?.[0] || '';
        assert.match(coverPageXml, /<img src="images\/cover.png" alt="Cover" \/>/);
        assert.match(opfXml, /<meta name="cover" content="cover-image" \/>/);
        assert.doesNotMatch(coverItem, /cover-image/);
        assert.match(newItem, /href="images\/cover.png"/);
        assert.match(newItem, /media-type="image\/png"/);
        assert.match(newItem, /properties="cover-image"/);
        assert.match(opfXml, /<item id="bookmanager-cover-page" href="bookmanager-cover.xhtml" media-type="application\/xhtml\+xml" \/>/);
        assert.match(opfXml, /<spine>\s*<itemref idref="bookmanager-cover-page" linear="yes" \/>/);
        assert.match(opfXml, /<guide>\s*<reference type="cover" title="Cover" href="bookmanager-cover.xhtml" \/>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 저장은 표지 변경 시에만 라이브러리 썸네일 경로를 비운다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-cache-'));
    try {
        const source = path.join(root, '표지 캐시 EPUB.epub');
        await createEpubCoverFixture(source);

        let databaseRow = {
            path: source,
            thumb_path: path.join(root, '기존-표지.jpg'),
        };
        const persistedThumbnailPaths = [];
        const libraryDb = {
            async getFileInfo() {
                return databaseRow;
            },
            async upsertFileInfo(record) {
                databaseRow = record;
                persistedThumbnailPaths.push(record.thumb_path);
            },
        };
        const refreshedThumbnailPath = path.join(root, '새-표지.png');

        const coverSaved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '표지 변경 제목', Format: 'Novel' },
            epubCoverChange: {
                type: 'entry',
                entryName: 'OEBPS/images/alt.png',
            },
        }], {
            backup_on: false,
            libraryDb,
            async refreshFilePreview(filePath) {
                assert.equal(filePath, source);
                assert.equal(databaseRow.thumb_path, '');
                databaseRow = { ...databaseRow, thumb_path: refreshedThumbnailPath };
            },
            shouldCancel: () => false,
        });

        assert.equal(coverSaved.stats.success.length, 1, coverSaved.stats.error.join('\n'));
        assert.equal(persistedThumbnailPaths[0], '');
        assert.equal(databaseRow.thumb_path, refreshedThumbnailPath);

        const metadataSaved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '메타데이터만 변경', Format: 'Novel' },
        }], {
            backup_on: false,
            libraryDb,
            shouldCancel: () => false,
        });

        assert.equal(metadataSaved.stats.success.length, 1, metadataSaved.stats.error.join('\n'));
        assert.equal(databaseRow.thumb_path, refreshedThumbnailPath);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 저장은 선택한 내부 표지가 사라지면 기존 표지를 유지하고 실패를 알린다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-missing-'));
    try {
        const source = path.join(root, '사라진 표지 EPUB.epub');
        await createEpubCoverFixture(source);
        const original = fs.readFileSync(source);

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '저장되지 않아야 할 제목' },
            epubCoverChange: {
                type: 'entry',
                entryName: 'OEBPS/images/missing.png',
            },
        }], {
            backup_on: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(saved.stats.success.length, 0);
        assert.equal(saved.stats.error.length, 1);
        assert.match(saved.stats.error[0], /선택한 EPUB 표지 이미지를 찾을 수 없습니다/);
        assert.deepEqual(fs.readFileSync(source), original);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 표지는 저장 직전에 외부 뷰어 호환 이미지로 정규화할 수 있다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-normalize-'));
    try {
        const source = path.join(root, '정규화 표지 EPUB.epub');
        const coverFile = path.join(root, 'new-cover.webp');
        await createEpubCoverFixture(source);
        fs.writeFileSync(coverFile, Buffer.from('webp cover'));

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '정규화 표지 제목' },
            epubCoverChange: {
                type: 'file',
                filePath: coverFile,
            },
        }], {
            backup_on: false,
            shouldCancel: () => false,
            async normalizeEpubCoverImage(buffer, sourcePath, mediaType) {
                assert.equal(buffer.toString('utf8'), 'webp cover');
                assert.equal(path.basename(sourcePath), 'new-cover.webp');
                assert.equal(mediaType, 'image/webp');
                return {
                    buffer: Buffer.from('png cover'),
                    mediaType: 'image/png',
                    extension: '.png',
                };
            },
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const coverEntry = entries.find(entry => entry.name === 'OEBPS/images/cover.png');
        const opfEntry = entries.find(entry => entry.name === 'OEBPS/content.opf');
        assert.ok(coverEntry);
        assert.deepEqual(readZipEntry(buffer, coverEntry), Buffer.from('png cover'));

        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        const newItem = opfXml.match(/<item\b[^>]*id="cover-image"[^>]*>/)?.[0] || '';
        assert.match(newItem, /href="images\/cover.png"/);
        assert.match(newItem, /media-type="image\/png"/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 저장은 기존 WebP 표지의 JPEG 대체 파일을 외부 뷰어 표지로 지정한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-alternate-'));
    try {
        const source = path.join(root, 'WebP 표지 EPUB.epub');
        await createEpubWebpCoverWithJpegAlternateFixture(source);

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '대체 표지 제목' },
        }], {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const opfEntry = entries.find(entry => entry.name === 'OEBPS/content.opf');
        const coverPageEntry = entries.find(entry => entry.name === 'OEBPS/bookmanager-cover.xhtml');
        assert.ok(opfEntry);
        assert.ok(coverPageEntry);
        assert.equal(entries.some(entry => entry.name === 'OEBPS/images/cover.png'), false);

        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        const coverPageXml = readZipEntry(buffer, coverPageEntry).toString('utf8');
        const webpItem = opfXml.match(/<item\b[^>]*id="bookmanager-cover"[^>]*>/)?.[0] || '';
        const jpegItem = opfXml.match(/<item\b[^>]*id="bookmanager-cover-2"[^>]*>/)?.[0] || '';
        assert.match(opfXml, /<meta name="cover" content="bookmanager-cover-2" \/>/);
        assert.doesNotMatch(webpItem, /cover-image/);
        assert.match(jpegItem, /properties="cover-image"/);
        assert.match(jpegItem, /media-type="image\/jpeg"/);
        assert.match(coverPageXml, /<img src="images\/bookmanager-cover\.jpg" alt="Cover" \/>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 저장은 기존 WebP 표지를 정규화할 수 있으면 JPEG 대체 파일보다 정규화 이미지를 우선한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-epub-cover-existing-normalize-'));
    try {
        const source = path.join(root, '기존 WebP 표지 EPUB.epub');
        await createEpubWebpCoverWithJpegAlternateFixture(source);

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: source,
            name: path.basename(source),
            metadata: { Title: '정규화 우선 제목' },
        }], {
            backup_on: false,
            shouldCancel: () => false,
            async normalizeEpubCoverImage(buffer, sourcePath, mediaType) {
                assert.equal(buffer.toString('utf8'), 'webp cover');
                assert.equal(sourcePath, 'OEBPS/images/bookmanager-cover.webp');
                assert.equal(mediaType, 'image/webp');
                return {
                    buffer: Buffer.from('normalized png cover'),
                    mediaType: 'image/png',
                    extension: '.png',
                };
            },
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const entries = listZipEntries(buffer);
        const normalizedCoverEntry = entries.find(entry => entry.name === 'OEBPS/images/cover.png');
        const opfEntry = entries.find(entry => entry.name === 'OEBPS/content.opf');
        const coverPageEntry = entries.find(entry => entry.name === 'OEBPS/bookmanager-cover.xhtml');
        assert.ok(normalizedCoverEntry);
        assert.deepEqual(readZipEntry(buffer, normalizedCoverEntry), Buffer.from('normalized png cover'));

        const opfXml = readZipEntry(buffer, opfEntry).toString('utf8');
        const coverPageXml = readZipEntry(buffer, coverPageEntry).toString('utf8');
        const jpegItem = opfXml.match(/<item\b[^>]*id="bookmanager-cover-2"[^>]*>/)?.[0] || '';
        const normalizedItem = opfXml.match(/<item\b[^>]*id="cover-image"[^>]*>/)?.[0] || '';
        assert.match(opfXml, /<meta name="cover" content="cover-image" \/>/);
        assert.doesNotMatch(jpegItem, /cover-image/);
        assert.match(normalizedItem, /href="images\/cover.png"/);
        assert.match(normalizedItem, /media-type="image\/png"/);
        assert.match(normalizedItem, /properties="cover-image"/);
        assert.match(coverPageXml, /<img src="images\/cover.png" alt="Cover" \/>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 메타데이터와 표지는 분석하고 파일 내부에 저장한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-pdf-'));
    try {
        const source = path.join(root, '문서 PDF.pdf');
        fs.writeFileSync(source, createPdfFixture());

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].bookType, 'pdf');
        assert.equal(analyzed.items[0].metadata.Title, 'Old PDF');
        assert.equal(analyzed.items[0].metadata.Writer, 'Old Author');
        assert.equal(analyzed.items[0].metadata.Summary, 'Old Subject');
        assert.equal(analyzed.items[0].metadata.Genre, 'old');
        assert.equal(analyzed.items[0].metadata.Tags, 'tag');
        assert.equal(analyzed.items[0].metadata.Creator, 'Old Creator');
        assert.equal(analyzed.items[0].metadata.Producer, 'Old Producer');
        assert.equal(analyzed.items[0].metadata.Trapped, 'False');
        assert.match(analyzed.items[0].coverDataUrl, /^data:image\/jpeg;base64,/);

        analyzed.items[0].metadata = {
            ...analyzed.items[0].metadata,
            Title: '새 PDF 제목',
            Writer: '새 저자',
            Summary: '새 설명',
            Genre: '문서',
            Tags: '테스트, PDF',
            Publisher: '새 출판사',
            ISBN: '9791111111111',
            LanguageISO: 'ko',
            CommunityRating: '4.0',
            Rights: '개인 이용',
            Creator: 'BookManager Test',
            Producer: 'BookManager PDF Writer',
            Trapped: 'Unknown',
            Year: '2026',
            Month: '6',
            Day: '29',
        };
        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const reanalyzed = await analyzeMetadataInputs([source], {});
        const metadata = reanalyzed.items[0].metadata;
        assert.equal(metadata.Title, '새 PDF 제목');
        assert.equal(metadata.Writer, '새 저자');
        assert.equal(metadata.Summary, '새 설명');
        assert.equal(metadata.Genre, '문서');
        assert.equal(metadata.Tags, '테스트, PDF');
        assert.equal(metadata.Publisher, '새 출판사');
        assert.equal(metadata.ISBN, '9791111111111');
        assert.equal(metadata.LanguageISO, 'ko');
        assert.equal(metadata.CommunityRating, '4.0');
        assert.equal(metadata.Rights, '개인 이용');
        assert.equal(metadata.Creator, 'BookManager Test');
        assert.equal(metadata.Producer, 'BookManager PDF Writer');
        assert.equal(metadata.Trapped, 'Unknown');
        assert.equal(metadata.Year, '2026');
        assert.equal(metadata.Month, '06');
        assert.equal(metadata.Day, '29');
        assert.match(await loadMetadataCover(source, {}), /^data:image\/jpeg;base64,/);
        assert.match(fs.readFileSync(source, 'latin1'), /\/Type \/Metadata \/Subtype \/XML/);
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

test('CBZ 메타데이터 저장은 변경이 없으면 압축파일을 다시 쓰지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-noop-'));
    try {
        const source = path.join(root, '작품명 03권.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        analyzed.items[0].metadata.Series = '작품명';
        analyzed.items[0].metadata.Title = '작품명 03권';
        const firstSave = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(firstSave.stats.success.length, 1, firstSave.stats.error.join('\n'));

        const reanalyzed = await analyzeMetadataInputs([source], {});
        const before = fs.readFileSync(source);
        const secondSave = await saveMetadataItems(reanalyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });

        assert.equal(secondSave.stats.success.length, 1, secondSave.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(source), before);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CBZ 메타데이터 저장은 라이브러리 캐시를 갱신한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-cache-'));
    try {
        const source = path.join(root, '시리즈캐시.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));
        await replaceZipEntry(source, 'ComicInfo.xml', createComicInfoXml({
            Series: '기존 작품',
            Title: '기존 제목',
        }));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        analyzed.items[0].metadata.Series = '변경된 작품';
        analyzed.items[0].metadata.Title = '변경된 제목';
        analyzed.items[0].metadata.SeriesGroup = '테스트 그룹';

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
        assert.equal(persistedRecords.length, 1);
        assert.equal(persistedRecords[0].series_group, '테스트 그룹');
        assert.equal(persistedRecords[0].series, '변경된 작품');
        assert.equal(persistedRecords[0].title, '변경된 제목');
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
