import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanFolder } from './tasks/folderScanTask.js';

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
        pdfObject(6, '<< /Title (PDF Title) /Author (PDF Author) /Subject (PDF Subject) /Keywords (pdf, document) /Producer (PDF Producer) >>'),
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
