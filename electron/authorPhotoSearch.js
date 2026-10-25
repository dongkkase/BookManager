import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { decodeHTML } from 'entities';
import { downloadCoverImage, parseCoverImageUrl } from './coverImageSearch.js';
import { decodeCoverEditorImage } from './coverEditorImageDecoder.js';
import { detectImageMimeType } from './imageMagic.js';

const PAGE_SIZE = 20;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;
const CANDIDATE_TTL_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 200;
const MAX_PREVIEWS = 40;
const NAVER_IMAGE_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/image';
const ERROR_MESSAGES = {
    AUTHOR_PHOTO_MISSING_KEYS: 'Enter your NAVER API HUB Client ID and Client Secret in Settings.',
    AUTHOR_PHOTO_INVALID_KEYS: 'Check your NAVER API HUB credentials and image search permission in Settings.',
    AUTHOR_PHOTO_RATE_LIMIT: 'Naver image search has reached its request limit. Try again later.',
    AUTHOR_PHOTO_TIMEOUT: 'The image request timed out. Try again.',
    AUTHOR_PHOTO_INVALID_QUERY: 'Enter a search query of up to 200 characters.',
    AUTHOR_PHOTO_INVALID_CANDIDATE: 'This image result has expired. Search again.',
    AUTHOR_PHOTO_CANCELLED: 'The image request was cancelled.',
    AUTHOR_PHOTO_REQUEST_FAILED: 'Naver image search could not be loaded. Try again.',
    AUTHOR_PHOTO_IMAGE_FAILED: 'This image could not be loaded. Choose another image.',
    AUTHOR_PHOTO_STORAGE_FAILED: 'The author photo could not be saved.',
    AUTHOR_PHOTO_UNTRUSTED_SENDER: 'Author photos are only available in the main library window.',
};

function photoError(code) {
    return Object.assign(new Error(ERROR_MESSAGES[code]), { code });
}

function failure(error, fallback = 'AUTHOR_PHOTO_REQUEST_FAILED') {
    const code = Object.hasOwn(ERROR_MESSAGES, error?.code) ? error.code : fallback;
    return { success: false, code, error: ERROR_MESSAGES[code] };
}

function searchQuery(value) {
    if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw photoError('AUTHOR_PHOTO_INVALID_QUERY');
    }
    const query = value.normalize('NFC').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!query) throw photoError('AUTHOR_PHOTO_INVALID_QUERY');
    return query;
}

function imageUrl(value, maxLength = 2048) {
    if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f\\]/.test(value)) return '';
    try {
        const url = parseCoverImageUrl(value);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
        if (hostname.includes(':') || /(?:^|\.)lan$/.test(hostname)) return '';
        url.hash = '';
        return url.href.length <= maxLength ? url.href : '';
    } catch {
        return '';
    }
}

function credentials(config) {
    const id = typeof config?.api_keys?.naver_client_id === 'string' ? config.api_keys.naver_client_id.trim() : '';
    const secret = typeof config?.api_keys?.naver_client_secret === 'string' ? config.api_keys.naver_client_secret.trim() : '';
    if (!id || !secret) throw photoError('AUTHOR_PHOTO_MISSING_KEYS');
    if (![id, secret].every(value => /^[\x21-\x7e]{1,1024}$/.test(value))) throw photoError('AUTHOR_PHOTO_INVALID_KEYS');
    return { id, secret };
}

