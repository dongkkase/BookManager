import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { inspectFolderFile, scanFolder } from './tasks/folderScanTask.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

async function createEpubCoverFixture(filePath, title, cover) {
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await replaceZipEntry(
        filePath,
        'META-INF/container.xml',
        '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    );
    await replaceZipEntry(
        filePath,
        'OEBPS/content.opf',
        [
            '<package xmlns:dc="http://purl.org/dc/elements/1.1/">',
            `<metadata><dc:title>${title}</dc:title><meta name="cover" content="cover-image"/></metadata>`,
            '<manifest><item id="cover-image" properties="cover-image" href="images/cover.png" media-type="image/png"/></manifest>',
            '</package>',
        ].join(''),
    );
    await replaceZipEntry(filePath, 'OEBPS/images/cover.png', cover);
}

test('폴더 스캔은 EPUB OPF cover-image를 썸네일로 추출한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const epubPath = path.join(libraryDir, 'EPUB Cover.epub');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            [
                '<package xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="uid">',
                '<metadata>',
                '<dc:identifier id="uid">978-89-123-4567-9</dc:identifier>',
                '<dc:title>EPUB Title</dc:title>',
                '<dc:creator>EPUB Writer</dc:creator>',
                '<dc:publisher>EPUB Publisher</dc:publisher>',
                '<dc:language>ko</dc:language>',
                '<dc:date>2026-06-23</dc:date>',
                '<dc:subject>Fantasy</dc:subject>',
                '<dc:subject>Adventure</dc:subject>',
                '<dc:subject>Keyword</dc:subject>',
                '<dc:description>&lt;div&gt;&lt;p&gt;Book description&lt;/p&gt;&lt;/div&gt;</dc:description>',
                '<meta property="belongs-to-collection" id="series">EPUB Series</meta>',
                '<meta refines="#series" property="collection-type">series</meta>',
                '<meta refines="#series" property="group-position">2.0</meta>',
                '<meta property="schema:ratingValue">4.5</meta>',
                '</metadata>',
                '<manifest><item id="cover-image" properties="cover-image" href="images/cover.png" media-type="image/png"/></manifest>',
                '</package>',
            ].join(''),
        );
        await replaceZipEntry(epubPath, 'OEBPS/images/cover.png', PNG_1X1);

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].book_type, 'book');
        assert.equal(files[0].title, 'EPUB Title');
        assert.equal(files[0].series, 'EPUB Series');
        assert.equal(files[0].volume, '2');
        assert.equal(files[0].writer, 'EPUB Writer');
        assert.equal(files[0].publisher, 'EPUB Publisher');
        assert.equal(files[0].genre, 'Fantasy');
        assert.equal(files[0].tags, 'Adventure, Keyword');
        assert.equal(files[0].date, '2026-06-23');
        assert.equal(files[0].isbn, '978-89-123-4567-9');
        assert.equal(files[0].language, 'ko');
        assert.equal(files[0].rating, '4.5');
        assert.equal(files[0].format, 'Novel');
        assert.equal(files[0].description, 'Book description');
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.existsSync(files[0].thumb_path), true);
        assert.equal(path.dirname(files[0].thumb_path), thumbnailDir);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 표지 변경 저장은 이전 썸네일을 무효화하고 즉시 새 표지를 캐시한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-cover-refresh-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const epubPath = path.join(libraryDir, 'EPUB Cover Refresh.epub');
    const newCoverPath = path.join(root, 'new-cover.png');
    const originalCover = Buffer.from('original-cover');
    const newCover = Buffer.from('new-cover');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(epubPath, Buffer.alloc(0));
        await replaceZipEntry(
            epubPath,
            'META-INF/container.xml',
            '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        );
        await replaceZipEntry(
            epubPath,
            'OEBPS/content.opf',
            [
                '<package xmlns:dc="http://purl.org/dc/elements/1.1/">',
                '<metadata><dc:title>Original Title</dc:title><meta name="cover" content="cover-image"/></metadata>',
                '<manifest><item id="cover-image" properties="cover-image" href="images/cover.jpg" media-type="image/jpeg"/></manifest>',
                '<spine/>',
                '</package>',
            ].join(''),
        );
        await replaceZipEntry(epubPath, 'OEBPS/images/cover.jpg', originalCover);
        fs.writeFileSync(newCoverPath, newCover);

        const initial = (await scanFolder(libraryDir, { dbPath, thumbnailDir }))[0];
        assert.deepEqual(fs.readFileSync(initial.thumb_path), originalCover);

        const saved = await saveMetadataItems([{
            checked: true,
            filepath: epubPath,
            name: path.basename(epubPath),
            metadata: { Title: 'Updated Title', Format: 'Novel' },
            epubCoverChange: { type: 'file', filePath: newCoverPath },
        }], {
            backup_on: false,
            dbPath,
            shouldCancel: () => false,
            refreshFilePreview: filePath => inspectFolderFile(filePath, {
                dbPath,
                thumbnailDir,
                force: true,
            }),
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const library = new LibraryDB({ dbPath });
        const cached = await library.getFileInfo(epubPath);
        await library.close();
        assert.ok(cached.thumb_path);
        assert.deepEqual(fs.readFileSync(cached.thumb_path), newCover);

        const rescanned = (await scanFolder(libraryDir, { dbPath, thumbnailDir }))[0];
        assert.equal(rescanned.cache_source, 'library');
        assert.equal(rescanned.thumb_path, cached.thumb_path);
        assert.deepEqual(fs.readFileSync(rescanned.thumb_path), newCover);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 표지 추출 중 원본이 교체되면 최신 파일로 한 번 다시 스캔한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-cover-race-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const epubPath = path.join(libraryDir, 'EPUB Cover Race.epub');
    const replacementPath = path.join(root, 'replacement.epub');
    const originalCover = Buffer.from('original-cover-before-replacement');
    const replacementCover = Buffer.from('replacement-cover-after-file-change-with-different-size');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        await createEpubCoverFixture(epubPath, 'Original Race Title', originalCover);
        await createEpubCoverFixture(replacementPath, 'Replacement Race Title With Different Size', replacementCover);
        let encoderCalls = 0;

        const files = await scanFolder(libraryDir, {
            dbPath,
            thumbnailDir,
            force: true,
            thumbnailEncoder: async imageBuffer => {
                encoderCalls += 1;
                if (encoderCalls === 1) fs.copyFileSync(replacementPath, epubPath);
                return {
                    buffer: imageBuffer,
                    extension: '.png',
                };
            },
        });

        assert.equal(files.length, 1);
        assert.equal(encoderCalls, 2);
        assert.equal(files[0].title, 'Replacement Race Title With Different Size');
        assert.deepEqual(fs.readFileSync(files[0].thumb_path), replacementCover);
        assert.equal(fs.readdirSync(thumbnailDir).length, 1);

        const latestStats = fs.statSync(epubPath);
        const library = new LibraryDB({ dbPath });
        const cached = await library.getFileInfo(epubPath);
        await library.close();
        assert.equal(cached.size, latestStats.size);
        assert.equal(cached.mtime, latestStats.mtimeMs / 1000);
        assert.equal(cached.thumb_path, files[0].thumb_path);
        assert.deepEqual(fs.readFileSync(cached.thumb_path), replacementCover);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB 추출 재시도 중에도 원본이 바뀌면 오래된 썸네일과 DB 캐시를 남기지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-cover-repeat-race-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const dbPath = path.join(root, 'library.db');
    const epubPath = path.join(libraryDir, 'EPUB Repeated Cover Race.epub');
    const replacements = [
        path.join(root, 'replacement-1.epub'),
        path.join(root, 'replacement-2.epub'),
    ];

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        await createEpubCoverFixture(epubPath, 'Original Repeat Title', Buffer.from('original-repeat-cover'));
        await createEpubCoverFixture(replacements[0], 'Replacement One', Buffer.from('first-replacement-cover-with-size-change'));
        await createEpubCoverFixture(replacements[1], 'Replacement Two With Different Size', Buffer.from('second-replacement-cover-with-another-size-change'));
        let encoderCalls = 0;
        const originalWarn = console.warn;
        console.warn = () => {};
        let files;
        try {
            files = await scanFolder(libraryDir, {
                dbPath,
                thumbnailDir,
                force: true,
                thumbnailEncoder: async imageBuffer => {
                    const replacementPath = replacements[encoderCalls];
                    encoderCalls += 1;
                    if (replacementPath) fs.copyFileSync(replacementPath, epubPath);
                    return {
                        buffer: imageBuffer,
                        extension: '.png',
                    };
                },
            });
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(encoderCalls, 2);
        assert.equal(files.length, 1);
        assert.equal(files[0].cover, '');
        assert.equal(files[0].thumb_path, '');
        assert.deepEqual(fs.readdirSync(thumbnailDir), []);

        const library = new LibraryDB({ dbPath });
        const cached = await library.getFileInfo(epubPath);
        await library.close();
        assert.equal(cached, null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
