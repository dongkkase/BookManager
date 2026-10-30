import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { downloadCoverImage, parseCoverImageUrl } from './coverImageSearch.js';
import { authorWebError, cancelGoogleAuthorSearches, googleAuthorProfile, parseNamuProfile } from './authorWebProfiles.js';

export function authorWebSearchUrl({ source, query, kind = 'profile', language = 'ko' }) {
    if (!['google', 'namuwiki'].includes(source) || !['profile', 'photo'].includes(kind)
        || typeof query !== 'string' || !query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw authorWebError('AUTHOR_PROFILE_INVALID_QUERY');
    }
    const url = new URL(source === 'google' ? 'https://www.google.com/search' : 'https://namu.wiki/Search');
    url.searchParams.set('q', query.normalize('NFC').trim());
    if (source === 'google') {
        url.searchParams.set('hl', ['ko', 'en', 'ja'].includes(language) ? language : 'ko');
        if (kind === 'photo') url.searchParams.set('udm', '2');
    } else url.searchParams.set('target', 'title');
    return url.href;
}

export function allowedAuthorWebNavigation(value, source, { isMainFrame = true } = {}) {
    try {
        const url = parseCoverImageUrl(value);
        if (source === 'google' && !isMainFrame && url.origin === 'https://www.recaptcha.net' && url.pathname.startsWith('/recaptcha/')) return true;
        return url.protocol === 'https:' && (source === 'namuwiki' ? url.hostname === 'namu.wiki'
            : source === 'google' && /(^|\.)google\.(?:com|co\.kr)$/.test(url.hostname));
    } catch { return false; }
}

export function requiresGoogleConfirmation(value) {
    if (!allowedAuthorWebNavigation(value, 'google')) return false;
    const url = new URL(value);
    return url.pathname === '/sorry' || url.pathname.startsWith('/sorry/') || url.hostname.startsWith('consent.google.');
}

// This function runs in the isolated web page and returns bounded data, never executable markup.
export function readGoogleAuthorResults(kind, selectedUrl = '') {
    const short = value => String(value || '').trim().slice(0, 1000);
    const imageUrl = image => [image?.currentSrc, image?.getAttribute('data-src'), image?.src]
        .find(value => /^https:\/\/encrypted-tbn\d+\.gstatic\.com\/images\?/.test(value || '')) || '';
    const entries = [];
    if (kind === 'photo') {
        for (const image of document.querySelectorAll('img')) {
            const thumbnail = imageUrl(image);
            if (!thumbnail || !image.alt || entries.some(entry => entry.image === thumbnail)) continue;
            entries.push({ title: short(image.alt), image: thumbnail,
                url: 'https://www.google.com/imgres?' + new URLSearchParams({ imgurl: thumbnail }) });
            if (entries.length === 8) break;
        }
    } else {
        for (const heading of document.querySelectorAll('h3')) {
            const anchor = heading.closest('a');
            if (!anchor?.href || !/^https?:/.test(anchor.href)) continue;
            if (selectedUrl && anchor.href !== selectedUrl) continue;
            let block = anchor;
            for (let level = 0; level < 5; level += 1) {
                const parent = block.parentElement;
                if (!parent || parent === document.body || parent.querySelectorAll('h3').length > 1) break;
                block = parent;
            }
            let url = anchor.href;
            const target = new URL(url);
            if (target.origin === location.origin && target.pathname === '/url') url = target.searchParams.get('q') || target.searchParams.get('url') || url;
            entries.push({ title: short(heading.innerText || heading.textContent), url, linkUrl: anchor.href,
                description: short(block.innerText || block.textContent), image: imageUrl(block.querySelector('img')) });
            if (entries.length === 8) break;
        }
    }
    return { entries, url: location.href, title: document.title,
        empty: /did not match any documents|검색결과가 없습니다|일치하는 검색결과가 없습니다|一致する情報は見つかりませんでした/.test(document.body.innerText) };
}

const LABELS = {
    ko: { profile: '검색 결과 링크를 오른쪽 클릭해 프로필 가져오기 · 나무위키는 인물 문서에서 오른쪽 클릭', photo: '원하는 사진을 오른쪽 클릭해 가져오기',
        confirmation: 'Google 확인을 완료하면 검색을 계속합니다. 취소하려면 이 창을 닫으세요.',
        selectProfile: '이 프로필 가져오기', selectPhoto: '이 사진 가져오기', failed: '가져오지 못했습니다. 다른 결과를 선택해 주세요.' },
    en: { profile: 'Right-click a result link to import a profile · On Namuwiki, open a person’s article first', photo: 'Right-click a photo to import it',
        confirmation: 'Complete the Google check to continue searching. Close this window to cancel.',
        selectProfile: 'Import this profile', selectPhoto: 'Import this photo', failed: 'Could not import this result. Choose another result.' },
    ja: { profile: '検索結果のリンクを右クリックして取り込み · ナムウィキでは人物の記事を開いてください', photo: '写真を右クリックして取り込み',
        confirmation: 'Googleの確認を完了すると検索を続けます。キャンセルするにはこのウィンドウを閉じてください。',
        selectProfile: 'このプロフィールを取り込む', selectPhoto: 'この写真を取り込む', failed: '取り込めませんでした。別の結果を選択してください。' },
};

