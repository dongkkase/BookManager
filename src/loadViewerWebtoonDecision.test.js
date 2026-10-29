import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViewerWebtoonDecision, readViewerImageHeaderMetrics } from './loadViewerWebtoonDecision.js';
import { getWebtoonSampleIndices } from './viewerWebtoonDetection.js';

const MiB = 1024 * 1024;
const tick = () => new Promise(resolve => setImmediate(resolve));

function png(width, height, index = 0, extra = []) {
    const chunk = (name, data) => {
        const result = Buffer.alloc(data.length + 12);
        result.writeUInt32BE(data.length);
        result.write(name, 4);
        data.copy(result, 8);
        return result;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header), ...extra.map(([name, data]) => chunk(name, data)),
        chunk('IDAT', Buffer.from([index])), chunk('IEND', Buffer.alloc(0)),
    ]);
}

function jpeg(width, height) {
    const result = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 218, 0, 2, 255, 217]);
    result.writeUInt16BE(height, 7);
    result.writeUInt16BE(width, 9);
    return result;
}

function webp(width, height, animated = false) {
    const chunk = Buffer.alloc(animated ? 18 : 14);
    chunk.write(animated ? 'VP8X' : 'VP8L');
    chunk.writeUInt32LE(animated ? 10 : 5, 4);
    if (animated) {
        chunk[8] = 2;
        chunk.writeUIntLE(width - 1, 12, 3);
        chunk.writeUIntLE(height - 1, 15, 3);
    } else {
        chunk[8] = 47;
        chunk.writeUInt32LE((width - 1) | ((height - 1) << 14), 9);
    }
    const header = Buffer.alloc(12);
    header.write('RIFF');
    header.writeUInt32LE(chunk.length + 4, 4);
    header.write('WEBP', 8);
    return Buffer.concat([header, chunk]);
}

function edge(seed) {
    let state = seed + 1;
    return Array.from({ length: 192 }, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    });
}

function harness(t, options = {}) {
    const count = options.count ?? 40;
    const width = options.width ?? 800;
    const height = options.height ?? 1000;
    const events = { fetched: [], decoded: 0, closed: 0, cancelled: 0, canvases: [] };
    const pages = Array.from({ length: count }, (_, index) => ({ name: `${index}.png`, size: 512 * 1024, pageUrl: `https://fixture.test/${index}`, ...options.page }));
    const originals = new Map();
    const replace = (name, value) => {
        originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    };
    t.after(() => {
        for (const [name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    });
    replace('fetch', async (url, config) => {
        const index = Number(String(url).split('/').at(-1));
        events.fetched.push(index);
        if (options.fetch) return options.fetch(url, config);
        if (options.fetchError) throw new Error('URL unavailable');
        const metrics = options.pageMetrics?.(index) || { width, height };
        const padding = options.encodedBytes ? [['tEXt', Buffer.alloc(options.encodedBytes - png(metrics.width, metrics.height, index).length - 12)]] : [];
        const bytes = options.bytes ?? png(metrics.width, metrics.height, index, padding);
        return new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                if (!options.leaveStreamOpen) controller.close();
            },
            cancel() { events.cancelled += 1; },
        }), { headers: options.contentLength ? { 'content-length': String(options.contentLength) } : {} });
    });
    replace('createImageBitmap', async blob => {
        events.decoded += 1;
        if (options.decodeError) throw new Error('Invalid image');
        if (options.decode) await options.decode();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const metrics = readViewerImageHeaderMetrics(bytes) || { width, height };
        return { width: metrics.width, height: metrics.height, index: bytes[41], close() { events.closed += 1; } };
    });
    replace('OffscreenCanvas', class {
        constructor(canvasWidth, canvasHeight) {
            this.width = canvasWidth;
            this.height = canvasHeight;
            events.canvases.push(this);
        }
        getContext() {
            let image;
            let y;
            return {
                clearRect() {},
                drawImage(source, x, sourceY) { image = source; y = sourceY; },
                getImageData() {
                    const imageWidth = image.width;
                    const pixels = new Uint8ClampedArray(imageWidth * 8);
                    const signature = options.pageEdge?.(image.index, y === 0 ? 'top' : 'bottom')
                        ?? (options.blank ? Array(192).fill(255) : edge(image.index + (y === 0 ? 0 : 1)));
                    for (let index = 0; index < 64; index += 1) {
                        const x = Math.floor(imageWidth * (0.04 + 0.92 * (index + 0.5) / 64));
                        for (const row of [0, 1]) pixels.set([...signature.slice(index * 3, index * 3 + 3), options.transparent ? 0 : 255], (row * imageWidth + x) * 4);
                    }
                    return { data: pixels };
                },
            };
        }
    });
    return { events, pages, run: (isCancelled = () => false, extra = {}) => loadViewerWebtoonDecision({ pages, bookName: '001.zip', ...extra }, isCancelled) };
}

