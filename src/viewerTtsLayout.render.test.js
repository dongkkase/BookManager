import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('TTS 조작과 상세 설정은 TXT/EPUB 본문 크기와 페이지 구성을 바꾸지 않는다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-tts-layout-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
let expectedReader;
const frame = async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (expectedReader) checkReaderUnchanged();
};
const settle = async () => { for (let i = 0; i < 25; i += 1) await frame(); };
const paragraphs = Array.from({ length: 160 }, (_, index) =>
    '문단' + String(index).padStart(4, '0') + ' 본문을 가리지 않고 책을 읽으며 낭독을 조작합니다. '.repeat(4));
const chapter = {
    name: 'chapter.xhtml', title: 'TTS 배치 검증', text: paragraphs.join('\\n\\n'),
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: '',
        html: '<html><head><style>body{margin:0;font:16px/26px sans-serif}p{margin:0 0 12px}</style></head><body>'
            + paragraphs.map(text => '<p>' + text + '</p>').join('') + '</body></html>',
    },
};
let loadSession;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'reduced' }),
    getText: async () => ({ text: paragraphs.join('\\n\\n') }),
    getEpubText: async () => ({ chapters: [chapter], toc: [], fonts: [] }),
    listComicPages: async () => ({ pages: [] }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
};
const root = createRoot(document.getElementById('root'));
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const rect = selector => document.querySelector(selector).getBoundingClientRect();
function readerSnapshot() {
    const content = document.querySelector('.viewer-content');
    const bounds = content.getBoundingClientRect();
    return JSON.stringify({
        top: bounds.top, height: bounds.height, width: bounds.width,
        text: content.textContent,
        pages: [...content.querySelectorAll('[data-reader-page-index]')].map(page => page.dataset.readerPageIndex),
        progress: document.querySelector('.viewer-title small').textContent,
    });
}
function checkReaderUnchanged() {
    check(readerSnapshot() === expectedReader, 'Opening or closing TTS changed the reader layout, content or page count');
}
function checkToolbar(label) {
    const menu = rect('.viewer-tts-menu');
    const toolbar = rect('.viewer-toolbar');
    const content = rect('.viewer-content');
    check(menu.bottom <= content.top + 1, label + ': TTS overlaps the reading area');
    check(menu.top >= toolbar.top && menu.bottom <= toolbar.bottom, label + ': TTS is outside the existing toolbar');
    document.querySelectorAll('.viewer-tts-actions > button, .viewer-tts-actions .viewer-dropdown-button').forEach(button => {
        const bounds = button.getBoundingClientRect();
        check(bounds.left >= 0 && bounds.right <= innerWidth, label + ': A TTS control is clipped');
        check(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.viewer-tts-menu'),
            label + ': A TTS control is covered');
    });
}
window.runTtsLayout = async ({ type, flowMode, epubStyle = 'optimized', motion = 'reduced' }) => {
    expectedReader = null;
    const key = [type, flowMode, epubStyle, innerWidth].join('-');
    localStorage.clear();
    localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
        flowMode, slideNavOpen: false, readerSettings: { epubStyle, pageEffect: 'none' },
    }));
    localStorage.setItem('bookmanager-viewer-tts-settings', JSON.stringify({ engine: 'supertonic', supertonicVoice: 'F1' }));
    window.viewerAPI.getConfig = async () => ({ language: 'ko', motion_preference: motion });
    loadSession = null;
    root.render(<ViewerApp key={key} />);
    await until(() => loadSession, 'Missing session listener');
    await loadSession({ id: key, type, filePath: '/fixture/' + key, fileName: 'TTS 배치 검증', preview: true });
    await until(() => !document.querySelector('.viewer-app')?.classList.contains('is-initial-render-loading')
        && document.querySelector('.viewer-content .viewer-text-page'), 'Reader did not become ready: ' + key);
    await settle();
    if (type === 'text' && flowMode !== 'scroll') {
        for (let index = 0; index < 4; index += 1) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            await settle();
        }
    }
    const initialHeight = rect('.viewer-content').height;
    expectedReader = readerSnapshot();
    document.querySelector('.viewer-tts-toggle-button').click();
    await until(() => document.querySelector('.viewer-tts-menu'), 'TTS did not open');
    const menu = document.querySelector('.viewer-tts-menu');
    const standardCluster = document.querySelector('.viewer-tool-group > .viewer-tool-cluster:not(.viewer-tts-cluster)');
    check(standardCluster.inert, 'Inactive toolbar controls must not receive focus during TTS');
    if (motion === 'full') {
        check(menu.getAnimations().length > 0, 'TTS entrance must animate in full motion mode');
        check(standardCluster.getAnimations().length > 0, 'Standard controls must animate out');
    } else {
        check(menu.getAnimations().length === 0, 'Reduced motion must skip TTS animations');
        check(getComputedStyle(menu).opacity === '1', 'Reduced motion must immediately show TTS');
    }
    await settle();
    checkToolbar(key);
    document.querySelector('.viewer-tts-voice-dropdown > button').click();
    await settle();
    const voices = rect('.viewer-tts-voice-dropdown .viewer-dropdown-menu');
    check(voices.left >= -1 && voices.right <= innerWidth + 1, 'Voice menu extends outside the window');
    document.querySelector('.viewer-tts-voice-dropdown > button').click();
    document.querySelector('.viewer-tts-rate-control > button').click();
    await settle();
    check(document.querySelector('.viewer-tts-rate-popover input'), 'Playback rate menu is unavailable');
    document.querySelector('.viewer-tts-rate-control > button').click();
    check(!document.querySelector('.viewer-supertonic-settings'), 'Reading settings must stay hidden until requested');
    document.querySelector('.viewer-tts-settings-toggle').click();
    await settle();
    checkToolbar(key + ' expanded');
    const body = document.querySelector('.viewer-supertonic-settings-body');
    check(body.scrollHeight > body.clientHeight, 'Long settings must scroll inside the popover');
    document.querySelector('.viewer-tts-settings-toggle').click();
    await settle();
    expectedReader = null;
    document.querySelector('.viewer-toolbar-toggle').click();
    await settle();
    check(getComputedStyle(document.querySelector('.viewer-toolbar')).opacity === '0', 'TTS must follow toolbar visibility');
    document.querySelector('.viewer-toolbar').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await settle();
    check(getComputedStyle(document.querySelector('.viewer-toolbar')).opacity === '1', 'TTS toolbar did not reappear on hover');
    document.querySelector('.viewer-toolbar-toggle').click();
    await settle();
    expectedReader = readerSnapshot();
    document.querySelector('.viewer-tts-actions > button:last-child').click();
    if (motion === 'full') {
        await frame();
        const exiting = document.querySelector('.viewer-tts-menu');
        check(exiting?.inert && exiting.getAttribute('aria-hidden') === 'true', 'Exiting TTS must not accept input');
        check(exiting.getAnimations().length > 0, 'TTS exit must animate');
    }
    await settle();
    check(!document.querySelector('.viewer-tts-menu'), 'Close button left TTS controls open');
    check(Math.abs(rect('.viewer-content').height - initialHeight) < 1, 'Closing left an empty gap');
    const normalControl = document.querySelector('.viewer-tool-group > .viewer-tool-cluster:not(.viewer-tts-cluster) button');
    check(getComputedStyle(normalControl).visibility === 'visible', 'Closing did not restore the normal toolbar');
    check(!standardCluster.inert && standardCluster.style.opacity === '' && standardCluster.style.translate === '',
        'Closing must restore original controls and remove temporary motion styles');
    document.querySelector('.viewer-tts-toggle-button').click();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    check(!document.querySelector('.viewer-tts-menu'), 'Escape did not close TTS controls');
    document.querySelector('.viewer-tts-toggle-button').click();
    await settle();
    checkToolbar(key + ' reopened');
    if (motion === 'full') {
        document.querySelector('.viewer-tts-actions > button:last-child').click();
        await frame();
        document.querySelector('.viewer-tts-toggle-button').click();
        await settle();
        checkToolbar(key + ' interrupted exit');
        check(document.querySelector('.viewer-tts-toggle-button').getAttribute('aria-expanded') === 'true',
            'An interrupted exit must not close the reopened controls');
        document.querySelector('.viewer-tts-actions > button:last-child').click();
        await frame();
        document.querySelectorAll('.viewer-tts-menu, .viewer-tool-group > .viewer-tool-cluster').forEach(node => {
            node.getAnimations().forEach(animation => animation.cancel());
        });
        await settle();
        check(!document.querySelector('.viewer-tts-menu') && !standardCluster.inert,
            'Cancelled browser animations must not leave the old toolbar inaccessible');
        document.querySelector('.viewer-tts-toggle-button').click();
        await settle();
        document.querySelector('.viewer-tts-actions > button:last-child').click();
        await frame();
        applyMotionPreference('reduced');
        await frame();
        await frame();
        check(!document.querySelector('.viewer-tts-menu') && !standardCluster.inert,
            'Enabling reduced motion during exit must restore the toolbar immediately');
        applyMotionPreference('full');
        document.querySelector('.viewer-tts-toggle-button').click();
        await frame();
        applyMotionPreference('reduced');
        await frame();
        await frame();
        const reducedMenu = document.querySelector('.viewer-tts-menu');
        check(reducedMenu && reducedMenu.getAnimations().length === 0 && getComputedStyle(reducedMenu).opacity === '1',
            'Enabling reduced motion during entrance must settle on visible TTS controls');
        applyMotionPreference('full');
        document.querySelector('.viewer-tts-actions > button:last-child').click();
        await frame();
        expectedReader = null;
        await loadSession({ id: key + '-comic', type: 'comic', filePath: '/fixture/comic', fileName: 'Comic', preview: true });
        await settle();
        check(!document.querySelector('.viewer-tts-control'), 'Changing document type must unmount TTS');
        for (const cluster of document.querySelectorAll('.viewer-tool-group > .viewer-tool-cluster')) {
            check(!cluster.inert && cluster.style.opacity === '' && cluster.style.translate === '',
                'Unmounting TTS must restore the remaining toolbar controls');
        }
        return { key, initialHeight, motionLifecycle: 'passed' };
    }
    expectedReader = null;
    return { key, initialHeight, toolbarHeight: rect('.viewer-toolbar').height };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const results = [];
    for (const scenario of [
        { type: 'text', flowMode: 'single' },
        { type: 'text', flowMode: 'spread', motion: 'full' },
        { type: 'text', flowMode: 'scroll' },
        { type: 'epub', flowMode: 'single' },
        { type: 'epub', flowMode: 'spread', epubStyle: 'original' },
        { type: 'text', flowMode: 'single', narrow: true, motion: 'full' },
    ]) {
        if (scenario.narrow) window.setSize(360, 640);
        results.push(await window.webContents.executeJavaScript('window.runTtsLayout(' + JSON.stringify(scenario) + ')'));
        if (process.env.BOOKMANAGER_TTS_SCREENSHOT && scenario.type === 'text' && scenario.flowMode === 'single' && !scenario.narrow) {
            await fs.writeFile(process.env.BOOKMANAGER_TTS_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
        }
    }
    console.log('TTS_LAYOUT_RESULT=' + JSON.stringify(results));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('TTS layout renderer timed out: ' + result)); }, 90000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/TTS_LAYOUT_RESULT=(.+)/)[1]);
        assert.equal(report.length, 6);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
