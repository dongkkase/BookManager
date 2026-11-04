import { app, BrowserWindow, nativeImage, session } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = new URL('./viewerCurlSurface.html', import.meta.url);
const maxPixels = 4 * 1024 * 1024;
const maxRequestBytes = 16 * 1024 * 1024;
const bundledFonts = new Set([
    'Jua-Regular.ttf', 'NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf', 'NanumGothic-ExtraBold.ttf',
    'NanumGothicCoding-Regular.ttf', 'NanumGothicCoding-Bold.ttf', 'NotoSansKR-Regular.ttf', 'NotoSansKR-VariableFont_wght.ttf',
]);
const partitions = new WeakMap();
let bitmapLayout;

function captureAsset(url, sessionId, allowedFonts = bundledFonts) {
    try {
        const parsed = new URL(url);
        if (!sessionId || parsed.protocol !== 'bookmanager-document:' || parsed.host !== 'session'
            || parsed.username || parsed.password || parsed.search) return null;
        const [, id, scope, ...parts] = parsed.pathname.split('/').map(decodeURIComponent);
        if (id !== sessionId || !parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\/\0]/.test(part))) return null;
        if (scope === 'bundled-font' && parts.length === 1 && allowedFonts.has(parts[0])) return { bundledFont: parts[0] };
        if (scope === 'asset' && /\.(?:jpe?g|png|gif|webp|bmp|svg|ttf|otf|woff2?)$/i.test(parts.at(-1))) return { bookAsset: true };
    } catch { /* Reject malformed URLs. */ }
    return null;
}

async function readBundledFont(name) {
    const root = app.isPackaged ? path.join(process.resourcesPath, 'src', 'fonts') : fileURLToPath(new URL('../src/fonts/', import.meta.url));
    const file = path.join(root, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return null;
    return { buffer: await fs.readFile(file), mime: 'font/ttf' };
}

function checkRequest(documents, pages) {
    if (!Array.isArray(documents) || !documents.length || documents.length > 4
        || !Array.isArray(pages) || !pages.length || pages.length > 4) throw new Error('Invalid EPUB capture count.');
    let bytes = 0;
    for (const { html, width, height, backgroundColor } of documents) {
        if (typeof html !== 'string' || !html || html.length > maxRequestBytes / 2
            || ![width, height].every(size => Number.isInteger(size) && size > 0 && size <= 4096)
            || width * height > maxPixels || (backgroundColor != null && (typeof backgroundColor !== 'string' || backgroundColor.length > 128))) {
            throw new Error('Invalid EPUB capture document.');
        }
        const size = Buffer.byteLength(html);
        bytes += size;
        if (size > maxRequestBytes / 2 || bytes > maxRequestBytes) throw new Error('EPUB capture input is too large.');
    }
    for (const { documentIndex, scrollLeft, scrollTop } of pages) {
        if (!Number.isInteger(documentIndex) || documentIndex < 0 || documentIndex >= documents.length
            || ![scrollLeft, scrollTop].every(value => Number.isFinite(value) && Math.abs(value) <= 1e8)) {
            throw new Error('Invalid EPUB capture offset.');
        }
    }
}

// These two functions run in the trusted shell. Chapter frames cannot run scripts or invoke IPC.
async function installDocument({ key, html, width, height, backgroundColor, optimizedSessionId, allowedFonts }, parseAsset) {
    const frames = window.chapterFrames ||= new Map();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('iframe, frame, frameset, script, object, embed, webview, base, form, meta[http-equiv]').forEach(node => node.remove());
    let fontRules;
    if (optimizedSessionId) {
        const fonts = parsed.head.querySelector('style[data-curl-fonts]');
        const layout = parsed.head.querySelector('style[data-curl-layout]');
        if (!fonts || !layout || fonts === layout) throw new Error('Invalid optimized EPUB capture styles.');
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(fonts.textContent);
        const names = new Set(allowedFonts);
        const rules = Array.from(sheet.cssRules);
        for (const rule of rules) {
            if (rule.type !== CSSRule.FONT_FACE_RULE) throw new Error('Invalid optimized EPUB font rule.');
            // The optimized reader emits one canonical URL per face, with an optional format.
            const source = /^url\("([^"\\]+)"\)(?:\s+format\("[\w-]+"\))?$/i.exec(rule.style.getPropertyValue('src'));
            if (!source || !parseAsset(source[1], optimizedSessionId, names) || !/\.(?:ttf|otf|woff2?)$/i.test(source[1])) {
                throw new Error('Invalid optimized EPUB font source.');
            }
        }
        fontRules = rules.map(rule => rule.cssText).join('\n');
        fonts.textContent = fontRules;
        parsed.head.replaceChildren(fonts, layout);
        parsed.body.querySelectorAll('style, link, meta, title').forEach(node => node.remove());
        for (const [oldKey, frame] of frames) {
            if (frame.optimizedFontRules === undefined) continue;
            frames.delete(oldKey);
            if (frame.width === String(width) && frame.height === String(height) && frame.optimizedFontRules === fontRules) {
                const chapter = frame.contentDocument;
                chapter.head.querySelector('style[data-curl-layout]').replaceWith(chapter.importNode(layout, true));
                chapter.body.replaceWith(chapter.importNode(parsed.body, true));
                frame.style.backgroundColor = backgroundColor || 'transparent';
                frames.set(key, frame);
                return;
            }
            frame.remove();
            break;
        }
    }
    if (frames.size >= 4) {
        const oldest = frames.keys().next().value;
        frames.get(oldest).remove();
        frames.delete(oldest);
    }
    const policy = parsed.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data: bookmanager-document:; font-src data: bookmanager-document:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    parsed.head.prepend(policy);
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-same-origin';
    frame.width = width;
    frame.height = height;
    frame.style.backgroundColor = backgroundColor || 'transparent';
    frame.style.visibility = 'hidden';
    if (optimizedSessionId) frame.optimizedFontRules = fontRules;
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    document.body.append(frame);
    frames.set(key, frame);
    await loaded;
}

