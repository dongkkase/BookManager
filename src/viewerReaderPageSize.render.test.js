import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('TXT와 EPUB은 판형 선택·창 크기 변경·책넘김에도 용지 비율과 읽기 위치를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-paper-size-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let index = 0; index < 12; index += 1) await frame(); };
const rootNode = document.getElementById('root');
const root = createRoot(rootNode);
const paragraphs = Array.from({ length: 140 }, (_, index) => '문단 ' + String(index).padStart(3, '0') + ' 책장을 넘기며 읽던 내용을 이어갑니다. 용지의 비율은 창의 크기가 달라져도 유지됩니다.');
const chapters = [{ name: 'chapter.xhtml', title: '책의 비율', text: paragraphs.join('\\n'), blocks: paragraphs.map(text => ({ type: 'text', text })), original: {
    layout: 'reflowable', resourceUrls: {}, stylesheet: '',
    html: '<html><head><style>body{margin:0;font:16px/24px sans-serif}p{margin:0 0 12px}</style></head><body>'
        + paragraphs.map(text => '<p>' + text + '</p>').join('') + '</body></html>',
} }];
let loadSession;
let mount = 0;
let currentType;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'full' }),
    getText: async () => ({ text: paragraphs.join('\\n') }),
    getEpubText: async () => ({ chapters, toc: [], fonts: [] }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
};
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message + ': ' + document.body.innerText.slice(0, 300));
}
const button = label => {
    const node = [...document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.getAttribute('title') === label || node.dataset.tooltip?.startsWith(label));
    check(node, 'Missing button: ' + label);
    return node;
};
const stage = () => document.querySelector('.viewer-reader-stage');
const pages = () => [...(stage()?.querySelectorAll('.viewer-text-page') || [])];
const ready = () => stage() && pages().length > 0 && !document.querySelector('.viewer-app.is-initial-render-loading') && !document.querySelector('.viewer-state');
const prefs = () => JSON.parse(localStorage.getItem('bookmanager-viewer-prefs:' + currentType) || '{}');
const bodyText = () => pages().map(page => page.querySelector('.viewer-reader-page-body')?.textContent || '').join('').replace(/\\s/g, '');
async function resize(width, height) {
    rootNode.style.width = width + 'px';
    rootNode.style.height = height + 'px';
    await settle();
    await until(ready, 'Layout did not settle after resizing');
    await settle();
}
function checkPages(ratio, label) {
    const content = document.querySelector('.viewer-content').getBoundingClientRect();
    const visiblePages = pages().filter(page => {
        const rect = page.getBoundingClientRect();
        return rect.width && rect.height && rect.right > content.left && rect.left < content.right;
    });
    check(visiblePages.length > 0, label + ': no visible pages');
    visiblePages.forEach(page => {
        const rect = page.getBoundingClientRect();
        check(Math.abs(rect.width - rect.height * ratio) < 1.5, label + ': incorrect ratio ' + rect.width + 'x' + rect.height);
        check(rect.left >= content.left - 1 && rect.right <= content.right + 1 && rect.top >= content.top - 1 && rect.bottom <= content.bottom + 1, label + ': page escaped viewport');
        const body = page.querySelector('.viewer-reader-page-body');
        if (body) {
            const range = document.createRange();
            range.selectNodeContents(body);
            const textRect = range.getBoundingClientRect();
            check(textRect.bottom <= body.getBoundingClientRect().bottom + 1, label + ': body text was clipped ' + JSON.stringify({ text: textRect.toJSON(), body: body.getBoundingClientRect().toJSON(), page: rect.toJSON() }));
        }
    });
    return visiblePages[0].getBoundingClientRect().width;
}
async function open({ type = 'text', epubStyle = 'optimized', flowMode = 'single', paperSize, pageEffect = 'none', preservePrefs = false } = {}) {
    currentType = type;
    if (!preservePrefs) localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
        flowMode, slideNavOpen: false, readerSettings: { paperSize, epubStyle, pageEffect, theme: 'paper', wrapMode: 'char' },
    }));
    loadSession = null;
    mount += 1;
    root.render(<ViewerApp key={mount} />);
    await until(() => loadSession, 'Session subscription missing');
    await loadSession({ id: 'paper-' + mount, type, filePath: '/fixture/paper-' + mount, fileName: '책의 비율', preview: true });
    await until(ready, 'Reader did not become ready');
    await settle();
}
async function choosePaper(label, id) {
    button('용지 판형').click();
    await until(() => document.querySelector('.viewer-paper-size-setting [role="option"]'), 'Paper menu missing');
    [...document.querySelectorAll('.viewer-paper-size-setting [role="option"]')].find(option => option.textContent.includes(label)).click();
    await until(() => prefs().readerSettings?.paperSize === id && (ready() || document.querySelector('.viewer-text-page.is-scroll')), 'Paper preference did not persist');
    await settle();
}
window.paperTests = (async () => {
    const results = [];
    rootNode.style.width = '1200px';
    rootNode.style.height = '780px';
    for (const settings of [{ type: 'text' }, { type: 'epub', epubStyle: 'optimized' }, { type: 'epub', epubStyle: 'original' }]) {
        for (const flowMode of ['single', 'spread']) {
            const label = settings.type + '-' + (settings.epubStyle || '') + '-' + flowMode;
            await open({ ...settings, flowMode });
            checkPages(152 / 225, label);
            check(!document.querySelector('.viewer-toolbar button[data-tooltip^="가로 맞춤"]'), label + ': incompatible page-fit controls remain visible');
            await resize(620, 820);
            checkPages(152 / 225, label + '-portrait');
            await resize(820, 560);
            checkPages(152 / 225, label + '-minimum-window');
            await resize(1200, 780);
            checkPages(152 / 225, label + '-landscape');
            await choosePaper('A5', 'a5');
            checkPages(148 / 210, label + '-a5');
            results.push(label);
        }
    }
    await open({ type: 'text' });
    for (let index = 0; index < 4; index += 1) {
        const previous = bodyText();
        button('다음장').click();
        await until(() => bodyText() !== previous, 'Text navigation stalled');
        await settle();
    }
    const anchor = bodyText().slice(0, 24);
    await choosePaper('A5', 'a5');
    check(bodyText().includes(anchor), 'Changing paper lost the manual text reading position');
    await resize(620, 820);
    check(bodyText().includes(anchor), 'Resizing lost the manual text reading position');
    await open({ type: 'text', preservePrefs: true });
    checkPages(148 / 210, 'restored preference');
    check(button('용지 판형').textContent.includes('A5'), 'Saved paper did not restore in settings');
    await choosePaper('사륙판', '46');
    checkPages(128 / 188, '46 format');
    await choosePaper('화면에 맞춤', 'screen');
    const screenRect = pages()[0].getBoundingClientRect();
    check(Math.abs(screenRect.width / screenRect.height - 128 / 188) > 0.02, 'Legacy screen mode retained a book ratio');
    await resize(1200, 780);
    for (const settings of [{ type: 'text' }, { type: 'epub', epubStyle: 'original' }]) {
        await open({ ...settings, flowMode: 'spread', paperSize: 'a5', pageEffect: 'page' });
        checkPages(148 / 210, settings.type + '-curl');
        const book = document.querySelector('.viewer-page-curl-book').getBoundingClientRect();
        check(Math.abs(book.width / 2 - book.height * 148 / 210) < 1.5, 'Book curl used a different paper ratio');
    }
    await open({ type: 'text' });
    button('스크롤').click();
    await until(() => document.querySelector('.viewer-text-page.is-scroll'), 'Scroll mode missing');
    const scrollRect = document.querySelector('.viewer-text-page.is-scroll').getBoundingClientRect();
    await choosePaper('A5', 'a5');
    const changedScrollRect = document.querySelector('.viewer-text-page.is-scroll').getBoundingClientRect();
    check(scrollRect.width === changedScrollRect.width && scrollRect.height === changedScrollRect.height, 'Paper choice changed continuous scrolling');
    await open({ type: 'text', flowMode: 'spread', paperSize: 'shinguk' });
    button('뷰어 설정').click();
    await settle();
    return results;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#root{width:1200px;height:780px}#root>.viewer-app{width:100%;height:100%;min-height:0}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.paperTests');
    if (process.env.BOOKMANAGER_PAPER_SCREENSHOT) require('node:fs').writeFileSync(process.env.BOOKMANAGER_PAPER_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    console.log('PAPER_RESULT=' + JSON.stringify(result));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const require = createRequire(import.meta.url);
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Paper layout renderer timed out: ' + result)); }, 90000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/PAPER_RESULT=(.+)/)[1]);
        assert.equal(report.length, 6);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