test('verified static PNG, JPEG and WebP dimensions require complete bounded headers', () => {
    for (const [bytes, mimeType] of [[png(800, 900), 'image/png'], [jpeg(800, 900), 'image/jpeg'], [webp(800, 900), 'image/webp']]) {
        assert.deepEqual(readViewerImageHeaderMetrics(bytes), { width: 800, height: 900, mimeType });
        assert.equal(readViewerImageHeaderMetrics(bytes.subarray(0, bytes.length - 1)), null);
    }
    assert.equal(readViewerImageHeaderMetrics(png(800, 900, 0, [['acTL', Buffer.alloc(8)]])), null);
    assert.equal(readViewerImageHeaderMetrics(webp(800, 900, true)), null);
    assert.equal(readViewerImageHeaderMetrics(png(0, 900)), null);
    assert.equal(readViewerImageHeaderMetrics(new Uint8Array(100)), null);
});

test('archive averages at or below 128 KiB decide scroll without fetching regardless of image count', async t => {
    for (const [count, size] of [[1, 120 * 1024], [1, 128 * 1024], [15, 128 * 1024], [19, 1024], [19, 128 * 1024], [20, 128 * 1024]]) {
        await t.test(`${count} images at ${size} bytes`, async child => {
            const h = harness(child, { count, page: { size }, bytes: new Uint8Array(100) });
            assert.equal(await h.run(() => false, { getPageUrl: () => assert.fail('Size classification requested a page') }), 'scroll');
            assert.deepEqual(h.events.fetched, []);
            assert.equal(h.events.decoded, 0);
        });
    }
});

test('explicit Webtoon reading direction takes priority over image sizes and analysis', async t => {
    for (const readingDirection of ['Webtoon', 'webtoon', ' WEBTOON\n']) {
        await t.test(JSON.stringify(readingDirection), async child => {
            const h = harness(child, { count: 2, page: { size: undefined }, fetchError: true });
            assert.equal(await h.run(() => false, {
                readingDirection,
                format: 'GraphicNovel',
                getPageUrl: () => assert.fail('Explicit reading direction requested an image'),
            }), 'scroll');
            assert.deepEqual(h.events.fetched, []);
            assert.equal(h.events.decoded, 0);
        });
    }
});

test('Webtoon metadata does not override cancellation or missing pages', async t => {
    const h = harness(t, { page: { size: undefined } });
    assert.equal(await h.run(() => true, { readingDirection: 'Webtoon' }), 'paged');
    for (const pages of [undefined, null, [], {}]) {
        assert.equal(await h.run(() => false, { pages, readingDirection: 'Webtoon' }), 'paged');
    }
    assert.deepEqual(h.events.fetched, []);
});

test('Webtoon format alone does not override the reading direction or image classification', async t => {
    for (const readingDirection of ['', 'ltr', 'rtl', 'Webtoon Collection', null, ['Webtoon']]) {
        await t.test(JSON.stringify(readingDirection), async child => {
            const h = harness(child, { blank: true });
            assert.equal(await h.run(() => false, { format: 'Webtoon', readingDirection }), 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(h.pages.length));
        });
    }
});

test('the archive average uses all images including the cover instead of the sampled median', async t => {
    const h = harness(t, { count: 20, page: { size: 100 * 1024 }, blank: true });
    h.pages[0].size = 2 * MiB;
    assert.equal(await h.run(), 'paged');
    assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(20));
});

function variableSliceMetrics(index) {
    if (index === 35) return { width: 1200, height: 1200 };
    return { width: 690, height: index === 14 ? 1149 : index === 34 ? 936 : 1600 };
}

