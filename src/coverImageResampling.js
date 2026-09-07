const DEFAULT_CACHE_ENTRIES = 32;
const DEFAULT_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 16_000_000;
const MAX_TARGET_PIXELS = 1_000_000;

function abortError(message = 'Cover image resize canceled.') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

function sourceUrl(image) {
    const value = image?.currentSrc || image?.src;
    return typeof value === 'string' ? value : '';
}

function sourceDimensions(image) {
    return {
        width: Number(image?.naturalWidth ?? image?.width),
        height: Number(image?.naturalHeight ?? image?.height),
    };
}

function validDimensions({ width, height }, maximumPixels) {
    return Number.isSafeInteger(width) && width > 0
        && Number.isSafeInteger(height) && height > 0
        && width * height <= maximumPixels;
}

export function coverResamplingTarget({
    naturalWidth,
    naturalHeight,
    displayWidth,
    displayHeight,
    devicePixelRatio = 1,
    fitMode = 'fill',
} = {}) {
    const source = { width: Number(naturalWidth), height: Number(naturalHeight) };
    const width = Number(displayWidth);
    const height = Number(displayHeight);
    const ratio = Number(devicePixelRatio);
    if (!validDimensions(source, MAX_SOURCE_PIXELS)
        || !Number.isFinite(width) || width <= 0
        || !Number.isFinite(height) || height <= 0
        || !Number.isFinite(ratio) || ratio <= 0) return null;
    const widthScale = width * ratio / source.width;
    const heightScale = height * ratio / source.height;
    const scale = fitMode === 'contain'
        ? Math.min(widthScale, heightScale)
        : Math.max(widthScale, heightScale);
    if (!Number.isFinite(scale) || scale >= 1) return null;
    const target = {
        width: Math.max(1, Math.ceil(source.width * scale)),
        height: Math.max(1, Math.ceil(source.height * scale)),
    };
    if (!validDimensions(target, MAX_TARGET_PIXELS)
        || target.width >= source.width || target.height >= source.height) return null;
    return target;
}

async function renderCover(options) {
    const { paintComicDownsample } = await import('./comicImageDownsample.js');
    return paintComicDownsample(options);
}

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Cover image encoding failed.'));
        }, 'image/png');
    });
}

