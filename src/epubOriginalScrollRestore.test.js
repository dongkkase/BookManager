import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('original EPUB scroll restoration waits for layout and yields to reader input', { timeout: 20000 }, async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const require = createRequire(import.meta.url);
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'epub-scroll-restore-test-')));
    try {
        const helper = (await fs.readFile(new URL('./epubOriginalScrollRestore.js', import.meta.url), 'utf8')).replace('export function', 'function');
        await fs.writeFile(path.join(directory, 'index.html'), `<!doctype html><meta charset="utf-8">
<style>
    #reader { width: 400px; height: 240px; border: 3px solid black; overflow: auto; scroll-behavior: smooth; }
    section { height: 400px; }
    section:nth-child(2) { height: 600px; }
    section:nth-child(3) { height: 1200px; }
    iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
<aside class="viewer-settings-panel"><input></aside>
<main id="reader"><article>
    <section data-reader-index="0"><iframe class="viewer-epub-original-frame" data-original-ready="false" srcdoc="<p>First</p>"></iframe></section>
    <section data-reader-index="1"><iframe class="viewer-epub-original-frame" data-original-ready="false" srcdoc="<p>Target</p>"></iframe></section>
    <section data-reader-index="2"><iframe class="viewer-epub-original-frame" data-original-ready="false" srcdoc="<p>Later</p>"></iframe></section>
</article></main>
<script>
${helper}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const until = async predicate => {
    for (let index = 0; index < 180; index += 1) {
        if (predicate()) return;
        await frame();
    }
    throw new Error('Layout or completion did not arrive');
};
window.restoreTests = (async () => {
    const root = document.getElementById('reader');
    const sections = [...root.querySelectorAll('section')];
    const frames = [...root.querySelectorAll('iframe')];
    await until(() => frames.every(iframe => iframe.contentDocument?.body));
    const completions = [];
    root.scrollTo({ top: 100, behavior: 'instant' });
    const cleanup = restoreEpubOriginalScrollPosition(root, { pageIndex: 1, chapterProgress: 0.5 }, { onFinish: result => completions.push(result.reason) });
    frames[1].dataset.originalReady = 'true';
    await pause(100);
    check(root.scrollTop === 100, 'A ready target must wait for preceding chapters');
    frames[0].dataset.originalReady = 'true';
    await frame();
    check(root.scrollTop === 100, 'Restoration must wait for stable frames');
    await until(() => Math.abs(root.scrollTop - 700) < 1);
    check(!completions.length, 'Restoration must watch for late changes after applying');
    document.querySelector('.viewer-settings-panel input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.querySelector('.viewer-settings-panel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    check(!completions.length, 'Settings panel input must not cancel the restoration');
    sections[0].style.height = '700px';
    sections[1].style.height = '800px';
    await until(() => Math.abs(root.scrollTop - 1100) < 1);
    await until(() => completions.length === 1);
    check(completions[0] === 'restored', 'Stable chapter geometry must complete restoration');
    check(frames[2].dataset.originalReady === 'false', 'Later chapters must not block restoration');
    cleanup(); cleanup();
    check(completions.length === 1, 'Completion must be reported only once');
    sections[0].style.height = '750px';
    root.scrollTo({ top: 500, behavior: 'instant' });
    await pause(80);
    check(root.scrollTop === 500, 'Finished observers must not move the reader');

    for (const type of ['wheel', 'pointerdown', 'keydown']) {
        let reason;
        restoreEpubOriginalScrollPosition(root, { pageIndex: 1, chapterProgress: 0.5 }, { onFinish: result => { reason = result.reason; } });
        await frame();
        const document = frames[1].contentDocument;
        const EventType = type === 'wheel' ? WheelEvent : type === 'pointerdown' ? PointerEvent : KeyboardEvent;
        document.body.dispatchEvent(new EventType(type, { key: 'ArrowDown', bubbles: true }));
        check(reason === 'cancelled', 'Native iframe ' + type + ' input must cancel restoration');
        root.scrollTo({ top: 120, behavior: 'instant' });
        await pause(60);
        check(root.scrollTop === 120, 'Cancelled restoration must not override user scrolling');
    }
    let current = true;
    let staleReason;
    restoreEpubOriginalScrollPosition(root, { pageIndex: 0, chapterProgress: 0 }, { isCurrent: () => current, onFinish: result => { staleReason = result.reason; } });
    current = false;
    await until(() => staleReason);
    check(staleReason === 'cancelled', 'A replaced restoration must stop');

    let removedReason;
    restoreEpubOriginalScrollPosition(root, { pageIndex: 0, chapterProgress: 0 }, { onFinish: result => { removedReason = result.reason; } });
    root.remove();
    await until(() => removedReason);
    check(removedReason === 'cancelled', 'A detached reader must stop');
    document.body.append(root);

    frames[0].dataset.originalReady = 'false';
    let timeoutReason;
    const timeoutCleanup = restoreEpubOriginalScrollPosition(root, { pageIndex: 1, chapterProgress: 0.5 }, { onFinish: result => { timeoutReason = result.reason; } });
    await pause(5200);
    check(timeoutReason === 'timeout', 'Unavailable chapter layout must time out');
    timeoutCleanup();
    return { restoredTop: 1100, inputs: 3, completions, staleReason, removedReason, timeoutReason };
})();
</script>`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile'));
app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 700, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadFile(path.join(__dirname, 'index.html'));
    const result = await window.webContents.executeJavaScript('window.restoreTests');
    console.log(JSON.stringify(result));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const timeout = setTimeout(() => child.kill(), 17000);
        let result;
        try {
            result = await new Promise((resolve, reject) => {
                child.on('error', reject);
                child.on('exit', (code, signal) => resolve({ code, signal }));
            });
        } finally {
            clearTimeout(timeout);
        }
        assert.equal(result.code, 0, output || JSON.stringify(result));
        assert.match(output, /"restoredTop":1100/);
        t.diagnostic(output.trim());
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
