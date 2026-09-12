import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('PDF 책넘김 배경은 본문 캔버스를 재사용하고 leaf 밖에서 다음 펼침면으로 교차 전환한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-pdf-ambient-test-'));
    try {
        const source = await fs.readFile(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
        const section = (start, end = '\nfunction ') => {
            const from = source.indexOf(start);
            const to = source.indexOf(end, from + start.length);
            assert.ok(from >= 0 && to > from, `Missing PDF ambient section: ${start}`);
            return source.slice(from, to);
        };
        const constants = ['BOOK_PAGE_TURN_DURATION', 'BOOK_AMBIENT_FADE_CLEANUP_BUFFER', 'PAGE_EFFECT_PREPARE_TIMEOUT']
            .map(name => {
                const declaration = source.match(new RegExp(`const ${name} = [^;]+;`))?.[0];
                assert.ok(declaration, `Missing ${name}`);
                return declaration;
            }).join('\n');
        const renderer = `
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerPageCurlBook from './src/ViewerPageCurlBook';
import { buildFlipBookPageModel, buildFlipBookStructureKey, finishAndTurnFlipBookToPage,
    getFlipBookAmbientEntries, getFlipBookCurrentGroupEntries, getFlipBookNearbyGroupEntries } from './src/viewerFlipBook.js';
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const viewerText = (key, fallback) => fallback;
const pdfjsLib = {};
${constants}
${section('function fitScaleForViewMode(', 'function normalizeTtsSettings(')}
${section('function scaledPageSizeForViewMode(')}
${section('function viewerClassName(')}
${section('function viewerElementsIncludingSelf(', 'function viewerInitialRenderIsPrepared(')}
${section('function paintAmbientCanvasFromSource(')}
${section('function FadingFlipBookAmbientLayer(', 'function storageKey(')}
${section('function PdfPageCanvas(', 'function PdfFlipBookAmbientPage(')}
${section('function PdfFlipBookAmbientPage(')}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
        if (predicate()) return;
        await nextFrame();
    }
    throw new Error(message + ': ' + JSON.stringify({ renders, backgrounds: layers().map(samples), pageChanges }));
}
const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
const renders = [];
const registrations = [];
const pageChanges = [];
const createDocument = (palette, ready = Promise.resolve()) => ({
    getPage: async pageNumber => {
        await ready;
        return {
            getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale, transform: [scale, 0, 0, scale, 0, 0] }),
            render: ({ canvasContext, viewport }) => {
                renders.push(pageNumber);
                canvasContext.fillStyle = palette[pageNumber - 1];
                canvasContext.fillRect(0, 0, viewport.width, viewport.height);
                return { promise: Promise.resolve(), cancel() {} };
            },
            getTextContent: async () => ({ items: [] }),
            cleanup() {},
        };
    },
});
const pdfDocument = createDocument(colors);
function PdfLeaf({ document, index, onAmbientReady }) {
    const publish = useCallback((sourceIndex, source) => {
        registrations.push({ index: sourceIndex, source });
        onAmbientReady?.(sourceIndex, source);
    }, [onAmbientReady]);
    return <PdfPageCanvas pdfDocument={document} pageNumber={index + 1} containerWidth={960}
        containerHeight={720} pageSlots={2} pageFrameWidth={456} viewMode="fit" zoom={100}
        active onAmbientReady={onAmbientReady ? publish : undefined} />;
}
const onPageIndexChange = index => pageChanges.push(index);
const getStepSizeForIndex = index => index === 0 ? 1 : 2;
const reactRoot = createRoot(document.getElementById('root'));
function renderBook(index, { immersive = true, document = pdfDocument, bookKey = 'pdf-ambient-test' } = {}) {
    reactRoot.render(<div className={'viewer-app' + (immersive ? ' is-background-immersive' : '')}><div className="viewer-content">
        <ViewerFlipBook bookKey={bookKey} className="viewer-pdf-stage is-fit" pageClassName="is-pdf"
            pageFormat="pdf" pageCount={5} currentPageIndex={index} spread pdfAmbient={immersive}
            getStepSizeForIndex={getStepSizeForIndex}
            pageSize={{ width: 456, height: 672 }} onPageIndexChange={onPageIndexChange}
            renderPage={(pageIndex, entry, state) => <PdfLeaf document={document} index={pageIndex} onAmbientReady={state.onAmbientReady} />} />
    </div></div>);
}
const layers = () => [...document.querySelectorAll('.viewer-flipbook-ambient-fade-layer')];
const sample = canvas => [...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data].slice(0, 3).join(',');
const samples = layer => [...layer.querySelectorAll('canvas')].map(sample).join('|');
const originalColors = '0,255,0|0,0,255';
const nextColors = '255,255,0|255,0,255';
function checkAmbientPlacement() {
    const ambient = document.querySelector('.viewer-flipbook-ambient-layer');
    check(ambient && ambient.parentElement.classList.contains('viewer-flipbook-scale'), 'Shared ambient must use the book coordinate frame');
    check(!ambient.closest('.viewer-flipbook-page, .stf__item, .viewer-flipbook'), 'Shared ambient must remain outside transformed leaves');
    check(getComputedStyle(ambient).overflow === 'visible', 'Shared glow must extend outside its frame');
    for (const canvas of ambient.querySelectorAll('canvas')) {
        check(canvas.width > 0 && canvas.height > 0 && Math.max(canvas.width, canvas.height) <= 360, 'Shared canvas must reuse a small ambient source');
        check(Number(getComputedStyle(canvas).opacity) > 0, 'Shared ambient must be visible');
    }
    const internal = [...document.querySelectorAll('.viewer-flipbook-page.is-pdf .viewer-ambient-canvas')];
    check(internal.length === 5, 'All PDF leaves must have rendered source canvases');
    check(internal.every(canvas => getComputedStyle(canvas).opacity === '0'), 'Leaf-local glow would be clipped into a dark seam');
}
window.testDone = (async () => {
    renderBook(1);
    await until(() => document.querySelectorAll('.viewer-pdf-canvas-wrap.is-ready').length === 5
        && layers().length === 1 && samples(layers()[0]) === originalColors, 'Initial PDF sources did not reach the shared background');
    check(renders.length === 5, 'Ambient registration must not duplicate PDF rendering: ' + renders);
    const registered = registrations.filter(entry => entry.source);
    check(new Set(registered.map(entry => entry.index)).size === 5, 'Every ready PDF leaf must register its own source');
    check(registered.every(entry => entry.source.width > 0 && entry.source.height > 0
        && Math.max(entry.source.canvas.width, entry.source.canvas.height) <= 360), 'Registered sources must retain page size and bounded canvas size');
    checkAmbientPlacement();
    renderBook(3);
    await until(() => layers().length === 2 && layers().some(layer => samples(layer) === nextColors), 'Next spread must mount beside the outgoing background');
    check(layers().some(layer => samples(layer) === originalColors), 'Outgoing background must remain mounted during the turn');
    checkAmbientPlacement();
    await until(() => layers().length === 2 && layers().some(layer => layer.classList.contains('is-visible') && samples(layer) === nextColors), 'Next background must become visible before outgoing cleanup');
    await until(() => layers().length === 1 && samples(layers()[0]) === nextColors && pageChanges.includes(3), 'Page turn must finish on the target spread and release the previous background');
    check(renders.length === 5, 'Page turn and ambient copies must not rerender the PDF: ' + renders);
    checkAmbientPlacement();
    renderBook(3, { immersive: false });
    await until(() => layers().length === 0, 'Solid background must release the shared ambient layer');
    renderBook(3);
    await until(() => layers().length === 1 && samples(layers()[0]) === nextColors, 'Returning to immersive must restore the current spread');
    check(renders.length === 5, 'Background mode changes must reuse ready PDF canvases');
    let releaseDocument;
    const replacement = createDocument(['#00ffff', '#00ffff', '#00ffff', '#00ffff', '#00ffff'], new Promise(resolve => { releaseDocument = resolve; }));
    renderBook(1, { bookKey: 'replacement-pdf', document: replacement });
    await nextFrame();
    await nextFrame();
    check(document.querySelectorAll('.viewer-flipbook-ambient-layer canvas').length === 0, 'A new document must not expose any previous PDF background while loading');
    releaseDocument();
    await until(() => layers().length === 1 && samples(layers()[0]) === '0,255,255|0,255,255', 'The replacement document must publish only its own background');
    check(renders.length === 10, 'Each replacement PDF page must render only once');
    checkAmbientPlacement();
    registrations.length = 0;
    reactRoot.unmount();
    check(new Set(registrations.filter(entry => entry.source === null).map(entry => entry.index)).size === 5, 'Unmount must unregister every PDF ambient source');
    return { renderCount: renders.length, sourceCount: registered.length, initialColors: originalColors, finalColors: nextColors };
})();
`;
        await build({ stdin: { contents: renderer, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, outfile: path.join(directory, 'renderer.js'), logLevel: 'silent' });
        await fs.copyFile(new URL('./styles/viewer.css', import.meta.url), path.join(directory, 'viewer.css'));
        await fs.writeFile(path.join(directory, 'index.html'), '<link rel="stylesheet" href="viewer.css"><style>body { margin: 0; } #root { width: 960px; height: 720px; }</style><div id="root"></div><script src="renderer.js"></script>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('PDF_AMBIENT_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const executable = createRequire(import.meta.url)('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(executable, [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('PDF ambient test timed out: ' + output)); }, 25000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/PDF_AMBIENT_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        assert.equal(JSON.parse(payload).renderCount, 10);
        t.diagnostic(payload);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