async function positionDocument(key, left, top, gray) {
    const frames = window.chapterFrames;
    const current = frames.get(key);
    frames.delete(key);
    frames.set(key, current);
    for (const frame of frames.values()) frame.style.visibility = frame === current ? 'visible' : 'hidden';
    const chapter = current.contentDocument;
    const root = chapter.documentElement;
    chapter.body.getBoundingClientRect();
    await Promise.all([chapter.fonts.ready, ...Array.from(chapter.images)
        .filter(image => image.currentSrc || image.getAttribute('src')).map(image => image.decode())]);
    if (Array.from(chapter.fonts).some(face => face.status === 'error')) throw new Error('EPUB capture font unavailable.');
    root.scrollTo({ left, top, behavior: 'instant' });
    if (Math.abs(root.scrollLeft - left) > 1 || Math.abs(root.scrollTop - top) > 1) throw new Error('EPUB capture offset is unavailable.');
    // A compositor readback may precede the first painted iframe even after two animation frames.
    const marker = chapter.createElement('span');
    marker.style.cssText = `all:initial!important;position:fixed!important;display:block!important;left:0!important;top:0!important;width:8px!important;height:8px!important;z-index:2147483647!important;background:rgb(${gray},${gray},${gray})!important`;
    root.append(marker);
    window.paintMarker = marker;
    const rect = marker.getBoundingClientRect();
    return { x: Math.max(0, Math.floor(rect.left)), y: Math.max(0, Math.floor(rect.top)) };
}

const nextPaint = () => new Promise(resolve => setTimeout(resolve, 16));

async function capturePaintedPage(contents, size, point, gray) {
    const marked = (buffer, width, height, x, y) => {
        const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
        const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
        const i = 4 * (py * width + px);
        return [0, 1, 2].every(channel => Math.abs(buffer[i + channel] - gray) <= 1) && buffer[i + 3] === 255;
    };
    if (point.x >= size.width || point.y >= size.height) throw new Error('EPUB capture marker is outside the viewport.');
    let seen = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await nextPaint();
        const probe = await contents.capturePage({ ...point, width: 1, height: 1 });
        if (!probe.isEmpty() && marked(probe.getBitmap(), probe.getSize().width, probe.getSize().height, 0, 0)) {
            seen = true;
            break;
        }
    }
    if (!seen) throw new Error('EPUB capture frame was not presented.');
    await contents.executeJavaScript('window.paintMarker.remove(); window.paintMarker = null');
    for (let attempt = 0; attempt < 30; attempt += 1) {
        await nextPaint();
        const image = await contents.capturePage({ x: 0, y: 0, ...size });
        if (image.isEmpty()) continue;
        const pixels = image.getSize();
        if (!marked(image.getBitmap(), pixels.width, pixels.height, point.x * pixels.width / size.width, point.y * pixels.height / size.height)) return image;
    }
    throw new Error('EPUB capture marker was not cleared.');
}

