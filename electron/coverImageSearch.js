import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { detectImageMimeType, supportedImageExtensionForMimeType } from './imageMagic.js';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;
const SEARCH_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;
const blockedIPv4 = new BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedIPv4.addSubnet(address, prefix, 'ipv4');
const publicIPv6 = new BlockList();
publicIPv6.addSubnet('2000::', 3, 'ipv6');
const blockedIPv6 = new BlockList();
blockedIPv6.addSubnet('2001::', 23, 'ipv6');
blockedIPv6.addSubnet('2001:db8::', 32, 'ipv6');
blockedIPv6.addSubnet('2002::', 16, 'ipv6');
blockedIPv6.addSubnet('3fff::', 20, 'ipv6');

export function isPublicCoverImageAddress(address) {
    const family = isIP(address);
    if (family === 4) return !blockedIPv4.check(address, 'ipv4');
    return family === 6 && publicIPv6.check(address, 'ipv6') && !blockedIPv6.check(address, 'ipv6');
}

export function parseCoverImageUrl(value) {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
        || !hostname || hostname === 'localhost' || /\.(localhost|local|internal|home)$/.test(hostname)
        || (!isIP(hostname) && !hostname.includes('.'))
        || (isIP(hostname) && !isPublicCoverImageAddress(hostname))) {
        throw new Error('Choose an image from a public HTTP or HTTPS address.');
    }
    return url;
}

function abortable(promise, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

async function readImageResponse(url, options) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await abortable(options.lookup(hostname, { all: true, verbatim: true }), options.signal);
    if (!addresses.length || addresses.some(record => !isPublicCoverImageAddress(record.address))) {
        throw new Error('The image address does not resolve to a public server.');
    }
    options.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const request = options.request || (url.protocol === 'https:' ? https.request : http.request);
        const req = request(url, {
            method: 'GET',
            agent: false,
            autoSelectFamily: false,
            signal: options.signal,
            lookup: (_hostname, lookupOptions, callback) => {
                // Pin the checked DNS result so a second lookup cannot reach a private address.
                if (lookupOptions.all) callback(null, addresses);
                else callback(null, addresses[0].address, addresses[0].family);
            },
            headers: {
                Accept: 'image/jpeg,image/png,image/webp,image/gif,image/bmp;q=0.9,*/*;q=0.1',
                'Accept-Encoding': 'identity',
                'User-Agent': options.userAgent || 'BookManager Cover Image',
            },
        }, response => {
            response.on('error', reject);
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.destroy();
                resolve({ redirect: response.headers.location });
                return;
            }
            if (response.statusCode !== 200) {
                response.destroy();
                reject(new Error(`The image server returned HTTP ${response.statusCode}.`));
                return;
            }
            const declaredSize = Number(response.headers['content-length']);
            if (declaredSize > options.maxBytes) {
                reject(Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' }));
                response.destroy();
                return;
            }
            const chunks = [];
            let total = 0;
            response.on('data', chunk => {
                total += chunk.length;
                if (total > options.maxBytes) {
                    reject(Object.assign(new Error('Choose an image no larger than 16 MiB.'), { code: 'COVER_IMAGE_TOO_LARGE' }));
                    response.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            response.on('aborted', () => reject(new Error('The image download was interrupted.')));
            response.on('end', () => resolve({ buffer: Buffer.concat(chunks, total) }));
        });
        req.on('error', reject);
        req.end();
    });
}

export async function downloadCoverImage(sourceUrl, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error('The image download timed out.')), options.timeoutMs || DOWNLOAD_TIMEOUT_MS);
    let directory = '';
    try {
        let url = parseCoverImageUrl(sourceUrl);
        let buffer;
        for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
            const response = await readImageResponse(url, {
                ...options,
                signal: controller.signal,
                lookup: options.lookup || dns.lookup,
                maxBytes: Math.min(options.maxBytes || MAX_IMAGE_BYTES, MAX_IMAGE_BYTES),
            });
            if (response.buffer) {
                buffer = response.buffer;
                break;
            }
            if (!response.redirect || redirect === MAX_REDIRECTS) throw new Error('The image server redirected too many times.');
            url = parseCoverImageUrl(new URL(response.redirect, url).href);
        }
        controller.signal.throwIfAborted();
        const mimeType = detectImageMimeType(buffer);
        if (!mimeType) throw Object.assign(new Error('Choose a JPEG, PNG, WebP, GIF, or BMP image.'), { code: 'COVER_IMAGE_UNSUPPORTED_FORMAT' });
        directory = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'bookmanager-cover-search-'));
        const imagePath = path.join(directory, `cover${supportedImageExtensionForMimeType(mimeType)}`);
        await fs.writeFile(imagePath, buffer, { flag: 'wx' });
        const loadImage = options.loadImage || (await import('./coverEditor.js')).loadCoverEditorImage;
        const image = await loadImage(imagePath, { normalizeImage: options.normalizeImage });
        controller.signal.throwIfAborted();
        return { ...image, cleanupDirectory: directory, sourceUrl: url.href };
    } catch (error) {
        if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
    }
}