export function requestNaverImages({ query, start, keys, signal }, { get = https.get, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const url = new URL(NAVER_IMAGE_URL);
    url.search = new URLSearchParams({ query, start: String(start), display: String(PAGE_SIZE), sort: 'sim' }).toString();
    return new Promise((resolve, reject) => {
        let request;
        let response;
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(result);
        };
        const stop = error => {
            finish(error);
            response?.destroy();
            request?.destroy();
        };
        const abort = () => stop(photoError('AUTHOR_PHOTO_CANCELLED'));
        const timer = setTimeout(() => stop(photoError('AUTHOR_PHOTO_TIMEOUT')), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try {
            request = get(url, {
                agent: false,
                headers: {
                    Accept: 'application/json',
                    'Accept-Encoding': 'identity',
                    'User-Agent': 'BookManager author photo search',
                    'X-NCP-APIGW-API-KEY-ID': keys.id,
                    'X-NCP-APIGW-API-KEY': keys.secret,
                },
            }, incoming => {
                response = incoming;
                response.on('error', () => finish(photoError('AUTHOR_PHOTO_REQUEST_FAILED')));
                if (settled) { response.destroy(); return; }
                if (response.statusCode !== 200) {
                    const code = [401, 403].includes(response.statusCode) ? 'AUTHOR_PHOTO_INVALID_KEYS'
                        : response.statusCode === 429 ? 'AUTHOR_PHOTO_RATE_LIMIT' : 'AUTHOR_PHOTO_REQUEST_FAILED';
                    stop(photoError(code));
                    return;
                }
                if (Number(response.headers['content-length']) > MAX_RESPONSE_BYTES) {
                    stop(photoError('AUTHOR_PHOTO_REQUEST_FAILED'));
                    return;
                }
                const chunks = [];
                let bytes = 0;
                response.on('data', chunk => {
                    if (settled) return;
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > MAX_RESPONSE_BYTES) { stop(photoError('AUTHOR_PHOTO_REQUEST_FAILED')); return; }
                    chunks.push(Buffer.from(chunk));
                });
                response.on('aborted', () => finish(photoError('AUTHOR_PHOTO_REQUEST_FAILED')));
                response.on('end', () => {
                    if (settled) return;
                    try { finish(null, JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))); }
                    catch { finish(photoError('AUTHOR_PHOTO_REQUEST_FAILED')); }
                });
            });
            request.on('error', () => finish(photoError('AUTHOR_PHOTO_REQUEST_FAILED')));
        } catch {
            finish(photoError('AUTHOR_PHOTO_REQUEST_FAILED'));
        }
    });
}

async function resizePhoto(buffer, maxSize) {
    const image = await decodeCoverEditorImage(buffer);
    const { width, height } = image.getSize();
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const resized = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: 'good',
    });
    return { buffer: resized.toPNG(), mimeType: 'image/png', ...resized.getSize() };
}

