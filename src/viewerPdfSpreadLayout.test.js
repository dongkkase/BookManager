import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('PDF 책넘김의 두 페이지는 leaf 폭을 유지하고 캔버스와 텍스트 좌표가 일치한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-pdf-spread-test-'));
    try {
        const source = await fs.readFile(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
        const section = (start, end) => {
            const from = source.indexOf(start);
            const to = source.indexOf(end, from);
            assert.ok(from >= 0 && to > from, `Missing PDF renderer section: ${start}`);
            return source.slice(from, to);
        };
        const stagePadding = Number(source.match(/const READER_STAGE_PADDING = (\d+);/)?.[1]);
        assert.ok(stagePadding > 0);
        const renderer = `
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const viewerText = (key, fallback) => fallback;
const pdfjsLib = {};
${section('function fitScaleForViewMode(', 'function normalizeTtsSettings(')}
${section('function scaledPageSizeForViewMode(', 'function supportsHighQualityComicDownsample(')}
${section('function PdfPageCanvas(', 'function slideThumbPageLabel(')}
const paintAmbientCanvasFromSource = (canvas, source) => {
    canvas.width = 12;
    canvas.height = 18;
    canvas.getContext('2d').drawImage(source, 0, 0, 12, 18);
};
let renderCount = 0;
const pdfDocument = {
    getPage: async pageNumber => ({
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 900 * scale, transform: [scale, 0, 0, scale, 0, 0] }),
        render: ({ canvasContext, viewport }) => {
            renderCount += 1;
            canvasContext.fillStyle = pageNumber === 1 ? '#235789' : '#ad343e';
            canvasContext.fillRect(0, 0, viewport.width, viewport.height);
            return { promise: Promise.resolve(), cancel() {} };
        },
        getTextContent: async () => ({ items: [{ str: 'PDF page ' + pageNumber, transform: [12, 0, 0, 12, 15, 30], width: 90, height: 12 }] }),
        cleanup() {},
    }),
};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const approximately = (left, right, message) => check(Math.abs(left - right) <= 0.75, message + ': ' + left + ' !== ' + right);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const delay = () => new Promise(resolve => setTimeout(resolve, 10));
const reactRoot = createRoot(document.getElementById('root'));
function Layout({ width, height, viewMode, visualScale, flipbook, renderZoom = 100 }) {
    const leafWidth = Math.max(180, Math.floor((width - ${stagePadding * 2}) / 2));
    const leafHeight = Math.max(260, height - ${stagePadding * 2});
    const page = index => <PdfPageCanvas pdfDocument={pdfDocument} pageNumber={index + 1}
        containerWidth={width} containerHeight={height} pageSlots={2} pageFrameWidth={flipbook ? leafWidth : undefined}
        viewMode={viewMode} zoom={renderZoom} active />;
    return <div className="viewer-content is-page-mode" style={{ width, height }}>
        <div className={'viewer-pdf-stage is-spread is-' + viewMode + (flipbook ? ' viewer-flipbook-stage' : '')}
            data-layout={flipbook ? 'flipbook' : 'normal'} style={flipbook ? { width, height, minHeight: height } : undefined}>
        {flipbook ? <div className="viewer-flipbook-scale" style={{ width: leafWidth * 2, height: leafHeight, transform: 'scale(' + visualScale + ')', transformOrigin: 'center center' }}>
            <div className="viewer-flipbook" style={{ width: leafWidth * 2, height: leafHeight }}>
                <div className="stf__parent" style={{ width: leafWidth * 2, height: leafHeight }}>
                    <div className="stf__wrapper" style={{ width: leafWidth * 2, height: leafHeight }}>
                        <div className="stf__block" style={{ position: 'relative', width: leafWidth * 2, height: leafHeight }}>
                            {[0, 1].map(index => <div key={index} className={'viewer-flipbook-page is-pdf is-' + (index ? 'right' : 'left') + '-page'}
                                style={{ position: 'absolute', left: index * leafWidth, top: 0, width: leafWidth, height: leafHeight }}>
                                <div className={'viewer-flipbook-page-inner is-' + (index ? 'right' : 'left') + '-page'}>{page(index)}</div>
                            </div>)}
                        </div>
                    </div>
                </div>
            </div>
        </div> : <div className="viewer-page-transition-layer is-current has-spread-pair"><div className="viewer-spread-pair">{page(0)}{page(1)}</div></div>}
        </div>
    </div>;
}
async function measure(scenario) {
    reactRoot.render(<Layout {...scenario} />);
    await nextFrame();
    await nextFrame();
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (document.querySelectorAll('.viewer-pdf-canvas-wrap.is-ready').length === 2
            && document.querySelectorAll('.viewer-pdf-text-layer span').length === 2) break;
        await delay();
    }
    const viewport = document.querySelector('.viewer-content');
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    const pages = [...document.querySelectorAll('.viewer-pdf-page')];
    check(pages.length === 2, 'Two PDF pages must be mounted');
    const metrics = pages.map((page, index) => {
        const wrap = page.querySelector('.viewer-pdf-canvas-wrap');
        const canvas = page.querySelector('.viewer-pdf-canvas');
        const text = page.querySelector('.viewer-pdf-text-layer');
        check(wrap.classList.contains('is-ready') && canvas.width > 0 && text, 'PDF page did not render');
        const pageRect = page.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const textRect = text.getBoundingClientRect();
        const prefix = [scenario.flipbook ? 'flipbook' : 'normal', scenario.viewMode, scenario.width, scenario.visualScale, scenario.renderZoom || 100, index].join('/');
        for (const dimension of ['left', 'top', 'width', 'height']) {
            approximately(wrapRect[dimension], canvasRect[dimension], prefix + ' wrap/canvas ' + dimension);
            approximately(textRect[dimension], canvasRect[dimension], prefix + ' text/canvas ' + dimension);
        }
        check(getComputedStyle(wrap).boxShadow === 'none', prefix + ' a separate page shadow remains at the center');
        let leafWidth = 0;
        if (scenario.flipbook) {
            const leafRect = page.closest('.viewer-flipbook-page').getBoundingClientRect();
            leafWidth = leafRect.width;
            check(getComputedStyle(page).maxWidth !== '50%', prefix + ' the normal spread rule halves an already fixed-width leaf');
            approximately(pageRect.width, canvasRect.width, prefix + ' PDF page/canvas width');
            check(canvasRect.left >= leafRect.left - 0.75 && canvasRect.right <= leafRect.right + 0.75, prefix + ' canvas crosses its leaf boundary');
        } else {
            approximately(pageRect.width, canvasRect.width, prefix + ' normal PDF page/canvas width');
        }
        return { left: canvasRect.left, right: canvasRect.right, width: canvasRect.width, height: canvasRect.height, leafWidth, pageWidth: pageRect.width };
    });
    check(metrics[0].right <= metrics[1].left + 0.75, 'The two PDF canvases overlap');
    if (!scenario.flipbook) {
        const viewportRect = viewport.getBoundingClientRect();
        check(metrics[0].left >= viewportRect.left - 0.75, 'The left PDF page overflows outside the scrollable area');
        check(viewport.scrollWidth >= metrics[1].right - viewportRect.left - 0.75, 'The scrollable width excludes the right PDF page');
        if (scenario.renderZoom === 200) {
            check(viewport.scrollWidth > viewport.clientWidth, 'Zoomed spread does not expand the scrollable width');
            viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth;
            check(viewport.scrollLeft > 0, 'Zoomed spread cannot scroll horizontally');
            const rightCanvasRect = pages[1].querySelector('.viewer-pdf-canvas').getBoundingClientRect();
            check(rightCanvasRect.right <= viewportRect.right + 0.75, 'The right PDF page cannot be reached by scrolling');
        }
    }
    return { ...scenario, pages: metrics, scrollWidth: viewport.scrollWidth, viewportWidth: viewport.clientWidth };
}
window.testDone = (async () => {
    const measurements = [];
    for (const viewport of [{ width: 960, height: 720 }, { width: 720, height: 540 }]) {
        for (const viewMode of ['fit', 'width']) {
            for (const visualScale of [1, 1.5]) measurements.push(await measure({ ...viewport, viewMode, visualScale, flipbook: true }));
            for (const renderZoom of [100, 200]) measurements.push(await measure({ ...viewport, viewMode, visualScale: 1, flipbook: false, renderZoom }));
        }
    }
    reactRoot.unmount();
    return { renderCount, measurements };
})();
`;
        await build({ stdin: { contents: renderer, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, outfile: path.join(directory, 'renderer.js'), logLevel: 'silent' });
        await fs.copyFile(new URL('./styles/viewer.css', import.meta.url), path.join(directory, 'viewer.css'));
        await fs.writeFile(path.join(directory, 'index.html'), '<link rel="stylesheet" href="viewer.css"><style>body { margin: 0; } #root { width: 1200px; height: 1000px; }</style><div id="root"></div><script src="renderer.js"></script>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1240, height: 1040, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('PDF_SPREAD_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const require = createRequire(import.meta.url);
        const executable = require('electron');
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(executable, [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('PDF spread test timed out: ' + output)); }, 25000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/PDF_SPREAD_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const measurements = JSON.parse(payload).measurements;
        assert.equal(measurements.length, 16);
        for (const widthCase of measurements.filter(item => item.flipbook && item.viewMode === 'width')) {
            t.diagnostic(JSON.stringify({ viewportWidth: widthCase.width, visualScale: widthCase.visualScale, pageWidth: widthCase.pages[0].pageWidth, canvasWidth: widthCase.pages[0].width, leafWidth: widthCase.pages[0].leafWidth }));
        }
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
