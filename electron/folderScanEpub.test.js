import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { scanFolder } from './tasks/folderScanTask.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

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