export async function openAuthorWebSearch(options = {}) {
    const { source, query, kind = 'profile', manual = false, signal } = options;
    const searchUrl = authorWebSearchUrl(options);
    const electronModule = options.electron || await import('electron');
    const { BrowserWindow, Menu, dialog } = electronModule.default || electronModule;
    const labels = LABELS[options.language] || LABELS.ko;
    const window = new BrowserWindow({
        parent: options.parentWindow, modal: Boolean(manual && options.parentWindow), show: manual,
        width: 1120, height: 800, minWidth: 720, minHeight: 520, title: labels[kind], autoHideMenuBar: true,
        webPreferences: { partition: source === 'google' ? 'persist:cover-image-search' : 'persist:author-web-search', nodeIntegration: false, contextIsolation: true,
            sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, spellcheck: false, backgroundThrottling: false },
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
    for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) contents.on(name, (event, url, _inPlace, mainFrame) => {
        if (!allowedAuthorWebNavigation(event.url || url, source, { isMainFrame: event.isMainFrame ?? mainFrame ?? true })) event.preventDefault();
    });
    window.on('page-title-updated', event => event.preventDefault());
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let finished = false;
        let selecting = false;
        let polling = false;
        let waitingForConfirmation = false;
        let pollTimer;
        let timeout;
        const armTimeout = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => finish(null, authorWebError('AUTHOR_PROFILE_TIMEOUT')), options.timeoutMs || (manual ? 30000 : 15000));
        };
        const finish = (result, error) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            clearTimeout(pollTimer);
            controller.abort();
            signal?.removeEventListener('abort', cancel);
            options.parentWindow?.removeListener('closed', cancel);
            session.removeListener('will-download', preventDownload);
            if (!window.isDestroyed()) window.destroy();
            if (error) reject(error);
            else resolve(result);
        };
        const cancel = () => finish(manual ? { cancelled: true } : null, manual ? null : authorWebError('AUTHOR_PROFILE_CANCELLED'));
        signal?.addEventListener('abort', cancel, { once: true });
        options.parentWindow?.once('closed', cancel);
        window.once('closed', cancel);
        if (signal?.aborted) { cancel(); return; }
        const pauseForConfirmation = url => {
            if (finished || source !== 'google' || !requiresGoogleConfirmation(url)) return false;
            if (!manual && !options.parentWindow) {
                finish(null, authorWebError('AUTHOR_PROFILE_ACCESS_BLOCKED'));
                return true;
            }
            clearTimeout(timeout);
            clearTimeout(pollTimer);
            if (!waitingForConfirmation) {
                waitingForConfirmation = true;
                window.setTitle(labels.confirmation);
                window.show();
                window.focus();
            }
            return true;
        };
        const resumeAfterConfirmation = () => {
            if (!waitingForConfirmation) return;
            waitingForConfirmation = false;
            window.setTitle(labels[kind]);
            armTimeout();
        };
        const snapshot = (selectedUrl = '') => contents.executeJavaScript(`(${readGoogleAuthorResults.toString()})(${JSON.stringify(kind)}, ${JSON.stringify(selectedUrl)})`);
        const poll = async () => {
            if (finished || polling || waitingForConfirmation) return;
            polling = true;
            try {
                const value = await snapshot();
                if (finished || waitingForConfirmation) return;
                if (pauseForConfirmation(value.url)) return;
                const profiles = value.entries.map(entry => googleAuthorProfile(entry, kind === 'photo' ? entry.title : query)).filter(Boolean);
                if (profiles.length || value.empty) { finish(profiles); return; }
            } catch (error) {
                if (error?.code === 'AUTHOR_PROFILE_ACCESS_BLOCKED') { finish(null, error); return; }
            } finally { polling = false; }
            if (!finished && !waitingForConfirmation) pollTimer = setTimeout(poll, 400);
        };
        contents.on('did-start-navigation', (event, url, _inPlace, mainFrame) => {
            if (finished || !(event.isMainFrame ?? mainFrame)) return;
            if (!pauseForConfirmation(event.url || url)) resumeAfterConfirmation();
        });
        contents.on('did-finish-load', () => {
            if (finished) return;
            if (pauseForConfirmation(contents.getURL())) return;
            resumeAfterConfirmation();
            if (manual) clearTimeout(timeout);
            else void poll();
        });
        contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
            if (mainFrame && code !== -3) finish(null, authorWebError('AUTHOR_PROFILE_REQUEST_FAILED'));
        });
        contents.once('render-process-gone', () => finish(null, authorWebError('AUTHOR_PROFILE_REQUEST_FAILED')));
        if (manual) contents.on('context-menu', async (_event, params) => {
            if (finished || selecting || waitingForConfirmation) return;
            const pageUrl = contents.getURL();
            let profile;
            let imageUrl;
            try {
                if (kind === 'photo' && params.mediaType === 'image') imageUrl = parseCoverImageUrl(params.srcURL).href;
                if (kind === 'profile' && source === 'namuwiki' && new URL(pageUrl).pathname.startsWith('/w/')) {
                    const html = await contents.executeJavaScript('document.documentElement.outerHTML.slice(0, 3145728)');
                    profile = parseNamuProfile(html, decodeURIComponent(new URL(pageUrl).pathname.slice(3)));
                } else if (kind === 'profile' && source === 'google' && params.linkURL) {
                    const value = await snapshot(params.linkURL);
                    const entry = value.entries.find(item => item.url === params.linkURL || item.linkUrl === params.linkURL);
                    profile = googleAuthorProfile(entry, query);
                }
            } catch { /* Keep unavailable choices disabled. */ }
            if (finished || contents.getURL() !== pageUrl) return;
            const enabled = Boolean(kind === 'photo' ? imageUrl : profile);
            Menu.buildFromTemplate([{ label: enabled ? kind === 'photo' ? labels.selectPhoto : labels.selectProfile : labels[kind], enabled,
                click: async () => {
                    if (finished || selecting || contents.getURL() !== pageUrl) return;
                    selecting = true;
                    let downloaded;
                    try {
                        if (profile) { finish({ profile }); return; }
                        downloaded = await (options.downloadImage || downloadCoverImage)(imageUrl, {
                            signal: controller.signal, maxBytes: 8 * 1024 * 1024, userAgent: contents.getUserAgent(),
                        });
                        if (finished) return;
                        if (!downloaded?.dataUrl || !Buffer.isBuffer(downloaded.buffer)) throw authorWebError('AUTHOR_PHOTO_IMAGE_FAILED');
                        finish({ dataUrl: downloaded.dataUrl, photo: {
                            id: createHash('sha256').update(downloaded.buffer).digest('hex'), source, query,
                            sourceUrl: downloaded.sourceUrl || imageUrl, imageSourceUrl: pageUrl,
                        } });
                    } catch {
                        if (!finished) await dialog.showMessageBox(window, { type: 'error', message: labels.failed });
                    } finally {
                        selecting = false;
                        if (downloaded?.cleanupDirectory) await fs.rm(downloaded.cleanupDirectory, { recursive: true, force: true }).catch(() => {});
                    }
                },
            }]).popup({ window });
        });
        armTimeout();
        window.loadURL(searchUrl).catch(error => {
            if (error?.code !== 'ERR_ABORTED' && error?.errno !== -3) finish(null, authorWebError('AUTHOR_PROFILE_REQUEST_FAILED'));
        });
    });
}