async function bitmapResult(image, size, isCurrent) {
    if (!bitmapLayout) {
        // NativeImage's byte order is platform-dependent. Probe RGBA(240, 80, 16, 128) once.
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4ECDQAAAFVQHRSmv+0gAAAABJRU5ErkJggg==';
        const [first, green, third, alpha] = nativeImage.createFromBuffer(Buffer.from(png, 'base64')).toBitmap();
        bitmapLayout = { blueFirst: third > first, premultiplied: green < 60, supported: alpha === 128 && first !== third };
    }
    const bytes = image.toBitmap();
    if (!bitmapLayout.supported || bytes.length !== size.width * size.height * 4) {
        return { ...size, bytes: image.toPNG(), format: 'png' };
    }
    const { blueFirst, premultiplied } = bitmapLayout;
    for (let start = 0; start < bytes.length; start += 512 * 1024) {
        if (!isCurrent()) throw new Error('EPUB capture is no longer current.');
        const end = Math.min(start + 512 * 1024, bytes.length);
        for (let i = start; i < end; i += 4) {
            const alpha = bytes[i + 3];
            if (blueFirst) {
                const blue = bytes[i];
                bytes[i] = bytes[i + 2];
                bytes[i + 2] = blue;
            }
            if (premultiplied && alpha > 0 && alpha < 255) {
                for (let channel = i; channel < i + 3; channel += 1) bytes[channel] = Math.min(255, Math.round(bytes[channel] * 255 / alpha));
            }
        }
        if (end < bytes.length) await new Promise(resolve => setImmediate(resolve));
    }
    return { ...size, bytes, format: 'rgba' };
}

