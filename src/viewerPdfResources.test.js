import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerPdfResourceOptions } from './viewerPdfResources.js';

test('file:// 빌드는 worker와 같은 assets 폴더 아래에서 CMap과 표준 글꼴을 읽는다', () => {
    const baseUrl = 'file:///Applications/Book%20Manager.app/Contents/Resources/app.asar/dist/viewer.html';
    const assetRoot = 'file:///Applications/Book%20Manager.app/Contents/Resources/app.asar/dist/assets/';
    for (const workerUrl of ['./assets/pdf.worker-123.mjs', `${assetRoot}pdf.worker-123.mjs`]) {
        assert.deepEqual(viewerPdfResourceOptions(workerUrl, { baseUrl }), {
            cMapUrl: `${assetRoot}pdfjs/cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${assetRoot}pdfjs/standard_fonts/`,
        });
    }
});

test('공유 뷰어의 /viewer/와 /viewer/index.html은 번들의 worker URL로 리소스를 찾는다', () => {
    for (const baseUrl of ['http://127.0.0.1:8899/viewer/', 'http://127.0.0.1:8899/viewer/index.html?file=book.pdf']) {
        assert.deepEqual(viewerPdfResourceOptions('http://127.0.0.1:8899/assets/pdf.worker-123.mjs', { baseUrl }), {
            cMapUrl: 'http://127.0.0.1:8899/assets/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'http://127.0.0.1:8899/assets/pdfjs/standard_fonts/',
        });
    }
});

test('절대 worker 경로는 뷰어 문서 위치와 관계없이 worker 디렉터리를 기준으로 한다', () => {
    const baseUrl = 'http://127.0.0.1:8899/viewer/index.html';
    for (const workerUrl of ['/assets/pdf.worker-123.mjs', 'http://127.0.0.1:8899/assets/pdf.worker-123.mjs']) {
        assert.deepEqual(viewerPdfResourceOptions(workerUrl, { baseUrl }), {
            cMapUrl: 'http://127.0.0.1:8899/assets/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'http://127.0.0.1:8899/assets/pdfjs/standard_fonts/',
        });
    }
});

test('개발 환경은 worker의 node_modules 경로 대신 /assets/pdfjs/를 사용한다', () => {
    for (const baseUrl of ['http://localhost:5173/viewer.html', 'http://localhost:5173/viewer/index.html']) {
        assert.deepEqual(viewerPdfResourceOptions('/node_modules/pdfjs-dist/build/pdf.worker.mjs?url', {
            baseUrl,
            development: true,
        }), {
            cMapUrl: 'http://localhost:5173/assets/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'http://localhost:5173/assets/pdfjs/standard_fonts/',
        });
    }
});
