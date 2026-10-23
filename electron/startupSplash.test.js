import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { createStartupSplash, revealStartupMainWindow } from './startupSplash.js';

class FakeWindow extends EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.destroyed = false;
        this.opacity = 1;
        this.opacityHistory = [];
        this.shown = false;
        this.messages = [];
        this.webContents = new EventEmitter();
        this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
        this.webContents.send = (...args) => this.messages.push(args);
    }

    isDestroyed() { return this.destroyed; }
    loadFile(file) { this.file = file; return Promise.resolve(); }
    show() { this.shown = true; }
    showInactive() { this.show(); }
    setOpacity(value) { this.opacity = value; this.opacityHistory.push(value); }
    destroy() { this.destroyed = true; this.emit('closed'); }
}

function clock() {
    let now = 0;
    let id = 0;
    const tasks = new Map();
    return {
        now: () => now,
        timers: {
            setTimeout(callback, delay) { tasks.set(++id, { callback, at: now + delay }); return id; },
            clearTimeout(key) { tasks.delete(key); },
            setInterval(callback, delay) { tasks.set(++id, { callback, at: now + delay, interval: delay }); return id; },
            clearInterval(key) { tasks.delete(key); },
        },
        advance(delta) {
            const destination = now + delta;
            while (tasks.size) {
                const [key, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
                if (task.at > destination) break;
                now = task.at;
                if (task.interval) task.at += task.interval;
                else tasks.delete(key);
                task.callback();
            }
            now = destination;
        },
        pending: () => tasks.size,
    };
}

function fixture() {
    const timer = clock();
    const splash = createStartupSplash({ BrowserWindow: FakeWindow, ...timer });
    return { splash, timer, main: new FakeWindow() };
}

test('startup splash buffers real stages until its local renderer is loaded', async () => {
    const { splash, timer } = fixture();
    splash.update('loading');
    assert.equal(splash.window.messages.length, 0);
    splash.window.webContents.emit('did-finish-load');
    assert.deepEqual(splash.window.messages.at(-1), [
        'bookmanager:startup-stage', { label: '라이브러리를 준비하고 있습니다', value: 2 },
    ]);
    assert.deepEqual(splash.window.openHandler(), { action: 'deny' });
    let prevented = false;
    splash.window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    splash.window.emit('ready-to-show');
    assert.equal(await splash.ready, true);
    assert.equal(splash.window.shown, true);
    splash.destroy();
    assert.equal(timer.pending(), 0);
});

test('startup crossfade shows the main window synchronously and restores opacity before cleanup', async () => {
    const { splash, timer, main } = fixture();
    splash.window.emit('ready-to-show');
    let shows = 0;
    const finished = splash.finish({ mainWindow: main, showMainWindow() { shows += 1; main.show(); } });
    assert.equal(shows, 1);
    assert.equal(main.shown, true);
    assert.equal(main.opacity, 0);
    assert.equal(splash.finish({ mainWindow: main }), finished);
    timer.advance(110);
    assert.ok(main.opacity > 0 && main.opacity < 1);
    assert.ok(splash.window.opacity > 0 && splash.window.opacity < 1);
    timer.advance(130);
    await finished;
    assert.equal(main.opacity, 1);
    assert.equal(splash.window.destroyed, true);
    assert.equal(timer.pending(), 0);
});

test('reduced motion and an already completed startup never leave a hidden main window', async () => {
    for (const alreadyShown of [false, true]) {
        const { splash, timer, main } = fixture();
        if (alreadyShown) splash.window.emit('ready-to-show');
        await splash.finish({ mainWindow: main, reducedMotion: alreadyShown });
        assert.equal(main.shown, true);
        assert.equal(main.opacityHistory.includes(0), false);
        assert.equal(splash.window.destroyed, true);
        splash.window.emit('ready-to-show');
        assert.equal(splash.window.shown, alreadyShown);
        assert.equal(timer.pending(), 0);
    }
});

test('destroying or timing out a splash cancels any native fade and restores the main window', async () => {
    for (const close of ['destroy', 'timeout']) {
        const { splash, timer, main } = fixture();
        splash.window.emit('ready-to-show');
        if (close === 'timeout') timer.advance(119990);
        const finished = splash.finish({ mainWindow: main });
        assert.equal(main.opacity, 0);
        if (close === 'destroy') splash.destroy();
        else timer.advance(10);
        await finished;
        assert.equal(main.opacity, 1);
        assert.equal(timer.pending(), 0);
    }
});

test('startup first paint has a bounded wait and late readiness cannot revive a destroyed splash', async () => {
    const { splash, timer } = fixture();
    timer.advance(600);
    assert.equal(await splash.ready, false);
    splash.destroy();
    splash.window.emit('ready-to-show');
    assert.equal(splash.window.shown, false);
});

test('a failed splash renderer releases startup immediately without preventing the main window', async () => {
    const { splash, timer, main } = fixture();
    splash.window.webContents.emit('render-process-gone');
    assert.equal(await splash.ready, false);
    assert.equal(splash.window.destroyed, true);
    await splash.finish({ mainWindow: main });
    assert.equal(main.shown, true);
    assert.equal(main.opacity, 1);
    assert.equal(timer.pending(), 0);
});

test('a main-only fade also recovers from unsupported opacity and a failing show callback', async () => {
    const timer = clock();
    const main = new FakeWindow();
    const transition = revealStartupMainWindow({ mainWindow: main, ...timer });
    assert.equal(main.shown, true);
    timer.advance(240);
    await transition;
    assert.equal(main.opacity, 1);
    const unsupported = new FakeWindow();
    unsupported.setOpacity = () => { throw new Error('Unsupported'); };
    await revealStartupMainWindow({ mainWindow: unsupported, ...timer });
    assert.equal(unsupported.shown, true);
    const failed = new FakeWindow();
    await revealStartupMainWindow({ mainWindow: failed, showMainWindow() { throw new Error('Closed during show'); }, ...timer });
    assert.equal(failed.shown, true);
    assert.equal(failed.opacity, 1);
    assert.equal(timer.pending(), 0);
});

test('isolated Electron renders the local splash artwork, rounded corners and progress before transitioning', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display for the isolated splash renderer.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-splash-test-'));
    try {
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const assert = require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    try {
        const { createStartupSplash } = await import(${JSON.stringify(new URL('./startupSplash.js', import.meta.url).href)});
        const splash = createStartupSplash({ BrowserWindow });
        await new Promise((resolve, reject) => {
            splash.window.webContents.once('did-finish-load', resolve);
            splash.window.webContents.once('did-fail-load', (_event, code, message) => reject(new Error(code + ': ' + message)));
        });
        await splash.ready;
        splash.update('loading');
        await new Promise(resolve => setTimeout(resolve, 100));
        const state = await splash.window.webContents.executeJavaScript(\`(() => {
            const image = document.querySelector('img');
            const progress = document.getElementById('progress');
            return {
                imageLoaded: image.complete && image.naturalWidth === 700,
                radius: getComputedStyle(document.querySelector('.splash')).borderRadius,
                trackRadius: getComputedStyle(progress).borderRadius,
                stage: progress.getAttribute('aria-valuenow'),
                status: document.getElementById('status').textContent,
                fill: document.getElementById('fill').getBoundingClientRect().width,
                track: progress.getBoundingClientRect().width,
                nodeAccess: typeof window.require,
            };
        })()\`);
        assert.equal(state.imageLoaded, true);
        assert.equal(state.radius, '20px');
        assert.equal(state.trackRadius, '999px');
        assert.equal(state.stage, '2');
        assert.equal(state.status, '라이브러리를 준비하고 있습니다');
        assert.ok(Math.abs(state.fill / state.track - 2 / 3) < 0.001);
        assert.equal(state.nodeAccess, 'undefined');
        const screenshot = await splash.window.webContents.capturePage();
        assert.deepEqual(screenshot.getSize(), { width: 700, height: 364 });
        const pixels = screenshot.toBitmap();
        assert.equal(pixels[3], 0);
        assert.ok(pixels[(150 * 700 + 350) * 4 + 3] > 0);
        if (process.env.BOOKMANAGER_SPLASH_SCREENSHOT) fs.writeFileSync(process.env.BOOKMANAGER_SPLASH_SCREENSHOT, screenshot.toPNG());
        const main = new BrowserWindow({ show: false, width: 800, height: 500 });
        await main.loadURL('data:text/html,<h1>Startup test</h1>');
        await splash.finish({ mainWindow: main });
        assert.equal(main.isVisible(), true);
        assert.equal(main.getOpacity(), 1);
        assert.equal(splash.window.isDestroyed(), true);
        process.stdout.write('SPLASH_RENDER_RESULT=' + JSON.stringify(state) + '\\n');
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
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], {
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            child.stdout.on('data', value => { output += value; });
            child.stderr.on('data', value => { output += value; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Splash renderer timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        assert.match(result.output, /SPLASH_RENDER_RESULT=/);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
