import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { scanFolder } from './tasks/folderScanTask.js';

function pdfObject(number, body, generation = 0) {
    return {
        number,
        buffer: Buffer.isBuffer(body)
            ? Buffer.concat([Buffer.from(`${number} ${generation} obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')])
            : Buffer.from(`${number} ${generation} obj\n${body}\nendobj\n`, 'latin1'),
    };
}

function pdfStreamObject(number, dict, data, generation = 0) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'latin1');
    return pdfObject(number, Buffer.concat([
        Buffer.from(`<< ${dict} /Length ${buffer.length} >>\nstream\n`, 'latin1'),
        buffer,
        Buffer.from('\nendstream', 'latin1'),
    ]), generation);
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
        pdfObject(6, '<< /Title (PDF Title) /Author (PDF Author) /Subject (PDF Subject) /Keywords (pdf, document) /Producer (PDF Producer) >>'),
    ], '/Root 1 0 R /Info 6 0 R');
}

function createMultiPagePdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources 6 0 R /MediaBox [0 0 240 320] /Contents 7 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 900 /Height 1400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'unused-first-page-resource'),
        pdfStreamObject(5, '/Type /XObject /Subtype /Image /Width 240 /Height 320 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'first-page-cover'),
        pdfObject(6, '<< /ProcSet [/PDF /ImageC] /XObject << /Unused 4 0 R /First 5 0 R >> >>'),
        pdfStreamObject(7, '', 'q 240 0 0 320 0 0 cm /First Do Q'),
        pdfObject(8, '<< /Type /Page /Parent 2 0 R /Resources 11 0 R /MediaBox [0 0 800 1200] /Contents 12 0 R >>'),
        pdfStreamObject(9, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfObject(10, '<< /Title (Multi Page PDF) /Author (PDF Author) >>'),
        pdfObject(11, '<< /ProcSet [/PDF /ImageC] /XObject << /Second 9 0 R >> >>'),
        pdfStreamObject(12, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
    ], '/Root 1 0 R /Info 10 0 R');
}

function createFormXObjectPdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 2 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources 6 0 R /MediaBox [0 0 300 420] /Contents 7 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 300 /Height 420 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'form-first-page-cover'),
        pdfStreamObject(5, '/Type /XObject /Subtype /Form /BBox [0 0 300 420] /Resources << /XObject << /Cover 4 0 R >> >> /Filter /FlateDecode', zlib.deflateSync(Buffer.from('q 300 0 0 420 0 0 cm /Cover Do Q', 'latin1'))),
        pdfObject(6, '<< /ProcSet [/PDF /ImageC] /XObject << /Fm1 5 0 R >> >>'),
        pdfStreamObject(7, '', 'q /Fm1 Do Q'),
        pdfObject(8, '<< /Title (Form XObject PDF) /Author (PDF Author) >>'),
        pdfObject(9, '<< /Type /Page /Parent 2 0 R /Resources 11 0 R /MediaBox [0 0 800 1200] /Contents 12 0 R >>'),
        pdfStreamObject(10, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfObject(11, '<< /ProcSet [/PDF /ImageC] /XObject << /Second 10 0 R >> >>'),
        pdfStreamObject(12, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
    ], '/Root 1 0 R /Info 8 0 R');
}

function asciiHexStreamData(value) {
    return `${Buffer.from(value, 'latin1').toString('hex')}>`;
}

function createFilteredImagePdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources 6 0 R /MediaBox [0 0 240 320] /Contents 7 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 240 /Height 320 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode]', asciiHexStreamData('filtered-first-page-cover')),
        pdfObject(6, '<< /ProcSet [/PDF /ImageC] /XObject << /Cover 4 0 R >> >>'),
        pdfStreamObject(7, '', 'q 240 0 0 320 0 0 cm /Cover Do Q'),
        pdfObject(8, '<< /Type /Page /Parent 2 0 R /Resources 10 0 R /MediaBox [0 0 800 1200] /Contents 11 0 R >>'),
        pdfStreamObject(9, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfObject(10, '<< /ProcSet [/PDF /ImageC] /XObject << /Second 9 0 R >> >>'),
        pdfStreamObject(11, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
        pdfObject(12, '<< /Title (Filtered Image PDF) /Author (PDF Author) >>'),
    ], '/Root 1 0 R /Info 12 0 R');
}

function pdfObjectStreamObject(number, entries) {
    let objectBodies = '';
    const offsets = [];
    for (const entry of entries) {
        offsets.push(`${entry.number} ${Buffer.byteLength(objectBodies, 'latin1')}`);
        objectBodies += `${entry.body}\n`;
    }
    const header = `${offsets.join(' ')}\n`;
    const first = Buffer.byteLength(header, 'latin1');
    const data = zlib.deflateSync(Buffer.from(`${header}${objectBodies}`, 'latin1'));
    return pdfStreamObject(number, `/Type /ObjStm /N ${entries.length} /First ${first} /Filter /FlateDecode`, data);
}

function createObjectStreamPageTreePdfFixture() {
    return buildPdf([
        pdfObjectStreamObject(20, [
            { number: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
            { number: 2, body: '<< /Type /Pages /Kids [3 1 R 8 0 R] /Count 2 >>' },
        ]),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 1 R >> >> /MediaBox [0 0 240 320] /Contents 5 0 R >>', 1),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 240 /Height 320 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'object-stream-first-page-cover', 1),
        pdfStreamObject(5, '', 'q 240 0 0 320 0 0 cm /Im0 Do Q'),
        pdfObject(8, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Second 9 0 R >> >> /MediaBox [0 0 800 1200] /Contents 10 0 R >>'),
        pdfStreamObject(9, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfStreamObject(10, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
        pdfObject(11, '<< /Title (Object Stream PDF) /Author (PDF Author) >>'),
    ], '/Root 1 0 R /Info 11 0 R');
}

function createJpxImagePdfFixture() {
    const jp2Data = Buffer.concat([
        Buffer.from('0000000c6a5020200d0a870a00000014667479706a703220', 'hex'),
        Buffer.from('jpx-first-page-cover', 'latin1'),
    ]);
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> /MediaBox [0 0 300 420] /Contents 5 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 300 /Height 420 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode', jp2Data),
        pdfStreamObject(5, '', 'q 300 0 0 420 0 0 cm /Im0 Do Q'),
        pdfObject(6, '<< /Title (JPX PDF) /Author (PDF Author) >>'),
    ], '/Root 1 0 R /Info 6 0 R');
}

function createInlineImagePdfFixture() {
    const inlineContent = [
        'q',
        'BI',
        '/W 240 /H 320 /CS /RGB /BPC 8 /F /DCT',
        'ID',
        'inline-first-page-cover',
        'EI',
        'Q',
    ].join('\n');
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /ProcSet [/PDF /ImageC] >> /MediaBox [0 0 240 320] /Contents 4 0 R >>'),
        pdfStreamObject(4, '', inlineContent),
        pdfObject(5, '<< /Title (Inline Image PDF) /Author (PDF Author) >>'),
        pdfObject(7, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Second 8 0 R >> >> /MediaBox [0 0 800 1200] /Contents 9 0 R >>'),
        pdfStreamObject(8, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfStreamObject(9, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
    ], '/Root 1 0 R /Info 5 0 R');
}

function createVectorFirstPagePdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /ProcSet [/PDF] >> /MediaBox [0 0 240 320] /Contents 4 0 R >>'),
        pdfStreamObject(4, '', 'q 0 0 240 320 re S Q'),
        pdfObject(5, '<< /Title (Vector First Page PDF) /Author (PDF Author) >>'),
        pdfObject(6, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Second 7 0 R >> >> /MediaBox [0 0 800 1200] /Contents 8 0 R >>'),
        pdfStreamObject(7, '/Type /XObject /Subtype /Image /Width 800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'second-page-larger-cover'),
        pdfStreamObject(8, '', 'q 800 0 0 1200 0 0 cm /Second Do Q'),
    ], '/Root 1 0 R /Info 5 0 R');
}

function createCroppedRotatedPdfFixture() {
    return buildPdf([
        pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        pdfObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        pdfObject(3, '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 4 0 R >> >> /MediaBox [0 0 100 200] /CropBox [10 20 90 120] /Rotate 90 /Contents 5 0 R >>'),
        pdfStreamObject(4, '/Type /XObject /Subtype /Image /Width 1000 /Height 2000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', 'cropped-rotated-first-page-cover'),
        pdfStreamObject(5, '', 'q 100 0 0 200 0 0 cm /Im0 Do Q'),
        pdfObject(6, '<< /Title (Cropped Rotated PDF) /Author (PDF Author) >>'),
    ], '/Root 1 0 R /Info 6 0 R');
}

test('폴더 스캔은 PDF 표지와 메타데이터를 추출한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'PDF Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createPdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].book_type, 'pdf');
        assert.equal(files[0].title, 'PDF Title');
        assert.equal(files[0].writer, 'PDF Author');
        assert.equal(files[0].description, 'PDF Subject');
        assert.equal(files[0].genre, 'pdf');
        assert.equal(files[0].tags, 'document');
        assert.equal(files[0].producer, 'PDF Producer');
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.existsSync(files[0].thumb_path), true);
        assert.equal(path.dirname(files[0].thumb_path), thumbnailDir);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 썸네일은 전체 이미지 중 가장 큰 이미지가 아니라 첫 번째 페이지 이미지로 만든다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-first-page-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'First Page Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createMultiPagePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지가 Form XObject로 이미지를 그려도 해당 이미지를 썸네일로 만든다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-form-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Form First Page Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createFormXObjectPdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'form-first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지 이미지가 필터 체인으로 감싸져도 해당 이미지를 썸네일로 만든다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-filtered-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Filtered First Page Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createFilteredImagePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'filtered-first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 페이지 트리가 ObjStm 안에 있어도 첫 번째 페이지 이미지를 썸네일로 만든다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-objstm-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Object Stream First Page Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createObjectStreamPageTreePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'object-stream-first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지 이미지가 JPXDecode여도 썸네일 인코더로 전달한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-jpx-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'JPX First Page Cover.pdf');
    let encodedSource = null;

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createJpxImagePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
            thumbnailEncoder: async (imageBuffer, options) => {
                encodedSource = {
                    imageName: options.imageName,
                    header: imageBuffer.subarray(0, 12).toString('hex'),
                };
                return {
                    buffer: Buffer.from('encoded-jpx-thumbnail', 'latin1'),
                    extension: '.png',
                };
            },
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(encodedSource.imageName, 'pdf-cover.jp2');
        assert.equal(encodedSource.header, '0000000c6a5020200d0a870a');
        assert.equal(path.extname(files[0].thumb_path), '.png');
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1'), 'encoded-jpx-thumbnail');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지 이미지가 inline image여도 해당 이미지를 썸네일로 만든다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-inline-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Inline First Page Cover.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createInlineImagePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(files[0].cover, /^bookmanager-thumbnail:\/\/cache\//);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'inline-first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지에 추출 가능한 이미지가 없으면 이후 페이지 이미지를 표지로 쓰지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-no-wrong-page-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Vector First Page.pdf');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createVectorFirstPagePdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].cover, '');
        assert.equal(files[0].thumb_path, '');
        assert.equal(fs.existsSync(thumbnailDir), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 첫 페이지 CropBox와 Rotate 정보는 썸네일 인코더로 전달한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-crop-rotate-cover-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Cropped Rotated First Page.pdf');
    let capturedTransform = null;

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(pdfPath, createCroppedRotatedPdfFixture());

        const files = await scanFolder(libraryDir, {
            thumbnailDir,
            sevenZExe: '',
            thumbnailEncoder: async (imageBuffer, options) => {
                capturedTransform = options.imageTransform;
                return {
                    buffer: Buffer.from('transformed-first-page-cover', 'latin1'),
                    extension: '.webp',
                };
            },
        });

        assert.equal(files.length, 1);
        assert.deepEqual(capturedTransform, {
            crop: {
                x: 100,
                y: 800,
                width: 800,
                height: 1000,
            },
            rotate: 90,
        });
        assert.equal(path.extname(files[0].thumb_path), '.webp');
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1'), 'transformed-first-page-cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('PDF 구버전 썸네일 캐시는 첫 페이지 표지로 다시 생성한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-pdf-cache-version-'));
    const libraryDir = path.join(root, 'library');
    const thumbnailDir = path.join(root, 'thumbnails');
    const pdfPath = path.join(libraryDir, 'Cached Wrong Page Cover.pdf');
    const oldThumbnailPath = path.join(thumbnailDir, 'legacy-wrong-cover.jpg');

    try {
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.mkdirSync(thumbnailDir, { recursive: true });
        fs.writeFileSync(pdfPath, createMultiPagePdfFixture());
        fs.writeFileSync(oldThumbnailPath, 'second-page-larger-cover');
        const stats = fs.statSync(pdfPath);
        let cachedRecord = {
            path: pdfPath,
            mtime: stats.mtimeMs / 1000,
            size: stats.size,
            ext: '.pdf',
            title: 'Cached PDF',
            book_type: 'pdf',
            thumb_path: oldThumbnailPath,
        };
        const libraryDb = {
            async getFileInfo(filePath) {
                return filePath === pdfPath ? cachedRecord : null;
            },
            async upsertFileInfo(info) {
                cachedRecord = { ...cachedRecord, ...info };
            },
        };

        const files = await scanFolder(libraryDir, {
            libraryDb,
            thumbnailDir,
            sevenZExe: '',
        });

        assert.equal(files.length, 1);
        assert.match(path.basename(files[0].thumb_path), /^pdf-first-page-v2-/);
        assert.notEqual(files[0].thumb_path, oldThumbnailPath);
        assert.equal(fs.readFileSync(files[0].thumb_path, 'latin1').trimEnd(), 'first-page-cover');
        assert.equal(cachedRecord.thumb_path, files[0].thumb_path);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