test('moderate archive averages and distributed portrait slice ratios decide scroll from headers without decoding', async t => {
    for (const encodedBytes of [150 * 1024, 200 * 1024]) {
        await t.test(String(encodedBytes), async child => {
            const h = harness(child, {
                count: 36, page: { size: encodedBytes }, encodedBytes,
                pageMetrics: variableSliceMetrics, blank: true,
            });
            assert.equal(await h.run(), 'scroll');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(36));
            assert.equal(h.events.decoded, 0);
        });
    }
});

test('moderate archive averages and consistently tall pages decide scroll from headers without decoding', async t => {
    for (const hasRemainder of [false, true]) {
        await t.test(hasRemainder ? 'short remainder and closing card' : 'uniform height', async child => {
            const encodedBytes = 150 * 1024;
            const h = harness(child, {
                count: 36, page: { size: encodedBytes }, encodedBytes, blank: true,
                pageMetrics: index => hasRemainder && index === 35
                    ? { width: 1200, height: 1200 }
                    : { width: 690, height: hasRemainder && index === 34 ? 817 : 1600 },
            });
            assert.equal(await h.run(), 'scroll');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(36));
            assert.equal(h.events.decoded, 0);
        });
    }
});

test('a fifteen-page episode with variable portrait cuts is classified from headers without decoding', async t => {
    const heights = [1836, 1187, 1104, 1919, 1920, 1878, 846, 1212, 1804, 1830, 1848, 924, 1242];
    const encodedBytes = 132.25 * 1024;
    const h = harness(t, {
        count: 15, page: { size: encodedBytes }, encodedBytes, blank: true,
        pageMetrics: index => index === 14
            ? { width: 1200, height: 1200 }
            : { width: 690, height: heights[index - 1] ?? 1600 },
    });
    assert.equal(await h.run(), 'scroll');
    assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(15));
    assert.equal(h.events.decoded, 0);
});

test('a seventeen-page episode with varying cuts in one sampled triplet is classified without extra requests or decoding', async t => {
    const heights = [837, 2252, 1972, 2000, 1346, 2156, 1892, 2312, 1534, 2180, 2508, 1728, 1551, 2248, 2216, 540, 1200];
    const encodedSizes = [376111, 131708, 100952, 147937, 99270, 183892, 160007, 175914, 72157, 140573, 135851, 94247, 84867, 114269, 142663, 16014, 522525];
    const h = harness(t, {
        count: 17, blank: true,
        fetch: async url => {
            const index = Number(String(url).split('/').at(-1));
            const width = index === 0 ? 580 : index === 16 ? 1200 : 690;
            const headerBytes = png(width, heights[index], index).length;
            return new Response(png(width, heights[index], index, [
                ['tEXt', Buffer.alloc(encodedSizes[index] - headerBytes - 12)],
            ]));
        },
    });
    h.pages.forEach((page, index) => { page.size = encodedSizes[index]; });
    assert.equal(h.pages.reduce((sum, page) => sum + page.size, 0), 2698957);
    assert.equal(await h.run(), 'scroll');
    assert.deepEqual(h.events.fetched, [1, 2, 3, 5, 6, 7, 10, 11, 12, 14, 15, 16]);
    assert.equal(h.events.decoded, 0);
});

test('short archives with too few body samples or ordinary page proportions retain pages', async t => {
    const variations = [
        ['seven body samples and a closing card', 9, index => index === 8
            ? { width: 1200, height: 1200 }
            : { width: 690, height: [1600, 1836, 1187, 1104, 1919, 1920, 1878, 846][index] }],
        ['ordinary fifteen-page episode', 15, index => index === 14
            ? { width: 1200, height: 1200 }
            : { width: 690, height: 1000 }],
    ];
    for (const [label, count, pageMetrics] of variations) {
        await t.test(label, async child => {
            const encodedBytes = 150 * 1024;
            const h = harness(child, {
                count, page: { size: encodedBytes }, encodedBytes, pageMetrics, blank: true,
            });
            assert.equal(await h.run(), 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(count));
            assert.equal(h.events.decoded, getWebtoonSampleIndices(count).length);
            assert.equal(h.events.closed, h.events.decoded);
        });
    }
});

