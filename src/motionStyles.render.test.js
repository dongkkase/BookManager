import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('모션 설정은 OS 설정과 독립적으로 CSS 효과를 제어하고 정적 상태를 보존한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-styles-test-'));
    try {
        const renderer = `
import { applyMotionPreference, initializeMotionPreference } from './src/motionPolicy.js';
import './src/styles/global.css';
import './src/styles/App.css';
import './src/styles/FolderTab.css';
import './src/styles/AppSupportActions.css';
import './src/styles/MenuSurface.css';
import './src/styles/CoverEditorDialog.css';
import './src/styles/RatingEditorDialog.css';
import './src/styles/MetadataTab.css';
import './src/styles/ReadiveTransfer.css';
import './src/styles/viewer.css';
import './src/styles/epubAudioControls.css';
import './src/features/fileTools/epubEditor/epubEditor.css';
initializeMotionPreference();
document.body.innerHTML = \`
    <a id="hover">Link</a>
    <section id="section" class="sidebar-section">
        <i id="toggle" class="sidebar-section-toggle-icon"></i>
        <div id="sectionContent" class="sidebar-section-content"><div class="sidebar-section-content-inner"><p style="height:50px">Library</p></div></div>
    </section>
    <div id="supportLayer" class="app-support-dialog-layer is-open"><div class="app-support-dialog">Message</div></div>
    <div id="loading" class="folder-cover-spinner"></div>
    <div id="detail" class="detail-panel-layer is-outgoing"></div>
    <div class="cover-editor-candidate"><span id="highlight" class="cover-editor-arrival-highlight"></span></div>
    <div class="rating-editor-star hovered"><div id="rating" class="rating-editor-star-visual"></div><svg class="is-bursting"></svg></div>
    <div class="rating-editor-sparks"><span></span></div>
    <div id="toast" class="app-toast">Saved</div>
    <div id="viewerToast" class="viewer-toast">Saved</div>
    <div id="scan" class="app-library-scan-card">Scanning</div>
    <div id="drop" class="app-file-drop-hover">Drop files</div>
    <div id="metadata" class="meta-api-dialog-backdrop"></div>
    <div class="folder-detail-bg"></div>
    <div class="app-lock-thumbnail-rail"></div>
    <div class="search-placeholder-viewport is-overflowing"><span class="search-placeholder-text">Search</span></div>
    <div class="readive-dialog"><span class="readive-spinner"></span></div>
    <div class="content-index-spinner"></div>
    <div class="ee-busy-spinner"></div>
    <div class="viewer-epub-audio-controls is-playing"><i class="viewer-epub-audio-note"></i><div class="viewer-epub-audio-levels"><i></i></div></div>
    <div id="attention" class="readive-sharing-panel is-connection-attention"></div>
    <div id="nativeMenu" class="bm-native-menu-surface" popover="manual">Menu</div>
\`;
const check = (condition, message) => { if (!condition) throw new Error(message); };
const style = (id, pseudo) => getComputedStyle(document.getElementById(id), pseudo);
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
window.applyMotion = applyMotionPreference;
window.verifyMotion = async (preference, systemReduced) => {
    applyMotionPreference(preference);
    await frame();
    await frame();
    const reduced = preference === 'reduced' || preference === 'system' && systemReduced;
    const label = preference + '/' + systemReduced;
    check(document.documentElement.dataset.motion === (reduced ? 'reduced' : 'full'), label + ': effective setting');
    check((style('hover').transitionDuration === '0s') === reduced, label + ': hover defaults');
    check((style('sectionContent').transitionDuration === '0s') === reduced, label + ': sidebar transition');
    check((style('supportLayer').transitionDuration === '0s') === reduced, label + ': GitHub dialog transition');
    check((style('loading').animationName === 'none') === reduced, label + ': spinner animation');
    check((style('rating').transform === 'none') === reduced, label + ': decorative rating transform');
    if (reduced) {
        for (const element of document.querySelectorAll('*')) {
            const computed = getComputedStyle(element);
            check(computed.animationName === 'none', label + ': animation still running on ' + element.className);
            check(computed.transitionDuration === '0s', label + ': transition still running on ' + element.className);
        }
        check(style('metadata', '::before').animationName === 'none', label + ': backdrop pseudo animation');
        check(style('loading').opacity === '1', label + ': loading indicator must remain visible');
        check(style('detail').opacity === '0', label + ': outgoing detail must be hidden');
        check(style('highlight').opacity === '0', label + ': finished highlight must not persist');
        for (const id of ['toast', 'viewerToast', 'scan', 'drop']) {
            check(style(id).opacity === '1', label + ': content must remain visible: ' + id);
        }
        const section = document.getElementById('section');
        section.classList.add('is-collapsed');
        check(style('sectionContent').visibility === 'hidden', label + ': collapse immediately hidden');
        check(document.getElementById('sectionContent').getBoundingClientRect().height === 0, label + ': collapse immediately zero height');
        section.classList.remove('is-collapsed');
        check(style('sectionContent').visibility === 'visible', label + ': expand immediately visible');
        check(document.getElementById('sectionContent').getBoundingClientRect().height === 50, label + ': expanded height restored');
        document.getElementById('supportLayer').classList.remove('is-open');
        check(style('supportLayer').visibility === 'hidden', label + ': dialog closes immediately');
        document.getElementById('supportLayer').classList.add('is-open');
        check(style('supportLayer').opacity === '1', label + ': dialog reopens visibly');
        document.getElementById('nativeMenu').showPopover();
        check(style('nativeMenu').opacity === '1', label + ': native menu must be visible');
        document.getElementById('nativeMenu').hidePopover();
        check(style('nativeMenu').display === 'none', label + ': native menu must be hidden');
    }
    return { preference, systemReduced, reduced };
};
window.verifySystemChange = async expected => {
    await frame();
    await frame();
    check(document.documentElement.dataset.motion === expected, 'System change must update CSS live');
};
`;
        await build({
            stdin: { contents: renderer, loader: 'js', resolveDir: projectRoot },
            bundle: true,
            outfile: path.join(directory, 'renderer.js'),
            loader: { '.ttf': 'file', '.svg': 'file', '.png': 'file' },
            logLevel: 'silent',
        });
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><script src="renderer.js"></script></body></html>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 900, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        window.webContents.debugger.attach('1.3');
        const emulate = value => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-reduced-motion', value }],
        });
        const results = [];
        for (const systemReduced of [false, true]) {
            await emulate(systemReduced ? 'reduce' : 'no-preference');
            for (const preference of ['system', 'full', 'reduced']) {
                results.push(await window.webContents.executeJavaScript('window.verifyMotion(' + JSON.stringify(preference) + ', ' + systemReduced + ')'));
            }
        }
        await window.webContents.executeJavaScript('window.applyMotion("system")');
        await emulate('no-preference');
        await window.webContents.executeJavaScript('window.verifySystemChange("full")');
        await emulate('reduce');
        await window.webContents.executeJavaScript('window.verifySystemChange("reduced")');
        process.stdout.write('MOTION_STYLES_RESULT=' + JSON.stringify(results) + '\\n');
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
            const timer = setTimeout(() => { child.kill(); reject(new Error('Motion style test timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/MOTION_STYLES_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const cases = JSON.parse(payload);
        assert.equal(cases.length, 6);
        for (const value of cases) t.diagnostic(JSON.stringify(value));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