export function registerAuthorPhotoSearchIpc(options) {
    const { ipcMain, getMainWindow, getConfig, getPhotoDirectory } = options;
    const requestJson = options.requestJson || requestNaverImages;
    const downloadImage = options.downloadImage || downloadCoverImage;
    const resizeImage = options.resizeImage || resizePhoto;
    const now = options.now || Date.now;
    const owners = new Map();
    let runningPreviews = 0;
    const previewQueue = [];

    const cancel = owner => {
        owner.search?.abort();
        for (const controller of owner.downloads) controller.abort(photoError('AUTHOR_PHOTO_CANCELLED'));
        owner.candidates.clear();
        owner.previews.clear();
    };
    const dispose = owner => {
        owner.disposed = true;
        cancel(owner);
        owners.delete(owner.sender);
        owner.sender.removeListener('destroyed', owner.onDestroyed);
        owner.sender.removeListener('did-start-navigation', owner.onNavigate);
    };
    const getOwner = event => {
        const window = getMainWindow?.();
        if (!window || window.isDestroyed() || window.webContents !== event.sender || event.sender.isDestroyed()
            || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
            throw photoError('AUTHOR_PHOTO_UNTRUSTED_SENDER');
        }
        let owner = owners.get(event.sender);
        if (!owner) {
            owner = { sender: event.sender, query: '', candidates: new Map(), previews: new Map(), downloads: new Set(), disposed: false };
            owner.onDestroyed = () => dispose(owner);
            owner.onNavigate = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) dispose(owner); };
            event.sender.once('destroyed', owner.onDestroyed);
            event.sender.on('did-start-navigation', owner.onNavigate);
            owners.set(event.sender, owner);
        }
        return owner;
    };
    const currentCandidate = (owner, id) => {
        const candidate = typeof id === 'string' && owner.candidates.get(id);
        if (owner.disposed || !candidate || now() - candidate.created >= CANDIDATE_TTL_MS) {
            owner.candidates.delete(id);
            owner.previews.delete(id);
            throw photoError('AUTHOR_PHOTO_INVALID_CANDIDATE');
        }
        return candidate;
    };
    const pumpPreviews = () => {
        while (runningPreviews < 3 && previewQueue.length) {
            const job = previewQueue.shift();
            job.signal.removeEventListener('abort', job.abort);
            if (job.signal.aborted) { job.reject(photoError('AUTHOR_PHOTO_CANCELLED')); continue; }
            runningPreviews += 1;
            Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                runningPreviews -= 1;
                pumpPreviews();
            });
        }
    };
    const limitedPreview = (signal, run) => new Promise((resolve, reject) => {
        if (signal.aborted) { reject(photoError('AUTHOR_PHOTO_CANCELLED')); return; }
        if (previewQueue.length >= 60) { reject(photoError('AUTHOR_PHOTO_IMAGE_FAILED')); return; }
        const job = { signal, run, resolve, reject };
        job.abort = () => {
            const index = previewQueue.indexOf(job);
            if (index >= 0) previewQueue.splice(index, 1);
            reject(photoError('AUTHOR_PHOTO_CANCELLED'));
        };
        signal.addEventListener('abort', job.abort, { once: true });
        previewQueue.push(job);
        pumpPreviews();
    });
    const fetchPhoto = async (candidate, controller, preview) => {
        let downloaded;
        const size = preview ? 160 : 512;
        const timer = setTimeout(() => controller.abort(photoError('AUTHOR_PHOTO_TIMEOUT')), options.timeoutMs || REQUEST_TIMEOUT_MS);
        try {
            controller.signal.throwIfAborted();
            downloaded = await downloadImage(preview ? candidate.thumbnail : candidate.url, {
                signal: controller.signal,
                maxBytes: MAX_IMAGE_BYTES,
                timeoutMs: (options.timeoutMs || REQUEST_TIMEOUT_MS) + 1000,
                tempRoot: options.tempRoot,
                normalizeImage: buffer => resizeImage(buffer, size),
            });
            controller.signal.throwIfAborted();
            if (!Buffer.isBuffer(downloaded?.buffer) || !downloaded.buffer.length
                || downloaded.buffer.length > (preview ? 256 * 1024 : 2 * 1024 * 1024)
                || detectImageMimeType(downloaded.buffer) !== 'image/png'
                || !(downloaded.width > 0 && downloaded.height > 0 && downloaded.width <= size && downloaded.height <= size)) {
                throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            }
            return { buffer: downloaded.buffer, sourceUrl: imageUrl(downloaded.sourceUrl || candidate.url) };
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            throw error;
        } finally {
            clearTimeout(timer);
            if (downloaded?.cleanupDirectory) await fs.rm(downloaded.cleanupDirectory, { recursive: true, force: true }).catch(() => {});
        }
    };

    ipcMain.handle('authors:searchPhotos', async (event, request = {}) => {
        let owner;
        let controller;
        try {
            owner = getOwner(event);
            const query = searchQuery(request?.query);
            const start = request?.start ?? 1;
            if (!Number.isInteger(start) || start < 1 || start > 1000) throw photoError('AUTHOR_PHOTO_INVALID_QUERY');
            if (start === 1 || query !== owner.query) cancel(owner);
            owner.query = query;
            owner.search?.abort();
            controller = new AbortController();
            owner.search = controller;
            const config = await getConfig();
            const keys = credentials(config);
            controller.signal.throwIfAborted();
            const data = await requestJson({ query, start, keys, signal: controller.signal });
            controller.signal.throwIfAborted();
            if (owner.disposed || !Array.isArray(data?.items)) throw photoError('AUTHOR_PHOTO_REQUEST_FAILED');
            for (const [id, candidate] of owner.candidates) {
                if (now() - candidate.created >= CANDIDATE_TTL_MS) { owner.candidates.delete(id); owner.previews.delete(id); }
            }
            const results = [];
            for (const item of data.items.slice(0, PAGE_SIZE)) {
                const url = imageUrl(item?.link);
                const thumbnail = imageUrl(item?.thumbnail, 8192);
                if (!url || !thumbnail) continue;
                const id = randomUUID();
                const title = decodeHTML(String(item.title || '').replace(/<[^>]*>/g, '')).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
                const dimension = value => Math.min(100000, Math.max(0, Math.round(Number(value) || 0)));
                owner.candidates.set(id, { url, thumbnail, query, created: now() });
                results.push({ id, title, width: dimension(item.sizewidth), height: dimension(item.sizeheight) });
            }
            while (owner.candidates.size > MAX_CANDIDATES) {
                const oldest = owner.candidates.keys().next().value;
                owner.candidates.delete(oldest);
                owner.previews.delete(oldest);
            }
            const nextStart = start + data.items.slice(0, PAGE_SIZE).length;
            const hasNext = nextStart <= 1000 && data.items.length >= PAGE_SIZE && nextStart <= Number(data.total);
            return { success: true, results, hasNext, nextStart: hasNext ? nextStart : null };
        } catch (error) {
            return { ...failure(controller?.signal.aborted ? photoError('AUTHOR_PHOTO_CANCELLED') : error), results: [] };
        } finally {
            if (owner && owner.search === controller) owner.search = null;
        }
    });

    ipcMain.handle('authors:previewPhoto', async (event, candidateId) => {
        try {
            const owner = getOwner(event);
            const candidate = currentCandidate(owner, candidateId);
            if (owner.previews.has(candidateId)) return { success: true, dataUrl: owner.previews.get(candidateId) };
            if (!candidate.previewPromise) {
                const controller = new AbortController();
                owner.downloads.add(controller);
                candidate.previewPromise = limitedPreview(controller.signal, async () => {
                    try { return await fetchPhoto(candidate, controller, true); }
                    catch (error) {
                        if (controller.signal.aborted || candidate.thumbnail === candidate.url) throw error;
                        return fetchPhoto({ ...candidate, thumbnail: candidate.url }, controller, true);
                    }
                }).then(photo => {
                    currentCandidate(owner, candidateId);
                    const dataUrl = `data:image/png;base64,${photo.buffer.toString('base64')}`;
                    owner.previews.set(candidateId, dataUrl);
                    while (owner.previews.size > MAX_PREVIEWS) owner.previews.delete(owner.previews.keys().next().value);
                    return dataUrl;
                }).finally(() => { owner.downloads.delete(controller); candidate.previewPromise = null; });
            }
            return { success: true, dataUrl: await candidate.previewPromise };
        } catch (error) {
            return failure(error, 'AUTHOR_PHOTO_IMAGE_FAILED');
        }
    });

    ipcMain.handle('authors:selectPhoto', async (event, request = {}) => {
        let owner;
        let controller;
        try {
            owner = getOwner(event);
            const candidate = currentCandidate(owner, request?.candidateId);
            if (owner.selection) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            controller = new AbortController();
            owner.selection = controller;
            owner.downloads.add(controller);
            const photo = await fetchPhoto(candidate, controller, false);
            currentCandidate(owner, request.candidateId);
            if (!photo.sourceUrl) throw photoError('AUTHOR_PHOTO_IMAGE_FAILED');
            const id = createHash('sha256').update(photo.buffer).digest('hex');
            let temporaryPath;
            try {
                const directory = await getPhotoDirectory();
                controller.signal.throwIfAborted();
                await fs.mkdir(directory, { recursive: true });
                controller.signal.throwIfAborted();
                temporaryPath = path.join(directory, `.${id}.${randomUUID()}.tmp`);
                await (options.writePhotoFile || fs.writeFile)(temporaryPath, photo.buffer, { flag: 'wx', mode: 0o600 });
                controller.signal.throwIfAborted();
                await fs.rename(temporaryPath, path.join(directory, `${id}.png`));
            } catch (error) {
                if (controller.signal.aborted) throw controller.signal.reason;
                throw photoError('AUTHOR_PHOTO_STORAGE_FAILED');
            } finally {
                if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
            }
            controller.signal.throwIfAborted();
            return { success: true, photo: { id, sourceUrl: photo.sourceUrl, query: candidate.query } };
        } catch (error) {
            return failure(error, 'AUTHOR_PHOTO_IMAGE_FAILED');
        } finally {
            owner?.downloads.delete(controller);
            if (owner && owner.selection === controller) owner.selection = null;
        }
    });

    ipcMain.handle('authors:releasePhotos', async event => {
        try {
            cancel(getOwner(event));
            return { success: true };
        } catch (error) {
            return failure(error);
        }
    });

    return { dispose: () => { for (const owner of owners.values()) dispose(owner); } };
}
