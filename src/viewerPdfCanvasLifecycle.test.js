import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('실제 React PDF 캔버스는 스크롤 key를 유지하며 비가시 자원을 해제하고 같은 크기로 복구한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-pdf-canvas-test-'));
    try {
        const source = await fs.readFile(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
        const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
        const keyExpression = source.match(/key=\{(flowMode === 'scroll' \? `pdf-scroll-[^\n]+)\}/)?.[1];
        assert.ok(keyExpression, '스크롤용 PDF 부모 key를 찾을 수 없습니다.');
        const renderer = `
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const viewerText = (key, fallback) => fallback;
const pdfjsLib = {};
${section('function fitScaleForViewMode(', 'function scaledPageSizeForViewMode(')}
${section('function scaledPageSizeForViewMode(', 'function supportsHighQualityComicDownsample(')}
${section('function PdfPageCanvas(', 'function slideThumbPageLabel(')}
const paintAmbientCanvasFromSource = (canvas, source) => {
    canvas.width = 30; canvas.height = 40;
    canvas.getContext('2d').drawImage(source, 0, 0, 30, 40);
};
const observers = new Set();
const selectionListeners = new Set();
const originalAddEventListener = document.addEventListener.bind(document);
const originalRemoveEventListener = document.removeEventListener.bind(document);
document.addEventListener = (type, listener, options) => {
    if (type === 'selectionchange') selectionListeners.add(listener);
    return originalAddEventListener(type, listener, options);
};
document.removeEventListener = (type, listener, options) => {
    if (type === 'selectionchange') selectionListeners.delete(listener);
    return originalRemoveEventListener(type, listener, options);
};
window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe(node) { this.node = node; }
    disconnect() { observers.delete(this); }
};
const notify = visible => [...observers].forEach(observer => observer.callback([{ isIntersecting: visible }]));
const wait = () => new Promise(resolve => setTimeout(resolve, 40));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const selectPageText = () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.viewer-pdf-text-layer span'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
};
let renderCount = 0;
let cleanupCount = 0;
const page = {
    getViewport: ({ scale }) => ({ width: 300 * scale, height: 400 * scale, transform: [1, 0, 0, 1, 0, 0] }),
    render: ({ canvasContext }) => {
        renderCount += 1;
        canvasContext.fillStyle = '#123456';
        canvasContext.fillRect(0, 0, 100, 100);
        return { promise: Promise.resolve(), cancel() {} };
    },
    getTextContent: async () => ({ items: [{ str: 'Page text', transform: [10, 0, 0, 10, 0, 20], width: 40, height: 10 }] }),
    cleanup: () => { cleanupCount += 1; },
};
const pdfDocument = { getPage: async () => page };
const reactRoot = createRoot(document.getElementById('root'));
function render(index, zoom = 100) {
    const flowMode = 'scroll';
    const session = { id: 'same-book' };
    const layer = { index };
    reactRoot.render(<div key={${keyExpression}}><PdfPageCanvas pdfDocument={pdfDocument} pageNumber={3} containerWidth={900} containerHeight={700} pageSlots={1} viewMode="fit" zoom={zoom} active={false} recycle /></div>);
}
window.testDone = (async () => {
    render(0); await wait();
    notify(true); await wait(); await wait();
    const canvas = document.querySelector('.viewer-pdf-canvas');
    const wrap = document.querySelector('.viewer-pdf-canvas-wrap');
    const height = wrap.getBoundingClientRect().height;
    check(renderCount === 1 && canvas.width > 0, 'initial render');
    check(document.querySelectorAll('.viewer-pdf-text-layer span').length === 1, 'initial text');
    render(4); await wait();
    check(canvas === document.querySelector('.viewer-pdf-canvas') && renderCount === 1, 'scroll remounted canvas');
    notify(false); await wait();
    check(canvas.width === 0 && canvas.height === 0, 'offscreen canvas retained');
    check(document.querySelectorAll('.viewer-pdf-text-layer span').length === 0, 'offscreen text retained');
    check(wrap.getBoundingClientRect().height === height, 'placeholder changed height');
    check(cleanupCount > 0, 'page resources retained');
    render(5, 150); await wait();
    check(renderCount === 1, 'offscreen zoom rendered canvas');
    const zoomHeight = wrap.getBoundingClientRect().height;
    check(zoomHeight === Math.floor(height * 1.5), 'offscreen zoom height');
    notify(true); await wait(); await wait();
    check(renderCount === 2 && canvas.width > 0, 'canvas did not re-render');
    check(wrap.getBoundingClientRect().height === zoomHeight, 're-entry changed height');
    check(document.querySelectorAll('.viewer-pdf-text-layer span').length === 1, 'text did not recover');
    const baseSelectionListeners = selectionListeners.size;
    selectPageText(); await wait();
    notify(false); await wait();
    check(canvas.width === 0, 'selected offscreen canvas retained');
    check(document.querySelectorAll('.viewer-pdf-text-layer span').length === 1, 'selected offscreen text was removed');
    check(selectionListeners.size === baseSelectionListeners + 1, 'selected page did not register cleanup');
    window.getSelection().removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await wait();
    check(document.querySelectorAll('.viewer-pdf-text-layer span').length === 0, 'deselected offscreen text retained');
    check(selectionListeners.size === baseSelectionListeners, 'selection cleanup listener retained');
    check(wrap.getBoundingClientRect().height === zoomHeight, 'deselect changed placeholder height');
    notify(true); await wait(); await wait();
    selectPageText(); await wait();
    notify(false); await wait();
    check(selectionListeners.size === baseSelectionListeners + 1, 'second selected page did not register cleanup');
    reactRoot.unmount(); await wait();
    check(observers.size === 0, 'observer retained after unmount');
    check(selectionListeners.size === baseSelectionListeners, 'selection listener retained after unmount');
    return { renderCount, cleanupCount, height, zoomHeight };
})();
`;
        await build({ stdin: { contents: renderer, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, outfile: path.join(root, 'renderer.js'), logLevel: 'silent' });
        await fs.writeFile(path.join(root, 'viewer.css'), await fs.readFile(new URL('./styles/viewer.css', import.meta.url)));
        await fs.writeFile(path.join(root, 'index.html'), '<link rel="stylesheet" href="viewer.css"><div id="root"></div><script src="renderer.js"></script>');
        const main = `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(root, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('PDF_CANVAS_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`;
        await fs.writeFile(path.join(root, 'main.cjs'), main);
        const require = createRequire(import.meta.url);
        const executable = require('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(executable, [path.join(root, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error(`PDF canvas test timed out: ${output}`)); }, 20000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
        });
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /PDF_CANVAS_RESULT=/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
