import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron';
import { ViewerSessionManager } from './viewerSessions.js';
import { normalizeExternalUrl } from './externalUrlPolicy.js';

let documentProtocolRegistered = false;
let comicProtocolRegistered = false;
const VIEWER_DEFAULT_WIDTH = 1280;
const VIEWER_DEFAULT_HEIGHT = 860;
const VIEWER_MIN_WIDTH = 820;
const VIEWER_MIN_HEIGHT = 560;

function isDevToolsShortcut(input = {}) {
    const key = String(input.key || '').toLowerCase();
    const primaryModifier = process.platform === 'darwin' ? input.meta : input.control;
    return key === 'f12' || (primaryModifier && input.shift && key === 'i');
}

function toggleDevTools(webContents) {
    if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
        return;
    }
    webContents.openDevTools({ mode: 'detach' });
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clampViewerSize(value, minimum, fallback, maximum) {
    const number = toFiniteNumber(value) ?? fallback;
    return Math.min(Math.max(Math.round(number), minimum), Math.max(minimum, maximum));
}

function viewerBoundsIntersectWorkArea(bounds, workArea) {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const workRight = workArea.x + workArea.width;
    const workBottom = workArea.y + workArea.height;

    return right > workArea.x
        && bounds.x < workRight
        && bottom > workArea.y
        && bounds.y < workBottom;
}

function resolveViewerWindowState(config = {}, displays = [], primaryWorkArea = {}) {
    const workArea = {
        x: toFiniteNumber(primaryWorkArea.x) ?? 0,
        y: toFiniteNumber(primaryWorkArea.y) ?? 0,
        width: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.width) ?? VIEWER_DEFAULT_WIDTH)),
        height: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.height) ?? VIEWER_DEFAULT_HEIGHT)),
    };
    const maxWidth = Math.max(VIEWER_MIN_WIDTH, workArea.width);
    const maxHeight = Math.max(VIEWER_MIN_HEIGHT, workArea.height);
    const width = clampViewerSize(config.viewer_width, VIEWER_MIN_WIDTH, VIEWER_DEFAULT_WIDTH, maxWidth);
    const height = clampViewerSize(config.viewer_height, VIEWER_MIN_HEIGHT, VIEWER_DEFAULT_HEIGHT, maxHeight);
    const savedX = toFiniteNumber(config.viewer_x);
    const savedY = toFiniteNumber(config.viewer_y);
    const savedBounds = savedX === null || savedY === null
        ? null
        : { x: Math.round(savedX), y: Math.round(savedY), width, height };
    const availableWorkAreas = displays
        .map(display => display?.workArea)
        .filter(Boolean);
    const isVisible = savedBounds
        && availableWorkAreas.some(displayWorkArea => viewerBoundsIntersectWorkArea(savedBounds, displayWorkArea));

    return {
        bounds: isVisible ? savedBounds : {
            x: Math.round(workArea.x + Math.max(0, (workArea.width - width) / 2)),
            y: Math.round(workArea.y + Math.max(0, (workArea.height - height) / 2)),
            width,
            height,
        },
        minWidth: VIEWER_MIN_WIDTH,
        minHeight: VIEWER_MIN_HEIGHT,
        isMaximized: Boolean(config.viewer_is_maximized),
    };
}

function serializeViewerWindowState(window) {
    const bounds = window.getNormalBounds();
    return {
        viewer_x: bounds.x,
        viewer_y: bounds.y,
        viewer_width: bounds.width,
        viewer_height: bounds.height,
        viewer_is_maximized: window.isMaximized(),
    };
}

function parseByteRange(rangeHeader = '', size = 0) {
    const match = String(rangeHeader || '').match(/^bytes=(\d*)-(\d*)$/);
    if (!match || size <= 0) return null;
    const [, startText, endText] = match;
    if (!startText && !endText) return null;

    if (!startText) {
        const suffixLength = Number(endText);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
        const start = Math.max(0, size - suffixLength);
        return { start, end: size - 1 };
    }

    const start = Number(startText);
    const requestedEnd = endText ? Number(endText) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start < 0 || requestedEnd < start || start >= size) {
        return null;
    }
    return {
        start,
        end: Math.min(requestedEnd, size - 1),
    };
}

async function createDocumentResponse(request, document) {
    const stat = await fs.promises.stat(document.filePath);
    const size = stat.size;
    const rangeHeader = request.headers.get('range') || '';
    const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=0',
        'Content-Type': document.mime,
    });

    if (size <= 0) {
        headers.set('Content-Length', '0');
        return new Response(null, { status: 200, headers });
    }

    const range = rangeHeader ? parseByteRange(rangeHeader, size) : null;
    if (rangeHeader && !range) {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const contentLength = end - start + 1;
    headers.set('Content-Length', String(contentLength));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);

    const body = request.method === 'HEAD'
        ? null
        : Readable.toWeb(fs.createReadStream(document.filePath, { start, end }));
    return new Response(body, {
        status: range ? 206 : 200,
        headers,
    });
}

