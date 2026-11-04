import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { fontUrlFromFace } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/bundledFonts.js')}`)};
import ViewerPageCurlBook from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerPageCurlBook.jsx')}`)};
import { applyMotionPreference } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/motionPolicy.js')}`)};
import EpubInlineMedia from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubInlineMedia.jsx')}`)};
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import { releasePageCurlSnapshots, snapshotPageCurlLeaf, snapshotPageCurlLeaves } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/viewerPageCurlSnapshot.js')}`)};
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
const book = () => document.querySelector('.fixture-book');
function dragEvent(type, x, y, options = {}) {
    const event = new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 31, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
        clientX: x, clientY: y, ...options,
    });
    book().dispatchEvent(event);
    return event;
}
function dragPoints(side = 'right') {
    const rect = book().getBoundingClientRect();
    const x = side === 'right' ? rect.right - 12 : rect.left + 12;
    return { x, y: rect.bottom - 32, move: amount => x + (side === 'right' ? -1 : 1) * rect.width * amount };
}
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
async function verifyNativeEpubSnapshots() {
    const nativeLeaves = [];
    const nativeRequests = [];
    const ink = ['rgb(180,36,48)', 'rgb(30,75,180)'];
    const nativeDocument = '<!doctype html><html><head><style data-original-layout>'
        + '@font-face{font-family:CurlNativeFixture;src:local("Arial"),local("Liberation Sans"),url("/@fs/${path.join(projectRoot, 'src/fonts/NanumGothic-Regular.ttf')}")}html{width:80px;height:64px;overflow:hidden;column-width:80px;column-gap:0;column-fill:auto}'
        + 'body{margin:0;font:12px CurlNativeFixture,serif}p{width:80px;height:64px;margin:0;break-after:column}p:first-child{background:' + ink[0] + '}p:last-child{background:' + ink[1] + '}</style></head><body><p>A</p><p>B</p></body></html>';
    for (let index = 0; index < 2; index += 1) {
        const node = document.createElement('div');
        node.style.cssText = 'position:fixed;top:20px;left:' + (20 + 190 * index) + 'px;z-index:10001;width:180px;height:160px';
        const article = document.createElement('article');
        article.className = 'viewer-text-page is-original-reader';
        article.style.cssText = 'position:relative;box-sizing:border-box;width:180px;height:160px;margin:0;padding:0;border:0;background:#eeeeee';
        const clip = document.createElement('div');
        clip.className = 'viewer-epub-original-document is-page';
        clip.style.cssText = 'position:absolute;left:20px;top:18px;width:110px;height:88px;overflow:hidden;background:#eeeeee';
        const iframe = document.createElement('iframe');
        iframe.className = 'viewer-epub-original-frame';
        iframe.dataset.originalEntry = 'book.xhtml';
        iframe.style.cssText = 'width:80px;height:64px;border:0;display:block;transform-origin:0 0;transform:scale(1.5)';
        const loaded = new Promise(resolve => iframe.addEventListener('load', resolve, { once: true }));
        iframe.srcdoc = nativeDocument;
        clip.append(iframe); article.append(clip); node.append(article); document.body.append(node);
        await loaded;
        await iframe.contentDocument.fonts.ready;
        check([...iframe.contentDocument.fonts].some(font => font.status === 'loaded'), 'Embedded-font fixture must load its face');
        iframe.contentDocument.documentElement.scrollLeft = index * 80;
        iframe.dataset.originalReady = 'true';
        nativeLeaves.push({ node, width: 180, height: 160, x: index * 180, pixelRatio: 2 });
    }
    await frames();
    const captureOptions = { epubSessionId: 'sample' };
    window.viewerAPI = { captureEpubCurl: async request => {
        nativeRequests.push(request);
        return Promise.all(request.pages.map(async (page, index) => {
            const { width, height } = request.documents[page.documentIndex];
            const tile = document.createElement('canvas');
            tile.width = width; tile.height = height;
            const context = tile.getContext('2d');
            context.fillStyle = ink[index]; context.fillRect(0, 0, width, height);
            const bytes = index ? new Uint8Array(context.getImageData(0, 0, width, height).data)
                : new Uint8Array(await (await new Promise(resolve => tile.toBlob(resolve, 'image/png'))).arrayBuffer());
            tile.width = tile.height = 0;
            return { format: index ? 'rgba' : 'png', width, height, bytes };
        }));
    } };
    const nativeSnapshots = await snapshotPageCurlLeaves(nativeLeaves, captureOptions);
    check(nativeRequests.length === 1 && nativeRequests[0].sessionId === 'sample', 'Eligible original leaves must share one native request');
    const captureRequest = nativeRequests[0];
    check(captureRequest.pages.length === 2 && captureRequest.pages.every((page, index) => page.scrollLeft === 80 * index && page.scrollTop === 0), 'Native capture lost the current or target column');
    check(captureRequest.documents.length === 1 && captureRequest.pages.every(page => page.documentIndex === 0), 'Two columns in one document must share its payload');
    check(captureRequest.documents.every(doc => doc.width === 80 && doc.height === 64 && doc.html.includes('CurlNativeFixture')), 'Native document must preserve source size and font');
    for (const [index, result] of nativeSnapshots.entries()) {
        check(result.status === 'fulfilled', 'Native capture did not produce a leaf');
        const canvas = result.value.image;
        check(canvas.width === 360 && canvas.height === 320 && result.value.frame.x === index * 180, 'Native leaf output lost scale or spread slot');
        const origin = nativeLeaves[index].node.getBoundingClientRect();
        const points = [[4,4], [21,75], [128,104], [133,102], [50,109]];
        const expectedPixels = await screenPixels(points.map(([x,y]) => ({ x: origin.left + x, y: origin.top + y })));
        points.forEach(([x,y], point) => {
            const actual = canvas.getContext('2d').getImageData(2*x, 2*y, 1, 1).data;
            check(expectedPixels[point].every((channel, i) => Math.abs(channel - actual[i]) <= 2), 'Native frame scaling or outer paper fill differs from the live leaf at ' + [index,x,y] + ': ' + actual + ' vs ' + expectedPixels[point]);
        });
    }
    releasePageCurlSnapshots(nativeSnapshots.map(result => result.value));
    const first = nativeLeaves[0];
    const liveFrame = first.node.querySelector('iframe');
    const overlayMedia = document.createElement('div');
    overlayMedia.className = 'viewer-epub-original-media-layer';
    first.node.querySelector('.viewer-epub-original-document').append(overlayMedia);
    const fallback = async message => {
        const [result] = await snapshotPageCurlLeaves([first], captureOptions);
        check(result.status === 'fulfilled', message + ': SVG fallback failed');
        const rgba = result.value.image.getContext('2d').getImageData(140, 140, 1, 1).data;
        check(rgba[0] > 165 && rgba[1] < 55 && rgba[2] < 65, message + ': renderer fallback lost the page');
        releasePageCurlSnapshots([result.value]);
    };
    await fallback('Media overlay');
    overlayMedia.remove();
    const range = liveFrame.contentDocument.createRange();
    range.selectNodeContents(liveFrame.contentDocument.querySelector('p'));
    liveFrame.contentWindow.getSelection().addRange(range);
    await fallback('Selected text');
    liveFrame.contentWindow.getSelection().removeAllRanges();
    liveFrame.contentWindow.CSS.highlights.set('native-fixture', new liveFrame.contentWindow.Highlight(range));
    await fallback('Highlighted text');
    liveFrame.contentWindow.CSS.highlights.delete('native-fixture');
    first.node.querySelector('article').classList.remove('is-original-reader');
    await fallback('Other reader article');
    first.node.querySelector('article').classList.add('is-original-reader');
    liveFrame.dataset.originalReady = 'false';
    const unready = await snapshotPageCurlLeaves([first], captureOptions);
    check(unready[0].status === 'rejected', 'Unready iframe must not produce a blank successful snapshot');
    liveFrame.dataset.originalReady = 'true';
    check(nativeRequests.length === 1, 'Native capture must skip interactive or non-original leaves');
    let rejectedCalls = 0;
    window.viewerAPI.captureEpubCurl = async () => { rejectedCalls += 1; throw new Error('Unavailable rasterizer'); };
    await fallback('Rejected native capture');
    check(rejectedCalls === 1, 'The bridge rejection path was not exercised');
    delete window.viewerAPI;
    await fallback('Missing native bridge');
    const plainDocument = new Promise(resolve => liveFrame.addEventListener('load', resolve, { once: true }));
    liveFrame.srcdoc = nativeDocument.replace(/@font-face[{][^}]+[}]/, '');
    await plainDocument;
    let plainCalls = 0;
    window.viewerAPI = { captureEpubCurl: async () => { plainCalls += 1; throw new Error('Unexpected font-free capture'); } };
    await fallback('Font-free document');
    check(plainCalls === 0, 'Font-free documents should retain the renderer path');
    delete window.viewerAPI;
    nativeLeaves.forEach(leaf => leaf.node.remove());
    expectReleased('Native and fallback snapshots must release all transient canvases');
}
async function verifyOptimizedEpubSnapshots() {
    const sheet = document.createElement('style');
    sheet.textContent = '@font-face{font-family:PublisherBatang;src:url("bookmanager-document://session/sample/asset/publisher.ttf")}'
        + '@font-face{font-family:Jua;src:url("' + fontUrlFromFace({ filename: 'Jua-Regular.ttf' }) + '")}'
        + '.optimized-fixture .viewer-text-page{background:#f1ede2;color:#182534;box-sizing:border-box;width:100%;height:100%;margin:0;display:flex;flex-direction:column;padding:14px 17px 12px;overflow:hidden;line-height:1.4;font:17px/1.4 Jua}'
        + '.optimized-fixture h2{font:19px/1.3 Jua;margin:0 0 8px;color:#542620}.optimized-fixture p{font:16px/1.4 publisherbatang;letter-spacing:.4px;margin:3px 0 7px;text-indent:8px}'
        + '.optimized-fixture footer{font:13px Jua;color:#135144;text-align:right}.optimized-fixture mark{background:#ffe28d;color:#182534}';
    document.head.append(sheet);
    const nodes = [];
    const requests = [];
    for (const index of [0, 1]) {
        const node = document.createElement('div');
        node.className = 'optimized-fixture';
        const zoom = index ? 1.25 : 1;
        node.style.cssText = 'position:fixed;left:' + (20 + index * 260) + 'px;top:20px;z-index:10020;width:200px;height:216px;transform-origin:0 0;transform:scale(' + zoom + ')';
        node.innerHTML = '<article class="viewer-text-page viewer-reader-scope is-epub-reader"><div class="viewer-reader-page-body"><h2>성호사설 ' + (index + 1)
            + '</h2><div class="viewer-reader-html-block"><p>우리 책의 <mark>강조한 문장</mark>입니다.</p><p style="text-align:right">본문이 여러 줄로 이어집니다. 두 번째 줄도 확인합니다.</p></div></div><footer>페이지 ' + (index + 25) + '</footer></article>';
        document.body.append(node);
        nodes.push(node);
        requests.push({ node, width: 200, height: 216, x: index * 200, pixelRatio: zoom });
    }
    await Promise.all([document.fonts.load('19px Jua', '성호'), document.fonts.load('16px publisherbatang', '본문')]);
    await document.fonts.ready;
    await frames();
    const screen = new Image();
    screen.src = await window.pageCurlFixture.capture(); await screen.decode();
    const reference = document.createElement('canvas');
    reference.width = innerWidth; reference.height = innerHeight;
    reference.getContext('2d').drawImage(screen, 0, 0, innerWidth, innerHeight);
    nodes[1].style.visibility = 'hidden';
    nodes[1].style.opacity = '0';
    let nativeCalls = 0;
    let nativeError;
    window.viewerAPI = { captureEpubCurl: async request => {
        nativeCalls += 1;
        try {
            check(request.sessionId === 'sample' && request.pages.length === 2, 'Optimized spreads must use their active EPUB session');
            const markup = request.documents.map(item => item.html).join('');
            check(markup.includes('bookmanager-document://session/sample/asset/publisher.ttf') && markup.includes('/bundled-font/Jua-Regular.ttf'), 'Optimized source lost its publisher or bundled font URL');
            check(markup.includes('강조한 문장') && markup.includes('페이지 26'), 'Optimized source lost marked content or the page number');
            return await window.pageCurlFixture.raster(request);
        }
        catch (error) { nativeError = error; throw error; }
    } };
    const options = { epubSessionId: 'sample' };
    const snapshots = await snapshotPageCurlLeaves(requests, options);
    check(!nativeError && nativeCalls === 1 && snapshots.every(item => item.status === 'fulfilled'), 'Native optimized composition did not complete: ' + (nativeError || nativeCalls));
    const glyphCoverage = [];
    for (const [index, item] of snapshots.entries()) {
        const { image, frame } = item.value;
        const rect = nodes[index].getBoundingClientRect();
        check(image.width === rect.width && image.height === rect.height && frame.x === index * 200, 'Optimized leaf size, scale or side changed');
        const expected = reference.getContext('2d').getImageData(rect.left, rect.top, rect.width, rect.height).data;
        const actual = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        check([241,237,226,255].every((n, k) => Math.abs(actual[k] - n) <= 2), 'Optimized paper color differs from the visible page');
        for (const element of nodes[index].querySelectorAll('h2, p, footer')) {
            const box = element.getBoundingClientRect();
            let intersection = 0, union = 0;
            for (let y = Math.max(0, Math.floor(box.top - rect.top)); y < Math.min(image.height, Math.ceil(box.bottom - rect.top)); y++) {
                for (let x = Math.max(0, Math.floor(box.left - rect.left)); x < Math.min(image.width, Math.ceil(box.right - rect.left)); x++) {
                    const p = 4 * (y * image.width + x);
                    const wasInk = expected[p] < 155 && expected[p + 1] < 155 && expected[p + 2] < 155;
                    const isInk = actual[p] < 155 && actual[p + 1] < 155 && actual[p + 2] < 155 && actual[p + 3] > 128;
                    union += Number(wasInk || isInk); intersection += Number(wasInk && isInk);
                }
            }
            glyphCoverage.push({ leaf: index, element: element.tagName, overlap: Number((intersection / union).toFixed(3)) });
            check(union > 25 && intersection / union > (index ? 0.64 : 0.9), 'Optimized typography differs on leaf ' + index + ' ' + element.tagName + ': ' + intersection + '/' + union);
        }
    }
    reference.width = reference.height = 0;
    releasePageCurlSnapshots(snapshots.map(item => item.value));
    const first = nodes[0], article = first.querySelector('article');
    const fallback = async message => {
        const [snapshot] = await snapshotPageCurlLeaves([requests[0]], options);
        check(snapshot.status === 'fulfilled', message + ' must preserve the SVG renderer: ' + snapshot.reason);
        releasePageCurlSnapshots([snapshot.value]);
    };
    const media = document.createElement('div'); media.className = 'viewer-epub-inline-media'; article.append(media);
    await fallback('Active inline media'); media.remove();
    const range = document.createRange(); range.selectNodeContents(article.querySelector('p'));
    window.getSelection().addRange(range); await fallback('Active text selection'); window.getSelection().removeAllRanges();
    check(nativeCalls === 1, 'Interactive optimized pages must stay on the renderer path');
    window.viewerAPI.captureEpubCurl = async () => { nativeCalls += 1; throw new Error('Native surface unavailable'); };
    await fallback('Native rejection'); check(nativeCalls === 2, 'Optimized bridge rejection not exercised');
    delete window.viewerAPI; await fallback('No bridge');
    nodes.forEach(node => node.remove()); sheet.remove();
    expectReleased('Optimized native and fallback captures must release their canvases');
    return glyphCoverage;
}
window.testDone = (async () => {
    applyMotionPreference('full');
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

    const dragStarts = [];
    let dragCancels = 0;
    renderBook({ onTurnStart: index => dragStarts.push(index), onTurnCancel: () => { dragCancels += 1; } });
    api().turnToPage(2);
    await frames();
    let drag = dragPoints();
    const beforeDrag = changes.length;
    dragEvent('pointerdown', drag.x, drag.y);
    dragEvent('pointermove', drag.move(0.16), drag.y);
    await until(() => painted(overlay()), 'Dragging must display a curl before pointerup');
    const firstDragFrame = overlay().toDataURL();
    await new Promise(resolve => setTimeout(resolve, 250));
    check(changes.length === beforeDrag && api().getCurrentPageIndex() === 2, 'Holding a drag must not auto-complete');
    dragEvent('pointermove', drag.move(0.42), drag.y - 20);
    await frames();
    check(overlay().toDataURL() !== firstDragFrame, 'The curl surface must follow pointer movement');
    dragEvent('pointerup', drag.move(0.42), drag.y - 20);
    await until(() => api().getCurrentPageIndex() === 4 && !book().hasAttribute('data-curl-dragging'), 'Released drag must finish on the target spread');
    check(changes.slice(beforeDrag).join(',') === '4' && dragStarts.at(-1) === 4, 'A completed drag must commit exactly once');
    expectReleased('Completed drag must release its snapshots');
    check(!book().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), 'A drag must suppress its following click');

    drag = dragPoints('left');
    const beforeRollback = changes.length;
    dragEvent('pointerdown', drag.x, drag.y);
    dragEvent('pointermove', drag.move(0.08), drag.y);
    await until(() => painted(overlay()), 'A short drag must preview the fold');
    dragEvent('pointerup', drag.move(0.08), drag.y);
    await until(() => !book().hasAttribute('data-curl-dragging'), 'A short drag must roll back');
    check(changes.length === beforeRollback && api().getCurrentPageIndex() === 4 && dragCancels === 1, 'Rollback must preserve the original page');
    expectReleased('Rollback must release its snapshots');

    for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur', 'resize', 'absolute']) {
        drag = dragPoints('left');
        dragEvent('pointerdown', drag.x, drag.y);
        dragEvent('pointermove', drag.move(0.4), drag.y);
        await until(() => painted(overlay()), cancellation + ' requires a held curl');
        const beforeCancel = changes.length;
        if (cancellation === 'blur') window.dispatchEvent(new Event('blur'));
        else if (cancellation === 'resize') renderBook({ width: 300, height: 380 });
        else if (cancellation === 'absolute') api().turnToPage(0);
        else dragEvent(cancellation, drag.move(0.4), drag.y);
        await until(() => !book().hasAttribute('data-curl-dragging'), cancellation + ' must clear the drag');
        await frames();
        check(changes.slice(beforeCancel).join(',') === (cancellation === 'absolute' ? '0' : ''), cancellation + ' must not commit a stale target');
        expectReleased(cancellation + ' must release its snapshots');
    }
    drag = dragPoints();
    dragEvent('pointerdown', drag.x, drag.y);
    dragEvent('pointermove', drag.move(0.4), drag.y);
    dragEvent('pointerup', drag.move(0.4), drag.y);
    await until(() => api().getCurrentPageIndex() === 2 && !book().hasAttribute('data-curl-dragging'), 'Release during snapshot preparation must finish the requested drag');
    expectReleased('Fast release must release its snapshots');
    drag = dragPoints();
    dragEvent('pointerdown', drag.x, drag.y);
    api().flip(4);
    await until(() => api().getCurrentPageIndex() === 4 && !book().hasAttribute('data-curl-dragging'), 'Automatic navigation must replace a pointerdown that has not started dragging');
    dragEvent('pointerup', drag.x, drag.y);
    expectReleased('Automatic navigation from a pending pointer must release its snapshots');
    results.push('pointer-driven curl, rollback, cancellation, resize and fast release');

    applyMotionPreference('reduced');
    await frames();
    const beforeReducedFlip = changes.length;
    const canvasCountBeforeReduced = transientCanvases().length;
    api().flip(6);
    check(api().getCurrentPageIndex() === 6 && changes.slice(beforeReducedFlip).join(',') === '6', 'Reduced motion must commit synchronously once');
    check(!painted(overlay()) && transientCanvases().length === canvasCountBeforeReduced, 'Reduced motion must not prepare snapshots');
    api().flip(4);
    check(api().getCurrentPageIndex() === 4, 'Reduced motion must accept the next navigation without a timer');
    await frames();
    drag = dragPoints('left');
    dragEvent('pointerdown', drag.x, drag.y);
    dragEvent('pointermove', drag.move(0.4), drag.y);
    check(!painted(overlay()) && api().getCurrentPageIndex() === 4, 'Reduced drag must keep the page static until release');
    dragEvent('pointerup', drag.move(0.4), drag.y);
    check(api().getCurrentPageIndex() === 2 && !book().hasAttribute('data-curl-dragging'), 'Reduced drag must commit immediately on release');
    await frames();
    drag = dragPoints();
    dragEvent('pointerdown', drag.x, drag.y);
    dragEvent('pointermove', drag.move(0.4), drag.y);
    applyMotionPreference('full');
    await frames();
    check(!book().hasAttribute('data-curl-dragging') && api().getCurrentPageIndex() === 2, 'Restoring full motion during a reduced drag must cancel the gesture and release input');
    await startFlip(4);
    applyMotionPreference('reduced');
    await frames();
    check(api().getCurrentPageIndex() === 4 && !painted(overlay()), 'Enabling reduced motion must complete an active curl');
    expectReleased('Reduced motion must release active snapshot canvases');
    applyMotionPreference('full');
    await frames();
    api().flip(6);
    applyMotionPreference('reduced');
    await frames(3);
    check(api().getCurrentPageIndex() === 6 && !painted(overlay()), 'Enabling reduced motion during snapshot preparation must commit immediately');
    await frames(3);
    expectReleased('Late snapshot completion after reduced motion must release its canvases');
    applyMotionPreference('full');
    await frames();
    results.push('reduced motion immediate turns, drag, and active preparation cleanup');

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

    const atlasFontStyle = document.createElement('style');
    atlasFontStyle.textContent = '@font-face{font-family:FixtureAtlasFont;src:url("/@fs/${path.join(projectRoot, 'src/fonts/NanumGothic-Bold.ttf')}")}';
    document.head.append(atlasFontStyle);
    await document.fonts.load('18px FixtureAtlasFont', '한국어');
    const atlasLeaves = [0, 1, 2, 3].map(index => document.querySelector('[data-flipbook-index="' + index + '"]'));
    atlasLeaves.forEach((leaf, index) => {
        const article = leaf.querySelector('.viewer-text-page');
        article.style.fontFamily = 'FixtureAtlasFont';
        article.style.background = colors[index];
    });
    await frames();
    const atlasSources = [];
    const nativeAtlasDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function (...args) {
        if (this.src.startsWith('data:image/svg+xml')) atlasSources.push(decodeURIComponent(this.src.slice(this.src.indexOf(',') + 1)));
        return nativeAtlasDecode.apply(this, args);
    };
    let atlasResults;
    try {
        atlasResults = await snapshotPageCurlLeaves(atlasLeaves.map((node, index) => ({ node, width: 240, height: 320, pixelRatio: 2, x: index % 2 * 240 })));
    } finally {
        HTMLImageElement.prototype.decode = nativeAtlasDecode;
    }
    check(atlasResults.every(result => result.status === 'fulfilled'), 'All atlas leaves must produce snapshots');
    check(atlasSources.length === 1 && (atlasSources[0].match(/@font-face/g) || []).length === 1, 'Four reader leaves must embed and decode their shared font only once');
    check(atlasSources[0].includes('data-bookmanager-curl-style'), 'Repeated computed styles must share their serialized declarations');
    for (const [index, result] of atlasResults.entries()) {
        const entry = result.value;
        check(entry.image.width === 480 && entry.image.height === 640 && entry.frame.x === index % 2 * 240, 'Atlas crops must preserve pixel ratio and leaf placement');
        const pixels = entry.image.getContext('2d').getImageData(0, 0, 480, 640).data;
        const expected = colors[index].slice(1).match(/../g).map(value => parseInt(value, 16));
        check(expected.every((value, channel) => Math.abs(pixels[(10 * 480 + 10) * 4 + channel] - value) < 3), 'Atlas crops must retain each leaf background without neighboring pixels');
        let glyphPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3] > 128 && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 80) glyphPixels += 1;
        }
        check(glyphPixels > 100, 'Every atlas crop must contain Korean and ruby text in its embedded font');
    }
    releasePageCurlSnapshots(atlasResults.map(result => result.value));
    atlasFontStyle.remove();
    expectReleased('Reader atlas and its cropped snapshots must release all backing stores');
    results.push('reader atlas shares fonts and preserves double-density leaf crops');

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
    const plainLoaded = new Promise(resolve => embeddedFrame.addEventListener('load', resolve, { once: true }));
    embeddedLeaf.style.cssText += ';position:fixed;z-index:10000';
    embeddedFrame.style.transform = 'none';
    embeddedFrame.srcdoc = '<html><head><style data-original-layout>html{width:240px;height:320px;column-width:240px;column-gap:0;column-fill:auto;overflow:hidden}body{margin:0;background:white}html{background:white}p{box-sizing:border-box;margin:0;padding:5px;height:80px;background:#1463ac;color:white;font:18px serif}p:nth-child(odd){background:#6a348c}</style></head><body>' + '<p>본문 123</p>'.repeat(640) + '</body></html>';
    await plainLoaded;
    const source = embeddedFrame.contentDocument;
    source.documentElement.scrollLeft = 157 * 240;
    await frames();
    const textSnapshot = await snapshotPageCurlLeaf(embeddedLeaf, { width: 240, height: 320 });
    const chapterContext = textSnapshot.image.getContext('2d');
    const samplePoints = [{ x: 100, y: 40 }, { x: 25, y: 120 }, { x: 100, y: 200 }, { x: 25, y: 280 }];
    const actualColors = await screenPixels(samplePoints);
    samplePoints.forEach(({ x, y }, index) => {
        const pixel = chapterContext.getImageData(x, y, 1, 1).data;
        const expected = index % 2 === 0 ? [106, 52, 140] : [20, 99, 172];
        check(pixel[3] === 255 && expected.every((value, channel) => Math.abs(pixel[channel] - value) <= 2 && Math.abs(pixel[channel] - actualColors[index][channel]) <= 2),
            'The curl must match the displayed late column and its publisher CSS: ' + pixel + ' vs ' + actualColors[index]);
    });
    const glyphs = chapterContext.getImageData(5, 5, 100, 32).data;
    check(glyphs.some((value, offset) => offset % 4 === 0 && value > 180), 'Plain chapter glyphs must be visible in the curl');
    releasePageCurlSnapshots([textSnapshot]);
    embeddedLeaf.remove();
    expectReleased('Embedded EPUB snapshots must release all temporary canvas backing stores');
    results.push('original EPUB iframe text and current column snapshots');

    await verifyNativeEpubSnapshots();
    results.push('native original EPUB capture eligibility, columns, scaled composition and renderer fallback');
    const optimizedGlyphCoverage = await verifyOptimizedEpubSnapshots();
    results.push('native optimized EPUB glyph coverage, layout, highlight and styled header/footer');

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
                check(delayedSnapshots === 3 && performance.now() - startedAt >= 900, 'The slow-reader regression must delay the player snapshots and shared reader atlas');
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

    const renderLongLeaf = index => <div key={index} data-flipbook-index={index}><span>Page {index}</span></div>;
    renderBook({ spread: true, startPage: 10000, preparedPage: 10000, pageCount: 12000, renderLeaf: renderLongLeaf }, 'long', null);
    await until(() => visibleIndexes().join(',') === '10000,10001', 'Long book did not restore the distant spread');
    check(book().querySelectorAll('[data-flipbook-index]').length <= 8, 'Long books must only mount current and nearby leaves');
    api().turnToPage(11800);
    await until(() => visibleIndexes().join(',') === '11800,11801', 'Jump to an unmounted spread lost the absolute page index');
    const openSpread = [...book().querySelectorAll('[data-curl-visible="true"]')];
    renderBook({ pageCount: 13000, indexRevision: 'complete', preparedPage: 11900,
        renderLeaf: index => <div key={index - 100} data-flipbook-index={index}><span>Page {index - 100}</span></div>,
    }, 'long', null);
    await until(() => visibleIndexes().join(',') === '11900,11901', 'Page numbers were not updated after the full book was measured');
    check(openSpread.every((node, slot) => node.isConnected && node.dataset.flipbookIndex === String(11900 + slot)),
        'Renumbering the current spread must keep the displayed leaves mounted');
    renderBook({ spread: false, startPage: 2, preparedPage: 2, pageCount: undefined, renderLeaf: undefined }, 'single-again');
    await until(() => visibleIndexes().join(',') === '2', 'Did not restore single-page fixture');
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
    return { results, changes, initialPixels, readerGlyphPixels, optimizedGlyphCoverage, transientCanvasCount: transientCanvases().length };
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
            server: { host: '127.0.0.1', fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const address = server.httpServer.address();
        assert.ok(address && typeof address === 'object');
        const fixtureUrl = `http://127.0.0.1:${address.port}/`;
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pageCurlFixture', {
    capture: () => ipcRenderer.invoke('page-curl-fixture:capture'),
    raster: request => ipcRenderer.invoke('page-curl-fixture:raster', request),
});
`);
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs/promises');
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-document', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const { createEpubCurlSurface } = await import(${JSON.stringify(pathToFileURL(path.join(projectRoot, 'electron/viewerCurlSurface.js')).href)});
    const font = await fs.readFile(${JSON.stringify(path.join(projectRoot, 'src/fonts/NanumGothic-Bold.ttf'))});
    const bookFont = 'bookmanager-document://session/sample/asset/publisher.ttf';
    const manager = { getDocumentAssetFromRequest: async url => url === bookFont ? { buffer: font, mime: 'font/ttf' } : null };
    const surface = createEpubCurlSurface(manager);
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    window.webContents.session.protocol.handle('https', () => new Response('<html><body>Test video<script>parent.postMessage("media-fixture-loaded", "*")</script></body></html>', { headers: { 'Content-Type': 'text/html' } }));
    window.webContents.session.protocol.handle('bookmanager-document', request => request.url === bookFont
        ? new Response(font, { headers: { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*' } }) : new Response(null, { status: 404 }));
    ipcMain.handle('page-curl-fixture:raster', (_event, { sessionId, documents, pages }) => surface.capture(sessionId, documents, pages));
    ipcMain.handle('page-curl-fixture:capture', async () => (await window.webContents.capturePage()).toDataURL());
    window.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) process.stderr.write(message + '\\n');
    });
    try {
        await window.loadURL(${JSON.stringify(fixtureUrl)});
        const result = await window.webContents.executeJavaScript('(async () => { const deadline = Date.now() + 10000; while (!window.testDone && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20)); if (!window.testDone) throw new Error("Page curl fixture failed to load"); return window.testDone; })()');
        process.stdout.write('PAGE_CURL_RESULT=' + JSON.stringify(result) + '\\n');
        surface.dispose();
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
        assert.equal(report.results.length, 17);
        assert.ok(report.transientCanvasCount > 1, 'The renderer must exercise actual snapshot allocation');
        t.diagnostic(payload);
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
