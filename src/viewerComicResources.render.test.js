import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDeflate, deflateSync } from 'node:zlib';
import test from 'node:test';
import { createServer } from 'vite';
import { crc32 } from '../electron/core/zipArchive.js';

function pngChunk(name, content) {
    const type = Buffer.from(name);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(content.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, content])));
    return Buffer.concat([header, type, content, checksum]);
}

function pngHeader(width, height, colorType = 2) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header)]);
}

function createPngFixture(width, height, simple = false) {
    const pixels = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * 3 + 1);
        for (let x = 0; x < width; x += 1) {
            const offset = row + 1 + x * 3;
            pixels[offset] = simple ? (x >>> 4) % 256 : x % 256;
            pixels[offset + 1] = simple ? (y >>> 4) % 256 : y % 256;
            pixels[offset + 2] = simple ? ((x ^ y) >>> 7) % 256 : ((x ^ y) >>> 3) % 256;
        }
    }
    const image = Buffer.concat([
        pngHeader(width, height),
        pngChunk('IDAT', deflateSync(pixels)),
    ]);
    const paddingLength = Math.max(0, 100 * 1024 - image.length - 12 - 12 - 8);
    const padding = simple ? [pngChunk('tEXt', Buffer.concat([Buffer.from('Fixture\0'), Buffer.alloc(paddingLength, 65)]))] : [];
    return Buffer.concat([image, ...padding, pngChunk('IEND', Buffer.alloc(0))]);
}

export async function createTallPngFixture(filePath, width = 720, height = 125000) {
    const file = await fs.open(filePath, 'w');
    const deflater = createDeflate({ level: 1 });
    let seed = 0x12345678;
    let position = 0;
    const write = async bytes => {
        let written = 0;
        while (written < bytes.length) {
            const result = await file.write(bytes, written, bytes.length - written, position);
            written += result.bytesWritten;
            position += result.bytesWritten;
        }
    };
    try {
        await write(pngHeader(width, height, 0));
        const output = (async () => {
            for await (const chunk of deflater) await write(pngChunk('IDAT', chunk));
        })();
        for (let start = 0; start < height; start += 256) {
            const rows = Math.min(256, height - start);
            const pixels = Buffer.alloc((width + 1) * rows);
            for (let localY = 0; localY < rows; localY += 1) {
                const row = localY * (width + 1);
                const randomRow = (start + localY) % 3 === 0;
                for (let x = 0; x < width; x += 1) {
                    if (randomRow) {
                        seed ^= seed << 13;
                        seed ^= seed >>> 17;
                        seed ^= seed << 5;
                    }
                    pixels[row + x + 1] = randomRow ? seed & 255 : (start + localY) % 256;
                }
            }
            if (!deflater.write(pixels)) await new Promise(resolve => deflater.once('drain', resolve));
        }
        deflater.end();
        await output;
        await write(pngChunk('IEND', Buffer.alloc(0)));
        return { filePath, width, height, encodedBytes: position };
    } finally {
        deflater.destroy();
        await file.close();
    }
}

