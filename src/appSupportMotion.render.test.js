import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('지원 버튼의 hover 효과는 한 번 재생되고 모션 설정과 기존 클릭·툴팁 동작을 따른다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-support-motion-'));
    try {
        const renderer = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppSupportActions } from './src/components/AppSupportActions.jsx';
import { TooltipLayer } from './src/components/TooltipLayer.jsx';
import { applyMotionPreference, initializeMotionPreference } from './src/motionPolicy.js';
import { translate } from './src/utils/i18n.js';
import { GITHUB_URL, SPONSOR_URL } from './src/appShell.js';
import './src/styles/global.css';
import './src/styles/App.css';
initializeMotionPreference();
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const t = key => translate(key, 'ko');
const external = [];
const starts = [];
window.electronAPI = { openExternal: async (url, options) => { external.push({ url, options }); } };
document.addEventListener('animationstart', event => {
    if (event.animationName.startsWith('app-support-')) {
        starts.push({ name: event.animationName, button: event.target.closest('.app-support-button')?.className, time: performance.now() });
    }
});
createRoot(document.getElementById('root')).render(<>
    <button id="keyboard-start" style={{ position: 'fixed', left: -1000 }}>Keyboard start</button>
    <div style={{ height: 72 }} />
    <div className="tab-bar-row">
        <div className="tab-bar-container"><span className="tab-item active">폴더</span><span className="tab-item">메타데이터 관리</span></div>
        <AppSupportActions t={t} />
    </div>
    <TooltipLayer />
</>);
const button = kind => document.querySelector('.app-support-' + kind);
const styles = kind => {
    const target = button(kind);
    const icon = target.querySelector('.app-support-button-icon');
    const visual = target.querySelector('.app-support-button-visual');
    const burst = target.querySelector('.app-support-button-burst');
    return { target, icon: getComputedStyle(icon), ring: getComputedStyle(visual, '::before'), particles: [getComputedStyle(burst, '::before'), getComputedStyle(burst, '::after')] };
};
window.supportMotion = {
    ready: (async () => { while (!button('sponsor')) await frame(); await frame(); })(),
    point(kind) {
        const rect = button(kind).getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    },
    async apply(preference) { applyMotionPreference(preference); await frame(); await frame(); },
    async fontScale(value) { document.documentElement.style.setProperty('--font-scale', value); await frame(); },
    mugSize() {
        const rect = button('sponsor').querySelector('.app-support-mug').getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    },
    paintFrame() {
        const rect = button('sponsor').querySelector('.app-support-mug').getBoundingClientRect();
        const start = starts.findLast(event => event.name === 'app-support-icon-pop' && event.button?.includes('app-support-sponsor'));
        return {
            region: { x: Math.floor(rect.x) - 2, y: Math.floor(rect.y) - 2, width: Math.ceil(rect.width) + 4, height: Math.ceil(rect.height) + 4 },
            elapsed: performance.now() - start.time,
            devicePixelRatio,
            transform: styles('sponsor').icon.transform,
            ...this.mugSize(),
        };
    },
    async paintBounds(dataUrl) {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        const bounds = { left: canvas.width, top: canvas.height, right: -1, bottom: -1 };
        let pixels = 0;
        for (let y = 0; y < canvas.height; y += 1) {
            for (let x = 0; x < canvas.width; x += 1) {
                const offset = (y * canvas.width + x) * 4;
                const [red, green, blue] = data.slice(offset, offset + 3);
                if (red <= 130 || red <= green * 1.15 || red <= blue * 1.15) continue;
                bounds.left = Math.min(bounds.left, x);
                bounds.top = Math.min(bounds.top, y);
                bounds.right = Math.max(bounds.right, x);
                bounds.bottom = Math.max(bounds.bottom, y);
                pixels += 1;
            }
        }
        check(pixels > 50, 'Sponsor painted pixels missing: ' + pixels);
        return { bounds, pixels };
    },
    async verifySettlement(original) {
        const animation = button('sponsor').querySelector('.app-support-button-icon').getAnimations()
            .find(value => value.animationName === 'app-support-icon-pop');
        check(animation, 'Sponsor pop animation missing');
        animation.pause();
        await animation.ready;
        const duration = Number(animation.effect.getTiming().duration);
        const samples = [];
        for (const progress of [0.4, 0.46, 0.52, 0.58, 0.64, 0.72, 0.85, 1]) {
            animation.currentTime = duration * progress;
            await frame();
            samples.push({ progress, ...this.mugSize(), transform: styles('sponsor').icon.transform, playState: animation.playState });
        }
        check(samples[0].width > original.width, 'Sponsor peak must enlarge the original icon: ' + JSON.stringify({ original, samples }));
        samples.forEach((sample, index) => {
            check(sample.width >= original.width - 0.02 && sample.height >= original.height - 0.02,
                'Sponsor shrank below its original size while settling: ' + JSON.stringify({ original, sample }));
            if (index > 0) check(sample.width <= samples[index - 1].width + 0.02 && sample.height <= samples[index - 1].height + 0.02,
                'Sponsor enlarged again after its peak: ' + JSON.stringify(samples));
        });
        animation.finish();
        this.verifyMugSize(original, 'finished hover');
        animation.cancel();
        return samples;
    },
    verifyMugSize(original, phase) {
        const actual = this.mugSize();
        check(Math.abs(actual.width - original.width) < 0.02 && Math.abs(actual.height - original.height) < 0.02,
            'Sponsor size changed after ' + phase + ': ' + JSON.stringify({ original, actual }));
        return actual;
    },
    async verify(kind, reduced) {
        await frame();
        const value = styles(kind);
        check(value.target.matches(':hover') || value.target.matches(':focus-visible'), kind + ': actual hover or keyboard focus missing');
        const expected = ['app-support-icon-pop', 'app-support-ring-burst', 'app-support-particle-burst', 'app-support-particle-burst'];
        [value.icon, value.ring, ...value.particles].forEach((style, index) => {
            check(style.animationName === (reduced ? 'none' : expected[index]), kind + ': incorrect animation ' + index + ': ' + style.animationName);
            if (!reduced) check(style.animationIterationCount === '1', kind + ': decorative animation must run only once');
        });
        if (reduced) this.verifyStatic(kind);
        return document.documentElement.dataset.motion;
    },
    verifyStatic(kind) {
        const value = styles(kind);
        check(value.icon.transform === 'none' || value.icon.transform === 'matrix(1, 0, 0, 1, 0, 0)', kind + ': icon remains transformed');
        check(value.ring.opacity === '0' && value.particles.every(style => style.opacity === '0'), kind + ': decorative residue remains visible');
        check(value.target.getAnimations({ subtree: true }).filter(animation => animation.animationName?.startsWith('app-support-')).every(animation => animation.playState === 'finished'), kind + ': decorative animation remains active');
    },
    count(kind) { return starts.filter(event => event.button?.includes('app-support-' + kind)).length; },
    verifyTooltip(kind) {
        const tooltip = document.querySelector('[role="tooltip"]');
        check(tooltip?.textContent === t(kind === 'star' ? 'support.github' : 'support.sponsor'), kind + ': tooltip missing or changed');
        check(button(kind).getAttribute('aria-describedby')?.split(' ').includes(tooltip.id), kind + ': tooltip description missing');
    },
    verifyExcluded(kind) {
        check(!button(kind).querySelector('.app-support-button-visual, .app-support-button-burst'), kind + ': unrelated button received burst markup');
        check(button(kind).getAnimations({ subtree: true }).every(animation => !animation.animationName?.startsWith('app-support-')), kind + ': unrelated button animated');
    },
    prepareKeyboard() { document.getElementById('keyboard-start').focus(); },
    blur() { document.activeElement?.blur(); },
    verifyDialog() { check(document.querySelector('.app-support-dialog-layer.is-open'), 'GitHub click did not open its dialog'); },
    async closeDialog() { document.querySelector('.app-support-dialog-close').click(); await frame(); },
    verifyExternal(kind) { check(external.at(-1)?.url === (kind === 'star' ? GITHUB_URL : SPONSOR_URL), kind + ': external URL behavior changed'); },
    async followGithub() { document.querySelector('.app-support-dialog-link').click(); await frame(); },
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
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 760, height: 300, webPreferences: { backgroundThrottling: false } });
    const run = async expression => {
        const result = await window.webContents.executeJavaScript('(async () => { try { return { value: await window.supportMotion.' + expression + ' }; } catch (error) { return { error: String(error.stack || error) }; } })()');
        if (result.error) throw new Error(result.error);
        return result.value;
    };
    const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const move = async kind => {
        const point = kind ? await run('point(' + JSON.stringify(kind) + ')') : { x: 20, y: 250 };
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
        await pause(35);
    };
    const click = async kind => {
        const point = await run('point(' + JSON.stringify(kind) + ')');
        window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
        window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
        await pause(35);
    };
    const key = async keyCode => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await pause(35);
    };
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        await run('ready');
        window.webContents.focus();
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 760, height: 300, deviceScaleFactor: 2, mobile: false });
        const emulate = reduced => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
        const modes = [];
        for (const systemReduced of [false, true]) {
            await emulate(systemReduced);
            for (const preference of ['system', 'full', 'reduced']) {
                await move(null);
                await run('apply(' + JSON.stringify(preference) + ')');
                const reduced = preference === 'reduced' || preference === 'system' && systemReduced;
                for (const kind of ['star', 'sponsor']) {
                    await move(kind);
                    const actual = await run('verify(' + JSON.stringify(kind) + ', ' + reduced + ')');
                    if (actual !== (reduced ? 'reduced' : 'full')) throw new Error('Effective motion preference mismatch');
                    await run('verifyTooltip(' + JSON.stringify(kind) + ')');
                    await move(null);
                }
                modes.push({ systemReduced, preference, reduced });
            }
        }
        await run('apply("full")');
        const screenshots = [];
        for (const kind of ['star', 'sponsor']) {
            const before = await run('count(' + JSON.stringify(kind) + ')');
            await move(kind);
            await pause(265);
            await run('verify(' + JSON.stringify(kind) + ', false)');
            const filename = '/private/tmp/bookmanager-support-' + kind + '-burst.png';
            fs.writeFileSync(filename, (await window.webContents.capturePage()).toPNG());
            screenshots.push(filename);
            await pause(1000);
            await run('verifyStatic(' + JSON.stringify(kind) + ')');
            const ended = await run('count(' + JSON.stringify(kind) + ')');
            if (ended - before !== 4) throw new Error(kind + ': hover did not start exactly four one-shot effects: ' + (ended - before));
            await pause(120);
            if (await run('count(' + JSON.stringify(kind) + ')') !== ended) throw new Error(kind + ': continuous hover restarted the burst');
            await move(null);
            await move(kind);
            await run('verify(' + JSON.stringify(kind) + ', false)');
            if (await run('count(' + JSON.stringify(kind) + ')') !== ended + 4) throw new Error(kind + ': re-enter did not restart the burst');
            await pause(150);
            await run('apply("reduced")');
            await run('verify(' + JSON.stringify(kind) + ', true)');
            await move(null);
            await run('apply("full")');
        }
        await run('fontScale(1.05)');
        await move('sponsor');
        const painted = [];
        for (const target of [700, 1100]) {
            let frame = await run('paintFrame()');
            while (frame.elapsed < target) {
                await pause(target - frame.elapsed);
                frame = await run('paintFrame()');
            }
            if (target === 700 && frame.elapsed >= 850) throw new Error('Sponsor paint sample missed the running animation: ' + frame.elapsed);
            const capture = await window.webContents.capturePage(frame.region);
            const filename = '/private/tmp/bookmanager-support-sponsor-paint-' + target + '.png';
            fs.writeFileSync(filename, capture.toPNG());
            screenshots.push(filename);
            const paint = await run('paintBounds(' + JSON.stringify(capture.toDataURL()) + ')');
            painted.push({ ...frame, ...paint });
        }
        if (JSON.stringify(painted[0].region) !== JSON.stringify(painted[1].region)
            || JSON.stringify(painted[0].bounds) !== JSON.stringify(painted[1].bounds)) {
            throw new Error('Sponsor painted size or position changed when its animation ended: ' + JSON.stringify(painted));
        }
        await move(null);
        const settlement = [];
        for (const fontScale of [1, 1.05, 1.25]) {
            await run('fontScale(' + fontScale + ')');
            const original = await run('mugSize()');
            await move('sponsor');
            const samples = await run('verifySettlement(' + JSON.stringify(original) + ')');
            await move(null);
            const afterLeave = await run('verifyMugSize(' + JSON.stringify(original) + ', "pointer leave")');
            settlement.push({ fontScale, original, samples, afterLeave });
        }
        await run('fontScale(1)');
        for (const kind of ['apple', 'android']) {
            await move(kind);
            await run('verifyExcluded(' + JSON.stringify(kind) + ')');
        }
        await move(null);
        await run('prepareKeyboard()');
        for (const kind of ['star', 'sponsor']) {
            await key('Tab');
            await run('verify(' + JSON.stringify(kind) + ', false)');
        }
        await run('blur()');
        await move('star');
        await click('star');
        await run('verifyDialog()');
        await run('followGithub()');
        await run('verifyExternal("star")');
        await move('sponsor');
        await click('sponsor');
        await run('verifyExternal("sponsor")');
        await run('apply("reduced")');
        await run('verify("sponsor", true)');
        const staticFilename = '/private/tmp/bookmanager-support-static.png';
        fs.writeFileSync(staticFilename, (await window.webContents.capturePage()).toPNG());
        screenshots.push(staticFilename);
        process.stdout.write('SUPPORT_MOTION_RESULT=' + JSON.stringify({ modes, screenshots, settlement, painted, gpu: app.getGPUFeatureStatus(), oneShot: true, replay: true, runtimeReduced: true, keyboardFocus: true, clicks: true, tooltips: true }) + '\\n');
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
            const timer = setTimeout(() => { child.kill(); reject(new Error('Support motion test timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const report = JSON.parse(result.output.match(/SUPPORT_MOTION_RESULT=(.+)/)?.[1] || 'null');
        assert.equal(report?.modes.length, 6);
        assert.deepEqual(report.settlement.map(value => value.fontScale), [1, 1.05, 1.25]);
        assert.deepEqual(report.painted.map(value => value.devicePixelRatio), [2, 2]);
        assert.equal(report.gpu.gpu_compositing, 'enabled', 'GPU compositing must be enabled for the paint regression');
        assert.ok(report.oneShot && report.replay && report.runtimeReduced && report.keyboardFocus && report.clicks && report.tooltips);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
