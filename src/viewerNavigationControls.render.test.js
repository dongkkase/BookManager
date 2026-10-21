import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('공통 뷰어의 처음·끝 버튼, 방향별 단축키와 탐색바 툴팁을 렌더링해 확인한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-navigation-')));
    let server;
    try {
        const objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] /Count 6 >>',
            ...Array.from({ length: 6 }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 700] /Resources << >> >>'),
        ];
        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        objects.forEach((object, index) => {
            offsets.push(Buffer.byteLength(pdf));
            pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
        });
        const xref = Buffer.byteLength(pdf);
        pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
        pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
        pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        await fs.writeFile(path.join(directory, 'fixture.pdf'), pdf);
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let i = 0; i < 5; i += 1) await frame(); };
async function until(predicate, message) {
    const deadline = performance.now() + 12000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message + ': ' + document.body.innerText.slice(0, 300));
}
const pages = Array.from({ length: 6 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 700;
    const context = canvas.getContext('2d');
    context.fillStyle = ['#487c99', '#399d70', '#b78944'][index % 3];
    context.fillRect(0, 0, 480, 700);
    context.fillStyle = '#fff'; context.font = '90px sans-serif'; context.fillText(String(index + 1), 180, 360);
    return { name: index + '.png', width: 480, height: 700, pageUrl: canvas.toDataURL() };
});
const text = Array.from({ length: 100 }, (_, index) => '문단 ' + index + ' 본문을 읽으며 페이지를 이동합니다. '.repeat(8)).join('\\n\\n');
let loadSession;
let adjacentMoves = 0;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'reduced' }),
    listComicPages: async () => ({ pages }),
    getText: async () => ({ text }),
    getEpubText: async () => ({ chapters: [{ name: 'chapter.xhtml', title: 'Chapter', text }], toc: [], fonts: [] }),
    getDocumentData: async () => ({ documentUrl: '/fixture.pdf' }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
    openAdjacent: async () => { adjacentMoves += 1; return {}; },
};
const root = createRoot(document.getElementById('root'));
const button = (scope, label) => [...document.querySelectorAll(scope + ' button')].find(node => node.dataset.tooltip?.startsWith(label));
const first = scope => button(scope, '처음으로');
const last = scope => button(scope, '끝으로');
const progress = () => document.querySelector('.viewer-title small').textContent;
const key = value => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
async function checkTooltip(target, placement) {
    target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    await settle();
    const tooltip = document.querySelector('[role="tooltip"]');
    check(tooltip?.textContent === target.dataset.tooltip, 'Tooltip label or shortcut is missing');
    check(!target.hasAttribute('title'), 'Native tooltip must be removed');
    const bounds = tooltip.getBoundingClientRect();
    const anchor = target.getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth, 'Tooltip extends beyond the viewport');
    check(placement === 'bottom' ? bounds.top >= anchor.bottom : bounds.bottom <= anchor.top, 'Tooltip overlaps the control');
    check(target.getAttribute('aria-describedby') === tooltip.id, 'Tooltip must describe its control');
    target.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    await settle();
}
window.runNavigation = async ({ type = 'comic', direction = 'ltr', arrowMode = 'reading-natural', flowMode = 'single', coverFirst = false }) => {
    const label = [type, direction, arrowMode, flowMode, coverFirst, innerWidth].join('/');
    localStorage.clear();
    localStorage.setItem('bookmanager-viewer-prefs:' + type, JSON.stringify({
        flowMode, readingDirection: direction, spreadCoverFirst: coverFirst, slideNavOpen: true,
        readerSettings: { pageEffect: 'none', arrowKeyMode: arrowMode },
    }));
    loadSession = null;
    root.render(<ViewerApp key={label} />);
    await until(() => loadSession, 'Missing session listener');
    await loadSession({ id: label, type, filePath: '/fixture/' + label, fileName: 'Navigation fixture', preview: true, adjacent: { hasNext: true } });
    await until(() => document.querySelector('.viewer-slide-strip button') && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), label + ': reader not ready');
    await settle();
    const toolbar = '.viewer-toolbar';
    const slide = '.viewer-slide-controls';
    check(first(toolbar)?.disabled && first(slide)?.disabled, label + ': first page controls should start disabled');
    const left = [...document.querySelectorAll(slide + ' .viewer-tool-button')];
    check(left.length === 4, label + ': slide navigation needs four buttons');
    check(left[0] === (direction === 'rtl' && type === 'comic' ? last(slide) : first(slide)), label + ': slide buttons do not follow reading direction');
    const previous = button(toolbar, '이전장');
    const expectedArrow = type === 'comic' && direction === 'rtl' && arrowMode === 'reading-natural' ? '→' : '←';
    check(previous.dataset.tooltip.includes(expectedArrow + ' / ↑ / PageUp'), label + ': incorrect previous-page shortcut');
    if (innerWidth > 1320) await checkTooltip(last(toolbar), 'bottom');
    const strip = document.querySelector('.viewer-slide-strip');
    check(getComputedStyle(strip).webkitMaskImage.includes('linear-gradient'), label + ': thumbnail edges are not faded');
    const stripBounds = strip.getBoundingClientRect();
    for (const control of left) {
        const rect = control.getBoundingClientRect();
        check(rect.height === 44, label + ': slide buttons must have the larger height');
        check(rect.left >= 0 && rect.right <= innerWidth, label + ': slide button clipped');
        check(rect.right <= stripBounds.left || rect.left >= stripBounds.right, label + ': slide button overlaps thumbnails');
    }
    await checkTooltip(last(slide), 'top');
    last(toolbar).click();
    await until(() => last(toolbar).disabled && last(slide).disabled, label + ': last-page buttons did not reach the end');
    const endProgress = progress();
    const content = document.querySelector('.viewer-content');
    if (flowMode === 'scroll') check(content.scrollTop + content.clientHeight >= content.scrollHeight - 2, label + ': End did not reach the scroll boundary');
    else {
        const [current, total] = endProgress.match(/\\d+/g).map(Number);
        check(current === total || (flowMode === 'spread' && current === total - 1), label + ': last spread is incorrect');
    }
    check(!button(toolbar, '다음장').disabled, label + ': next book should remain available at the end');
    first(slide).click();
    await until(() => first(toolbar).disabled, label + ': slide first-page button failed');
    if (flowMode === 'scroll') check(content.scrollTop <= 1, label + ': Home did not reach the scroll boundary');
    key('End');
    await until(() => last(toolbar).disabled, label + ': End shortcut failed');
    check(progress() === endProgress, label + ': button and End shortcut disagree');
    key('Home');
    await until(() => first(toolbar).disabled, label + ': Home shortcut failed');
    button(slide, '다음장').click();
    await until(() => !first(toolbar).disabled, label + ': slide next-page button failed');
    button(slide, '이전장').click();
    await until(() => first(toolbar).disabled, label + ': slide previous-page button failed');
    last(slide).click();
    await until(() => last(toolbar).disabled, label + ': slide last-page button failed');
    first(toolbar).click();
    await until(() => first(slide).disabled, label + ': toolbar first-page button failed');
    document.querySelector('.viewer-slide-toggle').click();
    await settle();
    const controls = document.querySelector(slide);
    check(controls.inert && controls.getAttribute('aria-hidden') === 'true', label + ': closed navigation must not receive focus');
    last(slide).focus();
    check(document.activeElement !== last(slide), label + ': hidden navigation received focus');
    check(adjacentMoves === 0, label + ': boundary jump opened another book');
    document.querySelector('.viewer-slide-toggle').click();
    await settle();
    return label;
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { backgroundThrottling: false } });
    await window.loadURL('http://127.0.0.1:${server.httpServer.address().port}/');
    const results = [];
    for (const options of [
        {}, { direction: 'rtl' }, { direction: 'rtl', arrowMode: 'ltr' },
        { direction: 'rtl', flowMode: 'spread' }, { flowMode: 'spread', coverFirst: true },
        { flowMode: 'scroll' }, { type: 'text', flowMode: 'spread' },
        { type: 'epub', flowMode: 'spread' }, { type: 'pdf', flowMode: 'spread' },
    ]) results.push(await window.webContents.executeJavaScript('window.runNavigation(' + JSON.stringify(options) + ')'));
    if (process.env.BOOKMANAGER_NAVIGATION_SCREENSHOT) {
        const image = await window.webContents.capturePage();
        require('fs').writeFileSync(process.env.BOOKMANAGER_NAVIGATION_SCREENSHOT + '.wide.png', image.toPNG());
    }
    window.setSize(640, 760);
    results.push(await window.webContents.executeJavaScript('window.runNavigation({ direction: "rtl" })'));
    console.log('NAVIGATION_RESULT=' + JSON.stringify(results));
    if (process.env.BOOKMANAGER_NAVIGATION_SCREENSHOT) {
        const image = await window.webContents.capturePage();
        require('fs').writeFileSync(process.env.BOOKMANAGER_NAVIGATION_SCREENSHOT, image.toPNG());
    }
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Navigation renderer timed out: ' + result)); }, 90000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/NAVIGATION_RESULT=(.+)/)[1]);
        assert.equal(report.length, 10);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
