import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('만화 스크롤은 2000페이지의 현재 영역만 로드하며 이동과 크기 변경 후 위치를 유지한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-comic-scroll-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerComicScroll from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerComicScroll.jsx')}`)};
import { captureComicScrollPosition, restoreComicScrollPosition } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/viewerComicScrollPosition.js')}`)};
const pages = Array.from({ length: 2000 }, (_, index) => ({ name: index + '.svg', index }));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let index = 0; index < 8; index += 1) await frame(); };
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#487c99"/></svg>');
let changePage;
let changeHeight;
let changeWidth;
let changeScale;
const requested = new Set();
const giantPages = Array.from({ length: 50 }, (_, index) => ({ name: 'giant-' + index + '.svg', index, size: 40 * 1024 * 1024 }));
function GiantFixture() {
    const scrollRef = useRef(null);
    const [pageIndex, setPageIndex] = useState(0);
    changePage = setPageIndex;
    return <main id="scroll" ref={scrollRef} style={{ width: 740, height: 600, overflow: 'auto' }}>
        <ViewerComicScroll
            pages={giantPages}
            scrollRef={scrollRef}
            pageIndex={pageIndex}
            renderPage={(page, index) => <img data-image-index={index} src={'/giant.svg?page=' + index} alt="Pending giant image" style={{ display: 'block', flex: '0 0 auto' }} />}
        />
    </main>;
}
function Fixture({ knownSizes = true, slow = false }) {
    const scrollRef = useRef(null);
    const [pageIndex, setPageIndex] = useState(0);
    const [heights, setHeights] = useState({});
    const [width, setWidth] = useState(700);
    const [scale, setScale] = useState(1);
    changePage = setPageIndex;
    changeHeight = (index, height) => setHeights(current => ({ ...current, [index]: height }));
    changeWidth = setWidth;
    changeScale = setScale;
    return <main id="scroll" ref={scrollRef} style={{ width, height: 600, overflow: 'auto' }}>
        <ViewerComicScroll
            pages={pages}
            scrollRef={scrollRef}
            pageIndex={pageIndex}
            layoutKey={scale}
            getPageStyle={knownSizes ? page => ({ width: 500 * scale, height: (heights[page.index] || 700) * scale }) : undefined}
            renderPage={(page, index) => <img
                data-image-index={index}
                src={slow ? '/slow.svg?page=' + index : image}
                alt="Pending image"
                style={{ display: 'block', flex: '0 0 auto', ...(slow ? {} : { width: 500 * scale, height: (heights[index] || 700) * scale }) }}
                onLoad={() => requested.add(index)}
            />}
        />
    </main>;
}
const root = createRoot(document.getElementById('root'));
window.comicScrollTests = (async () => {
    root.render(<Fixture />);
    await settle();
    const scroll = document.getElementById('scroll');
    const node = index => document.querySelector('[data-page-index="' + index + '"]');
    const mounted = () => [...document.querySelectorAll('[data-comic-mounted]')].map(item => Number(item.dataset.pageIndex));
    const assertBounded = label => check(mounted().length <= 12, label + ': mounted ' + mounted().length + ' pages');
    check(document.querySelectorAll('[data-page-index]').length === 2000, 'Missing lightweight navigation targets');
    assertBounded('initial');
    check(requested.size <= 12, 'Initial loading requested distant pages');
    const initialHeight = scroll.scrollHeight;
    node(1500).scrollIntoView({ block: 'start' });
    changePage(1500);
    await settle();
    assertBounded('direct jump');
    check(mounted().includes(1500), 'Jump target image was not loaded');
    check(!mounted().includes(0), 'Previous image remained mounted');
    check(Math.abs(node(1500).getBoundingClientRect().top - scroll.getBoundingClientRect().top) < 2, 'Jump target moved');
    check(scroll.scrollHeight === initialHeight, 'Unmounting changed placeholder geometry');
    for (const index of [1999, 0, 700, 20, 1800]) {
        node(index).scrollIntoView({ block: 'start' });
        changePage(index);
    }
    await settle();
    assertBounded('rapid jumps');
    check(mounted().includes(1800), 'Final rapid jump was lost');
    const anchorTop = node(1800).getBoundingClientRect().top;
    changeHeight(1798, 1100);
    await settle();
    check(Math.abs(node(1800).getBoundingClientRect().top - anchorTop) < 2, 'Late measurement above the viewport shifted the reading position');
    changeWidth(550);
    await settle();
    assertBounded('resize');
    check(Math.abs(node(1800).getBoundingClientRect().top - anchorTop) < 2, 'Viewport resize shifted the reading position');
    changeScale(1.25);
    await settle();
    node(1800).scrollIntoView({ block: 'start' });
    await settle();
    assertBounded('zoom');
    check(Math.abs(node(1800).getBoundingClientRect().height - 875) < 2, 'Zoom did not update placeholder height');
    check(mounted().includes(1800), 'Zoom lost the selected image');
    const result = { pages: 2000, mounted: mounted().length, requested: requested.size, scrollHeight: scroll.scrollHeight };
    root.render(<Fixture key="unmeasured" knownSizes={false} />);
    await settle();
    check(Math.abs(node(0).getBoundingClientRect().height - 700) < 2, 'Unknown page height was not measured');
    node(500).scrollIntoView({ block: 'start' });
    changePage(500);
    await settle();
    assertBounded('unknown dimensions');
    check(!node(0).querySelector('img'), 'Distant measured image was retained');
    check(Math.abs(node(0).getBoundingClientRect().height - 700) < 2, 'Unloading discarded the measured placeholder height');
    check(mounted().includes(500), 'Unknown-size jump target was not loaded');
    const unknownScroll = document.getElementById('scroll');
    unknownScroll.scrollTop += 350;
    await settle();
    const savedPosition = captureComicScrollPosition(unknownScroll, 500);
    check(savedPosition.pageIndex === 500 && Math.abs(savedPosition.offsetRatio - 0.5) < 0.01, 'Page-relative reading position was not captured: ' + JSON.stringify(savedPosition) + ', targetTop=' + node(500).getBoundingClientRect().top);
    root.render(<Fixture key="reopened" knownSizes={false} />);
    await settle();
    changePage(savedPosition.pageIndex);
    await settle();
    const reopenedScroll = document.getElementById('scroll');
    let restoreReason;
    restoreComicScrollPosition(reopenedScroll, savedPosition, { onFinish: result => { restoreReason = result.reason; } });
    for (let index = 0; index < 120 && !restoreReason; index += 1) await frame();
    check(restoreReason === 'restored', 'Unknown-size reading position restoration did not finish');
    const restoredPosition = captureComicScrollPosition(reopenedScroll, 500);
    check(restoredPosition.pageIndex === 500 && Math.abs(restoredPosition.offsetRatio - 0.5) < 0.01, 'Unknown preceding heights changed the resumed page or offset');
    let inputReason;
    restoreComicScrollPosition(reopenedScroll, { pageIndex: 900, offsetRatio: 0.25 }, { onFinish: result => { inputReason = result.reason; } });
    reopenedScroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    reopenedScroll.scrollTop = 100;
    await settle();
    check(inputReason === 'cancelled' && reopenedScroll.scrollTop === 100, 'Restoration overrode reader input');
    let staleReason;
    restoreComicScrollPosition(reopenedScroll, savedPosition, { isCurrent: () => false, onFinish: result => { staleReason = result.reason; } });
    await settle();
    check(staleReason === 'cancelled' && reopenedScroll.scrollTop === 100, 'Stale session restoration changed the position');
    const toolbarButton = document.createElement('button');
    document.body.append(toolbarButton);
    let toolbarReason;
    restoreComicScrollPosition(reopenedScroll, savedPosition, { onFinish: result => { toolbarReason = result.reason; } });
    toolbarButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    reopenedScroll.scrollTop = 200;
    await settle();
    check(toolbarReason === 'cancelled' && reopenedScroll.scrollTop === 200, 'Toolbar navigation did not cancel restoration');
    toolbarButton.remove();
    root.render(<Fixture key="slow" knownSizes={false} slow />);
    await settle();
    assertBounded('delayed image decoding');
    check(node(0).getBoundingClientRect().height >= 600, 'Pending alt text collapsed the placeholder');
    for (let index = 0; index < 120 && !node(0).querySelector('img')?.naturalWidth; index += 1) await frame();
    await settle();
    check(node(0).querySelector('img')?.naturalWidth === 500, 'Delayed image did not load');
    check(Math.abs(node(0).getBoundingClientRect().height - 700) < 2, 'Loaded image was not measured');
    assertBounded('decoded delayed images');
    root.render(<GiantFixture key="giant" />);
    await settle();
    check(JSON.stringify(mounted()) === '[0]', 'Unmeasured large pages started parallel decodes: ' + mounted());
    for (let index = 0; index < 120 && !node(0).querySelector('img')?.naturalWidth; index += 1) await frame();
    await settle();
    check(node(0).getBoundingClientRect().height === 100000, 'Giant page was not measured');
    check(JSON.stringify(mounted()) === '[0]', 'Giant first page loaded distant neighbors: ' + mounted());
    const giantScroll = document.getElementById('scroll');
    giantScroll.scrollTop = 50000;
    await settle();
    check(JSON.stringify(mounted()) === '[0]', 'Middle of giant page retained neighbors: ' + mounted());
    giantScroll.scrollTop = 99099;
    await settle();
    check(JSON.stringify(mounted()) === '[0,1]', 'Approaching giant page boundary did not preload its next page: ' + mounted() + JSON.stringify({ scrollTop: giantScroll.scrollTop, viewport: giantScroll.clientHeight, nextTop: node(1).offsetTop, currentHeight: node(0).offsetHeight, scrollHeight: giantScroll.scrollHeight }));
    for (let index = 0; index < 120 && !node(1).querySelector('img')?.naturalWidth; index += 1) await frame();
    await settle();
    check(node(1).querySelector('img')?.naturalHeight === 100000, 'Next giant page was not ready before the boundary');
    giantScroll.scrollTop = 150000;
    changePage(1);
    await settle();
    check(JSON.stringify(mounted()) === '[1]', 'Leaving giant page boundary did not release the previous image: ' + mounted());
    node(20).scrollIntoView({ block: 'start' });
    changePage(20);
    await settle();
    check(JSON.stringify(mounted()) === '[20]', 'Jump to unmeasured giant page decoded its estimated neighbors: ' + mounted());
    result.giantMiddleMounted = 1;
    result.giantBoundaryMounted = 2;
    root.unmount();
    await settle();
    check(document.querySelectorAll('img').length === 0, 'Unmount retained images');
    return result;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}.viewer-comic-scroll{position:relative;display:flex;flex-direction:column;align-items:center}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            plugins: [{
                name: 'delayed-comic-images',
                configureServer(viteServer) {
                    viteServer.middlewares.use((request, response, next) => {
                        const giant = request.url?.startsWith('/giant.svg');
                        if (!giant && !request.url?.startsWith('/slow.svg')) return next();
                        setTimeout(() => {
                            response.setHeader('Content-Type', 'image/svg+xml');
                            const width = giant ? 720 : 500;
                            const height = giant ? 100000 : 700;
                            response.end('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="#487c99"/></svg>');
                        }, 600);
                    });
                },
            }],
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
console.log('COMIC_SCROLL_START');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    console.log('COMIC_SCROLL_READY');
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('COMIC_SCROLL_CONSOLE: ' + message); });
    window.webContents.on('render-process-gone', (_event, details) => console.error('COMIC_SCROLL_RENDERER_GONE: ' + JSON.stringify(details)));
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    console.log('COMIC_SCROLL_LOADED');
    const result = await window.webContents.executeJavaScript('window.comicScrollTests');
    console.log('COMIC_SCROLL_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Comic scroll renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/COMIC_SCROLL_RESULT=(.+)/)[1]);
        assert.equal(report.pages, 2000);
        assert.ok(report.mounted <= 12);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
