import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('책넘김은 실제 페이지를 유지하고 이동 취소와 캔버스 수명을 관리한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-curl-test-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'pattern.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect x="4" y="4" width="2" height="2" fill="#c030a0"/></svg>');
        await fs.writeFile(path.join(directory, 'solid.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c030a0"/></svg>');
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ViewerPageCurlBook from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerPageCurlBook.jsx')}`)};
import EpubInlineMedia from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubInlineMedia.jsx')}`)};
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import { releasePageCurlSnapshots, snapshotPageCurlLeaf } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/viewerPageCurlSnapshot.js')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/viewer.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function frames(count = 2) { for (let index = 0; index < count; index += 1) await nextFrame(); }
async function until(predicate, message) {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await nextFrame();
    }
    throw new Error(message + ': ' + JSON.stringify({ changes, visible: visibleIndexes() }));
}
const createdCanvases = [];
const nativeCreateElement = document.createElement.bind(document);
document.createElement = (name, ...args) => {
    const element = nativeCreateElement(name, ...args);
    if (String(name).toLowerCase() === 'canvas') createdCanvases.push(element);
    return element;
};
const colors = ['#e63232', '#269e4b', '#305fd7', '#d69f25', '#944ad1', '#1a969b', '#d16c27', '#895140'];
const changes = [];
const results = [];
window.mediaFixtureLoads = 0;
window.addEventListener('message', event => {
    if (event.origin === 'https://www.youtube-nocookie.com' && event.data === 'media-fixture-loaded') window.mediaFixtureLoads += 1;
});
const bookRef = React.createRef();
const root = createRoot(document.getElementById('root'));
function Leaf({ index }) {
    const canvasRef = useRef(null);
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = 120;
        canvas.height = 140;
        const context = canvas.getContext('2d');
        context.fillStyle = colors[index];
        context.fillRect(0, 0, canvas.width, canvas.height);
    }, [index]);
    return <><canvas ref={canvasRef} className="fixture-source-canvas viewer-pdf-canvas" style={{ width: '100%', height: '70%', visibility: 'visible' }} />
        <span className="fixture-selectable-text">Selectable page {index}</span></>;
}
const leaves = colors.map((_color, index) => <div key={index} className="viewer-flipbook-page fixture-leaf" data-flipbook-index={index}>
    <Leaf index={index} />
</div>);
const onPageChange = index => changes.push(index);
let settings = { startPage: 0, preparedPage: 0, width: 240, height: 320, spread: true };
function renderBook(patch = {}, key = 'spread', pages = leaves) {
    settings = { ...settings, ...patch };
    root.render(<ViewerPageCurlBook key={key} ref={bookRef} {...settings} duration={220}
        className="viewer-flipbook fixture-book" style={{ margin: '20px' }} onPageChange={onPageChange}>
        {pages}
    </ViewerPageCurlBook>);
}
const api = () => bookRef.current.pageFlip();
const visibleIndexes = () => [...document.querySelectorAll('[data-curl-visible="true"]')]
    .filter(node => getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden')
    .map(node => Number(node.dataset.flipbookIndex));
function expectVisible(expected, message) {
    check(JSON.stringify(visibleIndexes()) === JSON.stringify(expected), message + ': ' + visibleIndexes());
}
const overlay = () => document.querySelector('.viewer-page-curl-canvas');
const transientCanvases = () => createdCanvases.filter(canvas => !canvas.classList.contains('fixture-source-canvas'));
function expectReleased(message) {
    check(transientCanvases().every(canvas => canvas.width === 0 || canvas.height === 0), message);
}
function painted(canvas) {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return false;
    const context = canvas.getContext('2d');
    for (const ratioX of [0.2, 0.5, 0.8]) {
        for (const ratioY of [0.2, 0.5, 0.8]) {
            if (context.getImageData(Math.floor(canvas.width * ratioX), Math.floor(canvas.height * ratioY), 1, 1).data[3] > 0) return true;
        }
    }
    return false;
}
async function screenPixels(points) {
    const image = new Image();
    image.src = await window.pageCurlFixture.capture();
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = points.map(point => [...context.getImageData(
        Math.floor(point.x * canvas.width / window.innerWidth), Math.floor(point.y * canvas.height / window.innerHeight), 1, 1).data]);
    canvas.width = 0;
    canvas.height = 0;
    return pixels;
}
async function startFlip(index) {
    renderBook({ preparedPage: index });
    await frames();
    api().flip(index);
    await until(() => painted(overlay()), 'A page turn must paint the actual page snapshot');
}
window.testDone = (async () => {
    renderBook();
    await until(() => bookRef.current && visibleIndexes().length === 2, 'The initial spread did not become visible');
    expectVisible([0, 1], 'The initial spread must preserve both DOM leaves');
    check(api().getCurrentPageIndex() === 0, 'The public API must report startPage');
    const first = document.querySelector('[data-flipbook-index="0"]');
    const second = document.querySelector('[data-flipbook-index="1"]');
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    check(Math.abs(firstRect.width - 240) < 1 && Math.abs(secondRect.left - firstRect.right) < 1, 'Spread leaves must retain their full width beside each other');
    await frames();
    const initialPixels = await screenPixels([first, second].map(leaf => {
        const rect = leaf.querySelector('canvas').getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }));
    for (const [index, pixel] of initialPixels.entries()) {
        const expected = [1, 3, 5].map(offset => Number.parseInt(colors[index].slice(offset, offset + 2), 16));
        check(expected.every((channel, channelIndex) => Math.abs(channel - pixel[channelIndex]) <= 3),
            'A prepared canvas with visibility:visible must not cover the current page: ' + JSON.stringify(initialPixels));
    }
    const text = first.querySelector('.fixture-selectable-text');
    const textRect = text.getBoundingClientRect();
    const hit = document.elementFromPoint(textRect.left + 3, textRect.top + 3);
    check(hit === text || text.contains(hit), 'No idle animation layer may intercept the document text');
    check(getComputedStyle(text).userSelect !== 'none', 'The idle page must permit text selection');
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    check(window.getSelection().toString() === 'Selectable page 0', 'The original document text must remain selectable');
    window.getSelection().removeAllRanges();
    results.push('initial spread and selectable DOM');

    const changesBeforeForward = changes.length;
    await startFlip(2);
    check(changes.length === changesBeforeForward, 'Snapshot preparation must not commit the destination early');
    await until(() => api().getCurrentPageIndex() === 2 && changes.length > changesBeforeForward, 'Forward curl did not commit');
    expectVisible([2, 3], 'Forward curl must show the destination spread');
    check(changes.slice(changesBeforeForward).join(',') === '2', 'Forward curl must notify completion exactly once');
    expectReleased('Completed forward curl must release all temporary canvas backing stores');
    await startFlip(0);
    await until(() => api().getCurrentPageIndex() === 0 && changes.at(-1) === 0, 'Backward curl did not commit');
    expectVisible([0, 1], 'Backward curl must restore the previous spread');
    expectReleased('Completed backward curl must release its snapshots');
    results.push('forward and backward animation');

    await startFlip(2);
    const beforeJump = changes.length;
    api().turnToPage(6);
    await until(() => api().getCurrentPageIndex() === 6 && visibleIndexes().join(',') === '6,7', 'Absolute navigation did not replace the active curl');
    await new Promise(resolve => setTimeout(resolve, 350));
    check(changes.slice(beforeJump).join(',') === '6', 'A cancelled animation must not publish a late destination');
    expectVisible([6, 7], 'The cancelled animation must not overwrite the absolute jump');
    expectReleased('Absolute navigation must release cancelled curl canvases');
    results.push('absolute jump cancels active animation');

    renderBook({ width: 280, height: 360, startPage: 0, preparedPage: 6 });
    await frames(3);
    check(api().getCurrentPageIndex() === 6, 'Changing size must not reapply startPage');
    expectVisible([6, 7], 'Changing size must keep the current spread');
    const resized = document.querySelector('[data-flipbook-index="6"]').getBoundingClientRect();
    check(Math.abs(resized.width - 280) < 1 && Math.abs(resized.height - 360) < 1, 'Leaf dimensions must follow the new page size');
    results.push('resizing preserves current page');

    await startFlip(4);
    const beforeFinish = changes.length;
    api().getRender().finishAnimation();
    await frames();
    await new Promise(resolve => setTimeout(resolve, 300));
    check(api().getCurrentPageIndex() === 6 && changes.length === beforeFinish, 'Explicit cancellation must preserve the current page without publishing the unfinished destination');
    expectVisible([6, 7], 'Explicit cancellation must keep the current spread');
    expectReleased('Explicit cancellation must release animation snapshots');
    results.push('explicit finish cancels without a stale commit');

    const readerLeaves = colors.map((_color, index) => <div key={index} className="viewer-flipbook-page fixture-leaf" data-flipbook-index={index}>
        <article className="viewer-text-page" style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: '24px', margin: 0, color: '#111', background: '#fff', font: '18px sans-serif' }}>
            <p>한국어 책넘김을 확인합니다. {index}</p>
            <p><ruby>漢字<rt>한자</rt></ruby>와 본문을 함께 읽습니다.</p>
        </article>
    </div>);
    renderBook({ width: 240, height: 320, startPage: 0, preparedPage: 0 }, 'reader', readerLeaves);
    await until(() => api().getCurrentPageIndex() === 0 && visibleIndexes().join(',') === '0,1', 'Reader leaves did not mount');
    const readerGlyphPixels = [];
    for (const pageIndex of [0, 2]) {
        const readerLeaf = document.querySelector('[data-flipbook-index="' + pageIndex + '"]');
        if (pageIndex === 2) check(getComputedStyle(readerLeaf).visibility === 'hidden', 'The target HTML page must still be hidden while preparing its snapshot');
        const readerSnapshot = await snapshotPageCurlLeaf(readerLeaf, { width: 240, height: 320, pixelRatio: 1 });
        const textPixels = readerSnapshot.image.getContext('2d').getImageData(0, 0, 240, 320).data;
        let darkPixels = 0;
        for (let index = 0; index < textPixels.length; index += 4) {
            if (textPixels[index + 3] > 128 && Math.max(textPixels[index], textPixels[index + 1], textPixels[index + 2]) < 160) darkPixels += 1;
        }
        check(darkPixels > 100, 'Visible and hidden HTML snapshots must contain actual Korean and ruby glyph pixels');
        readerGlyphPixels.push(darkPixels);
        releasePageCurlSnapshots([readerSnapshot]);
    }
    renderBook({ preparedPage: 2 }, 'reader', readerLeaves);
    await frames();
    const beforeReaderFlip = changes.length;
    api().flip(2);
    await until(() => painted(overlay()), 'Reader snapshot failure must not silently skip the curl animation');
    check(changes.length === beforeReaderFlip, 'Reader animation must not commit before drawing its snapshot');
    await until(() => api().getCurrentPageIndex() === 2 && visibleIndexes().join(',') === '2,3', 'Reader curl did not complete');
    expectReleased('Reader completion must release all HTML snapshot canvases');
    results.push('Korean and ruby HTML snapshots animate');

    const embeddedLeaf = document.createElement('div');
    embeddedLeaf.style.cssText = 'position:absolute;left:0;top:0;width:240px;height:320px';
    const embeddedReader = document.createElement('article');
    embeddedReader.className = 'viewer-text-page';
    embeddedReader.style.cssText = 'width:240px;height:320px;padding:0;margin:0;border:0;background:white';
    const embeddedFrame = document.createElement('iframe');
    embeddedFrame.className = 'viewer-epub-original-frame';
    embeddedFrame.style.cssText = 'width:240px;height:320px;border:0;display:block';
    const embeddedLoaded = new Promise(resolve => embeddedFrame.addEventListener('load', resolve, { once: true }));
    const embeddedImageCanvas = document.createElement('canvas');
    embeddedImageCanvas.width = 40;
    embeddedImageCanvas.height = 40;
    embeddedImageCanvas.getContext('2d').fillStyle = '#20c030';
    embeddedImageCanvas.getContext('2d').fillRect(0, 0, 40, 40);
    const embeddedImageUrl = embeddedImageCanvas.toDataURL();
    embeddedImageCanvas.width = 0;
    embeddedImageCanvas.height = 0;
    embeddedFrame.srcdoc = '<!doctype html><html style="width:240px;height:320px;overflow:hidden;column-width:240px;column-gap:0;column-fill:auto"><head><style>@font-face{font-family:FixtureOriginalFont;src:url("/@fs/${path.join(projectRoot, 'src/fonts/NanumGothic-Regular.ttf')}")}body{margin:0}p{margin:0;padding:20px;font:18px FixtureOriginalFont,sans-serif;color:black}.page{height:320px;break-after:column;background-image:url("/pattern.svg")}</style></head><body><div class="page" style="background-color:rgb(210,20,20)"><p>첫 번째 원본 페이지</p></div><div class="page" style="background-color:rgb(20,40,210)"><p>두 번째 원본 페이지</p><img style="display:block;margin:20px;width:40px;height:40px" src="' + embeddedImageUrl + '"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" style="display:block;margin-left:160px"><image href="/solid.svg" width="40" height="40"/></svg></div></body></html>';
    embeddedReader.append(embeddedFrame);
    embeddedLeaf.append(embeddedReader);
    document.body.append(embeddedLeaf);
    await embeddedLoaded;
    await embeddedFrame.contentDocument.fonts.ready;
    await frames();
    embeddedFrame.dataset.originalReady = 'true';
    const snapshotFontRequests = [];
    const nativeFetch = window.fetch;
    window.fetch = (...args) => { snapshotFontRequests.push(String(args[0])); return nativeFetch(...args); };
    for (const [offset, expected] of [[0, [210, 20, 20]], [240, [20, 40, 210]]]) {
        embeddedFrame.contentDocument.documentElement.scrollLeft = offset;
        await frames();
        const snapshot = await snapshotPageCurlLeaf(embeddedLeaf, { width: 240, height: 320 });
        const context = snapshot.image.getContext('2d');
        const pixel = [...context.getImageData(120, 200, 1, 1).data];
        check(expected.every((channel, index) => Math.abs(channel - pixel[index]) <= 3),
            'Embedded EPUB snapshots must paint the current column, including its background: ' + JSON.stringify({ offset, pixel }));
        const backgroundPixel = [...context.getImageData(124, 204, 1, 1).data];
        check(backgroundPixel[0] > 180 && backgroundPixel[1] < 70 && backgroundPixel[2] > 140,
            'External CSS background images must be inlined into the original EPUB snapshot: ' + JSON.stringify(backgroundPixel));
        const pixels = context.getImageData(0, 0, 240, 100).data;
        let glyphPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] > 128 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) < 100) glyphPixels += 1;
        }
        check(glyphPixels > 80, 'Embedded EPUB snapshots must include the actual text, not an empty iframe');
        if (offset > 0) {
            const imagePixel = [...context.getImageData(30, 100, 1, 1).data];
            check(imagePixel[1] > 150 && imagePixel[0] < 60 && imagePixel[2] < 70,
                'Images from the iframe realm must be inlined into the snapshot: ' + JSON.stringify(imagePixel));
            const svgPixel = [...context.getImageData(170, 160, 1, 1).data];
            check(svgPixel[0] > 180 && svgPixel[1] < 70 && svgPixel[2] > 140,
                'External SVG image references must be inlined: ' + JSON.stringify(svgPixel));
        }
        releasePageCurlSnapshots([snapshot]);
    }
    window.fetch = nativeFetch;
    check(snapshotFontRequests.some(url => url.includes('NanumGothic-Regular.ttf')),
        'Embedded document font-face rules must be collected from the iframe stylesheet');
    embeddedFrame.style.transform = 'scale(0.5)';
    embeddedFrame.style.transformOrigin = 'top left';
    const scaledSnapshot = await snapshotPageCurlLeaf(embeddedLeaf, { width: 240, height: 320 });
    const scaledPixel = [...scaledSnapshot.image.getContext('2d').getImageData(60, 100, 1, 1).data];
    check(scaledPixel[2] > 180 && scaledPixel[0] < 50, 'An iframe transform must retain the current column in a scaled snapshot');
    releasePageCurlSnapshots([scaledSnapshot]);
    embeddedFrame.dataset.originalReady = 'false';
    let rejectedUnreadyFrame = false;
    try { await snapshotPageCurlLeaf(embeddedLeaf, { width: 240, height: 320 }); }
    catch { rejectedUnreadyFrame = true; }
    check(rejectedUnreadyFrame, 'Unready iframe snapshots must use the existing DOM fallback instead of animating a blank image');
    embeddedFrame.dataset.originalReady = 'true';
    embeddedFrame.contentDocument.body.style.backgroundImage = 'url("/pattern.svg?unavailable")';
    window.fetch = (...args) => String(args[0]).includes('?unavailable')
        ? Promise.reject(new Error('Unavailable snapshot resource')) : nativeFetch(...args);
    let rejectedMissingResource = false;
    try { await snapshotPageCurlLeaf(embeddedLeaf, { width: 240, height: 320 }); }
    catch { rejectedMissingResource = true; }
    window.fetch = nativeFetch;
    check(rejectedMissingResource, 'Unavailable embedded assets must use the DOM fallback instead of losing the publisher artwork');
    embeddedLeaf.remove();
    expectReleased('Embedded EPUB snapshots must release all temporary canvas backing stores');
    results.push('original EPUB iframe text and current column snapshots');

    for (const mode of ['optimized', 'original']) {
        const mediaChapter = {
            name: 'media.xhtml', original: { resourceUrls: {}, layout: 'pre-paginated', viewport: { width: 240, height: 320 },
                html: '<html><head><style>body{margin:0;font:16px sans-serif}p{margin:12px}figure{margin:0}</style></head><body><p>Video page</p><figure class="external-media"><figcaption>Video fixture</figcaption><p><a href="https://youtu.be/jNQXAC9IVRw">YouTube</a></p></figure><p>Text after video</p></body></html>' },
        };
        const mediaLeaves = Array.from({ length: 4 }, (_, index) => <div key={index} className="viewer-flipbook-page fixture-leaf" data-flipbook-index={index}>
            <article className="viewer-text-page" style={{ width: 240, height: 320, padding: 0, margin: 0, background: '#fff' }}>
                {mode === 'original'
                    ? <EpubOriginalDocument chapter={mediaChapter} pageSize={{ width: 240, height: 320 }} mediaActive={index < 2} />
                    : <><p>Video page {index}</p><EpubInlineMedia url="https://youtu.be/jNQXAC9IVRw" title="Video fixture" active={index < 2} /><p>Text after video</p></>}
            </article>
        </div>);
        const key = 'media-' + mode;
        const loadsBeforeMount = window.mediaFixtureLoads;
        renderBook({ spread: true, width: 240, height: 320, startPage: 0, preparedPage: 0 }, key, mediaLeaves);
        await frames();
        await until(() => api().getCurrentPageIndex() === 0
            && document.querySelectorAll('.viewer-epub-inline-media iframe').length === 2
            && [...document.querySelectorAll('.viewer-epub-original-frame')].every(frame => frame.dataset.originalReady === 'true'), 'Inline media pages did not initialize: ' + mode);
        const livePlayers = [...document.querySelectorAll('.viewer-epub-inline-media iframe')];
        await until(() => window.mediaFixtureLoads >= loadsBeforeMount + 2, 'Remote media fixtures did not load');
        for (const player of livePlayers) {
            check(player.contentDocument === null, 'The fixture must use a cross-origin player');
            Object.defineProperty(player, 'contentDocument', { configurable: true, get() { throw new Error('Snapshots must not read remote player documents'); } });
        }
        const playerLoads = window.mediaFixtureLoads;
        for (const pageIndex of [0, 2]) {
            const leaf = document.querySelector('[data-flipbook-index="' + pageIndex + '"]');
            const snapshot = await snapshotPageCurlLeaf(leaf, { width: 240, height: 320 });
            const pixel = [...snapshot.image.getContext('2d').getImageData(10, 80, 1, 1).data];
            check(pixel[3] > 240 && pixel[0] < 40 && pixel[1] < 40 && pixel[2] < 40, 'Video snapshot must preserve its reserved area: ' + mode + ':' + pageIndex + ':' + pixel);
            releasePageCurlSnapshots([snapshot]);
        }
        check(livePlayers.every(player => player.isConnected), 'Snapshot replacement must not remove live players: ' + mode);
        check(window.mediaFixtureLoads === playerLoads, 'Snapshots must not reload players or create new media requests');
        for (const destination of [2, 0]) {
            renderBook({ preparedPage: destination }, key, mediaLeaves);
            await frames();
            const beforeMediaFlip = changes.length;
            api().flip(destination);
            await until(() => painted(overlay()) && document.querySelector('[data-curl-animating="true"]'), 'Pages containing a player must animate in both directions: ' + mode);
            check(changes.length === beforeMediaFlip, 'Media must not cause an immediate page commit');
            await until(() => api().getCurrentPageIndex() === destination, 'Media page curl did not finish');
            expectReleased('Media page curl must release its snapshots');
        }
        if (mode === 'optimized') {
            const nativeDecode = HTMLImageElement.prototype.decode;
            let delayedSnapshots = 0;
            HTMLImageElement.prototype.decode = async function (...args) {
                if (this.src.startsWith('data:image/svg+xml')) {
                    delayedSnapshots += 1;
                    await new Promise(resolve => setTimeout(resolve, 900));
                }
                return nativeDecode.apply(this, args);
            };
            try {
                renderBook({ preparedPage: 2 }, key, mediaLeaves);
                await frames();
                const beforeSlowMediaFlip = changes.length;
                const startedAt = performance.now();
                api().flip(2);
                await until(() => painted(overlay()) && document.querySelector('[data-curl-animating="true"]'), 'Reader snapshots taking longer than 800ms must still animate');
                check(delayedSnapshots === 4 && performance.now() - startedAt >= 900, 'The slow-reader regression must delay all four snapshot decodes');
                check(changes.length === beforeSlowMediaFlip, 'Slow media snapshot preparation must not commit before drawing');
                await until(() => api().getCurrentPageIndex() === 2 && visibleIndexes().join(',') === '2,3', 'Slow media page curl did not finish');
                check(changes.slice(beforeSlowMediaFlip).join(',') === '2', 'Slow media page curl must commit exactly once');
                expectReleased('Slow media page curl must release its snapshots');
                results.push('slow EPUB media snapshots finish preparation and animate');
            } finally {
                HTMLImageElement.prototype.decode = nativeDecode;
            }
        }
        livePlayers.forEach(player => { delete player.contentDocument; });
        results.push(mode + ' EPUB inline media pages animate without accessing remote player documents');
    }

    renderBook({ spread: false, startPage: 1, preparedPage: 1, width: 240, height: 320 }, 'single');
    await until(() => api().getCurrentPageIndex() === 1 && visibleIndexes().join(',') === '1', 'Single-page mode must show its initial leaf');
    renderBook({ preparedPage: 2 }, 'single');
    await frames();
    api().flip(2);
    await until(() => painted(overlay()), 'Single-page curl must paint a snapshot');
    await until(() => api().getCurrentPageIndex() === 2 && visibleIndexes().join(',') === '2', 'Single-page curl must advance one leaf');
    expectReleased('Single-page completion must release its snapshots');
    results.push('single-page animation');

    renderBook({ preparedPage: 3 }, 'single');
    await frames();
    api().flip(3);
    await until(() => painted(overlay()), 'Unmount test requires an active animation');
    const changesBeforeUnmount = changes.length;
    root.unmount();
    await new Promise(resolve => setTimeout(resolve, 350));
    check(bookRef.current === null && changes.length === changesBeforeUnmount, 'Unmount must cancel callbacks from the active animation');
    expectReleased('Unmount must release every temporary canvas backing store');
    check(document.querySelector('.viewer-page-curl-canvas') === null, 'Unmount must remove the animation canvas');
    results.push('unmount cancels animation and releases canvases');
    return { results, changes, initialPixels, readerGlyphPixels, transientCanvasCount: transientCanvases().length };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>body { margin: 0; } .fixture-leaf { background: #fff; color: #111; display: flex; flex-direction: column; } .fixture-selectable-text { display: block; font: 18px sans-serif; user-select: text; }</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: {
                react: path.join(projectRoot, 'node_modules/react'),
                'react-dom': path.join(projectRoot, 'node_modules/react-dom'),
            } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const address = server.httpServer.address();
        assert.ok(address && typeof address === 'object');
        const fixtureUrl = `http://127.0.0.1:${address.port}/`;
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pageCurlFixture', { capture: () => ipcRenderer.invoke('page-curl-fixture:capture') });
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    window.webContents.session.protocol.handle('https', () => new Response('<html><body>Test video<script>parent.postMessage("media-fixture-loaded", "*")</script></body></html>', { headers: { 'Content-Type': 'text/html' } }));
    ipcMain.handle('page-curl-fixture:capture', async () => (await window.webContents.capturePage()).toDataURL());
    window.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) process.stderr.write(message + '\\n');
    });
    try {
        await window.loadURL(${JSON.stringify(fixtureUrl)});
        const result = await window.webContents.executeJavaScript('(async () => { const deadline = Date.now() + 10000; while (!window.testDone && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20)); if (!window.testDone) throw new Error("Page curl fixture failed to load"); return window.testDone; })()');
        process.stdout.write('PAGE_CURL_RESULT=' + JSON.stringify(result) + '\\n');
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
            const timer = setTimeout(() => { child.kill(); reject(new Error('Page curl renderer timed out: ' + output)); }, 30000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/PAGE_CURL_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const report = JSON.parse(payload);
        assert.equal(report.results.length, 12);
        assert.ok(report.transientCanvasCount > 1, 'The renderer must exercise actual snapshot allocation');
        t.diagnostic(payload);
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