function registerDocumentProtocol(sessions) {
    if (documentProtocolRegistered) return;
    documentProtocolRegistered = true;
    protocol.handle('bookmanager-document', async request => {
        try {
            const asset = await sessions.getDocumentAssetFromRequest(request.url);
            if (asset) {
                return new Response(new Uint8Array(asset.buffer), {
                    headers: {
                        'Content-Type': asset.mime,
                        'Cache-Control': 'private, max-age=3600',
                    },
                });
            }
            const document = sessions.resolveDocumentRequest(request.url);
            if (!document) return new Response('Not found', { status: 404 });
            return await createDocumentResponse(request, document);
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

function registerComicProtocol(sessions) {
    if (comicProtocolRegistered) return;
    comicProtocolRegistered = true;
    protocol.handle('bookmanager-comic', async request => {
        try {
            const page = await sessions.getComicPageDataFromRequest(request.url);
            if (!page) return new Response('Not found', { status: 404 });
            return new Response(new Uint8Array(page.buffer), {
                headers: {
                    'Content-Type': page.mime,
                    'Cache-Control': 'private, max-age=3600',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

export function setupViewerWindowManager(options = {}) {
    const {
        isDev = false,
        devServerUrl = 'http://127.0.0.1:5173',
        distIndexPath = '',
        preloadPath = '',
        getIconPath = () => undefined,
        getSevenZPath = async () => '',
        getAudioLibraryRecord = async () => null,
        configManager = null,
    } = options;

    const sessions = new ViewerSessionManager({ getSevenZPath, getAudioLibraryRecord });
    registerDocumentProtocol(sessions);
    registerComicProtocol(sessions);
    let viewerWindow = null;
    let pendingSession = null;
    let viewerWindowStateSaveTimer = null;

    const viewerUrl = () => `${devServerUrl}?viewer=1`;

    const sendSession = session => {
        if (!viewerWindow || viewerWindow.isDestroyed() || !session) return;
        const isMainFrameLoading = typeof viewerWindow.webContents.isLoadingMainFrame === 'function'
            ? viewerWindow.webContents.isLoadingMainFrame()
            : viewerWindow.webContents.isLoading();
        if (isMainFrameLoading) {
            pendingSession = session;
            return;
        }
        viewerWindow.webContents.send('viewer:load-session', session);
    };

    const ensureViewerWindow = () => {
        if (viewerWindow && !viewerWindow.isDestroyed()) return viewerWindow;
        const primaryDisplay = screen.getPrimaryDisplay();
        const windowState = resolveViewerWindowState(
            configManager?.getConfig?.() || {},
            screen.getAllDisplays(),
            primaryDisplay.workArea,
        );

        viewerWindow = new BrowserWindow({
            ...windowState.bounds,
            minWidth: windowState.minWidth,
            minHeight: windowState.minHeight,
            title: 'BookManagerViewer',
            icon: getIconPath(),
            autoHideMenuBar: true,
            backgroundColor: '#111111',
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                plugins: true,
                webviewTag: true,
            },
            show: false,
        });

        const sendFullscreenState = () => {
            if (!viewerWindow || viewerWindow.isDestroyed()) return;
            viewerWindow.webContents.send('viewer:fullscreen-change', {
                fullscreen: viewerWindow.isFullScreen(),
            });
        };
        const saveViewerWindowState = () => {
            if (!viewerWindow || viewerWindow.isDestroyed() || !configManager) return;
            configManager.updateConfig(serializeViewerWindowState(viewerWindow));
        };
        const scheduleViewerWindowStateSave = () => {
            if (!configManager) return;
            if (viewerWindowStateSaveTimer) clearTimeout(viewerWindowStateSaveTimer);
            viewerWindowStateSaveTimer = setTimeout(() => {
                viewerWindowStateSaveTimer = null;
                saveViewerWindowState();
            }, 400);
        };

        if (process.platform !== 'darwin') {
            viewerWindow.setMenu(null);
        }

        viewerWindow.webContents.on('before-input-event', (event, input) => {
            if (!isDevToolsShortcut(input)) return;
            event.preventDefault();
            toggleDevTools(viewerWindow.webContents);
        });
        viewerWindow.once('ready-to-show', () => {
            if (windowState.isMaximized) {
                viewerWindow?.maximize();
            }
            viewerWindow?.show();
        });
        viewerWindow.webContents.on('did-finish-load', () => {
            sendSession(pendingSession || sessions.current());
            sendFullscreenState();
            pendingSession = null;
        });
        viewerWindow.on('enter-full-screen', sendFullscreenState);
        viewerWindow.on('leave-full-screen', sendFullscreenState);
        viewerWindow.on('resize', scheduleViewerWindowStateSave);
        viewerWindow.on('move', scheduleViewerWindowStateSave);
        viewerWindow.on('maximize', scheduleViewerWindowStateSave);
        viewerWindow.on('unmaximize', scheduleViewerWindowStateSave);
        viewerWindow.on('close', saveViewerWindowState);
        viewerWindow.on('closed', () => {
            if (viewerWindowStateSaveTimer) {
                clearTimeout(viewerWindowStateSaveTimer);
                viewerWindowStateSaveTimer = null;
            }
            viewerWindow = null;
            pendingSession = null;
        });

        if (isDev) {
            viewerWindow.loadURL(viewerUrl());
        } else {
            viewerWindow.loadFile(distIndexPath, { query: { viewer: '1' } });
        }

        return viewerWindow;
    };

    const openViewer = async filePath => {
        const session = sessions.create(filePath);
        const window = ensureViewerWindow();
        window.setTitle(`BookManagerViewer - ${path.basename(session.filePath)}`);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        sendSession(session);
        return { success: true, session };
    };

    const openAdjacentViewer = async (sessionId, direction) => {
        const session = sessions.createAdjacent(sessionId, direction);
        const window = ensureViewerWindow();
        window.setTitle(`BookManagerViewer - ${path.basename(session.filePath)}`);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return { success: true, session };
    };

    const openAudioQueueItem = async (sessionId, fileName) => {
        const session = sessions.createAudioQueueItem(sessionId, fileName);
        const window = ensureViewerWindow();
        window.setTitle(`BookManagerViewer - ${path.basename(session.filePath)}`);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return { success: true, session };
    };

    ipcMain.handle('viewer:open', async (_event, filePath) => openViewer(filePath));
    ipcMain.handle('viewer:openAdjacent', async (_event, sessionId, direction) => openAdjacentViewer(sessionId, direction));
    ipcMain.handle('viewer:openAudioQueueItem', async (_event, sessionId, fileName) => openAudioQueueItem(sessionId, fileName));
    ipcMain.handle('viewer:getCurrentSession', async () => sessions.current());
    ipcMain.handle('viewer:listComicPages', async (_event, sessionId) => (
        sessions.listComicPages(sessionId)
    ));
    ipcMain.handle('viewer:getComicPage', async (_event, sessionId, entryName) => (
        sessions.getComicPage(sessionId, entryName)
    ));
    ipcMain.handle('viewer:getDocumentData', async (_event, sessionId) => (
        sessions.getDocumentData(sessionId)
    ));
    ipcMain.handle('viewer:getAudioData', async (_event, sessionId) => (
        sessions.getAudioData(sessionId)
    ));
    ipcMain.handle('viewer:listAudioQueue', async (_event, sessionId) => (
        sessions.listAudioQueue(sessionId)
    ));
    ipcMain.handle('viewer:getText', async (_event, sessionId, options = {}) => (
        sessions.getText(sessionId, options)
    ));
    ipcMain.handle('viewer:getEpubText', async (_event, sessionId) => (
        sessions.getEpubText(sessionId)
    ));
    ipcMain.handle('viewer:getConfig', async () => {
        const config = configManager?.getConfig?.() || {};
        const language = config.language || config.lang || 'ko';
        const apiKeys = config.api_keys || {};
        return {
            lang: language,
            language,
            hasTtsOpenAiKey: Boolean(String(apiKeys.tts_openai_key || '').trim()),
            hasTtsGoogleKey: Boolean(String(apiKeys.tts_google_key || '').trim()),
        };
    });
    ipcMain.handle('viewer:openExternal', async (event, url) => {
        const safeUrl = normalizeExternalUrl(url);
        if (!safeUrl) throw new Error('External URL was blocked.');
        const targetWindow = BrowserWindow.fromWebContents(event.sender) || viewerWindow;
        const result = await dialog.showMessageBox(targetWindow, {
            type: 'question',
            buttons: ['열기', '취소'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
            title: '외부 링크 열기',
            message: '브라우저에서 외부 링크를 열까요?',
            detail: safeUrl,
        });
        if (result.response !== 0) return { success: false, canceled: true };
        await shell.openExternal(safeUrl);
        return { success: true };
    });
    ipcMain.handle('viewer:toggleFullscreen', async event => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        if (!targetWindow || targetWindow.isDestroyed()) return { success: false };
        const nextFullscreen = !targetWindow.isFullScreen();
        targetWindow.setFullScreen(nextFullscreen);
        return { success: true, fullscreen: nextFullscreen };
    });
    ipcMain.handle('viewer:getFullscreenState', async event => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender);
        if (!targetWindow || targetWindow.isDestroyed()) return { success: false, fullscreen: false };
        return { success: true, fullscreen: targetWindow.isFullScreen() };
    });

    return {
        openViewer,
        getWindow: () => viewerWindow,
    };
}