export function createCoverImageResampler({
    renderer = renderCover,
    document: documentObject = globalThis.document,
    url: urlApi = globalThis.URL,
    maxCacheEntries = DEFAULT_CACHE_ENTRIES,
    maxCacheBytes = DEFAULT_CACHE_BYTES,
} = {}) {
    const entries = new Map();
    const jobs = new Map();
    const queue = [];
    let activeJob = null;
    let cacheBytes = 0;
    let disposed = false;
    const entryLimit = Number.isFinite(maxCacheEntries) && maxCacheEntries >= 0
        ? Math.floor(maxCacheEntries) : DEFAULT_CACHE_ENTRIES;
    const byteLimit = Number.isFinite(maxCacheBytes) && maxCacheBytes >= 0
        ? maxCacheBytes : DEFAULT_CACHE_BYTES;

    const createCanvas = () => {
        const canvas = documentObject?.createElement?.('canvas');
        if (!canvas) throw new Error('Canvas is unavailable.');
        return canvas;
    };

    function revoke(entry) {
        if (entry.revoked) return;
        entry.revoked = true;
        urlApi.revokeObjectURL(entry.url);
    }

    function retire(entry) {
        if (entries.get(entry.key) === entry) {
            entries.delete(entry.key);
            cacheBytes -= entry.bytes;
        }
        entry.retired = true;
        if (entry.references === 0) revoke(entry);
    }

    function trimCache() {
        for (const entry of entries.values()) {
            if (entries.size <= entryLimit && cacheBytes <= byteLimit) break;
            if (entry.references === 0) retire(entry);
        }
    }

    function touch(entry) {
        if (entries.get(entry.key) !== entry) return;
        entries.delete(entry.key);
        entries.set(entry.key, entry);
    }

    function lease(entry) {
        entry.references += 1;
        touch(entry);
        let released = false;
        return {
            url: entry.url,
            release() {
                if (released) return;
                released = true;
                entry.references -= 1;
                if (entry.retired && entry.references === 0) revoke(entry);
                else {
                    touch(entry);
                    trimCache();
                }
            },
        };
    }

    function detach(customer) {
        customer.signal?.removeEventListener('abort', customer.onAbort);
    }

    function rejectCustomers(job, error) {
        for (const customer of job.customers) {
            detach(customer);
            customer.reject(error);
        }
        job.customers.clear();
    }

    function cancelJob(job) {
        if (job.canceled) return;
        job.canceled = true;
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.cancelRender?.(abortError());
        job.image = null;
    }

    function assertCurrent(job, image) {
        if (disposed || job.canceled) throw abortError();
        const size = sourceDimensions(image);
        if (sourceUrl(image) !== job.sourceUrl
            || size.width !== job.sourceWidth || size.height !== job.sourceHeight) {
            throw abortError('Cover image source changed.');
        }
    }

    async function run(job) {
        let canvas = null;
        try {
            const image = job.image;
            assertCurrent(job, image);
            canvas = createCanvas();
            const cancelToken = new Promise((_resolve, reject) => {
                job.cancelRender = reject;
            });
            cancelToken.catch(() => {});
            const painted = await renderer({
                source: image,
                canvas,
                target: job.target,
                createCanvas,
                cancelToken,
            });
            assertCurrent(job, image);
            if (!painted) throw new Error('Cover image resize failed.');
            const blob = await canvasBlob(canvas);
            assertCurrent(job, image);
            const entry = {
                key: job.key,
                url: urlApi.createObjectURL(blob),
                bytes: job.target.width * job.target.height * 4 + blob.size,
                references: 0,
                retired: false,
                revoked: false,
            };
            entries.set(entry.key, entry);
            cacheBytes += entry.bytes;
            for (const customer of job.customers) {
                detach(customer);
                customer.resolve(lease(entry));
            }
            job.customers.clear();
            trimCache();
        } catch (error) {
            rejectCustomers(job, error);
        } finally {
            if (canvas) {
                canvas.width = 1;
                canvas.height = 1;
            }
            job.image = null;
            job.cancelRender = null;
            if (jobs.get(job.key) === job) jobs.delete(job.key);
            activeJob = null;
            pump();
        }
    }

    function pump() {
        if (disposed || activeJob) return;
        const job = queue.shift();
        if (!job) return;
        activeJob = job;
        void run(job);
    }

    function acquire(image, target, { signal } = {}) {
        if (disposed || signal?.aborted) return Promise.reject(abortError());
        const src = sourceUrl(image);
        const sourceSize = sourceDimensions(image);
        const targetSize = { width: Number(target?.width), height: Number(target?.height) };
        if (!src.trim() || !validDimensions(sourceSize, MAX_SOURCE_PIXELS)
            || !validDimensions(targetSize, MAX_TARGET_PIXELS)
            || targetSize.width >= sourceSize.width || targetSize.height >= sourceSize.height) {
            return Promise.reject(new Error('Invalid cover image resize dimensions or source.'));
        }
        const key = JSON.stringify([src, targetSize.width, targetSize.height]);
        const cached = entries.get(key);
        if (cached) return Promise.resolve(lease(cached));

        let job = jobs.get(key);
        if (!job) {
            job = {
                key,
                image,
                sourceUrl: src,
                sourceWidth: sourceSize.width,
                sourceHeight: sourceSize.height,
                target: targetSize,
                customers: new Set(),
                canceled: false,
                cancelRender: null,
            };
            jobs.set(key, job);
            queue.push(job);
        }
        const pending = new Promise((resolve, reject) => {
            const customer = { resolve, reject, signal, onAbort: null };
            customer.onAbort = () => {
                if (!job.customers.delete(customer)) return;
                detach(customer);
                reject(abortError());
                if (job.customers.size === 0) cancelJob(job);
            };
            job.customers.add(customer);
            signal?.addEventListener('abort', customer.onAbort, { once: true });
            if (signal?.aborted) customer.onAbort();
        });
        pump();
        return pending;
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (const job of jobs.values()) {
            rejectCustomers(job, abortError());
            cancelJob(job);
        }
        queue.length = 0;
        for (const entry of entries.values()) retire(entry);
    }

    return { acquire, dispose };
}

const sharedCoverResampler = createCoverImageResampler();

export function acquireResampledCover(image, target, options) {
    return sharedCoverResampler.acquire(image, target, options);
}
