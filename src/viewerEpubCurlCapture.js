import { optimizedCurlDocument } from './viewerOptimizedCurlDocument.js';

// Keep Chromium's raster of embedded fonts on both the chapter and reflowed page paths.
function describeLeaf({ node, width, height, pixelRatio = 1, x = 0 }, sessionId, optimizedCache) {
    const article = node?.querySelector('.viewer-text-page.is-original-reader, .viewer-text-page.is-epub-reader.viewer-reader-scope');
    if (!article || article.querySelector('.viewer-epub-inline-media, .viewer-epub-original-media-layer')) return null;
    const optimized = article.classList.contains('is-epub-reader') && !article.classList.contains('is-original-reader');
    const paper = article?.querySelector('.viewer-epub-original-document');
    const iframe = paper?.querySelector('.viewer-epub-original-frame[data-original-ready="true"]');
    const source = optimized ? article.ownerDocument : iframe?.contentDocument;
    if (!source?.body || source.getSelection()?.isCollapsed === false) return null;
    if (optimized) {
        if (article.querySelector('iframe, video, canvas, [data-epub-media-url]')) return null;
    } else if (![...source.fonts].some(font => font.status === 'loaded') || source.querySelector('[data-epub-media-url]') ||
        source.defaultView.CSS.highlights?.size || !iframe.clientWidth || !iframe.clientHeight) return null;

    const leaf = node.getBoundingClientRect();
    if (!leaf.width || !leaf.height) return null;
    const box = element => {
        const rect = element.getBoundingClientRect();
        return {
            x: (rect.left - leaf.left) * width / leaf.width,
            y: (rect.top - leaf.top) * height / leaf.height,
            width: rect.width * width / leaf.width,
            height: rect.height * height / leaf.height,
            color: getComputedStyle(element).backgroundColor,
        };
    };
    const articleBox = box(article);
    const viewport = optimized ? articleBox : box(iframe);
    if (!viewport.width || !viewport.height) return null;
    const document = optimized ? optimizedCurlDocument(article, sessionId, viewport.width, viewport.height, optimizedCache) : {
        html: '<!doctype html>\n' + source.documentElement.outerHTML,
        width: iframe.clientWidth, height: iframe.clientHeight, backgroundColor: viewport.color,
    };
    if (!document) return null;
    return {
        document, scrollLeft: optimized ? 0 : source.documentElement.scrollLeft,
        scrollTop: optimized ? 0 : source.documentElement.scrollTop,
        layers: optimized ? [articleBox] : [articleBox, box(paper), viewport], viewport, pixelRatio,
        frame: { x, y: 0, width, height },
    };
}

function sameDocument(left, right) {
    return left.width === right.width && left.height === right.height &&
        left.backgroundColor === right.backgroundColor && left.html === right.html;
}

function sameColumn(left, right) {
    return left.scrollLeft === right.scrollLeft && left.scrollTop === right.scrollTop &&
        left.pixelRatio === right.pixelRatio && sameDocument(left.document, right.document);
}

async function paintColumn(leaf, capture) {
    const { bytes, format, width, height } = capture;
    const source = format === 'rgba'
        ? new ImageData(ArrayBuffer.isView(bytes)
            ? new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            : new Uint8ClampedArray(bytes), width, height)
        : new Blob([bytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(source);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(leaf.frame.width * leaf.pixelRatio);
        canvas.height = Math.ceil(leaf.frame.height * leaf.pixelRatio);
        const context = canvas.getContext('2d');
        context.scale(canvas.width / leaf.frame.width, canvas.height / leaf.frame.height);
        for (const box of leaf.layers) {
            context.beginPath();
            context.rect(box.x, box.y, box.width, box.height);
            context.clip();
            context.fillStyle = box.color;
            context.fillRect(box.x, box.y, box.width, box.height);
        }
        const rect = leaf.viewport;
        context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
        return { image: canvas, frame: leaf.frame };
    } finally {
        bitmap.close();
    }
}

export function createEpubCurlCapture(sessionId) {
    if (!sessionId || !globalThis.window?.viewerAPI?.captureEpubCurl) return null;
    const capture = window.viewerAPI.captureEpubCurl;
    let recent = [];
    let queue = Promise.resolve();
    let pending = 0;
    let generation = 0;
    const optimizedCache = new WeakMap();
    const describe = request => describeLeaf(request, sessionId, optimizedCache);
    const cached = leaf => recent.find(item => sameColumn(item.leaf, leaf))?.capture;

    async function getColumns(leaves, expectedGeneration) {
        if (generation !== expectedGeneration) return [];
        const docs = [];
        const pages = [];
        const missing = [];
        const columns = leaves.map((leaf, index) => {
            if (!leaf) return null;
            const hit = cached(leaf);
            if (hit) return hit;
            let documentIndex = docs.findIndex(doc => sameDocument(doc, leaf.document));
            if (documentIndex < 0) documentIndex = docs.push(leaf.document) - 1;
            pages.push({ documentIndex, scrollLeft: leaf.scrollLeft, scrollTop: leaf.scrollTop });
            missing.push(index);
            return null;
        });
        if (missing.length) {
            const captures = await capture({ sessionId, documents: docs, pages });
            if (generation !== expectedGeneration) return [];
            missing.forEach((index, position) => {
                const value = captures[position];
                if (value?.bytes?.byteLength > 0 && (value.format === 'png' || value.format === 'rgba')) {
                    columns[index] = value;
                }
            });
        }
        const used = leaves.flatMap((leaf, index) => columns[index] ? [{ leaf, capture: columns[index] }] : []);
        let bytes = 0;
        const older = recent.filter(item => !used.some(entry => entry.capture === item.capture));
        recent = [];
        for (const item of [...used, ...older]) {
            bytes += item.capture.bytes.byteLength;
            if (recent.length === 8 || bytes > 32 * 1024 * 1024) break;
            recent.push(item);
        }
        return columns;
    }

    function request(leaves) {
        pending += 1;
        const current = generation;
        const job = queue.then(() => getColumns(leaves, current));
        queue = job.catch(() => {}).finally(() => { pending -= 1; });
        return job;
    }
    return {
        async read(requests) {
            const leaves = requests.map(describe);
            if (!leaves.some(Boolean)) return [];
            let columns = leaves.map(leaf => leaf && cached(leaf));
            if (leaves.some((leaf, index) => leaf && !columns[index])) {
                try { columns = await request(leaves); } catch { return []; }
            }
            return Promise.all(columns.map(async (column, index) => {
                if (!column) return null;
                try { return await paintColumn(leaves[index], column); } catch { return null; }
            }));
        },
        warm(requests) {
            // A neighboring frame may have become ready while the first column was being painted.
            if (pending) return queue;
            const leaves = requests.map(describe);
            if (leaves.some(leaf => leaf && !cached(leaf))) {
                void request(leaves).catch(() => {});
            }
        },
        clear() { generation += 1; recent = []; },
    };
}