export function registerAuthorWebSearchIpc({ ipcMain, getMainWindow, getLanguage, openSearch = openAuthorWebSearch }) {
    const requests = new Map();
    const ownerWindow = event => {
        const window = getMainWindow?.();
        if (!window || window.isDestroyed() || window.webContents !== event.sender || event.sender.isDestroyed()
            || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw authorWebError('AUTHOR_PROFILE_UNTRUSTED_SENDER');
        return window;
    };
    ipcMain.handle('authors:openWebSearch', async (event, request = {}) => {
        let controller;
        let cancel;
        let navigate;
        try {
            const parentWindow = ownerWindow(event);
            authorWebSearchUrl(request);
            if (requests.has(event.sender)) throw authorWebError('AUTHOR_PROFILE_REQUEST_FAILED');
            controller = new AbortController();
            requests.set(event.sender, controller);
            cancel = () => controller.abort();
            navigate = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) cancel(); };
            event.sender.once('destroyed', cancel);
            event.sender.on('did-start-navigation', navigate);
            return await openSearch({ source: request.source, query: request.query, kind: request.kind,
                manual: true, parentWindow, language: getLanguage?.() || 'ko', signal: controller.signal });
        } catch (error) {
            return { success: false, code: ['AUTHOR_PROFILE_UNTRUSTED_SENDER', 'AUTHOR_PROFILE_INVALID_QUERY', 'AUTHOR_PROFILE_TIMEOUT', 'AUTHOR_PROFILE_ACCESS_BLOCKED'].includes(error?.code)
                ? error.code : 'AUTHOR_PROFILE_REQUEST_FAILED' };
        } finally {
            if (controller) {
                if (requests.get(event.sender) === controller) requests.delete(event.sender);
                event.sender.removeListener('destroyed', cancel);
                event.sender.removeListener('did-start-navigation', navigate);
            }
        }
    });
    ipcMain.handle('authors:cancelWebSearch', event => {
        const window = ownerWindow(event);
        requests.get(event.sender)?.abort();
        cancelGoogleAuthorSearches(window);
        return { success: true };
    });
}
