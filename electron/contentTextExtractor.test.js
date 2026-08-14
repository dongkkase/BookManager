import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    extractContentTokens,
    tokenizeContentQuery,
} from './contentTextExtractor.js';
import { replaceZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';

function pdfObject(number, body) {
    const content = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'latin1');
    return {
        number,
        buffer: Buffer.concat([
            Buffer.from(`${number} 0 obj\n`, 'latin1'),
            content,
            Buffer.from('\nendobj\n', 'latin1'),
        ]),
    };
}

function pdfStreamObject(number, data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
    return pdfObject(number, Buffer.concat([
        Buffer.from(`<< /Length ${buffer.length} >>\nstream\n`, 'latin1'),
        buffer,
        Buffer.from('\nendstream', 'latin1'),
    ]));
}

function buildPdf(objects) {
    const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
    const offsets = new Map();
    for (const object of objects.sort((left, right) => left.number - right.number)) {
        offsets.set(object.number, chunks.reduce((total, chunk) => total + chunk.length, 0));
        chunks.push(object.buffer);
    }
    const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const size = Math.max(...objects.map(object => object.number)) + 1;
    const xref = ['xref', `0 ${size}`, '0000000000 65535 f '];
    for (let number = 1; number < size; number += 1) {
        const offset = offsets.get(number);
        xref.push(offset === undefined
            ? '0000000000 65535 f '
            : `${String(offset).padStart(10, '0')} 00000 n `);
    }
    chunks.push(Buffer.from([
        xref.join('\n'),
        'trailer',
        `<< /Size ${size} /Root 1 0 R >>`,
        'startxref',
        String(xrefOffset),
        '%%EOF',
        '',
    ].join('\n'), 'latin1'));
    return Buffer.concat(chunks);
}

