import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('툴바 줌은 현재 화면 중앙을 유지하고 본문 줌은 마우스 위치를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-zoom-anchor-test-'));
    try {
        const source = await fs.readFile(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
        const section = (start, end = '\nfunction ') => {
            const from = source.indexOf(start);
            const to = source.indexOf(end, from + start.length);
            assert.ok(from >= 0 && to > from, `Missing zoom renderer section: ${start}`);
            return source.slice(from, to);
        };
        const constants = ['ZOOM_MIN', 'ZOOM_MAX', 'ZOOM_STEP', 'WHEEL_ZOOM_BUTTON_MASK'].map(name => {
            const declaration = source.match(new RegExp(`const ${name} = [^;]+;`))?.[0];
            assert.ok(declaration, `Missing ${name}`);
            return declaration;
        }).join('\n');
        const controlStart = source.indexOf('<ZoomControl');
        const controlEnd = source.indexOf('/>', controlStart);
        assert.ok(controlStart >= 0 && controlEnd > controlStart);
        const toolbarControl = source.slice(controlStart, controlEnd + 2);
        const viewerCss = await fs.readFile(new URL('./styles/viewer.css', import.meta.url), 'utf8');
        const offsetRuleStart = viewerCss.indexOf('.viewer-content > :first-child');
        const offsetRule = offsetRuleStart < 0 ? '' : viewerCss.slice(offsetRuleStart, viewerCss.indexOf('}', offsetRuleStart) + 1);
        const ambientRuleStart = viewerCss.indexOf('.viewer-ambient-canvas {');
        assert.ok(ambientRuleStart >= 0, 'Missing ambient canvas styling');
        const ambientRule = viewerCss.slice(ambientRuleStart, viewerCss.indexOf('}', ambientRuleStart) + 1);
        const renderer = `
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const viewerText = (key, fallback) => fallback;
const plusMinusIcon = '';
${constants}
${section('function isShortcutModifierEvent(')}
${section('function zoomAnchorSelectorForTarget(')}
${section('function ToolbarButton(')}
${section('function ZoomControl(')}
function Fixture({ fit = false, ambient = false }) {
    const [zoom, setZoom] = useState(100);
    const [renderZoom, setRenderZoom] = useState(100);
    const zoomValueRef = useRef(zoom);
    const pageWidth = fit ? (ambient ? 300 : 420) : 1200;
    const zoomStep = ZOOM_STEP;
    const scrollRef = useRef(null);
    const scrollZoomAnchorSequenceRef = useRef(0);
    const scrollZoomAnchorCleanupRef = useRef(null);
    const scrollZoomAnchorApplyRef = useRef(null);
    const wheelButtonStateRef = useRef(0);
    const suppressContextMenuRef = useRef(false);
    const session = { type: 'pdf' };
    const flowMode = fit ? 'single' : 'scroll';
    const resetPageModeScroll = useCallback(() => {}, []);
    const movePage = useCallback(() => { throw new Error('Scrolling PDF wheel must not navigate pages'); }, []);
    ${section('const createScrollZoomAnchor =', 'const handleSlideNavWheel =')}
    ${section('const handleWheel =', 'const toggleFullscreen =')}
    useEffect(() => {
        const timer = setTimeout(() => setRenderZoom(zoom), window.fixtureResizeDelay || 0);
        return () => clearTimeout(timer);
    }, [zoom]);
    return <>
        <div className="fixture-toolbar">${toolbarControl}</div>
        <div className={'fixture-viewport viewer-content' + (fit ? ' is-fit' : '')} ref={scrollRef} data-zoom={zoom}>
            <div className={'fixture-document viewer-pdf-stage ' + (fit ? 'is-single is-fit' : 'is-scroll') + (ambient ? ' is-ambient' : '')}>
                {(fit ? [0] : [0, 1, 2]).map(index => <section key={index} className="viewer-pdf-page" data-pdf-page-index={index}
                    style={{ width: fit ? pageWidth * renderZoom / 100 : undefined, height: fit ? 260 * renderZoom / 100 : 900 * renderZoom / 100 + 40 }}>
                    {ambient && <canvas className="viewer-ambient-canvas" aria-hidden="true" />}
                    <canvas className="viewer-pdf-canvas" style={{ width: pageWidth * renderZoom / 100, height: (fit ? 260 : 900) * renderZoom / 100 }} />
                </section>)}
            </div>
        </div>
    </>;
}
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 12) { for (let index = 0; index < count; index += 1) await nextFrame(); }
const check = (condition, message) => { if (!condition) throw new Error(message); };
const root = createRoot(document.getElementById('root'));
const measurements = [];
const viewport = () => document.querySelector('.fixture-viewport');
const center = () => {
    const node = viewport();
    const rect = node.getBoundingClientRect();
    return { x: rect.left + node.clientWidth / 2, y: rect.top + node.clientHeight / 2 };
};
function changeRange(value) {
    const input = document.querySelector('.viewer-zoom-range');
    check(input, 'The actual zoom control must expose its range input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}
function ctrlWheelAt(point, deltaY) {
    const target = document.elementFromPoint(point.x, point.y);
    check(target && viewport().contains(target), 'Ctrl wheel must target PDF content');
    const event = new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: point.x, clientY: point.y,
    });
    check(target.dispatchEvent(event) === false && event.defaultPrevented, 'The actual native wheel listener must cancel browser scrolling and zoom');
}
async function anchored(label, action, expectedZoom, point = center(), settleFrames = 12, followViewportCenter = false, referenceCanvas = null) {
    const node = viewport();
    const page = referenceCanvas
        ? referenceCanvas.closest('[data-pdf-page-index]')
        : document.elementFromPoint(point.x, point.y)?.closest('[data-pdf-page-index]');
    check(page && node.contains(page), label + ': a visible reference page is required');
    const canvas = referenceCanvas || page.querySelector('.viewer-pdf-canvas');
    const before = canvas.getBoundingClientRect();
    const ratioX = (point.x - before.left) / before.width;
    const ratioY = (point.y - before.top) / before.height;
    const previousScroll = [node.scrollLeft, node.scrollTop];
    const previousViewport = [node.clientWidth, node.clientHeight];
    action();
    const resizeSamples = [];
    const layoutObserver = new ResizeObserver(() => {
        const rect = canvas.getBoundingClientRect();
        const expected = followViewportCenter ? center() : point;
        resizeSamples.push({ x: rect.left + ratioX * rect.width - expected.x, y: rect.top + ratioY * rect.height - expected.y });
    });
    // Observe after the production listener; a raw rAF can run before resize delivery.
    node.querySelectorAll('.viewer-pdf-page, .viewer-pdf-canvas').forEach(page => layoutObserver.observe(page));
    await frames(settleFrames);
    layoutObserver.disconnect();
    const resizePeak = resizeSamples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample.x), Math.abs(sample.y)), 0);
    check(resizePeak <= 1.25, label + ': layout changed before its anchor was restored; peak drift ' + resizePeak);
    check(Number(node.dataset.zoom) === expectedZoom, label + ': expected zoom ' + expectedZoom + ', got ' + node.dataset.zoom);
    const after = canvas.getBoundingClientRect();
    const expectedPoint = followViewportCenter ? center() : point;
    const driftX = after.left + ratioX * after.width - expectedPoint.x;
    const driftY = after.top + ratioY * after.height - expectedPoint.y;
    check(Math.abs(driftX) <= 1.25 && Math.abs(driftY) <= 1.25, label + ': anchored point moved by ' + driftX + ', ' + driftY
        + '; viewport ' + previousViewport + ' -> ' + [node.clientWidth, node.clientHeight]
        + '; scroll size ' + [node.scrollWidth, node.scrollHeight] + '; translate ' + getComputedStyle(node.firstElementChild).translate);
    if (!node.classList.contains('is-fit')) {
        check(node.scrollLeft !== previousScroll[0] || node.scrollTop !== previousScroll[1], label + ': scroll position did not follow the resized page');
    }
    measurements.push({ label, zoom: expectedZoom, page: page.dataset.pdfPageIndex, driftX, driftY, resizePeak, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop });
}
window.testDone = (async () => {
    root.render(<Fixture />);
    await frames(2);
    viewport().scrollLeft = 340;
    viewport().scrollTop = 1140;
    document.querySelector('.viewer-zoom-button').click();
    await frames(2);
    await anchored('range 100 to 200', () => changeRange(200), 200);
    await anchored('range 200 to 120', () => changeRange(120), 120);
    viewport().scrollLeft += 170;
    viewport().scrollTop += 180;
    await frames(2);
    await anchored('range after manual scrolling', () => changeRange(180), 180);
    const control = document.querySelector('.viewer-zoom-control');
    const toolbarRect = control.getBoundingClientRect();
    await anchored('toolbar wheel', () => control.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -100,
        clientX: toolbarRect.left + 8, clientY: toolbarRect.top + 8,
    })), 190);
    await anchored('toolbar reset', () => document.querySelector('.viewer-zoom-reset').click(), 100);
    const rect = viewport().getBoundingClientRect();
    const mouse = { x: rect.left + 130, y: rect.top + 95 };
    await anchored('mouse point zoom in', () => ctrlWheelAt(mouse, -100), 110, mouse);
    await anchored('mouse point zoom out', () => ctrlWheelAt(mouse, 100), 100, mouse);
    window.fixtureResizeDelay = 240;
    await anchored('delayed PDF canvas resize', () => changeRange(160), 160, center(), 30);
    window.fixtureResizeDelay = 0;
    const fixedParent = document.querySelector('.fixture-document');
    fixedParent.style.height = '6500px';
    const fixedParentHeight = fixedParent.getBoundingClientRect().height;
    let sizeBeforeEarlierPageResize;
    await anchored('earlier PDF page moves an unchanged target inside a fixed parent', () => {
        changeRange(170);
        setTimeout(() => {
            const targetCanvas = document.querySelector('[data-pdf-page-index="1"] .viewer-pdf-canvas');
            const rect = targetCanvas.getBoundingClientRect();
            sizeBeforeEarlierPageResize = [rect.width, rect.height];
            const earlierPage = document.querySelector('[data-pdf-page-index="0"]');
            earlierPage.style.height = (earlierPage.getBoundingClientRect().height + 55) + 'px';
        }, 240);
    }, 170, center(), 30);
    const unchangedCanvas = document.querySelector('[data-pdf-page-index="1"] .viewer-pdf-canvas').getBoundingClientRect();
    check(sizeBeforeEarlierPageResize?.[0] === unchangedCanvas.width && sizeBeforeEarlierPageResize[1] === unchangedCanvas.height,
        'Only the earlier page must resize after the target PDF canvas settles');
    check(fixedParent.getBoundingClientRect().height === fixedParentHeight, 'The parent must not resize when an earlier PDF page grows');
    const previousViewportHeight = viewport().clientHeight;
    await anchored('toolbar zoom follows the center after a scrollbar reduces viewport height', () => {
        changeRange(180);
        viewport().style.height = '390px';
    }, 180, center(), 12, true);
    check(viewport().clientHeight === previousViewportHeight - 10, 'The viewport must lose ten pixels as it would when a scrollbar appears');
    window.fixtureResizeDelay = 240;
    changeRange(190);
    await frames(4);
    viewport().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    viewport().scrollLeft += 90;
    viewport().scrollTop += 120;
    const userScroll = [viewport().scrollLeft, viewport().scrollTop];
    await frames(30);
    check(Number(viewport().dataset.zoom) === 190, 'A normal scroll wheel must not change zoom');
    check(viewport().scrollLeft === userScroll[0] && viewport().scrollTop === userScroll[1], 'Delayed resize must not undo scrolling after the user cancels anchoring');
    measurements.push({ label: 'user scrolling cancels delayed correction', zoom: 190, scrollLeft: userScroll[0], scrollTop: userScroll[1] });
    window.fixtureResizeDelay = 0;
    changeRange(200);
    await frames(2);
    const pendingRect = viewport().getBoundingClientRect();
    const priorityMouse = { x: pendingRect.left + 130, y: pendingRect.top + 95 };
    await anchored('Ctrl wheel takes priority over pending toolbar center correction', () => ctrlWheelAt(priorityMouse, -100), 210, priorityMouse);
    for (const ratio of [0.7, 0.3]) {
        root.render(<Fixture fit key={'small-' + ratio} />);
        await frames(2);
        const smallCanvas = document.querySelector('.viewer-pdf-canvas').getBoundingClientRect();
        check(smallCanvas.width < viewport().clientWidth && smallCanvas.height < viewport().clientHeight, 'The initial single page must be smaller than the viewport');
        const point = { x: smallCanvas.left + smallCanvas.width * ratio, y: smallCanvas.top + smallCanvas.height * ratio };
        for (const [zoom, delta] of [[110, -100], [100, 100], [90, 100], [80, 100], [90, -100]]) {
            const centered = zoom < 100 || Number(viewport().dataset.zoom) < 100;
            await anchored('small page at ' + ratio + ' zoom ' + zoom + (centered ? ' using viewport center' : ' using pointer'),
                () => ctrlWheelAt(point, delta), zoom, centered ? center() : point, 12, centered);
        }
    }
    root.render(<Fixture fit key="small-scroll-boundary" />);
    await frames(2);
    document.querySelector('.viewer-zoom-button').click();
    await frames(2);
    await anchored('single page becomes scrollable at 150 percent', () => changeRange(150), 150, center(), 12, true);
    check(viewport().scrollWidth > viewport().clientWidth, 'The 150 percent page must cross the horizontal scrolling boundary');
    const largerCanvas = document.querySelector('.viewer-pdf-canvas').getBoundingClientRect();
    const boundaryPoint = { x: largerCanvas.left + largerCanvas.width * 0.7, y: largerCanvas.top + largerCanvas.height * 0.7 };
    for (const zoom of [140, 130, 120, 110, 100, 90]) {
        const centered = zoom < 100;
        await anchored('zoom crosses the scrolling boundary at ' + zoom, () => ctrlWheelAt(boundaryPoint, 100), zoom,
            centered ? center() : boundaryPoint, 12, centered);
    }
    root.render(<Fixture fit key="small-background-pointer" />);
    await frames(2);
    const referenceCanvas = document.querySelector('.viewer-pdf-canvas');
    const referenceRect = referenceCanvas.getBoundingClientRect();
    const backgroundPoint = { x: referenceRect.left - 35, y: referenceRect.top + referenceRect.height / 2 };
    for (const [zoom, delta] of [[110, -100], [100, 100], [90, 100]]) {
        check(!document.elementFromPoint(backgroundPoint.x, backgroundPoint.y)?.closest('[data-pdf-page-index]'), 'The pointer must remain over the page background');
        await anchored('background wheel uses viewport center at ' + zoom,
            () => ctrlWheelAt(backgroundPoint, delta), zoom, center(), 12, true, referenceCanvas);
    }
    for (const minimumZoom of [10, 20, 30]) {
        for (const pointerRatio of [0.7, 0.85]) {
            root.render(<Fixture fit key={'restore-small-' + minimumZoom + '-' + pointerRatio} />);
            await frames(3);
            const node = viewport();
            const viewportRect = node.getBoundingClientRect();
            const point = { x: viewportRect.left + node.clientWidth * pointerRatio, y: viewportRect.top + node.clientHeight * pointerRatio };
            const canvas = node.querySelector('.viewer-pdf-canvas');
            let frameCount = 0;
            let minVisibleFraction = 1;
            let maxCenterDrift = 0;
            let restoredPointerDrift = null;
            const label = 'restore ' + minimumZoom + ' to 150 with fixed viewport pointer at ' + pointerRatio;
            const wheelAndObserve = async (delta, expectedZoom) => {
                ctrlWheelAt(point, delta);
                for (let frame = 0; frame < 4; frame += 1) {
                    await nextFrame();
                    const rect = canvas.getBoundingClientRect();
                    const vr = node.getBoundingClientRect();
                    const visibleWidth = Math.max(0, Math.min(rect.right, vr.left + node.clientWidth) - Math.max(rect.left, vr.left));
                    const visibleHeight = Math.max(0, Math.min(rect.bottom, vr.top + node.clientHeight) - Math.max(rect.top, vr.top));
                    check(visibleWidth > 1 && visibleHeight > 1, label + ': the page disappeared at zoom ' + node.dataset.zoom);
                    minVisibleFraction = Math.min(minVisibleFraction, visibleWidth * visibleHeight / (rect.width * rect.height));
                    frameCount += 1;
                }
                check(Number(node.dataset.zoom) === expectedZoom, label + ': each wheel must apply one zoom step');
                if (expectedZoom <= 100) {
                    const rect = canvas.getBoundingClientRect();
                    const midpoint = center();
                    maxCenterDrift = Math.max(maxCenterDrift,
                        Math.abs(rect.left + rect.width / 2 - midpoint.x), Math.abs(rect.top + rect.height / 2 - midpoint.y));
                    check(maxCenterDrift <= 1.25, label + ': the reduced page must remain centered');
                }
            };
            for (let zoom = 90; zoom >= minimumZoom; zoom -= 10) await wheelAndObserve(100, zoom);
            const reduced = canvas.getBoundingClientRect();
            check(point.x > reduced.right && point.y > reduced.bottom, 'The fixed pointer must lie outside the reduced page');
            for (let zoom = minimumZoom + 10; zoom <= 150; zoom += 10) {
                const before = canvas.getBoundingClientRect();
                await wheelAndObserve(-100, zoom);
                if (zoom === 110 && pointerRatio === 0.7) {
                    check(point.x >= before.left && point.x <= before.right && point.y >= before.top && point.y <= before.bottom,
                        'The pointer must lie inside the restored 100 percent page');
                    const after = canvas.getBoundingClientRect();
                    restoredPointerDrift = Math.max(
                        Math.abs(after.left + (point.x - before.left) / before.width * after.width - point.x),
                        Math.abs(after.top + (point.y - before.top) / before.height * after.height - point.y));
                    check(restoredPointerDrift <= 1.25, label + ': 100 to 110 must resume pointer anchoring inside the page');
                }
            }
            measurements.push({ label, zoom: 150, frameCount, minVisibleFraction, maxCenterDrift, restoredPointerDrift });
        }
    }
    for (const { interval, ambient = false } of [{ interval: 32 }, { interval: 48 }, { interval: 64 }, { interval: 48, ambient: true }]) {
        root.render(<Fixture fit ambient={ambient} key={'rapid-' + interval + '-' + ambient} />);
        await frames(3);
        const canvas = document.querySelector('.viewer-pdf-canvas');
        const start = canvas.getBoundingClientRect();
        const point = { x: start.left + start.width * 0.7, y: start.top + start.height * 0.7 };
        let sent = 0;
        let timer;
        let frameCount = 0;
        let maxFrameDrift = 0;
        const steps = ambient ? 12 : 6;
        const startedAt = performance.now();
        const wheel = () => {
            ctrlWheelAt(point, -100);
            sent += 1;
            if (sent < steps) timer = setTimeout(wheel, interval);
        };
        try {
            wheel();
            while (performance.now() - startedAt < interval * steps + 300) {
                await nextFrame();
                const rect = canvas.getBoundingClientRect();
                maxFrameDrift = Math.max(maxFrameDrift,
                    Math.abs(rect.left + rect.width * 0.7 - point.x), Math.abs(rect.top + rect.height * 0.7 - point.y));
                frameCount += 1;
            }
            const expectedZoom = 100 + steps * 10;
            const label = 'rapid wheel every ' + interval + 'ms' + (ambient ? ' with scaled ambient overflow' : '');
            check(sent === steps && Number(viewport().dataset.zoom) === expectedZoom, 'Rapid wheel events must each apply exactly one zoom step');
            check(maxFrameDrift <= 1.25, label + ' jumps between frames; peak drift ' + maxFrameDrift);
            measurements.push({ label, zoom: expectedZoom, frameCount, maxFrameDrift });
        } finally {
            clearTimeout(timer);
        }
    }
    const detachedViewport = viewport();
    root.unmount();
    const detachedWheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, cancelable: true });
    check(detachedViewport.dispatchEvent(detachedWheel) && !detachedWheel.defaultPrevented, 'Unmount must remove the native content wheel listener');
    return measurements;
})();
`;
        await build({ stdin: { contents: renderer, loader: 'jsx', resolveDir: process.cwd() }, bundle: true, outfile: path.join(directory, 'renderer.js'), logLevel: 'silent' });
        await fs.writeFile(path.join(directory, 'index.html'), `
<style>
body { margin: 0; }
.fixture-toolbar { position: absolute; left: 20px; top: 10px; }
.fixture-viewport { position: absolute; left: 120px; top: 130px; width: 600px; height: 400px; overflow: auto; overflow-anchor: none; }
.fixture-document { display: flex; flex-direction: column; gap: 40px; padding: 80px; width: 2400px; }
.fixture-document section { flex: 0 0 auto; width: 2400px; }
.fixture-document.is-fit { width: max-content; min-width: 100%; height: max-content; min-height: 100%; padding: 0; gap: 0; align-items: center; justify-content: center; }
.fixture-document.is-ambient { width: 100%; }
.fixture-document.is-ambient section { position: relative; }
.viewer-pdf-canvas { display: block; background: #d0dce8; }
${offsetRule}
${ambientRule}
</style><div id="root"></div><script src="renderer.js"></script>`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('ZOOM_ANCHOR_RESULT=' + JSON.stringify(result) + '\\n');
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
            const timer = setTimeout(() => { child.kill(); reject(new Error('Zoom anchor test timed out: ' + output)); }, 35000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/ZOOM_ANCHOR_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const measurements = JSON.parse(payload);
        assert.equal(measurements.length, 42);
        for (const measurement of measurements) t.diagnostic(JSON.stringify(measurement));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
