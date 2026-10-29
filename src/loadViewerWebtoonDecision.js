import { classifyWebtoon, getWebtoonSampleIndices, hasLongWebtoonPages, isWebtoonByArchiveRatios, isWebtoonByArchiveSize } from './viewerWebtoonDetection.js';

const MAXIMUM_SAMPLE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 32 * 1024 * 1024;

function chunkName(bytes, offset) {
    return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function readViewerImageHeaderMetrics(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const metrics = (width, height, mimeType) => width > 0 && height > 0 ? { width, height, mimeType } : null;
    if (bytes[0] === 137 && chunkName(bytes, 1) === 'PNG\r' && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
        let size = null;
        let hasImageData = false;
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const length = view.getUint32(offset);
            const name = chunkName(bytes, offset + 4);
            if (length > bytes.length - offset - 12 || name === 'acTL') return null;
            if (offset === 8 && (name !== 'IHDR' || length !== 13)) return null;
            if (name === 'IHDR') {
                if (size || length !== 13 || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) return null;
                size = metrics(view.getUint32(offset + 8), view.getUint32(offset + 12), 'image/png');
            }
            if (name === 'IDAT') hasImageData = true;
            if (name === 'IEND') return length === 0 && hasImageData && offset + 12 === bytes.length ? size : null;
            offset += length + 12;
        }
        return null;
    }
    if (bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
        let size = null;
        for (let offset = 2; offset + 3 < bytes.length;) {
            if (bytes[offset++] !== 255) return null;
            while (bytes[offset] === 255) offset += 1;
            const marker = bytes[offset++];
            if (marker === 218) return size;
            if (marker === 0 || marker === 216 || marker === 217 || (marker >= 208 && marker <= 215)) return null;
            if (offset + 2 > bytes.length) return null;
            const length = view.getUint16(offset);
            if (length < 2 || length > bytes.length - offset) return null;
            if (marker === 226 && chunkName(bytes, offset + 2) === 'MPF\0') return null;
            if ([192, 193, 194].includes(marker)) {
                if (size || length < 8 || length !== 8 + 3 * bytes[offset + 7]) return null;
                size = metrics(view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg');
            }
            offset += length;
        }
        return null;
    }
    if (chunkName(bytes, 0) === 'RIFF' && chunkName(bytes, 8) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length) {
        let canvasSize = null;
        let imageSize = null;
        const uint24 = offset => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
        for (let offset = 12; offset + 8 <= bytes.length;) {
            const name = chunkName(bytes, offset);
            const length = view.getUint32(offset + 4, true);
            const data = offset + 8;
            if (length > bytes.length - data || name === 'ANIM' || name === 'ANMF') return null;
            if (name === 'VP8X') {
                if (canvasSize || length !== 10 || (bytes[data] & 2)) return null;
                canvasSize = metrics(uint24(data + 4) + 1, uint24(data + 7) + 1, 'image/webp');
            } else if (name === 'VP8 ') {
                if (imageSize || length < 10 || bytes[data + 3] !== 157 || bytes[data + 4] !== 1 || bytes[data + 5] !== 42) return null;
                imageSize = metrics(view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383, 'image/webp');
            } else if (name === 'VP8L') {
                if (imageSize || length < 5 || bytes[data] !== 47 || (bytes[data + 4] & 224)) return null;
                const bits = view.getUint32(data + 1, true);
                imageSize = metrics((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1, 'image/webp');
            }
            offset = data + length + (length % 2);
            if (offset > bytes.length) return null;
            if (offset === bytes.length) {
                if (canvasSize && (canvasSize.width !== imageSize?.width || canvasSize.height !== imageSize?.height)) return null;
                return imageSize;
            }
        }
    }
    return null;
}

async function fetchSampleBytes(url, limit, signal, isCancelled) {
    if (!url || isCancelled()) return null;
    const response = await fetch(url, { cache: 'no-store', signal });
    if (!response.ok || isCancelled()) return null;
    const declaredLength = Number(response.headers.get('content-length'));
    if (declaredLength > limit) {
        await response.body?.cancel();
        return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks = [];
    let length = 0;
    let completed = false;
    try {
        while (!isCancelled()) {
            const result = await reader.read();
            if (result.done) {
                completed = true;
                break;
            }
            length += result.value.byteLength;
            if (length > limit) return null;
            chunks.push(result.value);
        }
    } finally {
        if (!completed) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (isCancelled() || !completed || length === 0) return null;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

async function readPageEdges(bytes, sample, isCancelled) {
    if (isCancelled() || sample.encodedBytes > 4 * 1024 * 1024
        || sample.width * sample.height > 8_000_000
        || Math.max(sample.width, sample.height) > 4096 || sample.height < 2) return {};
    let image = null;
    let canvas = null;
    try {
        image = await createImageBitmap(new Blob([bytes], { type: sample.mimeType }));
        if (isCancelled() || image.width !== sample.width || image.height !== sample.height) return {};
        canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(sample.width, 2) : document.createElement('canvas');
        canvas.width = sample.width;
        canvas.height = 2;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return {};
        const read = y => {
            context.clearRect(0, 0, sample.width, 2);
            context.drawImage(image, 0, y, sample.width, 2, 0, 0, sample.width, 2);
            const pixels = context.getImageData(0, 0, sample.width, 2).data;
            const result = [];
            for (let index = 0; index < 64; index += 1) {
                const x = Math.min(sample.width - 1, Math.floor(sample.width * (0.04 + 0.92 * (index + 0.5) / 64)));
                const offset = x * 4;
                if (pixels[offset + 3] < 250 || pixels[offset + sample.width * 4 + 3] < 250) return undefined;
                for (let channel = 0; channel < 3; channel += 1) {
                    result.push((pixels[offset + channel] + pixels[offset + sample.width * 4 + channel]) / 2);
                }
            }
            return result;
        };
        return { top: read(0), bottom: read(sample.height - 2) };
    } finally {
        image?.close();
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}

export async function loadViewerWebtoonDecision({ pages, bookName = '', readingDirection = '', getPageUrl } = {}, isCancelled = () => false) {
    if (!Array.isArray(pages) || pages.length === 0 || isCancelled()) return 'paged';
    if (typeof readingDirection === 'string' && readingDirection.trim().toLowerCase() === 'webtoon') return 'scroll';
    let totalEncodedBytes = 0;
    for (const page of pages) {
        if (!Number.isSafeInteger(page?.size) || page.size <= 0
            || totalEncodedBytes > Number.MAX_SAFE_INTEGER - page.size) {
            totalEncodedBytes = null;
            break;
        }
        totalEncodedBytes += page.size;
    }
    // Archive entries describe the encoded image sizes, excluding metadata and container compression.
    if (isWebtoonByArchiveSize(pages.length, totalEncodedBytes)) return 'scroll';
    const indices = getWebtoonSampleIndices(pages.length);
    if (indices.length === 0) return 'paged';
    const descriptors = indices.map(index => ({ ...pages[index], index }));
    // Both comic protocol and IPC extract the entry before returning bytes. Unknown sizes
    // cannot be bounded in the renderer, so automatic probing leaves those books paged.
    if (descriptors.some(page => !Number.isSafeInteger(page.size) || page.size <= 0 || page.size > MAXIMUM_SAMPLE_BYTES)
        || descriptors.reduce((sum, page) => sum + page.size, 0) > MAXIMUM_TOTAL_BYTES) return 'paged';
    const controller = new AbortController();
    const cancelTimer = setInterval(() => {
        if (isCancelled()) {
            controller.abort();
            clearInterval(cancelTimer);
        }
    }, 50);
    try {
        const samples = [];
        const contents = [];
        let totalBytes = 0;
        for (const page of descriptors) {
            if (isCancelled()) return 'paged';
            const limit = Math.min(MAXIMUM_SAMPLE_BYTES, MAXIMUM_TOTAL_BYTES - totalBytes);
            if (limit <= 0) return 'paged';
            let bytes = null;
            let needsFallback = !page.pageUrl;
            if (page.pageUrl) {
                try {
                    bytes = await fetchSampleBytes(page.pageUrl, limit, controller.signal, isCancelled);
                } catch {
                    if (isCancelled()) return 'paged';
                    needsFallback = true;
                }
            }
            if (needsFallback && getPageUrl && !isCancelled()) {
                const url = await getPageUrl(page);
                if (url && url !== page.pageUrl) bytes = await fetchSampleBytes(url, limit, controller.signal, isCancelled);
            }
            if (!bytes || isCancelled()) return 'paged';
            totalBytes += bytes.length;
            const metrics = readViewerImageHeaderMetrics(bytes);
            if (!metrics) return 'paged';
            samples.push({ ...metrics, index: page.index, name: page.name || '', encodedBytes: bytes.length });
            contents.push(bytes);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (isCancelled()) return 'paged';
        if (isWebtoonByArchiveRatios(pages.length, totalEncodedBytes, samples)) return 'scroll';
        if (hasLongWebtoonPages(pages.length, samples)) return 'scroll';
        if (samples.length < 8) return 'paged';
        for (let index = 0; index < samples.length; index += 1) {
            if (isCancelled()) return 'paged';
            Object.assign(samples[index], await readPageEdges(contents[index], samples[index], isCancelled));
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return isCancelled() ? 'paged' : classifyWebtoon(pages.length, samples, bookName);
    } catch {
        return 'paged';
    } finally {
        clearInterval(cancelTimer);
        controller.abort();
    }
}
