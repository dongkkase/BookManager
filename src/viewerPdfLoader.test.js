import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadViewerPdfDocument } from './viewerPdfLoader.js';

function makePdf(padding = 0, pageObjects) {
    const objects = [
        ...(pageObjects || [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << >> >>',
            '<< /Length 0 >>\nstream\n\nendstream',
        ]),
        `<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`,
    ];
    let content = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(content));
        content += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(content);
    content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    content += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array(Buffer.from(content));
}

function makeKoreanPdf(padding = 0) {
    const content = 'BT /F1 24 Tf 30 300 Td <B0A1B3AAB4D9> Tj ET';
    return makePdf(padding, [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium /Encoding /KSCms-UHC-H /DescendantFonts [6 0 R] >>',
        '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>',
        '<< /Type /FontDescriptor /FontName /HYSMyeongJo-Medium /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
    ]);
}

function pdfFetch(data, requests, options = {}) {
    return async (url, init) => {
        assert.equal(url, 'bookmanager-document://session/test/book.pdf');
        const header = init.headers?.Range;
        requests.push(header || 'full');
        const match = header?.match(/^bytes=(\d+)-(\d+)$/);
        if (!match || options.ignoreRanges) return new Response(data, { status: 200 });
        if (options.failLaterRanges && requests.length > 1) return new Response('', { status: 416 });
        const begin = Number(match[1]);
        const end = Math.min(Number(match[2]), data.length - 1);
        return new Response(data.slice(begin, end + 1), {
            status: 206,
            headers: { 'Content-Range': `bytes ${begin}-${end}/${data.length}` },
        });
    };
}

test('이름으로 지정된 한국어 CMap은 외부 CMap 자료가 없으면 글자를 추출하지 못한다', async () => {
    const document = await pdfjs.getDocument({
        data: makeKoreanPdf(),
        verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;
    try {
        const text = await (await document.getPage(1)).getTextContent();
        assert.deepEqual(text.items, []);
    } finally {
        await document.destroy();
    }
});

for (const [name, padding, fetchOptions] of [
    ['작은 전체 데이터', 0, {}],
    ['큰 파일의 범위 요청', 1024 * 1024, {}],
    ['후속 범위 요청의 전체 데이터 fallback', 1024 * 1024, { failLaterRanges: true }],
]) {
    test(`${name} PDF도 packed CMap과 표준 폰트 옵션으로 한글을 추출한다`, async () => {
        const requests = [];
        const documentOptions = [];
        const assets = {
            cMapUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url)),
            cMapPacked: true,
            standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)),
        };
        const document = await loadViewerPdfDocument({
            ...pdfjs,
            getDocument(options) {
                documentOptions.push(options);
                return pdfjs.getDocument(options);
            },
        }, 'bookmanager-document://session/test/book.pdf', {
            ...assets,
            fetch: pdfFetch(makeKoreanPdf(padding), requests, fetchOptions),
        });
        try {
            const page = await document.getPage(1);
            const text = await page.getTextContent();
            assert.equal(text.items.map(item => item.str).join(''), '가나다');
            assert.equal(documentOptions.length, 1);
            for (const [key, value] of Object.entries(assets)) {
                assert.equal(documentOptions[0][key], value, key);
            }
            assert.equal(Boolean(documentOptions[0].range), padding > 0);
            if (padding) assert.ok(requests.length > 1, '실제 PDFDataRangeTransport 경로를 사용한다');
            if (fetchOptions.failLaterRanges) assert.equal(requests.filter(value => value === 'full').length, 1);
            else assert.equal(requests.includes('full'), false);
        } finally {
            await document.destroy();
        }
    });
}

for (const [name, padding] of [['작은', 0], ['큰', 1024 * 1024]]) {
    test(`${name} PDF는 실제 PDF.js에서 동일한 페이지 치수와 내용을 읽는다`, async () => {
        const data = makePdf(padding);
        const requests = [];
        const document = await loadViewerPdfDocument(pdfjs, 'bookmanager-document://session/test/book.pdf', {
            fetch: pdfFetch(data, requests),
        });
        try {
            assert.equal(document.numPages, 1);
            const page = await document.getPage(1);
            assert.deepEqual(page.view, [0, 0, 300, 400]);
            assert.deepEqual((await page.getTextContent()).items, []);
            assert.equal(requests.includes('full'), false);
            if (padding) {
                const bytesRead = requests.reduce((sum, header) => {
                    const [begin, end] = header.slice(6).split('-').map(Number);
                    return sum + Math.min(end + 1, data.length) - begin;
                }, 0);
                assert.ok(bytesRead < data.length / 2, `불필요한 전체 읽기: ${bytesRead}/${data.length}`);
            }
        } finally {
            await document.destroy();
        }
    });
}

for (const [name, fetchOptions] of [
    ['범위를 지원하지 않는 응답', { ignoreRanges: true }],
    ['후속 범위 요청 실패', { failLaterRanges: true }],
]) {
    test(`${name}도 전체 데이터 fallback으로 같은 PDF를 연다`, async () => {
        const requests = [];
        const document = await loadViewerPdfDocument(pdfjs, 'bookmanager-document://session/test/book.pdf', {
            fetch: pdfFetch(makePdf(1024 * 1024), requests, fetchOptions),
        });
        try {
            assert.equal(document.numPages, 1);
            assert.deepEqual((await document.getPage(1)).view, [0, 0, 300, 400]);
            assert.ok(requests.filter(value => value === 'full').length <= 1);
        } finally {
            await document.destroy();
        }
    });
}

test('PDF 초기 요청 중 취소하면 재시도하거나 문서 작업을 시작하지 않는다', async () => {
    const controller = new AbortController();
    let requests = 0;
    const promise = loadViewerPdfDocument(pdfjs, 'bookmanager-document://session/test/book.pdf', {
        signal: controller.signal,
        fetch: async (url, { signal }) => {
            requests += 1;
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
            });
        },
    });
    controller.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(requests, 1);
});

test('PDF 초기 범위 본문이 끊겨도 전체 응답으로 복구하며 사용자 취소는 재시도하지 않는다', async () => {
    const data = makePdf();
    const requests = [];
    const document = await loadViewerPdfDocument(pdfjs, 'bookmanager-document://session/test/book.pdf', {
        fetch: async (url, init) => {
            requests.push(init.headers?.Range || 'full');
            if (requests.length > 1) return new Response(data, { status: 200 });
            return new Response(new ReadableStream({ start: controller => controller.error(new Error('connection closed')) }), {
                status: 206,
                headers: { 'Content-Range': `bytes 0-${data.length - 1}/${data.length}` },
            });
        },
    });
    try {
        assert.equal(document.numPages, 1);
        assert.deepEqual((await document.getPage(1)).view, [0, 0, 300, 400]);
        assert.deepEqual(requests, ['bytes=0-65535', 'full']);
    } finally {
        await document.destroy();
    }

    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(loadViewerPdfDocument(pdfjs, 'bookmanager-document://session/test/book.pdf', {
        signal: controller.signal,
        fetch: async () => {
            calls += 1;
            return {
                ok: true,
                status: 206,
                async arrayBuffer() {
                    controller.abort();
                    throw new Error('body cancelled');
                },
            };
        },
    }), { name: 'AbortError' });
    assert.equal(calls, 1);
});
