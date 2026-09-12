import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('몰입형 PDF 전환은 레이어 바깥의 흐린 배경을 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-pdf-transition-ambient-'));
    try {
        await fs.copyFile(new URL('./styles/viewer.css', import.meta.url), path.join(directory, 'viewer.css'));
        await fs.writeFile(path.join(directory, 'index.html'), `
<link rel="stylesheet" href="viewer.css">
<style>body { margin: 0; } .viewer-app { width: 900px; height: 650px; } .viewer-content { overflow: hidden; }</style>
<div class="viewer-app is-background-immersive"><main class="viewer-content"></main></div>
<script>
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 3) { for (let index = 0; index < count; index += 1) await frame(); }
const viewport = document.querySelector('.viewer-content');
function page(color) {
    const section = document.createElement('section');
    section.className = 'viewer-pdf-page';
    const wrap = document.createElement('div');
    wrap.className = 'viewer-pdf-canvas-wrap is-ready';
    Object.assign(wrap.style, { width: '210px', minHeight: '310px' });
    const ambient = document.createElement('canvas');
    ambient.className = 'viewer-ambient-canvas';
    ambient.width = 28;
    ambient.height = 40;
    ambient.getContext('2d').fillStyle = color;
    ambient.getContext('2d').fillRect(0, 0, 28, 40);
    const canvas = document.createElement('canvas');
    canvas.className = 'viewer-pdf-canvas';
    canvas.width = 210;
    canvas.height = 310;
    Object.assign(canvas.style, { width: '210px', height: '310px' });
    canvas.getContext('2d').fillStyle = '#f4f4f4';
    canvas.getContext('2d').fillRect(0, 0, 210, 310);
    wrap.append(ambient, canvas);
    section.append(wrap);
    return section;
}
function mount(flow, effect, direction) {
    const stage = document.createElement('div');
    stage.className = 'viewer-pdf-stage is-' + flow + ' has-page-effect is-animating effect-' + effect + ' effect-' + direction;
    stage.style.setProperty('--viewer-page-effect-duration', '1000ms');
    for (const [role, color] of [['outgoing', '#369aff'], ['incoming', '#3ae5ab']]) {
        const layer = document.createElement('div');
        layer.className = 'viewer-page-transition-layer is-' + role + (flow === 'spread' ? ' has-spread-pair' : '');
        if (flow === 'spread') {
            const pair = document.createElement('div');
            pair.className = 'viewer-spread-pair';
            pair.append(page(color), page(color));
            layer.append(pair);
        } else layer.append(page(color));
        stage.append(layer);
    }
    viewport.replaceChildren(stage);
    return stage;
}
function probePoints(stage) {
    const vr = viewport.getBoundingClientRect();
    const points = new Map();
    const pages = [...stage.querySelectorAll('.viewer-pdf-canvas')].map(canvas => canvas.getBoundingClientRect());
    const add = (x, y, boundary) => {
        x = Math.round(x);
        y = Math.round(y);
        if (x < vr.left + 2 || x >= vr.right - 2 || y < vr.top + 2 || y >= vr.bottom - 2) return;
        if (pages.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return;
        const key = x + ',' + y;
        const previous = points.get(key);
        points.set(key, { x, y, boundary: boundary || previous?.boundary || false });
    };
    for (const layer of stage.children) {
        const rect = layer.getBoundingClientRect();
        for (const ratio of [0.3, 0.5, 0.7]) {
            add(rect.left + rect.width * ratio, rect.top - 14, true);
            add(rect.left + rect.width * ratio, rect.bottom + 14, true);
            add(rect.left - 14, rect.top + rect.height * ratio, true);
            add(rect.right + 14, rect.top + rect.height * ratio, true);
        }
    }
    for (const rect of pages) {
        add(rect.left + rect.width / 2, rect.top - 35, false);
        add(rect.left + rect.width / 2, rect.bottom + 35, false);
    }
    check(points.size > 0, 'The fixture must expose blurred background outside the PDF pages');
    return [...points.values()];
}
const peakDifference = (first, second, points, boundaryOnly = false) => first.reduce((maximum, pixel, index) => {
    if (boundaryOnly && !points[index].boundary) return maximum;
    return Math.max(maximum, ...pixel.slice(0, 3).map((channel, channelIndex) => Math.abs(channel - second[index][channelIndex])));
}, 0);
window.testDone = (async () => {
    const measurements = [];
    let negativeControlPeak = 0;
    let boundaryProbeCount = 0;
    for (const flow of ['single', 'spread']) {
        for (const [effect, direction] of [['fade', 'next'], ['slide', 'next'], ['slide', 'previous']]) {
            const stage = mount(flow, effect, direction);
            await frames();
            const animations = stage.getAnimations({ subtree: true });
            check(animations.length === 2, 'Both transition layers must run the real CSS animations');
            animations.forEach(animation => animation.pause());
            for (const progress of [0, 0.5, 1]) {
                animations.forEach(animation => { animation.currentTime = progress * 1000; });
                await frames();
                const points = probePoints(stage);
                boundaryProbeCount += points.filter(point => point.boundary).length;
                const actual = await window.ambientFixture.sample(points);
                [...stage.children].forEach(layer => { layer.style.overflow = 'visible'; });
                await frames();
                const reference = await window.ambientFixture.sample(points);
                const difference = peakDifference(actual, reference, points);
                check(difference <= 3, [flow, effect, direction, progress].join('/') + ': the transition clipped the ambient blur; pixel difference ' + difference);
                let oldClippingDifference = 0;
                if (progress === 0.5) {
                    [...stage.children].forEach(layer => { layer.style.overflow = 'hidden'; });
                    await frames();
                    const clipped = await window.ambientFixture.sample(points);
                    oldClippingDifference = peakDifference(clipped, reference, points, true);
                    negativeControlPeak = Math.max(negativeControlPeak, oldClippingDifference);
                }
                [...stage.children].forEach(layer => { layer.style.removeProperty('overflow'); });
                await frames();
                measurements.push({ flow, effect, direction, progress, probeCount: points.length, difference, oldClippingDifference });
            }
        }
    }
    check(boundaryProbeCount > 0, 'Pixels must be sampled outside the transition layer boundaries');
    check(negativeControlPeak >= 10, 'The old overflow:hidden rule must visibly fail the same outside-boundary comparison');
    viewport.replaceChildren();
    return { measurements, negativeControlPeak, boundaryProbeCount };
})();
</script>`);
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ambientFixture', { sample: points => ipcRenderer.invoke('pdf-transition-ambient:sample', points) });
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 900, height: 650, useContentSize: true,
        webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    ipcMain.handle('pdf-transition-ambient:sample', async (_event, points) => {
        const image = await window.webContents.capturePage();
        const bitmap = image.toBitmap({ scaleFactor: 1 });
        const size = image.getSize(1);
        return points.map(point => {
            const offset = (point.y * size.width + point.x) * 4;
            return [...bitmap.subarray(offset, offset + 4)];
        });
    });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('PDF_TRANSITION_AMBIENT_RESULT=' + JSON.stringify(result) + '\\n');
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
            const timer = setTimeout(() => { child.kill(); reject(new Error('PDF transition ambient test timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/PDF_TRANSITION_AMBIENT_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const report = JSON.parse(payload);
        assert.equal(report.measurements.length, 18);
        assert.ok(report.negativeControlPeak >= 10);
        t.diagnostic(payload);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