test('averages above 200 KiB or unknown totals retain the pixel-analysis fallback for variable slices', async t => {
    for (const unknownTotal of [false, true]) {
        await t.test(unknownTotal ? 'unknown total' : '200 KiB plus one byte', async child => {
            const encodedBytes = unknownTotal ? 150 * 1024 : 200 * 1024 + 1;
            const h = harness(child, {
                count: 36, page: { size: encodedBytes }, encodedBytes,
                pageMetrics: variableSliceMetrics, blank: true,
            });
            if (unknownTotal) h.pages[0].size = undefined;
            assert.equal(await h.run(), 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(36));
            assert.equal(h.events.decoded, getWebtoonSampleIndices(36).length);
            assert.equal(h.events.closed, h.events.decoded);
        });
    }
});

test('ordinary page proportions, resolution-only changes and landscape spreads retain pages', async t => {
    const variations = [
        ['ordinary proportions', () => ({ width: 690, height: 1000 })],
        ['resolution only', index => index === 14 || index === 34 ? { width: 345, height: 500 } : { width: 690, height: 1000 }],
        ['landscape spread', index => index === 14 || index === 34 ? { width: 1600, height: 690 } : { width: 690, height: 1600 }],
    ];
    for (const [label, pageMetrics] of variations) {
        await t.test(label, async child => {
            const encodedBytes = 150 * 1024;
            const h = harness(child, {
                count: 36, page: { size: encodedBytes }, encodedBytes, pageMetrics, blank: true,
            });
            assert.equal(await h.run(), 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(36));
            assert.equal(h.events.decoded, getWebtoonSampleIndices(36).length);
        });
    }
});

test('archive averages above the size shortcut limit fall through to image analysis', async t => {
    for (const options of [
        { count: 20, page: { size: 128 * 1024 + 1 }, blank: true },
        { count: 20, page: { size: 512 * 1024 }, height: 4000 },
    ]) {
        await t.test(JSON.stringify(options), async child => {
            const h = harness(child, options);
            assert.equal(await h.run(), options.height ? 'scroll' : 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(options.count));
        });
    }
});

test('missing or invalid sizes outside the samples do not produce a partial archive average', async t => {
    for (const size of [undefined, null, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
        await t.test(String(size), async child => {
            const h = harness(child, { count: 20, page: { size: 90 * 1024 }, blank: true });
            h.pages[0].size = size;
            assert.equal(await h.run(), 'paged');
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(20));
        });
    }
});

test('cancelled detection does not apply the archive size shortcut', async t => {
    const h = harness(t, { count: 20, page: { size: 90 * 1024 } });
    assert.equal(await h.run(() => true), 'paged');
    assert.deepEqual(h.events.fetched, []);
});

test('very tall images are classified from headers without bitmap decoding', async t => {
    const h = harness(t, { count: 1, height: 100_000 });
    assert.equal(await h.run(), 'scroll');
    assert.equal(h.events.decoded, 0);
    assert.deepEqual(h.events.fetched, [0]);
});