test('대용량 만화는 읽기와 효과를 유지하며 이미지 수와 렌더러 메모리 증가를 제한한다', { timeout: 180000 }, async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-comic-resources-')));
    let server;
    try {
        const fixtureMode = process.env.BOOKMANAGER_COMIC_FIXTURE || 'bmp';
        const tallFixture = fixtureMode === 'tall-png';
        const splitFixture = fixtureMode === 'split-png';
        const pngFixture = fixtureMode.endsWith('png');
        const width = tallFixture ? 720 : splitFixture ? 690 : pngFixture ? 1600 : 1024;
        const height = tallFixture ? 125000 : splitFixture ? 1800 : pngFixture ? 2400 : 1536;
        const png = pngFixture && !tallFixture ? createPngFixture(width, height, splitFixture) : null;
        if (png) await fs.writeFile(path.join(directory, 'fixture.png'), png);
        let tallBytes = 0;
        if (tallFixture) {
            if (process.env.BOOKMANAGER_COMIC_FIXTURE_FILE) {
                await fs.copyFile(process.env.BOOKMANAGER_COMIC_FIXTURE_FILE, path.join(directory, 'fixture.png'));
                tallBytes = (await fs.stat(path.join(directory, 'fixture.png'))).size;
            } else {
                tallBytes = (await createTallPngFixture(path.join(directory, 'fixture.png'))).encodedBytes;
            }
        }
        const fixture = {
            mode: fixtureMode,
            format: pngFixture ? 'png' : 'bmp',
            mime: pngFixture ? 'image/png' : 'image/bmp',
            width,
            height,
            encodedBytes: tallBytes || png?.length || 1024 * 1536 * 3 + 54,
            smallCount: pngFixture ? 24 : 200,
            pageCount: splitFixture ? 2000 : pngFixture ? 243 : 2000,
            folderCount: pngFixture ? 3 : 0,
            immersive: process.env.BOOKMANAGER_COMIC_IMMERSIVE === '1',
        };
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
import ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/styles/global.css')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const fixture = ${JSON.stringify(fixture)};
const resourceActivity = [];
const blobSources = new WeakMap();
const recordActivity = entry => { resourceActivity.push(entry); if (resourceActivity.length > 80) resourceActivity.shift(); return entry; };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.startsWith('bookmanager-comic:')) return nativeFetch(input, options);
    const entry = recordActivity({ kind: 'fetch', url, phase: 'started', at: performance.now() });
    try {
        const response = await nativeFetch(input, options);
        entry.phase = 'headers';
        return new Proxy(response, { get(target, key) {
            if (key === 'blob') return async () => {
                entry.phase = 'reading';
                const blob = await target.blob();
                blobSources.set(blob, url);
                entry.phase = 'complete';
                entry.bytes = blob.size;
                return blob;
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
    } catch (error) { entry.phase = 'error'; entry.error = error.message; throw error; }
};
const nativeCreateImageBitmap = window.createImageBitmap.bind(window);
window.createImageBitmap = (...args) => {
    const entry = recordActivity({ kind: 'bitmap', url: blobSources.get(args[0]) || '', phase: 'started', at: performance.now(), resize: args[1] || null });
    return nativeCreateImageBitmap(...args).then(bitmap => {
        entry.phase = 'complete'; entry.width = bitmap.width; entry.height = bitmap.height;
        return bitmap;
    }, error => { entry.phase = 'error'; entry.error = error.message; throw error; });
};
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => { for (let index = 0; index < 12; index += 1) await frame(); };
async function until(predicate, message) {
    const deadline = performance.now() + (fixture.mode === 'tall-png' ? 30000 : 12000);
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error((typeof message === 'function' ? message() : message) + ': ' + document.body.innerText.slice(0, 200));
}
let loadSession;
let pageCount = fixture.pageCount;
let mount = 0;
let session;
window.comicRequestCancellations = 0;
window.viewerAPI = {
    getCurrentSession: async () => JSON.parse(localStorage.getItem('comic-resource-active-session') || 'null')?.session || null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getConfig: async () => ({ language: 'ko', motion_preference: 'full' }),
    listComicPages: async id => ({ pages: Array.from({ length: pageCount }, (_, index) => {
        const folder = fixture.folderCount ? 'chapter-' + (Math.floor(index / Math.ceil(pageCount / fixture.folderCount)) + 1) + '/' : '';
        const basename = String(index).padStart(5, '0') + '.' + fixture.format;
        return {
            index, name: folder + basename, basename,
            mime: fixture.mime, size: fixture.encodedBytes,
            pageUrl: 'bookmanager-comic://fixture/' + id + '/' + folder + basename,
        };
    }) }),
    listBundledFonts: async () => [],
    listSystemFonts: async () => [],
    cancelComicPageRequest: async (sessionId, requestId) => {
        check(sessionId.startsWith('resource-') && requestId, 'Managed page request lost its session or token');
        window.comicRequestCancellations += 1;
        await window.comicMemoryProbe.cancel(requestId);
    },
};
const root = createRoot(document.getElementById('root'));
const button = label => [...document.querySelectorAll('.viewer-toolbar button')].find(node => node.dataset.tooltip?.startsWith(label));
const scroll = () => document.querySelector('.viewer-content');
const bodyImages = () => [...document.querySelectorAll('.viewer-comic-image, .viewer-comic-tiled-page')];
const loadedBodyImages = () => bodyImages().filter(image => image.classList.contains('viewer-comic-tiled-page')
    ? image.dataset.comicTiledReady === 'true' : image.complete && image.naturalWidth > 0);
const liveImages = () => [...document.querySelectorAll('.viewer-comic-image, .viewer-comic-tile, .viewer-comic-page-frame .viewer-ambient-canvas, .viewer-slide-thumb.is-comic img, .viewer-slide-thumb.is-comic canvas')];
const thumbnailReady = node => {
    const image = node?.querySelector('img');
    const canvas = node?.querySelector('canvas');
    return (image?.complete && image.naturalWidth > 0) || (canvas?.style.display === 'block' && canvas.width > 0 && canvas.height > 0);
};
const imageStats = () => ({
    body: bodyImages().length,
    originalBodyImages: document.querySelectorAll('.viewer-comic-image').length,
    tiledBodies: document.querySelectorAll('.viewer-comic-tiled-page').length,
    tileCanvases: document.querySelectorAll('.viewer-comic-tile').length,
    ambientCanvases: document.querySelectorAll('.viewer-comic-page-frame .viewer-ambient-canvas').length,
    thumbnails: document.querySelectorAll('.viewer-slide-thumb.is-comic img, .viewer-slide-thumb.is-comic canvas').length,
    thumbnailImages: document.querySelectorAll('.viewer-slide-thumb.is-comic img').length,
    thumbnailCanvases: document.querySelectorAll('.viewer-slide-thumb.is-comic canvas').length,
    decodedPixels: liveImages().reduce((sum, image) => sum + (image.naturalWidth ?? image.width) * (image.naturalHeight ?? image.height), 0),
    sourcePixels: loadedBodyImages().reduce((sum, image) => sum + (image.naturalWidth ?? Number(image.dataset.comicSourceWidth)) * (image.naturalHeight ?? Number(image.dataset.comicSourceHeight)), 0),
});
const centerPage = () => {
    const content = scroll();
    const center = content.getBoundingClientRect().top + content.clientHeight / 2;
    for (const image of loadedBodyImages()) {
        const rect = image.getBoundingClientRect();
        if (image.classList.contains('viewer-comic-tiled-page')) {
            const paintedAtCenter = [...image.querySelectorAll('.viewer-comic-tile')].some(canvas => {
                const tileRect = canvas.getBoundingClientRect();
                if (!canvas.width || !canvas.height || tileRect.top > center || tileRect.bottom <= center) return false;
                const sourceY = Math.min(canvas.height - 1, Math.floor((center - tileRect.top) / tileRect.height * canvas.height));
                return canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), sourceY, 1, 1).data[3] > 0;
            });
            if (!paintedAtCenter) continue;
        }
        if (rect.top <= center && rect.bottom > center) return {
            index: Number(image.closest('[data-page-index]').dataset.pageIndex),
            fraction: (center - rect.top) / rect.height,
        };
    }
    return null;
};
let imageLoadTrace = [];
document.addEventListener('load', event => {
    const image = event.target;
    const content = scroll();
    if (!image?.classList?.contains('viewer-comic-image') || !content) return;
    const viewport = content.getBoundingClientRect();
    const hit = document.elementFromPoint(viewport.left + viewport.width / 2, viewport.top + content.clientHeight / 2);
    const wrapper = hit?.closest('[data-page-index]');
    imageLoadTrace.push({ loaded: image.closest('[data-page-index]')?.dataset.pageIndex, image: image.getBoundingClientRect().toJSON(), hitPage: wrapper?.dataset.pageIndex, hit: hit?.getBoundingClientRect().toJSON(), wrapper: wrapper?.getBoundingClientRect().toJSON(), viewport: viewport.toJSON() });
    imageLoadTrace = imageLoadTrace.slice(-12);
}, true);
function bounded(label) {
    const stats = imageStats();
    check(stats.body > 0 && stats.body <= (fixture.mode === 'tall-png' ? 2 : 32), label + ': unbounded body images ' + JSON.stringify(stats));
    check(stats.thumbnails <= 40, label + ': unbounded thumbnail images ' + JSON.stringify(stats));
    check(stats.tileCanvases <= 12, label + ': unbounded visible image tiles ' + JSON.stringify(stats));
    if (fixture.mode === 'tall-png') check(stats.originalBodyImages === 0 && stats.tiledBodies > 0, label + ': giant static PNG escaped the bounded tile path');
    check(stats.decodedPixels <= (fixture.mode === 'tall-png' ? 24 : fixture.format === 'png' ? 160 : 112) * 1024 * 1024, label + ': unbounded attached decoded pixels ' + JSON.stringify(stats));
    return stats;
}
window.openComicResourceFixture = async ({ count = fixture.pageCount, mode = 'scroll', effect = 'none' } = {}) => {
    pageCount = count;
    root.render(null);
    await settle();
    localStorage.clear();
    localStorage.setItem('bookmanager-viewer-prefs:comic', JSON.stringify({
        flowMode: mode, viewMode: fixture.mode === 'tall-png' ? 'width' : 'fit', zoom: 100, slideNavOpen: false,
        viewerBackground: { mode: fixture.immersive ? 'immersive' : 'solid' },
        spreadCoverFirst: true, readerSettings: { pageEffect: effect },
    }));
    loadSession = null;
    root.render(<ViewerApp key={++mount} />);
    await until(() => loadSession, 'Session listener unavailable');
    session = { id: 'resource-' + mount, type: 'comic', filePath: '/fixture/resource-' + mount + (fixture.format === 'png' ? '.zip' : '.cbz'), fileName: 'Resource fixture', preview: true };
    await loadSession(session);
    await until(() => loadedBodyImages().length > 0 && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Comic did not become ready');
    await settle();
    check(!document.querySelector('.viewer-slide-thumb.is-comic img, .viewer-slide-thumb.is-comic canvas'), 'Closed page navigation retained images');
    if (mode === 'scroll') {
        check(document.querySelectorAll('.viewer-comic-scroll [data-page-index]').length >= count, 'Unloaded pages lost their navigation anchors');
        await until(() => centerPage(), 'Initial scroll page is blank');
    }
    localStorage.setItem('comic-resource-active-session', JSON.stringify({ session, pageCount }));
    return bounded('open-' + count);
};
window.restoreComicResourceAfterReload = async () => {
    const saved = JSON.parse(localStorage.getItem('comic-resource-active-session') || 'null');
    check(saved?.session, 'Reload fixture lost its active book');
    session = saved.session;
    pageCount = saved.pageCount;
    root.render(<ViewerApp key={++mount} />);
    await until(() => loadedBodyImages().length > 0 && !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading'), 'Refreshing the viewer left the initial loading screen active');
    await settle();
    check(document.querySelector('.viewer-comic-scroll'), 'Reload changed the selected scroll layout');
    return bounded('reload');
};
window.visitComicResourcePage = async ({ index }) => {
    imageLoadTrace = [];
    scroll().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 0 }));
    const target = document.querySelector('.viewer-comic-scroll [data-page-index="' + index + '"]');
    check(target, 'Missing unloaded page anchor ' + index);
    const trace = [];
    const capture = phase => trace.push({ phase, top: scroll().scrollTop, viewport: scroll().getBoundingClientRect().toJSON(), zoom: button('확대/축소')?.textContent, target: target.getBoundingClientRect().toJSON(), center: centerPage(), mounted: bodyImages().map(image => ({ index: image.closest('[data-page-index]')?.dataset.pageIndex, top: image.getBoundingClientRect().top, height: image.getBoundingClientRect().height })) });
    capture('before');
    target.scrollIntoView({ block: 'start' });
    capture('scrolled');
    await until(() => loadedBodyImages().some(image => Number(image.closest('[data-page-index]').dataset.pageIndex) === index), () => {
        capture('timeout');
        return 'Jumped page did not load ' + index + ': ' + JSON.stringify({ top: scroll().scrollTop, targetTop: target.offsetTop, mounted: [...document.querySelectorAll('[data-comic-mounted]')].map(page => page.dataset.pageIndex), trace, imageLoadTrace });
    });
    await settle();
    capture('settled');
    check(centerPage()?.index === index, 'Page loading moved the reading anchor: ' + JSON.stringify({ expected: index, actual: centerPage(), trace, imageLoadTrace }));
    const anchorOffset = target.getBoundingClientRect().top - scroll().getBoundingClientRect().top - scroll().clientTop;
    check(Math.abs(anchorOffset) <= 2, 'Page loading skipped the beginning of the selected page: ' + JSON.stringify({ index, anchorOffset, trace, imageLoadTrace }));
    return { ...bounded('visit-' + index), anchorOffset, center: centerPage() };
};
window.checkTallComicBoundary = async () => {
    const content = scroll();
    content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 0 }));
    const firstPage = content.querySelector('[data-page-index="0"]');
    const viewportTop = content.getBoundingClientRect().top + content.clientTop;
    content.scrollTop += firstPage.getBoundingClientRect().bottom - viewportTop - content.clientHeight * 1.5;
    await until(() => loadedBodyImages().some(image => Number(image.closest('[data-page-index]').dataset.pageIndex) === 1),
        () => 'Next giant page was not prepared near the boundary: ' + JSON.stringify({ scrollTop: content.scrollTop, center: centerPage(), mounted: [...document.querySelectorAll('[data-comic-mounted]')].map(page => page.dataset.pageIndex) }));
    await settle();
    check(centerPage()?.index === 0, 'Preloading the next giant page displaced the current page');
    const approaching = bounded('giant-boundary-approach');
    content.scrollTop += content.clientHeight * 1.25;
    await until(() => centerPage()?.index === 1, 'Crossing the giant page boundary left the visible page blank');
    await settle();
    return { approaching, crossed: bounded('giant-boundary-crossed') };
};
window.checkComicResourceThumbnails = async () => {
    document.querySelector('.viewer-slide-toggle').click();
    await until(() => [...document.querySelectorAll('.viewer-slide-thumb.is-comic')].some(thumbnailReady), 'Visible thumbnails did not load');
    await settle();
    if (fixture.format === 'png') {
        check(document.querySelectorAll('.viewer-slide-thumb.is-comic img').length === 0, 'Static PNG thumbnails retained full-size image elements');
    }
    const opened = bounded('thumbnails-open');
    const targetIndex = Math.floor(pageCount * 0.875);
    const target = [...document.querySelectorAll('.viewer-slide-thumb.is-comic')].find(node => node.getAttribute('aria-label') === (targetIndex + 1) + ' 페이지로 이동');
    check(target, 'Distant page disappeared from thumbnail navigation');
    target.scrollIntoView({ inline: 'center', block: 'nearest' });
    await until(() => thumbnailReady(target), 'Distant thumbnail did not load');
    target.click();
    await until(() => centerPage()?.index === targetIndex, 'Thumbnail navigation lost its page target');
    await settle();
    bounded('thumbnails-jump');
    document.querySelector('.viewer-slide-toggle').click();
    await until(() => document.querySelectorAll('.viewer-slide-thumb.is-comic img, .viewer-slide-thumb.is-comic canvas').length === 0, 'Closing thumbnails did not release their images');
    return opened;
};
window.checkComicResourceResume = async () => {
    const index = Math.floor(pageCount * 0.75);
    if (fixture.mode === 'tall-png' && fixture.immersive) {
        window.comicDebugTarget = index;
        document.querySelector('.viewer-slide-toggle').click();
        await until(() => document.querySelectorAll('.viewer-slide-thumb.is-comic').length > 0, 'Resume page navigation did not open');
        const target = [...document.querySelectorAll('.viewer-slide-thumb.is-comic')].find(node => node.getAttribute('aria-label') === (index + 1) + ' 페이지로 이동');
        check(target, 'Resume thumbnail target is missing');
        target.scrollIntoView({ inline: 'center', block: 'nearest' });
        target.click();
        await until(() => centerPage()?.index === index, () => 'Thumbnail jump did not reach the resume page: ' + JSON.stringify(window.comicResourceDebugSnapshot()));
        document.querySelector('.viewer-slide-toggle').click();
        await settle();
    } else await window.visitComicResourcePage({ index });
    const page = scroll().querySelector('[data-page-index="' + index + '"]');
    let previousGeometry = '';
    let geometryStableSince = performance.now();
    await until(() => {
        const rect = page.getBoundingClientRect();
        const geometry = [rect.top, rect.height, scroll().scrollTop].join(':');
        if (geometry !== previousGeometry) {
            previousGeometry = geometry;
            geometryStableSince = performance.now();
        }
        return performance.now() - geometryStableSince >= 350;
    }, 'Resume fixture layout did not settle after its page jump');
    scroll().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 0 }));
    const viewportTop = scroll().getBoundingClientRect().top + scroll().clientTop;
    const pageRect = page.getBoundingClientRect();
    scroll().scrollTop += pageRect.top - viewportTop + pageRect.height * 0.35;
    const stateKey = 'bookmanager-viewer-state:' + session.filePath;
    await until(() => {
        const saved = JSON.parse(localStorage.getItem(stateKey) || '{}').comicScrollPosition;
        return saved?.pageIndex === index && saved.offsetRatio > 0.3 && saved.offsetRatio < 0.4;
    }, () => 'Scroll reading position was not saved: ' + JSON.stringify({ saved: JSON.parse(localStorage.getItem(stateKey) || '{}'), scrollTop: scroll().scrollTop, page: page.getBoundingClientRect().toJSON() }));
    await settle();
    const expected = JSON.parse(localStorage.getItem(stateKey)).comicScrollPosition;
    check(expected.offsetRatio > 0.3 && expected.offsetRatio < 0.4, 'Fixture did not save an offset inside the page: ' + JSON.stringify({ expected, initialPage: pageRect.toJSON(), currentPage: page.getBoundingClientRect().toJSON(), scrollTop: scroll().scrollTop }));
    const position = () => {
        const content = scroll();
        const top = content.getBoundingClientRect().top + content.clientTop;
        const target = content.querySelector('[data-page-index="' + index + '"]');
        const rect = target.getBoundingClientRect();
        return { ratio: (top - rect.top) / rect.height, height: rect.height };
    };
    const remount = async legacy => {
        root.render(null);
        await settle();
        if (legacy) localStorage.setItem(stateKey, JSON.stringify({ pageIndex: index, scrollPercent: 75, pageCount }));
        loadSession = null;
        localStorage.removeItem('comic-resource-active-session');
        root.render(<ViewerApp key={++mount} />);
        await until(() => loadSession, 'Resume session listener unavailable');
        session = { ...session, id: 'resource-resume-' + mount };
        await loadSession(session);
        await until(() => loadedBodyImages().some(image => Number(image.closest('[data-page-index]')?.dataset.pageIndex) === index), 'Saved page did not load');
        await until(() => Math.abs(position().ratio - (legacy ? 0 : expected.offsetRatio)) * position().height <= 2,
            'Resuming the book lost its page or within-page offset');
        await settle();
        check(Math.abs(position().ratio - (legacy ? 0 : expected.offsetRatio)) * position().height <= 2,
            'Late image loading displaced the resumed page');
        return { ...position(), ...bounded(legacy ? 'legacy-resume' : 'resume') };
    };
    return { expected, restored: await remount(false), legacy: await remount(true) };
};
window.checkComicResourceEffect = async ({ effect }) => {
    if (effect === 'page') {
        check(document.querySelector('.viewer-flipbook'), 'Book turn renderer was removed');
    }
    const previous = button('다음장');
    check(previous && !previous.disabled, 'Next-page action unavailable');
    const before = document.querySelector('.viewer-title small').textContent;
    previous.click();
    await until(() => effect === 'page'
        ? document.querySelector('[data-curl-animating]')
        : document.querySelector('.viewer-comic-stage.has-page-effect'), 'Selected transition did not run: ' + effect);
    await until(() => document.querySelector('.viewer-title small').textContent !== before
        && !document.querySelector('.viewer-comic-stage.has-page-effect, [data-curl-animating]'), 'Page effect did not finish: ' + effect);
    await until(() => loadedBodyImages().some(image => Number(image.closest('[data-page-index]')?.dataset.pageIndex) > 0), 'Advanced page was not displayed');
    await settle();
    const stats = bounded('effect-' + effect);
    const prefs = JSON.parse(localStorage.getItem('bookmanager-viewer-prefs:comic'));
    check(prefs.readerSettings.pageEffect === effect, 'Selected page effect was changed');
    return stats;
};
window.comicResourceSnapshot = () => ({ ...imageStats(), center: centerPage() });
window.comicResourceDebugSnapshot = () => {
    const content = scroll();
    const target = content?.querySelector('[data-page-index="' + window.comicDebugTarget + '"]');
    const targetButton = [...document.querySelectorAll('.viewer-slide-thumb.is-comic')].find(node => node.getAttribute('aria-label') === (window.comicDebugTarget + 1) + ' 페이지로 이동');
    return {
        ...window.comicResourceSnapshot(), targetIndex: window.comicDebugTarget,
        title: document.querySelector('.viewer-title')?.textContent,
        activeThumbnail: document.querySelector('.viewer-slide-thumb[aria-current="page"]')?.getAttribute('aria-label'),
        targetButton: targetButton && { label: targetButton.getAttribute('aria-label'), disabled: targetButton.disabled, current: targetButton.getAttribute('aria-current'), rect: targetButton.getBoundingClientRect().toJSON() },
        scroll: content && { top: content.scrollTop, left: content.scrollLeft, height: content.scrollHeight, width: content.scrollWidth, clientHeight: content.clientHeight, translate: content.style.getPropertyValue('--viewer-zoom-translate'), rect: content.getBoundingClientRect().toJSON() },
        target: target?.getBoundingClientRect().toJSON(),
        mounted: [...document.querySelectorAll('[data-comic-mounted]')].map(node => ({ index: node.dataset.pageIndex, rect: node.getBoundingClientRect().toJSON(), ready: node.querySelector('.viewer-comic-tiled-page')?.dataset.comicTiledReady, placeholder: Boolean(node.querySelector('.viewer-comic-placeholder')), source: node.querySelector('img')?.currentSrc })),
        activity: resourceActivity.slice(-24),
    };
};
window.checkTallComicPixels = async () => {
    const tiles = [...document.querySelectorAll('.viewer-comic-tile[data-comic-tile-ready="true"]')];
    check(tiles.length > 0, 'Tall PNG did not produce painted image tiles');
    for (const canvas of tiles) {
        const sourceTop = Number(canvas.dataset.comicTileIndex) * 2048;
        const y = [1, 2, 3].find(value => (sourceTop + value) % 3 !== 0);
        const actual = [...canvas.getContext('2d').getImageData(10, y, 1, 1).data];
        const expected = (sourceTop + y) % 256;
        check(actual[0] === expected && actual[1] === expected && actual[2] === expected && actual[3] === 255,
            'Image tile changed its source pixels or crop offset: ' + JSON.stringify({ sourceTop, y, actual, expected }));
    }
    const ambient = [...document.querySelectorAll('.viewer-comic-tiled-page .viewer-ambient-canvas')];
    if (fixture.immersive) {
        check(document.querySelector('.viewer-app.is-background-immersive'), 'Immersive background preference was lost');
        check(ambient.length > 0 && ambient.every(canvas => canvas.width > 0 && canvas.height > 1
            && canvas.getContext('2d').getImageData(0, Math.floor(canvas.height / 2), 1, 1).data[3] > 0), 'Immersive background did not retain the page image');
    }
    return { pixelsChecked: tiles.length, ambientCanvases: ambient.length, ...bounded('source-pixels') };
};
let tallCenterBeforeResize;
window.captureTallComicPosition = async () => {
    await settle();
    tallCenterBeforeResize = centerPage();
    check(tallCenterBeforeResize, 'Tall comic has no painted page before resizing');
    return tallCenterBeforeResize;
};
window.checkTallComicResize = async () => {
    await settle();
    await until(() => {
        const current = centerPage();
        const image = loadedBodyImages().find(node => Number(node.closest('[data-page-index]').dataset.pageIndex) === current?.index);
        return current?.index === tallCenterBeforeResize.index && image
            && Math.abs(current.fraction - tallCenterBeforeResize.fraction) * image.getBoundingClientRect().height <= 2;
    }, 'Resizing lost the tall PNG reading anchor');
    return { center: centerPage(), scrollTop: scroll().scrollTop, translate: scroll().style.getPropertyValue('--viewer-zoom-translate'), ...await window.checkTallComicPixels() };
};
let tallWheelBefore;
let tallWheelDelta;
window.addEventListener('wheel', event => { tallWheelDelta = event.deltaY; }, { capture: true, passive: true });
window.prepareTallComicWheel = async () => {
    await settle();
    tallWheelBefore = centerPage();
    tallWheelDelta = null;
    check(tallWheelBefore, 'Tall PNG has no painted page before wheel scrolling');
    const bounds = scroll().getBoundingClientRect();
    return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2), scrollTop: scroll().scrollTop, translate: scroll().style.getPropertyValue('--viewer-zoom-translate') };
};
window.checkTallComicWheel = async () => {
    await until(() => tallWheelDelta !== null, 'Native wheel input did not reach the viewer');
    await until(() => {
        const current = centerPage();
        if (!current) return false;
        const distance = current.index - tallWheelBefore.index + current.fraction - tallWheelBefore.fraction;
        return tallWheelDelta < 0 ? distance < -0.00001 : distance > 0.00001;
    }, () => 'Zoom or resize prevented wheel scrolling: ' + JSON.stringify({ before: tallWheelBefore, current: centerPage(), deltaY: tallWheelDelta, scrollTop: scroll().scrollTop, translate: scroll().style.getPropertyValue('--viewer-zoom-translate') }));
    return { before: tallWheelBefore, current: centerPage(), deltaY: tallWheelDelta, scrollTop: scroll().scrollTop, translate: scroll().style.getPropertyValue('--viewer-zoom-translate') };
};
let tallZoomBefore;
window.prepareTallComicZoom = async () => {
    tallZoomBefore = { center: centerPage(), zoom: Number.parseFloat(button('확대/축소')?.textContent) };
    button('확대/축소').click();
    await until(() => document.querySelector('.viewer-zoom-range'), 'Zoom controls did not open');
    await settle();
    const input = document.querySelector('.viewer-zoom-range');
    const bounds = input.getBoundingClientRect();
    const point = { x: Math.round(bounds.left + 8 + (bounds.width - 16) * (200 - Number(input.min)) / (Number(input.max) - Number(input.min))), y: Math.round(bounds.top + bounds.height / 2) };
    check(document.elementFromPoint(point.x, point.y) === input, 'The zoom control is covered by another element');
    return point;
};
window.checkTallComicZoom = async () => {
    await until(() => Number.parseFloat(button('확대/축소')?.textContent) !== tallZoomBefore.zoom, 'Tall PNG did not apply the zoom control input');
    button('확대/축소').click();
    await settle();
    check(centerPage()?.index === tallZoomBefore.center?.index, 'Zoom changed the current tall PNG page');
    await until(() => {
        const current = centerPage();
        const page = loadedBodyImages().find(image => Number(image.closest('[data-page-index]').dataset.pageIndex) === current?.index);
        return current?.index === tallZoomBefore.center?.index && page
            && Math.abs(current.fraction - tallZoomBefore.center.fraction) * page.getBoundingClientRect().height <= 2;
    }, () => 'Zoom displaced the tall PNG reading position: ' + JSON.stringify({ before: tallZoomBefore, current: centerPage() }));
    const zoom = Number.parseFloat(button('확대/축소')?.textContent);
    check(JSON.parse(localStorage.getItem('bookmanager-viewer-prefs:comic')).zoom === zoom, 'Zoom control did not preserve the selected magnification');
    return { zoom, center: centerPage(), ...await window.checkTallComicPixels() };
};
window.comicResourceReady = true;
`);
        const appHtml = await fs.readFile(path.join(projectRoot, 'index.html'), 'utf8');
        const contentSecurityPolicy = appHtml.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i)?.[0];
        assert.ok(contentSecurityPolicy);
        await fs.writeFile(path.join(directory, 'index.html'), '<head>' + contentSecurityPolicy + '</head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body>');
        await fs.writeFile(path.join(directory, 'preload.cjs'), `
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('comicMemoryProbe', { read: () => process.getProcessMemoryInfo(), cancel: requestId => ipcRenderer.invoke('fixture:cancel-comic', requestId) });
`);
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
let safetyTimer = null;
let fixtureWindow = null;
protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-comic', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const fixture = ${JSON.stringify(fixture)};
    const width = fixture.width;
    const height = fixture.height;
    const image = fixture.format === 'png' ? require('fs').readFileSync(${JSON.stringify(path.join(directory, 'fixture.png'))}) : Buffer.alloc(54 + width * height * 3, 150);
    if (fixture.format === 'bmp') {
        image.write('BM', 0);
        image.writeUInt32LE(image.length, 2);
        image.writeUInt32LE(0, 6);
        image.writeUInt32LE(54, 10);
        image.writeUInt32LE(40, 14);
        image.writeInt32LE(width, 18);
        image.writeInt32LE(height, 22);
        image.writeUInt16LE(1, 26);
        image.writeUInt16LE(24, 28);
        image.writeUInt32LE(0, 30);
        image.writeUInt32LE(width * height * 3, 34);
        image.fill(0, 38, 54);
    }
    let requests = 0;
    let phaseRequests = 0;
    let managedRequests = 0;
    let activeResponses = 0;
    let peakActiveResponses = 0;
    const responseCancellations = new Map();
    const activeResponseUrls = new Map();
    ipcMain.handle('fixture:cancel-comic', (_event, requestId) => { responseCancellations.get(requestId)?.(); });
    protocol.handle('bookmanager-comic', async request => {
        requests += 1;
        if (new URL(request.url).searchParams.has('requestId')) managedRequests += 1;
        phaseRequests += 1;
        if (phaseRequests > 96) {
            console.error('Unbounded comic request burst: ' + phaseRequests);
            app.exit(1);
            return new Response('', { status: 429 });
        }
        let body = image;
        if (fixture.mode === 'tall-png') {
            activeResponses += 1;
            peakActiveResponses = Math.max(peakActiveResponses, activeResponses);
            if (activeResponses > 3) {
                console.error('Unsafe giant PNG response concurrency: ' + JSON.stringify({ activeResponses, activePhase, urls: [...activeResponseUrls.values(), request.url], latestSnapshot }));
                app.exit(1);
                return new Response('', { status: 429 });
            }
            let offset = 0;
            let finished = false;
            let responseController = null;
            const requestId = new URL(request.url).searchParams.get('requestId');
            const finish = (cancel = false) => {
                if (finished) return;
                finished = true;
                activeResponses -= 1;
                responseCancellations.delete(requestId);
                activeResponseUrls.delete(requestId);
                if (cancel) {
                    try { responseController?.close(); } catch {}
                }
            };
            body = new ReadableStream({
                start(controller) { responseController = controller; },
                async pull(controller) {
                    await new Promise(resolve => setTimeout(resolve, 2));
                    if (finished) return;
                    const end = Math.min(image.length, offset + 256 * 1024);
                    controller.enqueue(image.subarray(offset, end));
                    offset = end;
                    if (offset === image.length) { controller.close(); finish(); }
                },
                cancel: () => finish(),
            });
            responseCancellations.set(requestId, () => finish(true));
            activeResponseUrls.set(requestId, request.url);
        }
        return new Response(body, { headers: { 'Content-Type': fixture.mime, 'Cache-Control': 'no-store', 'Content-Length': String(image.length), 'Access-Control-Allow-Origin': '*' } });
    });
    const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { backgroundThrottling: false, preload: ${JSON.stringify(path.join(directory, 'preload.cjs'))} } });
    fixtureWindow = window;
    let peakRendererWorkingSetKiB = 0;
    let peakRendererPrivateKiB = 0;
    let peakGpuWorkingSetKiB = 0;
    let peakTotalWorkingSetKiB = 0;
    let peakWorkingSetPhase = '';
    let peakWorkingSetSnapshot = null;
    let activePhase = 'startup';
    let memoryProbePending = false;
    let latestSnapshot = null;
    safetyTimer = fixture.mode === 'tall-png' ? setInterval(() => {
        const metrics = app.getAppMetrics();
        const workingSet = metrics.filter(metric => metric.type === 'Tab').reduce((sum, metric) => sum + (metric.memory.workingSetSize || 0), 0);
        const gpuWorkingSet = metrics.filter(metric => metric.type === 'GPU').reduce((sum, metric) => sum + (metric.memory.workingSetSize || 0), 0);
        peakGpuWorkingSetKiB = Math.max(peakGpuWorkingSetKiB, gpuWorkingSet);
        peakTotalWorkingSetKiB = Math.max(peakTotalWorkingSetKiB, metrics.reduce((sum, metric) => sum + (metric.memory.workingSetSize || 0), 0));
        if (workingSet > peakRendererWorkingSetKiB) {
            peakRendererWorkingSetKiB = workingSet;
            peakWorkingSetPhase = activePhase;
            peakWorkingSetSnapshot = latestSnapshot;
        }
        if (!memoryProbePending) {
            memoryProbePending = true;
            window.webContents.executeJavaScript('window.comicMemoryProbe?.read().then(memory => ({ memory, view: window.comicResourceSnapshot?.() }))')
                .then(snapshot => {
                    latestSnapshot = snapshot;
                    peakRendererPrivateKiB = Math.max(peakRendererPrivateKiB, snapshot?.memory?.private || 0);
                }).catch(() => {}).finally(() => { memoryProbePending = false; });
        }
        if (workingSet > 2560 * 1024 || gpuWorkingSet > 6 * 1024 * 1024) {
            console.error('Giant PNG exceeded a test safety cutoff (renderer 2.5GiB, GPU 6GiB): ' + JSON.stringify({ workingSet, gpuWorkingSet, activePhase, latestSnapshot, metrics }));
            app.exit(1);
        }
    }, 100) : null;
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL('http://127.0.0.1:${server.httpServer.address().port}/');
    await window.webContents.executeJavaScript('new Promise((resolve, reject) => { const started = performance.now(); const check = () => window.comicResourceReady ? resolve() : performance.now() - started > 12000 ? reject(new Error("Resource fixture did not initialize")) : requestAnimationFrame(check); check(); })');
    const call = async (name, options = {}) => {
        activePhase = name + ':' + JSON.stringify(options);
        console.log('COMIC_RESOURCE_STEP=' + name + ':' + JSON.stringify(options));
        phaseRequests = 0;
        let timeout;
        try {
            const result = await Promise.race([
                window.webContents.executeJavaScript('window.' + name + '(' + JSON.stringify(options) + ')'),
                new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Renderer phase timed out: ' + activePhase)), 35000); }),
            ]);
            return { ...result, requests: phaseRequests };
        } finally { clearTimeout(timeout); }
    };
    window.webContents.debugger.attach('1.3');
    const memory = async () => {
        const immediate = await window.webContents.executeJavaScript('window.comicMemoryProbe.read()');
        await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const retained = await window.webContents.executeJavaScript('window.comicMemoryProbe.read()');
        const snapshot = { ...immediate, retainedPrivate: retained.private, retainedShared: retained.shared, processes: app.getAppMetrics().map(metric => ({ type: metric.type, memory: metric.memory })) };
        if (fixture.mode === 'tall-png') console.log('COMIC_RESOURCE_MEMORY=' + JSON.stringify({ activePhase, ...snapshot }));
        return snapshot;
    };
    const report = { fixture, encodedMiBPerPage: image.length / 1024 / 1024, samples: [] };
    if (fixture.mode === 'tall-png') {
        report.fresh = await call('openComicResourceFixture', { count: fixture.pageCount });
        report.freshMemory = await memory();
    }
    report.small = await call('openComicResourceFixture', { count: fixture.smallCount });
    report.smallMemory = await memory();
    report.large = await call('openComicResourceFixture', { count: fixture.pageCount, mode: fixture.mode === 'split-png' ? 'auto' : 'scroll' });
    report.largeMemory = await memory();
    if (process.env.BOOKMANAGER_RESOURCE_SCREENSHOT) require('fs').writeFileSync(process.env.BOOKMANAGER_RESOURCE_SCREENSHOT + '-scroll.png', (await window.webContents.capturePage()).toPNG());
    if (fixture.mode === 'tall-png' || fixture.mode === 'split-png') {
        await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
        await window.webContents.executeJavaScript('new Promise(resolve => { const check = () => window.comicResourceReady ? resolve() : requestAnimationFrame(check); check(); })');
        report.reload = await call('restoreComicResourceAfterReload');
    }
    if (fixture.mode === 'tall-png') report.boundary = await call('checkTallComicBoundary');
    const visits = fixture.mode === 'tall-png' ? fixture.immersive ? 2 : 8 : 32;
    for (let index = 0; index < visits; index += 1) {
        const page = (index * 59 + 17) % (fixture.pageCount - 10);
        const result = await call('visitComicResourcePage', { index: page });
        if (index === 0) report.firstVisit = result;
        if (fixture.mode === 'tall-png' || index === 7 || index === 15 || index === 31) report.samples.push({ visited: index + 1, ...result, memory: await memory() });
    }
    report.thumbnails = await call('checkComicResourceThumbnails');
    report.afterThumbnailsMemory = await memory();
    if (fixture.mode === 'tall-png' && fixture.immersive) {
        report.tiledPixels = await call('checkTallComicPixels');
        const zoomPoint = await call('prepareTallComicZoom');
        window.webContents.sendInputEvent({ type: 'mouseMove', x: zoomPoint.x, y: zoomPoint.y });
        window.webContents.sendInputEvent({ type: 'mouseDown', x: zoomPoint.x, y: zoomPoint.y, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: zoomPoint.x, y: zoomPoint.y, button: 'left', clickCount: 1 });
        report.zoom = await call('checkTallComicZoom');
        await call('captureTallComicPosition');
        window.setContentSize(1100, 850);
        await window.webContents.executeJavaScript('new Promise(resolve => { const check = () => innerWidth === 1100 && innerHeight === 850 ? resolve() : requestAnimationFrame(check); check(); })');
        report.resizeNarrow = await call('checkTallComicResize');
        await call('captureTallComicPosition');
        window.setContentSize(1440, 960);
        await window.webContents.executeJavaScript('new Promise(resolve => { const check = () => innerWidth === 1440 && innerHeight === 960 ? resolve() : requestAnimationFrame(check); check(); })');
        report.resizeWide = await call('checkTallComicResize');
        const wheelPoint = await call('prepareTallComicWheel');
        window.webContents.sendInputEvent({ type: 'mouseWheel', x: wheelPoint.x, y: wheelPoint.y, deltaX: 0, deltaY: 240, canScroll: true });
        report.wheel = await call('checkTallComicWheel');
        report.resume = await call('checkComicResourceResume');
        report.afterResumeMemory = await memory();
    }
    if (fixture.mode !== 'tall-png') report.resume = await call('checkComicResourceResume');
    report.effects = [];
    for (const effect of fixture.mode === 'tall-png' ? [] : ['slide', 'fade', 'page']) {
        await call('openComicResourceFixture', { count: fixture.pageCount, mode: 'spread', effect });
        report.effects.push({ effect, ...await call('checkComicResourceEffect', { effect }) });
        if (effect === 'page' && process.env.BOOKMANAGER_RESOURCE_SCREENSHOT) require('fs').writeFileSync(process.env.BOOKMANAGER_RESOURCE_SCREENSHOT + '-page.png', (await window.webContents.capturePage()).toPNG());
    }
    report.requests = requests;
    report.managedRequests = managedRequests;
    report.cancelledRequests = await window.webContents.executeJavaScript('window.comicRequestCancellations');
    report.processes = app.getAppMetrics().map(metric => ({ type: metric.type, memory: metric.memory }));
    report.safety = { peakActiveResponses, peakRendererWorkingSetKiB, peakRendererPrivateKiB, peakGpuWorkingSetKiB, peakTotalWorkingSetKiB, peakWorkingSetPhase, peakWorkingSetSnapshot };
    if (safetyTimer) clearInterval(safetyTimer);
    if (process.env.BOOKMANAGER_RESOURCE_REPORT) require('fs').writeFileSync(process.env.BOOKMANAGER_RESOURCE_REPORT, JSON.stringify(report, null, 2));
    console.log('COMIC_RESOURCE_RESULT=' + JSON.stringify(report));
    app.exit(0);
}).catch(async error => {
    if (safetyTimer) clearInterval(safetyTimer);
    const snapshot = await Promise.race([
        fixtureWindow?.webContents.executeJavaScript('window.comicResourceDebugSnapshot?.()').catch(failure => ({ error: failure.message })),
        new Promise(resolve => setTimeout(() => resolve({ error: 'Snapshot timed out' }), 2000)),
    ]);
    console.error('COMIC_RESOURCE_DIAGNOSTIC=' + JSON.stringify(snapshot));
    console.error('COMIC_RESOURCE_FATAL=' + (error.stack || error));
    app.exit(1);
});
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            let fatalTimeout = null;
            child.stdout.on('data', data => {
                result += data;
                for (const line of String(data).split('\n')) {
                    if (line.startsWith('COMIC_RESOURCE_STEP=')) console.log(line);
                }
            });
            child.stderr.on('data', data => {
                result += data;
                if (String(data).includes('COMIC_RESOURCE_FATAL=') && !fatalTimeout) fatalTimeout = setTimeout(() => child.kill('SIGKILL'), 1000);
            });
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                if (process.env.BOOKMANAGER_RESOURCE_REPORT) require('node:fs').writeFileSync(process.env.BOOKMANAGER_RESOURCE_REPORT + '.log', result);
                reject(new Error('Comic resource renderer timed out: ' + result));
            }, 150000);
            child.once('error', error => { clearTimeout(timeout); clearTimeout(fatalTimeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); clearTimeout(fatalTimeout); resolve({ code, result }); });
        });
        if (process.env.BOOKMANAGER_RESOURCE_REPORT) await fs.writeFile(process.env.BOOKMANAGER_RESOURCE_REPORT + '.log', output.result);
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/COMIC_RESOURCE_RESULT=(.+)/)[1]);
        assert.ok(report.large.requests <= 32, JSON.stringify(report));
        if (!tallFixture) assert.ok(report.largeMemory.retainedPrivate - report.smallMemory.retainedPrivate < 128 * 1024, 'Ten times as many pages retained too much memory: ' + JSON.stringify(report));
        const first = report.samples[0].memory.retainedPrivate;
        const last = report.samples.at(-1).memory.retainedPrivate;
        assert.ok(last - first < 128 * 1024, 'Decoded images remained retained after traversing the book: ' + JSON.stringify(report));
        if (tallFixture) {
            const gpuWorkingSet = sample => sample.memory.processes.filter(metric => metric.type === 'GPU').reduce((sum, metric) => sum + metric.memory.workingSetSize, 0);
            assert.ok(gpuWorkingSet(report.samples.at(-1)) - gpuWorkingSet(report.samples[0]) < 128 * 1024,
                'GPU memory kept accumulating while traversing giant PNG pages: ' + JSON.stringify(report));
        }
        assert.deepEqual(report.effects.map(item => item.effect), tallFixture ? [] : ['slide', 'fade', 'page']);
        const minimumRequests = tallFixture ? 2 : 100;
        assert.ok(report.managedRequests > minimumRequests && report.cancelledRequests > minimumRequests, 'Mounted image cleanup did not cancel managed requests: ' + JSON.stringify(report));
        if (tallFixture || splitFixture) assert.ok(report.reload.body > 0, 'Refreshing the viewer did not finish its initial load');
        t.diagnostic(JSON.stringify(report));
    } finally {
        server?.httpServer?.closeAllConnections?.();
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