function allowedSearchNavigation(value) {
    try {
        const url = parseCoverImageUrl(value);
        return url.protocol === 'https:' && /(^|\.)google\.(com|co\.kr)$/.test(url.hostname);
    } catch {
        return false;
    }
}

function navigationUrl(event, legacyUrl) {
    return event.url || (typeof legacyUrl === 'string' ? legacyUrl : legacyUrl?.url);
}

function isAbortedNavigation(error) {
    return error?.code === 'ERR_ABORTED' || error?.errno === -3;
}

export async function selectGoogleCoverImage(options = {}) {
    const query = String(options.query || '').normalize('NFC').trim();
    if (!query || query.length > 300) throw new Error('Enter a search query of up to 300 characters.');
    if (options.signal?.aborted) return { cancelled: true };
    const electronModule = options.electron || await import('electron');
    const { BrowserWindow, Menu, dialog } = electronModule.default || electronModule;
    const language = ['en', 'ja'].includes(options.language) ? options.language : 'ko';
    const labels = {
        ko: {
            instruction: 'Google 이미지 · 검색 결과를 클릭한 뒤 큰 이미지를 우클릭하여 커버 선택',
            select: '커버로 선택',
            hint: '검색 결과를 클릭한 뒤 큰 이미지를 우클릭하세요',
            loading: '커버 이미지를 불러오는 중…',
            errorTitle: '커버 이미지 가져오기',
            errorMessage: '이미지를 불러오지 못했습니다. 다른 이미지를 선택해 주세요.',
            searchError: 'Google 이미지 검색을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
            searchTimeout: 'Google 이미지 검색 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
            windowError: '이미지 검색 창이 예기치 않게 종료되었습니다. 다시 검색해 주세요.',
        },
        en: {
            instruction: 'Google Images · Click a result, then right-click its large image to select a cover',
            select: 'Use as cover',
            hint: 'Click a result, then right-click its large image',
            loading: 'Loading cover image…',
            errorTitle: 'Import cover image',
            errorMessage: 'Could not load this image. Choose another image.',
            searchError: 'Could not load Google Images. Check your internet connection and try again.',
            searchTimeout: 'Google Images is taking too long to respond. Try again shortly.',
            windowError: 'The image search window closed unexpectedly. Try searching again.',
        },
        ja: {
            instruction: 'Google画像 · 検索結果をクリックし、大きな画像を右クリックして表紙を選択',
            select: '表紙に使用',
            hint: '検索結果をクリックしてから大きな画像を右クリックしてください',
            loading: '表紙画像を読み込み中…',
            errorTitle: '表紙画像を取り込む',
            errorMessage: '画像を読み込めませんでした。別の画像を選択してください。',
            searchError: 'Google画像を読み込めませんでした。インターネット接続を確認して、もう一度お試しください。',
            searchTimeout: 'Google画像の応答が遅れています。しばらくしてからもう一度お試しください。',
            windowError: '画像検索ウィンドウが予期せず終了しました。もう一度検索してください。',
        },
    }[language];
    const instruction = labels.instruction;
    const searchUrl = new URL('https://www.google.com/search');
    searchUrl.searchParams.set('udm', '2');
    searchUrl.searchParams.set('imgsz', 'l');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('hl', language);
    const window = new BrowserWindow({
        parent: options.parentWindow || undefined,
        modal: Boolean(options.parentWindow),
        width: 1120,
        height: 800,
        minWidth: 720,
        minHeight: 520,
        title: instruction,
        autoHideMenuBar: true,
        webPreferences: {
            partition: 'persist:cover-image-search',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            navigateOnDragDrop: false,
            spellcheck: false,
        },
    });
    window.setMenu(null);
    const contents = window.webContents;
    const session = contents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    const preventDownload = event => event.preventDefault();
    session.on('will-download', preventDownload);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
        contents.on(eventName, (event, url) => {
            if (!allowedSearchNavigation(navigationUrl(event, url))) event.preventDefault();
        });
    }
    window.on('page-title-updated', event => event.preventDefault());
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let finished = false;
        let selecting = false;
        let searchTimer;
        const finish = async (result, error) => {
            if (finished) return;
            finished = true;
            clearTimeout(searchTimer);
            controller.abort();
            options.signal?.removeEventListener('abort', cancel);
            if (!window.isDestroyed()) window.destroy();
            session.removeListener('will-download', preventDownload);
            try {
                session.flushStorageData();
                await session.cookies.flushStore();
            } catch {
                // Storage failures must not discard the chosen image or prevent closing.
            }
            if (error) reject(error);
            else resolve(result);
        };
        const cancel = () => finish({ cancelled: true });
        const failSearch = (message, code) => finish(null, Object.assign(new Error(message), { code }));
        const waitForSearch = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => failSearch(labels.searchTimeout, 'COVER_SEARCH_TIMEOUT'), options.searchTimeoutMs || SEARCH_TIMEOUT_MS);
        };
        options.signal?.addEventListener('abort', cancel, { once: true });
        window.once('closed', cancel);
        if (options.signal?.aborted) {
            cancel();
            return;
        }
        contents.once('render-process-gone', () => failSearch(labels.windowError, 'COVER_SEARCH_WINDOW_CLOSED'));
        contents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
            if (!finished && (event.isMainFrame ?? isMainFrame) && !(event.isSameDocument ?? isInPlace)
                && allowedSearchNavigation(navigationUrl(event, url))) waitForSearch();
        });
        contents.on('did-finish-load', () => {
            if (!contents.isLoadingMainFrame()) clearTimeout(searchTimer);
        });
        contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
            if (!finished && isMainFrame && errorCode !== -3) failSearch(labels.searchError, 'COVER_SEARCH_LOAD_FAILED');
        });
        contents.on('context-menu', (_event, params) => {
            if (finished || selecting) return;
            let canSelect = params.mediaType === 'image';
            try {
                parseCoverImageUrl(params.srcURL);
            } catch {
                canSelect = false;
            }
            const items = [{
                label: canSelect ? labels.select : labels.hint,
                enabled: canSelect,
                click: async () => {
                    if (selecting || finished) return;
                    selecting = true;
                    window.setTitle(labels.loading);
                    try {
                        const result = await (options.downloadImage || downloadCoverImage)(params.srcURL, {
                            normalizeImage: options.normalizeImage,
                            signal: controller.signal,
                            userAgent: contents.getUserAgent(),
                        });
                        if (finished) {
                            await fs.rm(result.cleanupDirectory, { recursive: true, force: true });
                            return;
                        }
                        finish(result);
                    } catch (error) {
                        if (finished) return;
                        window.setTitle(instruction);
                        await dialog.showMessageBox(window, {
                            type: 'error',
                            title: labels.errorTitle,
                            message: labels.errorMessage,
                            detail: error.message,
                        }).catch(() => {});
                    } finally {
                        selecting = false;
                    }
                },
            }];
            if (params.isEditable) items.push({ type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
            Menu.buildFromTemplate(items).popup({ window });
        });
        waitForSearch();
        window.loadURL(searchUrl.href).catch(error => {
            // Google can replace the initial navigation before it finishes loading.
            // Its ERR_ABORTED rejection must not close the replacement search page.
            if (!finished && !isAbortedNavigation(error)) failSearch(labels.searchError, 'COVER_SEARCH_LOAD_FAILED');
        });
    });
}