function createTextPdf(pageCount = 1) {
    const pageObjects = [];
    const pageRefs = [];
    for (let index = 0; index < pageCount; index += 1) {
        const pageNumber = 4 + (index * 2);
        const streamNumber = pageNumber + 1;
        pageRefs.push(`${pageNumber} 0 R`);
        pageObjects.push(
            pdfObject(pageNumber, `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 300 400] /Contents ${streamNumber} 0 R >>`),
            pdfStreamObject(streamNumber, `BT /F1 12 Tf 40 320 Td (Hello PDF page ${index + 1} hello) Tj ET`),
        );
    }
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageCount} >>`),
        pdfObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
        ...pageObjects,
    ]);
}

function createImageOnlyPdf() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R >>'),
        pdfStreamObject(4, ''),
    ]);
}

async function createTextEpub(filePath, options = {}) {
    fs.writeFileSync(filePath, Buffer.alloc(0));
    await replaceZipEntry(
        filePath,
        'META-INF/container.xml',
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>',
    );
    await replaceZipEntry(
        filePath,
        'OEBPS/content.opf',
        `<package>
            <manifest>
                <item id="second" href="second.xhtml" media-type="application/xhtml+xml" />
                <item id="first" href="first.xhtml" media-type="application/xhtml+xml" />
                <item id="style" href="book.css" media-type="text/css" />
                <item id="image" href="image.png" media-type="image/png" />
                <item id="font" href="book.woff2" media-type="font/woff2" />
            </manifest>
            <spine>
                <itemref idref="second" />
                <itemref idref="style" />
                <itemref idref="image" />
                <itemref idref="font" />
                <itemref idref="first" />
            </spine>
        </package>`,
    );
    await replaceZipEntry(
        filePath,
        'OEBPS/second.xhtml',
        '<html><head><style>.hidden { display: none; }</style></head><body><p>SecondToken repeated &ldquo;Quote&rdquo;</p><script>ScriptSecret</script></body></html>',
    );
    await replaceZipEntry(
        filePath,
        'OEBPS/first.xhtml',
        '<html><body><p>FirstToken repeated</p><img src="image.png" alt="ImageSecret" /></body></html>',
    );
    await replaceZipEntry(filePath, 'OEBPS/book.css', '.body::after { content: "CssSecret"; }');
    await replaceZipEntry(filePath, 'OEBPS/image.png', Buffer.from('not-a-real-image'));
    await replaceZipEntry(filePath, 'OEBPS/book.woff2', Buffer.from('FontSecret'));
    if (options.encrypted) {
        await replaceZipEntry(
            filePath,
            'META-INF/encryption.xml',
            `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
                    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc" />
                    <CipherData><CipherReference URI="../OEBPS/second.xhtml" /></CipherData>
                </EncryptedData>
            </encryption>`,
        );
    }
}

test('content query tokenizer normalizes case and compatibility characters and removes duplicates', () => {
    assert.deepEqual(tokenizeContentQuery('ＦＯＯ foo Foo 본문 본문 日本語 日本語'), [
        'foo',
        '본문',
        '日本語',
    ]);
});

test('TXT content extraction returns normalized unique tokens and enforces the token limit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-txt-'));
    try {
        const source = path.join(root, 'sample.txt');
        const text = 'ＦＯＯ foo Foo\n본문 본문\n日本語 日本語';
        fs.writeFileSync(source, text, 'utf8');

        const result = await extractContentTokens(source, {
            signal: { get aborted() { return false; } },
        });
        assert.equal(result.status, 'ok');
        assert.deepEqual(result.tokens, ['foo', '본문', '日本語']);
        assert.equal(result.tokenCount, 3);
        assert.equal(result.textBytes, Buffer.byteLength(text, 'utf8'));
        assert.deepEqual(result.warnings, []);

        const limited = await extractContentTokens(source, { maxUniqueTokens: 2 });
        assert.equal(limited.status, 'truncated');
        assert.deepEqual(limited.tokens, ['foo', '본문']);
        assert.equal(limited.tokenCount, 2);
        assert.match(limited.warnings.join('\n'), /limited to 2 unique values/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB text-only extraction follows the spine and skips images, CSS, fonts, and scripts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-epub-'));
    try {
        const source = path.join(root, 'sample.epub');
        await createTextEpub(source);

        const manager = new ViewerSessionManager();
        const session = manager.create(source);
        const textOnly = await manager.getEpubText(session.id, { textOnly: true });
        assert.deepEqual(textOnly.chapters.map(chapter => chapter.name), [
            'OEBPS/second.xhtml',
            'OEBPS/first.xhtml',
        ]);
        assert.equal(Object.hasOwn(textOnly, 'fonts'), false);
        assert.equal(Object.hasOwn(textOnly.chapters[0], 'blocks'), false);

        const result = await extractContentTokens(source);
        assert.equal(result.status, 'ok');
        assert.equal(result.tokens.indexOf('secondtoken') < result.tokens.indexOf('firsttoken'), true);
        assert.equal(result.tokens.filter(token => token === 'repeated').length, 1);
        assert.equal(result.tokens.includes('quote'), true);
        assert.equal(result.tokens.includes('scriptsecret'), false);
        assert.equal(result.tokens.includes('csssecret'), false);
        assert.equal(result.tokens.includes('imagesecret'), false);

        const limited = await extractContentTokens(source, { maxUniqueTokens: 2 });
        assert.equal(limited.status, 'truncated');
        assert.equal(limited.tokenCount, 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('EPUB encrypted spine content is skipped with an encrypted status', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-epub-encrypted-'));
    try {
        const source = path.join(root, 'encrypted.epub');
        await createTextEpub(source, { encrypted: true });

        const result = await extractContentTokens(source);
        assert.equal(result.status, 'encrypted');
        assert.deepEqual(result.tokens, []);
        assert.equal(result.tokenCount, 0);
        assert.match(result.warnings.join('\n'), /encrypted/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF content extraction reads selectable page text and reports image-only files for OCR', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-pdf-'));
    try {
        const textPdf = path.join(root, 'text.pdf');
        const imagePdf = path.join(root, 'image.pdf');
        fs.writeFileSync(textPdf, createTextPdf(2));
        fs.writeFileSync(imagePdf, createImageOnlyPdf());

        const extracted = await extractContentTokens(textPdf);
        assert.equal(extracted.status, 'ok');
        assert.deepEqual(extracted.tokens.slice(0, 3), ['hello', 'pdf', 'page']);
        assert.equal(extracted.tokens.filter(token => token === 'hello').length, 1);
        assert.equal(extracted.textBytes > 0, true);

        const ocr = await extractContentTokens(imagePdf);
        assert.equal(ocr.status, 'ocr_required');
        assert.deepEqual(ocr.tokens, []);
        assert.match(ocr.warnings.join('\n'), /no selectable text/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('content extraction returns cancelled for an aborted request', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-cancel-'));
    try {
        const source = path.join(root, 'sample.txt');
        fs.writeFileSync(source, 'cancelled content', 'utf8');
        const controller = new AbortController();
        controller.abort();

        const result = await extractContentTokens(source, { signal: controller.signal });
        assert.equal(result.status, 'cancelled');
        assert.deepEqual(result.tokens, []);
        assert.equal(result.tokenCount, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('content extraction discards tokens when the source file changes during processing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-content-text-changed-'));
    const originalSegment = Intl.Segmenter.prototype.segment;
    try {
        const source = path.join(root, 'changing.txt');
        fs.writeFileSync(source, '変更前の日本語コンテンツ', 'utf8');
        let changed = false;
        Intl.Segmenter.prototype.segment = function segmentWithSourceChange(...args) {
            if (!changed) {
                changed = true;
                fs.appendFileSync(source, '\n% changed during extraction', 'utf8');
            }
            return originalSegment.apply(this, args);
        };

        const result = await extractContentTokens(source);

        assert.equal(result.status, 'changed');
        assert.deepEqual(result.tokens, []);
        assert.equal(result.tokenCount, 0);
        assert.match(result.warnings.join('\n'), /changed during/i);
    } finally {
        Intl.Segmenter.prototype.segment = originalSegment;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