test('the bounded browser loader recognizes continuous slices and releases bitmaps and canvases', async t => {
    const h = harness(t);
    assert.equal(await h.run(), 'scroll');
    assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(40));
    assert.equal(h.events.decoded, 12);
    assert.equal(h.events.closed, 12);
    assert.ok(h.events.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('Korean chapter and volume hints preserve their meaning across Unicode normalization forms', async t => {
    const seeds = new Map([
        [1, [101, 102]], [2, [102, 103]], [3, [103, 104]],
        [13, [201, 202]], [14, [202, 203]], [15, [204, 205]],
    ]);
    const cases = [
        ['NFC chapter', '306화.zip', 'scroll'],
        ['NFD chapter', '306화.zip'.normalize('NFD'), 'scroll'],
        ['no chapter hint', '306.zip', 'paged'],
        ['NFC volume', '306화 1권.zip', 'paged'],
        ['NFD volume', `306화 1${'권'.normalize('NFD')}.zip`, 'paged'],
    ];
    for (const [label, bookName, expected] of cases) {
        await t.test(label, async child => {
            const h = harness(child, {
                height: 1600,
                pageEdge: (index, side) => seeds.has(index)
                    ? edge(seeds.get(index)[side === 'top' ? 0 : 1]) : Array(192).fill(255),
            });
            assert.equal(await h.run(() => false, { bookName }), expected);
            assert.deepEqual(h.events.fetched, getWebtoonSampleIndices(40));
            assert.equal(h.events.decoded, 12);
            assert.equal(h.events.closed, 12);
        });
    }
});

test('blank margins and transparent cuts are not accepted as continuous drawings', async t => {
    for (const options of [{ blank: true }, { transparent: true }]) {
        await t.test(JSON.stringify(options), async child => {
            const h = harness(child, options);
            assert.equal(await h.run(), 'paged');
            assert.equal(h.events.closed, h.events.decoded);
        });
    }
});

test('unknown, invalid, oversized and excessive total declared sizes reject before any request', async t => {
    for (const size of [undefined, 0, -1, NaN, Infinity, 1.5, 17 * MiB, 3 * MiB]) {
        await t.test(String(size), async child => {
            const h = harness(child, { page: { size } });
            assert.equal(await h.run(), 'paged');
            assert.deepEqual(h.events.fetched, []);
        });
    }
});

test('oversized streamed or advertised responses are cancelled without an IPC fallback', async t => {
    for (const options of [{ contentLength: 17 * MiB, leaveStreamOpen: true }, { bytes: new Uint8Array(17 * MiB), leaveStreamOpen: true }]) {
        await t.test(options.contentLength ? 'declared' : 'streamed', async child => {
            const h = harness(child, options);
            assert.equal(await h.run(() => false, { getPageUrl: () => assert.fail('Oversized data retried') }), 'paged');
            assert.equal(h.events.fetched.length, 1);
            assert.equal(h.events.decoded, 0);
            assert.equal(h.events.cancelled, 1);
        });
    }
});

test('actual sample total remains bounded when descriptors underestimate output', async t => {
    const h = harness(t, { fetch: async () => {
        const bytes = png(800, 1000, 1, [['tEXt', Buffer.alloc(3 * MiB)]]);
        return new Response(bytes);
    } });
    assert.equal(await h.run(), 'paged');
    assert.equal(h.events.fetched.length, 11);
    assert.equal(h.events.decoded, 0);
});

test('unsupported headers, oversized edge bitmaps and decode failures safely retain pages', async t => {
    for (const options of [{ bytes: new Uint8Array(100) }, { width: 4500, height: 4500 }, { decodeError: true }]) {
        await t.test(JSON.stringify(options).slice(0, 80), async child => {
            const h = harness(child, options);
            assert.equal(await h.run(), 'paged');
            assert.equal(h.events.closed, options.decodeError ? 0 : h.events.decoded);
        });
    }
});

test('missing URLs accept asynchronous data URLs without image decoding for long pages', async t => {
    const originalFetch = globalThis.fetch;
    const h = harness(t, { count: 1, page: { pageUrl: undefined }, fetch: originalFetch });
    assert.equal(await h.run(() => false, { getPageUrl: async page => {
        assert.equal(page.index, 0);
        return `data:image/png;base64,${png(800, 4000).toString('base64')}`;
    } }), 'scroll');
    assert.equal(h.events.decoded, 0);
});

test('cancellation aborts a pending fetch and does not request subsequent pages', async t => {
    let cancelled = false;
    const h = harness(t, { fetch: (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    }) });
    const pending = h.run(() => cancelled);
    await tick();
    cancelled = true;
    assert.equal(await pending, 'paged');
    assert.equal(h.events.fetched.length, 1);
    assert.equal(h.events.decoded, 0);
});

test('cancellation during bitmap decode closes the late bitmap and stops subsequent work', async t => {
    let cancelled = false;
    let release;
    const h = harness(t, { decode: () => new Promise(resolve => { release = resolve; }) });
    const pending = h.run(() => cancelled);
    while (!release) await new Promise(resolve => setTimeout(resolve, 1));
    cancelled = true;
    release();
    assert.equal(await pending, 'paged');
    assert.equal(h.events.decoded, 1);
    assert.equal(h.events.closed, 1);
    assert.equal(h.events.canvases.length, 0);
});