export function createEpubCurlSurface(manager) {
    if (!partitions.has(manager)) partitions.set(manager, session.fromPartition('epub-curl-' + randomUUID(), { cache: false }));
    const partition = partitions.get(manager);
    let window = null;
    let sessionId = '';
    let generation = 0;
    let queue = { count: 0, tail: Promise.resolve() };
    let abortCapture = null;
    let disposed = false;
    let markerSequence = 0;
    const assets = new Map();
    const loadingAssets = new Map();
    let assetBytes = 0;
    const maxAssetBytes = 64 * 1024 * 1024;

    function readAsset(url, target) {
        const cached = assets.get(url);
        if (cached) {
            assets.delete(url);
            assets.set(url, cached);
            return cached;
        }
        if (loadingAssets.has(url)) return loadingAssets.get(url);
        if (loadingAssets.size >= 16) return null;
        const active = generation;
        const load = target.bundledFont ? readBundledFont(target.bundledFont) : manager.getDocumentAssetFromRequest(url);
        const pending = load.then(asset => {
            if (active !== generation || !asset) return null;
            if (asset.buffer.length <= maxAssetBytes) {
                while (assetBytes + asset.buffer.length > maxAssetBytes || assets.size >= 64) {
                    const oldest = assets.keys().next().value;
                    assetBytes -= assets.get(oldest).buffer.length;
                    assets.delete(oldest);
                }
                assets.set(url, asset);
                assetBytes += asset.buffer.length;
            }
            return asset;
        }).finally(() => { if (loadingAssets.get(url) === pending) loadingAssets.delete(url); });
        loadingAssets.set(url, pending);
        return pending;
    }
    partition.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
    partition.setPermissionCheckHandler(() => false);
    const denyDownload = event => event.preventDefault();
    partition.on('will-download', denyDownload);
    partition.webRequest.onBeforeRequest((details, respond) => {
        const localShell = details.resourceType === 'mainFrame' && details.url === host.href;
        const imageOrFont = ['image', 'font'].includes(details.resourceType);
        const target = imageOrFont && captureAsset(details.url, sessionId);
        const allowed = target && (!target.bundledFont || details.resourceType === 'font');
        respond({ cancel: !localShell && !(imageOrFont && (details.url.startsWith('data:') || allowed)) });
    });
    partition.protocol.handle('bookmanager-document', async request => {
        const active = generation;
        const target = captureAsset(request.url, sessionId);
        if (request.method !== 'GET' || !target) return new Response(null, { status: 403 });
        const asset = await Promise.resolve(readAsset(request.url, target)).catch(() => null);
        if (!asset || active !== generation) return new Response(null, { status: 404 });
        return new Response(asset.buffer, { headers: { 'Content-Type': asset.mime, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
    });

    function reset() {
        generation += 1;
        abortCapture?.(new Error('EPUB capture is no longer current.'));
        abortCapture = null;
        queue = { count: 0, tail: Promise.resolve() };
        sessionId = '';
        assets.clear();
        loadingAssets.clear();
        assetBytes = 0;
        if (window && !window.isDestroyed()) window.destroy();
        window = null;
    }

    async function capture(documents, pages, active) {
        if (active !== generation) throw new Error('EPUB capture is no longer current.');
        if (!window) {
            window = new BrowserWindow({
                show: false, frame: false, width: 1, height: 1, useContentSize: true, transparent: true,
                webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
                    webviewTag: false, offscreen: true, backgroundThrottling: false },
            });
            window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            window.webContents.on('will-attach-webview', event => event.preventDefault());
            window.webContents.on('will-frame-navigate', event => {
                if (event.isMainFrame || !['about:srcdoc', 'about:blank'].includes(event.url)) event.preventDefault();
            });
            await window.loadFile(fileURLToPath(host));
        }
        if (active !== generation) throw new Error('EPUB capture is no longer current.');
        const surface = window;
        const contents = surface.webContents;
        const keys = documents.map(({ width, height, backgroundColor, html, mode }) => (
            createHash('sha256').update(JSON.stringify([width, height, backgroundColor, mode === 'optimized'])).update(html).digest('hex')
        ));
        const width = Math.max(...documents.map(item => item.width));
        const height = Math.max(...documents.map(item => item.height));
        if (width * height > maxPixels) throw new Error('EPUB capture viewport is too large.');
        const previous = surface.getContentSize();
        if (previous[0] !== width || previous[1] !== height) surface.setContentSize(width, height);
        const output = [];
        let resultBytes = 0;
        for (const page of pages) {
            if (generation !== active) throw new Error('EPUB capture is no longer current.');
            const key = keys[page.documentIndex];
            const doc = documents[page.documentIndex];
            if (!(await contents.executeJavaScript(`window.chapterFrames?.has(${JSON.stringify(key)}) === true`))) {
                const payload = { key, html: doc.html, width: doc.width, height: doc.height, backgroundColor: doc.backgroundColor };
                if (doc.mode === 'optimized') {
                    payload.optimizedSessionId = sessionId;
                    payload.allowedFonts = [...bundledFonts];
                }
                await contents.executeJavaScript(`(${installDocument})(${JSON.stringify(payload)}, ${captureAsset})`);
            }
            const gray = 50 + (++markerSequence % 140);
            const point = await contents.executeJavaScript(`(${positionDocument})(${JSON.stringify(key)},${page.scrollLeft},${page.scrollTop},${gray})`);
            const image = await capturePaintedPage(contents, { width: doc.width, height: doc.height }, point, gray);
            if (image.isEmpty() || active !== generation) throw new Error('EPUB capture failed.');
            const size = image.getSize();
            resultBytes += size.width * size.height * 4;
            if (resultBytes > 48 * 1024 * 1024) throw new Error('EPUB capture output is too large.');
            output.push(await bitmapResult(image, size, () => active === generation));
        }
        return output;
    }

    return {
        reset,
        dispose() {
            if (disposed) return;
            disposed = true;
            reset();
            partition.protocol.unhandle('bookmanager-document');
            partition.webRequest.onBeforeRequest(null);
            partition.off('will-download', denyDownload);
        },
        capture(id, documents, pages) {
            if (disposed) throw new Error('EPUB capture is no longer current.');
            checkRequest(documents, pages);
            if (sessionId && sessionId !== id) reset();
            if (queue.count >= 2) throw new Error('EPUB capture is busy.');
            sessionId = id;
            const active = generation;
            const work = queue;
            work.count += 1;
            const job = work.tail.then(async () => {
                if (active !== generation) throw new Error('EPUB capture is no longer current.');
                let timer;
                try {
                    return await Promise.race([capture(documents, pages, active), new Promise((_, reject) => {
                        abortCapture = reject;
                        timer = setTimeout(() => reject(new Error('EPUB capture timed out.')), 6000);
                    })]);
                } catch (error) {
                    if (active === generation) reset();
                    throw error;
                } finally {
                    clearTimeout(timer);
                    if (active === generation) abortCapture = null;
                }
            });
            work.tail = job.catch(() => {});
            return job.finally(() => { work.count -= 1; });
        },
    };
}
