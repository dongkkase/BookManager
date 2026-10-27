import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('표지 확대 전환과 포인터 기울기는 모달 조작, 원본 로드와 동작 줄이기를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-preview-motion-'));
    try {
        const renderer = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CoverPreviewDialog } from './src/components/folder/CoverPreviewDialog.jsx';
import { applyMotionPreference, initializeMotionPreference } from './src/motionPolicy.js';
import './src/styles/global.css';
import './src/styles/FolderTab.css';
initializeMotionPreference();
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const frames = async () => { await frame(); await frame(); };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, message) {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const cover = (size, ratio = 1.4) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + (size * ratio) + '"><rect width="100%" height="100%" fill="#36536c"/><rect x="20%" y="20%" width="60%" height="60%" fill="#d6c79d"/></svg>');
const thumbnail = cover(150);
const original = cover(900);
const squareThumbnail = cover(150, 1);
let loadMode = 'deferred';
let pendingCover;
let closeCount = 0;
let hidePreview;
let setCoverRatio;
const requests = [];
const errors = [];
window.addEventListener('error', event => errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
window.electronAPI = {
    loadMetadataCover(filePath) {
        requests.push(filePath);
        if (loadMode === 'reject') return Promise.reject(new Error('Fixture original cover unavailable'));
        if (loadMode === 'deferred') return new Promise(resolve => { pendingCover = resolve; });
        return Promise.resolve(original);
    },
};
const t = key => ({ cover_preview: '표지 크게 보기', btn_close: '닫기', no_image: '이미지 없음' })[key] || key;
function Fixture() {
    const [visible, setVisible] = useState(false);
    const [ratio, setRatio] = useState(1.4);
    const sourceRef = useRef(null);
    hidePreview = () => setVisible(false);
    setCoverRatio = setRatio;
    const src = ratio === 1 ? squareThumbnail : thumbnail;
    return <>
        <div style={{ position: 'fixed', left: 48, top: 90, width: 150, height: 150 * ratio }}>
            <img id="source-cover" ref={sourceRef} src={src} alt="테스트 표지" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
            <button id="preview-trigger" type="button" aria-haspopup="dialog" aria-label="표지 크게 보기"
                style={{ position: 'absolute', inset: 0, background: 'transparent', border: 0 }}
                onClick={event => { event.currentTarget.focus(); setVisible(true); }} />
        </div>
        {visible && <CoverPreviewDialog src={src} sourceElement={sourceRef.current} filePath="/fixture/cover.epub" alt="테스트 표지" t={t}
            onClose={() => { closeCount += 1; setVisible(false); }} />}
    </>;
}
const root = createRoot(document.getElementById('root'));
root.render(<Fixture />);
const dialog = () => document.querySelector('.detail-cover-preview-dialog');
const image = () => dialog()?.querySelector('.detail-cover-preview-image');
const body = () => dialog()?.querySelector('.detail-cover-preview-body');
const tilt = () => dialog()?.querySelector('.detail-cover-preview-tilt');
const trigger = () => document.getElementById('preview-trigger');
const bounds = element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
};
const near = (actual, expected, tolerance = 2) => Math.abs(actual - expected) <= tolerance;
const sameBounds = (actual, expected) => ['left', 'top', 'width', 'height'].every(key => near(actual[key], expected[key]));
const tiltMatrix = () => new DOMMatrixReadOnly(getComputedStyle(tilt()).transform);
const isTilted = () => Math.abs(tiltMatrix().m13) + Math.abs(tiltMatrix().m23) > 0.01;
const isNeutral = () => {
    const matrix = tiltMatrix();
    return Math.abs(matrix.m13) + Math.abs(matrix.m23) < 0.0005
        && near(matrix.m11, 1, 0.001) && near(matrix.m22, 1, 0.001);
};
async function apply(preference) { applyMotionPreference(preference); await frames(); }
async function open(preference = 'full', settle = true) {
    await apply(preference);
    trigger().click();
    await until(() => dialog()?.open && image()?.complete, 'The cover preview did not open');
    check(dialog().parentElement === document.body && dialog().matches(':modal'), 'The cover preview must retain native modal isolation');
    check(dialog().contains(document.activeElement), 'Opening the preview must focus its close control');
    if (settle) await until(() => dialog()?.dataset.phase === 'open', 'The cover preview did not settle');
    return dialog();
}
async function closed(expectedCount) {
    await until(() => !dialog(), 'Closing the preview left its dialog mounted');
    await frames();
    check(document.activeElement === trigger(), 'Closing the preview must restore trigger focus');
    check(closeCount === expectedCount, 'Closing the preview must notify its parent exactly once: ' + closeCount + '/' + expectedCount);
}
function point(pointerType = 'mouse') {
    const rect = body().getBoundingClientRect();
    const values = { bubbles: true, cancelable: true, pointerId: pointerType === 'mouse' ? 1 : 2, pointerType, isPrimary: true,
        clientX: rect.left + rect.width * 0.85, clientY: rect.top + rect.height * 0.2 };
    image().dispatchEvent(new PointerEvent('pointerover', { ...values, relatedTarget: document.body }));
    image().dispatchEvent(new PointerEvent('pointermove', values));
}
function leave() {
    image().dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', pointerId: 1, relatedTarget: document.body }));
}
async function neutral(message) { await until(isNeutral, message); }
function assertStatic(label) {
    const rect = bounds(image());
    const layout = bounds(body());
    check(dialog().dataset.phase === 'open' && sameBounds(rect, layout) && isNeutral(), label + ': reduced motion must show the settled cover immediately: '
        + JSON.stringify({ phase: dialog().dataset.phase, rect, layout, tilt: getComputedStyle(tilt()).transform,
            transition: getComputedStyle(dialog().querySelector('.detail-cover-preview-transition')).transform }));
    check(dialog().getAnimations({ subtree: true }).every(animation => animation.playState !== 'running'), label + ': reduced motion left a running animation');
}
const results = [];
window.coverMotion = {
    ready: (async () => {
        await until(() => document.getElementById('source-cover')?.complete && trigger(), 'The fixture thumbnail did not load');
        await frames();
    })(),
    async verifyEntranceAndTilt() {
        const source = bounds(document.getElementById('source-cover'));
        await open('full', false);
        const start = bounds(image());
        const target = bounds(body());
        check(dialog().dataset.phase === 'opening', 'Full motion must animate the opening transition');
        check(start.width < target.width * 0.8 && Math.abs(start.left - source.left) < Math.abs(target.left - source.left),
            'The cover must start near its thumbnail before enlarging: ' + JSON.stringify({ source, start, target }));
        check(requests.at(-1) === '/fixture/cover.epub', 'The preview must load the selected original cover');
        pendingCover(original);
        await until(() => image()?.naturalWidth === 900, 'The full-resolution cover did not replace the thumbnail');
        check(sameBounds(bounds(body()), target), 'Loading the original cover must not move or resize the preview layout');
        await until(() => dialog()?.dataset.phase === 'open', 'The entrance animation did not complete');
        const settled = bounds(image());
        check(sameBounds(settled, target) && settled.width > source.width, 'The entrance must settle at the enlarged layout');
        check(settled.left >= 0 && settled.top >= 0 && settled.right <= innerWidth && settled.bottom <= innerHeight, 'The enlarged cover must fit inside the viewport');
        check(getComputedStyle(image()).objectFit === 'contain', 'The enlarged cover must preserve the full artwork');
        const ambient = dialog().querySelector('.detail-cover-preview-ambient');
        check(ambient?.getAttribute('aria-hidden') === 'true' && getComputedStyle(ambient).pointerEvents === 'none', 'Ambient decoration must remain inaccessible and ignore pointer input');
        check(!tilt().contains(dialog().querySelector('.detail-cover-preview-close')), 'The close control must remain outside the tilting cover');
        const closeBounds = bounds(dialog().querySelector('.detail-cover-preview-close'));
        image().click();
        await frames();
        check(dialog()?.open, 'Clicking the cover must not close the preview');
        for (const [pointerType, reset] of [['mouse', 'leave'], ['pen', 'cancel'], ['mouse', 'blur']]) {
            point(pointerType);
            await until(isTilted, pointerType + ': pointer movement did not tilt the cover');
            check(sameBounds(bounds(dialog().querySelector('.detail-cover-preview-close')), closeBounds), 'Tilting the cover moved its close control');
            if (reset === 'leave') leave();
            else if (reset === 'cancel') image().dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType, pointerId: 2 }));
            else window.dispatchEvent(new Event('blur'));
            await neutral(reset + ': the cover did not return to its neutral pose');
        }
        point('touch');
        await pause(180);
        check(isNeutral(), 'Touch input must not tilt the cover');
        const expected = closeCount + 1;
        const current = dialog();
        current.querySelector('.detail-cover-preview-close').click();
        await until(() => current.dataset.phase === 'closing', 'Full motion must animate the exit');
        check(current.open && current.matches(':modal'), 'The native dialog must remain modal until exit finishes');
        current.dispatchEvent(new Event('cancel', { cancelable: true }));
        current.click();
        current.querySelector('.detail-cover-preview-close').click();
        await closed(expected);
        results.push('entrance geometry', 'original cover stability', 'mouse and pen tilt', 'pointer reset', 'touch suppression', 'idempotent close');
        loadMode = 'original';
    },
    async openForEscape() { await open(); return closeCount + 1; },
    async verifyEscapeClosed(expected) { await closed(expected); results.push('native Escape and focus'); },
    async prepareCapture() { await open(); await frames(); },
    async prepareTiltCapture() { point(); await pause(300); },
    async finishCapture() {
        const expected = closeCount + 1;
        dialog().querySelector('.detail-cover-preview-close').click();
        await closed(expected);
    },
    async verifyInterruptedMotion() {
        let expected = closeCount + 1;
        await open('full', false);
        dialog().querySelector('.detail-cover-preview-close').click();
        await closed(expected);
        results.push('close during entrance');

        await open('full', false);
        await apply('reduced');
        assertStatic('Entrance interruption');
        point();
        await frames();
        assertStatic('Reduced pointer movement');
        expected = closeCount + 1;
        dialog().click();
        await frames();
        check(!dialog(), 'Reduced backdrop close must complete immediately');
        await closed(expected);

        await open();
        point();
        await until(isTilted, 'The cover did not tilt before the reduced preference change');
        await apply('reduced');
        assertStatic('Tilt interruption');
        await apply('full');
        point('pen');
        await until(isTilted, 'Restoring full motion must re-enable pointer tilt');
        expected = closeCount + 1;
        dialog().querySelector('.detail-cover-preview-close').click();
        await until(() => dialog()?.dataset.phase === 'closing', 'The exit did not start before reducing motion');
        await apply('reduced');
        check(!dialog(), 'Reducing motion during exit must remove the dialog immediately');
        await closed(expected);
        results.push('runtime reduced entrance', 'runtime reduced tilt', 'runtime reduced exit', 'motion re-enabled');

        await open('reduced');
        assertStatic('Initial reduced preference');
        expected = closeCount + 1;
        dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
        await closed(expected);
    },
    async verifyFailuresAndUnmount() {
        loadMode = 'reject';
        await open('reduced');
        await frames();
        check(image()?.src === thumbnail && image()?.naturalWidth === 150, 'A rejected original load must retain the available thumbnail');
        let expected = closeCount + 1;
        dialog().querySelector('.detail-cover-preview-close').click();
        await closed(expected);

        loadMode = 'deferred';
        await open('full', false);
        const removedDialog = dialog();
        const count = closeCount;
        hidePreview();
        await until(() => !dialog(), 'Unmounting during entrance must remove the dialog');
        check(!removedDialog.open && document.activeElement === trigger(), 'Unmounting must close the native modal and restore trigger focus');
        loadMode = 'original';
        await open();
        pendingCover(original);
        await pause(600);
        check(!removedDialog.open && dialog()?.open, 'Stale animation and load callbacks must not affect a reopened preview');
        check(closeCount === count, 'An unmounted entrance must not issue a stale close callback');
        expected = closeCount + 1;
        dialog().querySelector('.detail-cover-preview-close').click();
        await closed(expected);
        check(errors.length === 0, 'Preview lifecycle raised runtime errors: ' + errors.join('; '));
        results.push('original load rejection', 'unmount cleanup', 'reopen after unmount');

        loadMode = 'reject';
        setCoverRatio(1);
        await until(() => document.getElementById('source-cover')?.naturalHeight === 150, 'The square thumbnail did not load');
        await open();
        const square = bounds(image());
        const close = bounds(dialog().querySelector('.detail-cover-preview-close'));
        check(near(square.width, square.height) && square.width > 150, 'An audiobook cover must retain its square aspect ratio');
        check(square.left >= 0 && square.top >= 0 && square.right <= innerWidth && square.bottom <= innerHeight
            && close.right <= innerWidth && close.top >= 0, 'The enlarged square cover and close control must fit in the viewport');
        expected = closeCount + 1;
        dialog().querySelector('.detail-cover-preview-close').click();
        await closed(expected);
        results.push('square cover viewport fit');
        root.unmount();
        return { results, requests: requests.length, closeCount };
    },
};
`;
        await build({
            stdin: { contents: renderer, loader: 'jsx', resolveDir: projectRoot },
            bundle: true,
            outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file', '.svg': 'file', '.png': 'file' },
            logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    const run = async expression => {
        const result = await window.webContents.executeJavaScript('(async () => { try { return { value: await window.coverMotion.' + expression + ' }; } catch (error) { return { error: String(error.stack || error) }; } })()');
        if (result.error) throw new Error(result.error);
        return result.value;
    };
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        window.webContents.focus();
        await run('ready');
        await run('verifyEntranceAndTilt()');
        const expected = await run('openForEscape()');
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await run('verifyEscapeClosed(' + expected + ')');
        await run('verifyInterruptedMotion()');
        if (${JSON.stringify(Boolean(process.env.BOOKMANAGER_COVER_SCREENSHOT))}) {
            await run('prepareCapture()');
            fs.writeFileSync('/private/tmp/bookmanager-cover-motion-rest.png', (await window.webContents.capturePage()).toPNG());
            await run('prepareTiltCapture()');
            fs.writeFileSync('/private/tmp/bookmanager-cover-motion-tilt.png', (await window.webContents.capturePage()).toPNG());
            await run('finishCapture()');
        }
        const report = await run('verifyFailuresAndUnmount()');
        process.stdout.write('COVER_PREVIEW_MOTION_RESULT=' + JSON.stringify(report) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('Cover preview motion test timed out: ' + output)); }, 45000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const report = JSON.parse(result.output.match(/COVER_PREVIEW_MOTION_RESULT=(.+)/)?.[1] || 'null');
        assert.equal(report?.results.length, 16);
        const captureCount = process.env.BOOKMANAGER_COVER_SCREENSHOT ? 1 : 0;
        assert.equal(report.requests, 10 + captureCount);
        assert.equal(report.closeCount, 9 + captureCount);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
