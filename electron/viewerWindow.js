import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron';
import {
    AUDIOBOOK_CLOSE_ACTION,
    createAudiobookCloseDialogOptions,
    resolveAudiobookCloseAction,
} from './audiobookClosePolicy.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { normalizeExternalUrl } from './externalUrlPolicy.js';
import { audioSessionMatchesSuccessfulPath } from './audioViewerMetadataRefresh.js';
import { LibraryDB } from './database/library_db.js';

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

function viewerWindowStateKey(kind = 'reader', field = '') {
    const prefix = kind === 'audio' ? 'audio_viewer' : 'viewer';
    return `${prefix}_${field}`;
}

function resolveViewerWindowState(config = {}, displays = [], primaryWorkArea = {}, kind = 'reader') {
    const workArea = {
        x: toFiniteNumber(primaryWorkArea.x) ?? 0,
        y: toFiniteNumber(primaryWorkArea.y) ?? 0,
        width: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.width) ?? VIEWER_DEFAULT_WIDTH)),
        height: Math.max(1, Math.round(toFiniteNumber(primaryWorkArea.height) ?? VIEWER_DEFAULT_HEIGHT)),
    };
    const maxWidth = Math.max(VIEWER_MIN_WIDTH, workArea.width);
    const maxHeight = Math.max(VIEWER_MIN_HEIGHT, workArea.height);
    const width = clampViewerSize(
        config[viewerWindowStateKey(kind, 'width')],
        VIEWER_MIN_WIDTH,
        VIEWER_DEFAULT_WIDTH,
        maxWidth,
    );
    const height = clampViewerSize(
        config[viewerWindowStateKey(kind, 'height')],
        VIEWER_MIN_HEIGHT,
        VIEWER_DEFAULT_HEIGHT,
        maxHeight,
    );
    const savedX = toFiniteNumber(config[viewerWindowStateKey(kind, 'x')]);
    const savedY = toFiniteNumber(config[viewerWindowStateKey(kind, 'y')]);
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
        isMaximized: Boolean(config[viewerWindowStateKey(kind, 'is_maximized')]),
    };
}

function serializeViewerWindowState(window, kind = 'reader') {
    const bounds = window.getNormalBounds();
    return {
        [viewerWindowStateKey(kind, 'x')]: bounds.x,
        [viewerWindowStateKey(kind, 'y')]: bounds.y,
        [viewerWindowStateKey(kind, 'width')]: bounds.width,
        [viewerWindowStateKey(kind, 'height')]: bounds.height,
        [viewerWindowStateKey(kind, 'is_maximized')]: window.isMaximized(),
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
        getLibraryDbPath = () => '',
        getMainWindow = () => null,
        configManager = null,
    } = options;

    const sessions = new ViewerSessionManager({ getSevenZPath, getAudioLibraryRecord });
    let readingStateDb = null;
    registerDocumentProtocol(sessions);
    registerComicProtocol(sessions);
    const viewerContexts = {
        reader: {
            kind: 'reader',
            window: null,
            closingWindows: new Set(),
            pendingSession: null,
            currentSession: null,
            stateSaveTimer: null,
        },
        audio: {
            kind: 'audio',
            window: null,
            closingWindows: new Set(),
            pendingSession: null,
            currentSession: null,
            stateSaveTimer: null,
            miniPlayerActive: false,
            audioTrackState: null,
            audioPlaybackState: null,
            allowClose: false,
            closeDialogPromise: null,
            closeRequestVersion: 0,
        },
    };

    const viewerUrl = () => `${devServerUrl}?viewer=1`;
    const contextForSession = session => (
        session?.type === 'audio' ? viewerContexts.audio : viewerContexts.reader
    );
    const activeViewerWindow = context => (
        context?.window
        && !context.window.isDestroyed()
        && !context.closingWindows.has(context.window)
            ? context.window
            : null
    );
    const viewerContextForSender = sender => {
        const senderWindow = BrowserWindow.fromWebContents(sender);
        if (!senderWindow || senderWindow.isDestroyed()) return null;
        return Object.values(viewerContexts).find(context => activeViewerWindow(context) === senderWindow) || null;
    };
    const setContextSession = (context, session, options = {}) => {
        if (!context || !session) return;
        if (context.kind === 'audio' && context.currentSession?.id !== session.id) {
            if (options.preserveCloseRequest !== true) {
                context.closeRequestVersion += 1;
            }
            context.audioTrackState = {
                sessionId: session.id,
                fileName: session.fileName,
            };
            context.audioPlaybackState = { sessionId: session.id };
        }
        context.currentSession = session;
    };

    const mainAppWindow = () => {
        const window = getMainWindow?.();
        return window
            && !window.isDestroyed()
            && !window.webContents.isDestroyed()
            ? window
            : null;
    };

    const recordReadingState = async (session, state = {}) => {
        const dbPath = getLibraryDbPath?.();
        if (!session?.filePath || !dbPath) return null;
        try {
            if (!readingStateDb) readingStateDb = new LibraryDB({ dbPath });
            const saved = await readingStateDb.upsertReadingState(session.filePath, {
                ...state,
                format: session.type || state.format || '',
            });
            const mainWindow = mainAppWindow();
            if (saved && mainWindow) {
                mainWindow.webContents.send('reading:changed', {
                    filePath: saved.filePath,
                    itemId: saved.itemId,
                    lastReadAt: saved.lastReadAt,
                });
            }
            return saved;
        } catch (error) {
            console.warn(`[ReadingState] Failed to save ${session.filePath}: ${error.message}`);
            return null;
        }
    };

    const mainWindowForSender = sender => {
        const window = mainAppWindow();
        return window?.webContents === sender ? window : null;
    };

    const nonNegativeNumber = (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, number) : fallback;
    };

    const sanitizeAudioTrackState = (state = {}, session) => ({
        sessionId: session.id,
        title: String(state.title || ''),
        artist: String(state.artist || ''),
        artwork: String(state.artwork || state.artworkDataUrl || ''),
        fileName: String(state.fileName || session.fileName || ''),
    });

    const sanitizeAudioPlaybackState = (state = {}, session) => {
        const volume = Number(state.volume);
        const duration = nonNegativeNumber(state.duration ?? state.durationSeconds);
        const currentTime = nonNegativeNumber(state.currentTime ?? state.positionSeconds);
        return {
            sessionId: session.id,
            currentTime: duration > 0 ? Math.min(currentTime, duration) : currentTime,
            duration,
            playing: Boolean(state.playing),
            playbackRate: Math.min(4, Math.max(0.25, Number(state.playbackRate) || 1)),
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
            muted: Boolean(state.muted),
        };
    };

    const audioMiniPlayerSnapshot = (context, type = 'show') => ({
        type,
        visible: Boolean(context?.miniPlayerActive),
        sessionId: context?.currentSession?.id || '',
        title: context?.audioTrackState?.title || '',
        artist: context?.audioTrackState?.artist || '',
        artwork: context?.audioTrackState?.artwork || '',
        fileName: context?.audioTrackState?.fileName || context?.currentSession?.fileName || '',
        currentTime: nonNegativeNumber(context?.audioPlaybackState?.currentTime),
        duration: nonNegativeNumber(context?.audioPlaybackState?.duration),
        playing: Boolean(context?.audioPlaybackState?.playing),
        playbackRate: Number(context?.audioPlaybackState?.playbackRate) || 1,
        volume: Number.isFinite(Number(context?.audioPlaybackState?.volume))
            ? Number(context.audioPlaybackState.volume)
            : 1,
        muted: Boolean(context?.audioPlaybackState?.muted),
    });

    const sendAudioMiniPlayerState = (context, type = 'show') => {
        const window = mainAppWindow();
        if (!window || !context?.miniPlayerActive) return;
        let payload = audioMiniPlayerSnapshot(context, type);
        if (type === 'track') {
            payload = {
                type,
                visible: true,
                ...(context.audioTrackState || {}),
            };
        } else if (type === 'playback') {
            payload = {
                type,
                visible: true,
                ...(context.audioPlaybackState || {}),
            };
        }
        window.webContents.send('viewer:audio-mini-state', payload);
    };

    const clearAudioMiniPlayer = context => {
        if (!context || context.kind !== 'audio') return;
        const wasActive = context.miniPlayerActive;
        context.miniPlayerActive = false;
        if (!wasActive) return;
        const window = mainAppWindow();
        if (!window) return;
        window.webContents.send('viewer:audio-mini-state', {
            type: 'clear',
            visible: false,
        });
    };

    const focusMainAppWindow = () => {
        const window = mainAppWindow();
        if (!window) return null;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return window;
    };

    const forceCloseViewerContext = context => {
        const window = activeViewerWindow(context);
        if (!window) {
            clearAudioMiniPlayer(context);
            return false;
        }
        if (context.kind === 'audio') {
            clearAudioMiniPlayer(context);
            context.allowClose = true;
            context.closeRequestVersion += 1;
        }
        window.close();
        return true;
    };

    const transferAudioContextToMiniPlayer = (context, window) => {
        if (!mainAppWindow() || activeViewerWindow(context) !== window) return false;
        context.miniPlayerActive = true;
        window.hide();
        sendAudioMiniPlayerState(context, 'show');
        focusMainAppWindow();
        return true;
    };

    const requestViewerClose = (context, window) => {
        if (!context || !window || window.isDestroyed()) {
            return Promise.resolve({ success: false });
        }
        if (context.kind !== 'audio') {
            window.close();
            return Promise.resolve({ success: true, action: AUDIOBOOK_CLOSE_ACTION.CLOSE });
        }
        if (context.closeDialogPromise) return context.closeDialogPromise;

        const requestedVersion = context.closeRequestVersion;
        const config = configManager?.getConfig?.() || {};
        const language = config.language || config.lang || 'ko';
        const closeDialogPromise = (async () => {
            const result = await dialog.showMessageBox(
                window,
                createAudiobookCloseDialogOptions(language),
            );
            const action = resolveAudiobookCloseAction(result.response);
            const requestIsCurrent = activeViewerWindow(context) === window
                && context.closeRequestVersion === requestedVersion;
            if (!requestIsCurrent) {
                return { success: false, stale: true, action: AUDIOBOOK_CLOSE_ACTION.CANCEL };
            }
            if (action === AUDIOBOOK_CLOSE_ACTION.TRANSFER) {
                const transferred = transferAudioContextToMiniPlayer(context, window);
                return {
                    success: transferred,
                    action: transferred ? action : AUDIOBOOK_CLOSE_ACTION.CANCEL,
                };
            }
            if (action === AUDIOBOOK_CLOSE_ACTION.CLOSE) {
                forceCloseViewerContext(context);
                return { success: true, action };
            }
            return { success: true, canceled: true, action };
        })().catch(() => ({
            success: false,
            canceled: true,
            action: AUDIOBOOK_CLOSE_ACTION.CANCEL,
        })).finally(() => {
            if (context.closeDialogPromise === closeDialogPromise) {
                context.closeDialogPromise = null;
            }
        });
        context.closeDialogPromise = closeDialogPromise;
        return closeDialogPromise;
    };

    const sendSession = (context, session) => {
        const viewerWindow = activeViewerWindow(context);
        if (!viewerWindow || !session) return;
        const isMainFrameLoading = typeof viewerWindow.webContents.isLoadingMainFrame === 'function'
            ? viewerWindow.webContents.isLoadingMainFrame()
            : viewerWindow.webContents.isLoading();
        if (isMainFrameLoading) {
            context.pendingSession = session;
            return;
        }
        viewerWindow.webContents.send('viewer:load-session', session);
    };

    const ensureViewerWindow = context => {
        const existingWindow = activeViewerWindow(context);
        if (existingWindow) return existingWindow;
        const primaryDisplay = screen.getPrimaryDisplay();
        const windowState = resolveViewerWindowState(
            configManager?.getConfig?.() || {},
            screen.getAllDisplays(),
            primaryDisplay.workArea,
            context.kind,
        );

        const viewerWindow = new BrowserWindow({
            ...windowState.bounds,
            minWidth: windowState.minWidth,
            minHeight: windowState.minHeight,
            title: 'BookManagerViewer',
            icon: getIconPath(),
            autoHideMenuBar: true,
            backgroundColor: '#111111',
            transparent: false,
            opacity: 1,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                plugins: true,
                webviewTag: true,
                backgroundThrottling: context.kind !== 'audio',
            },
            show: false,
        });
        context.window = viewerWindow;

        const sendFullscreenState = () => {
            if (viewerWindow.isDestroyed() || context.window !== viewerWindow) return;
            viewerWindow.webContents.send('viewer:fullscreen-change', {
                fullscreen: viewerWindow.isFullScreen(),
            });
        };
        const saveViewerWindowState = () => {
            if (viewerWindow.isDestroyed() || context.window !== viewerWindow || !configManager) return;
            configManager.updateConfig(serializeViewerWindowState(viewerWindow, context.kind));
        };
        const scheduleViewerWindowStateSave = () => {
            if (!configManager) return;
            if (context.stateSaveTimer) clearTimeout(context.stateSaveTimer);
            const stateSaveTimer = setTimeout(() => {
                if (context.stateSaveTimer === stateSaveTimer) {
                    context.stateSaveTimer = null;
                }
                saveViewerWindowState();
            }, 400);
            context.stateSaveTimer = stateSaveTimer;
        };
        const handleViewerWindowClose = event => {
            saveViewerWindowState();
            if (context.kind === 'audio' && !context.allowClose) {
                event.preventDefault();
                void requestViewerClose(context, viewerWindow);
                return;
            }
            if (context.kind === 'audio') context.allowClose = false;
            context.closingWindows.add(viewerWindow);
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
            if (viewerWindow.isDestroyed() || context.window !== viewerWindow) return;
            if (windowState.isMaximized) {
                viewerWindow.maximize();
            }
            console.info(`[ViewerWindow] Ready to show (${context.kind}).`);
            if (!context.miniPlayerActive) viewerWindow.show();
        });
        viewerWindow.webContents.on('did-finish-load', () => {
            if (context.window !== viewerWindow) return;
            const currentSession = context.pendingSession
                || context.currentSession
                || sessions.current(context.kind);
            setContextSession(context, currentSession);
            sendSession(context, currentSession);
            sendFullscreenState();
            context.pendingSession = null;
            console.info(`[ViewerWindow] Renderer loaded (${context.kind}, session=${currentSession?.id || 'none'}).`);
        });
        viewerWindow.on('enter-full-screen', sendFullscreenState);
        viewerWindow.on('leave-full-screen', sendFullscreenState);
        viewerWindow.on('resize', scheduleViewerWindowStateSave);
        viewerWindow.on('move', scheduleViewerWindowStateSave);
        viewerWindow.on('maximize', scheduleViewerWindowStateSave);
        viewerWindow.on('unmaximize', scheduleViewerWindowStateSave);
        viewerWindow.on('close', handleViewerWindowClose);
        viewerWindow.webContents.on('render-process-gone', () => {
            if (context.window !== viewerWindow || context.kind !== 'audio') return;
            context.closeRequestVersion += 1;
            clearAudioMiniPlayer(context);
        });
        viewerWindow.on('closed', () => {
            context.closingWindows.delete(viewerWindow);
            if (context.window !== viewerWindow) return;
            if (context.stateSaveTimer) {
                clearTimeout(context.stateSaveTimer);
                context.stateSaveTimer = null;
            }
            if (context.kind === 'audio') {
                context.closeRequestVersion += 1;
                clearAudioMiniPlayer(context);
                context.audioTrackState = null;
                context.audioPlaybackState = null;
                context.allowClose = false;
                context.closeDialogPromise = null;
            }
            context.window = null;
            context.pendingSession = null;
            context.currentSession = null;
        });

        if (isDev) {
            viewerWindow.loadURL(viewerUrl());
        } else {
            viewerWindow.loadFile(distIndexPath, { query: { viewer: '1' } });
        }

        return viewerWindow;
    };

    const focusContextWindow = (context, session, options = {}) => {
        const preserveMiniPlayer = options.preserveMiniPlayer === true;
        const preserveCloseRequest = options.preserveCloseRequest === true;
        const wasMiniPlayerActive = context.kind === 'audio' && context.miniPlayerActive;
        const existingWindow = activeViewerWindow(context);
        setContextSession(context, session, { preserveCloseRequest });
        const window = ensureViewerWindow(context);
        window.setTitle(`BookManagerViewer - ${path.basename(session.filePath)}`);
        if (wasMiniPlayerActive && preserveMiniPlayer) {
            sendAudioMiniPlayerState(context, 'show');
            return window;
        }
        if (context.kind === 'audio') clearAudioMiniPlayer(context);
        if (!existingWindow) {
            window.once('ready-to-show', () => {
                if (window.isDestroyed() || context.window !== window || context.miniPlayerActive) return;
                window.focus();
            });
            return window;
        }
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return window;
    };

    const openViewer = async filePath => {
        const session = sessions.create(filePath);
        const context = contextForSession(session);
        console.info(`[ViewerWindow] Opening ${session.type} session ${session.id}: ${session.filePath}`);
        focusContextWindow(context, session);
        sendSession(context, session);
        void recordReadingState(session, { lastReadAt: Date.now() });
        return { success: true, session };
    };

    const refreshAudioMetadata = async successfulPaths => {
        const context = viewerContexts.audio;
        const session = context.currentSession;
        const viewerWindow = activeViewerWindow(context);
        if (!viewerWindow || !audioSessionMatchesSuccessfulPath(session, successfulPaths)) {
            return { success: false, refreshed: false };
        }

        const sessionId = session.id;
        const audioData = await sessions.getAudioData(sessionId);
        if (
            activeViewerWindow(context) !== viewerWindow
            || context.currentSession?.id !== sessionId
        ) {
            return { success: false, refreshed: false, stale: true };
        }

        viewerWindow.webContents.send('viewer:audio-metadata-refresh', {
            sessionId,
            audioData,
        });
        return { success: true, refreshed: true, sessionId };
    };

    const viewerContextForSessionRequest = (event, sessionId) => {
        const session = sessions.get(sessionId);
        const expectedContext = contextForSession(session);
        const senderContext = viewerContextForSender(event?.sender);
        if (!senderContext) {
            throw new Error('Viewer window was not found.');
        }
        if (senderContext !== expectedContext) {
            throw new Error('Viewer session does not belong to this window.');
        }
        return senderContext;
    };

    const viewerContextForCurrentSessionRequest = (event, sessionId) => {
        const context = viewerContextForSessionRequest(event, sessionId);
        if (context.currentSession?.id !== sessionId) {
            throw new Error('Viewer session is no longer current.');
        }
        return context;
    };

    const openAdjacentViewer = async (event, sessionId, direction) => {
        const context = viewerContextForCurrentSessionRequest(event, sessionId);
        const session = sessions.createAdjacent(sessionId, direction);
        focusContextWindow(context, session, {
            preserveMiniPlayer: true,
            preserveCloseRequest: true,
        });
        void recordReadingState(session, { lastReadAt: Date.now() });
        return { success: true, session };
    };

    const openAudioQueueItem = async (event, sessionId, fileName) => {
        const context = viewerContextForCurrentSessionRequest(event, sessionId);
        const session = sessions.createAudioQueueItem(sessionId, fileName);
        focusContextWindow(context, session, {
            preserveMiniPlayer: true,
            preserveCloseRequest: true,
        });
        void recordReadingState(session, { lastReadAt: Date.now() });
        return { success: true, session };
    };

    const audioContextForPublishedState = (event, state = {}) => {
        const context = viewerContextForSender(event?.sender);
        const session = context?.currentSession;
        if (context !== viewerContexts.audio || session?.type !== 'audio') return null;
        if (!state || String(state.sessionId || '') !== session.id) return null;
        return { context, session };
    };

    const controlAudioMiniPlayer = (event, command = {}) => {
        if (!mainWindowForSender(event?.sender)) {
            throw new Error('Audio mini player control is only available from the main window.');
        }
        const context = viewerContexts.audio;
        const window = activeViewerWindow(context);
        const sessionId = context.currentSession?.id || '';
        if (!context.miniPlayerActive || !window || !sessionId) return { success: false };
        if (String(command?.sessionId || '') !== sessionId) return { success: false };
        const type = String(command?.type || '');
        if (type === 'restore') {
            clearAudioMiniPlayer(context);
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            return { success: true, type };
        }
        if (type === 'close') {
            forceCloseViewerContext(context);
            return { success: true, type };
        }
        if (!['play', 'pause', 'seek'].includes(type)) return { success: false };
        const payload = { type, sessionId };
        if (type === 'seek') {
            const duration = nonNegativeNumber(context.audioPlaybackState?.duration);
            payload.positionSeconds = Math.min(
                nonNegativeNumber(command.positionSeconds),
                duration > 0 ? duration : Number.MAX_SAFE_INTEGER,
            );
        }
        window.webContents.send('viewer:audio-mini-command', payload);
        return { success: true, type };
    };

    ipcMain.handle('viewer:open', async (_event, filePath) => openViewer(filePath));
    ipcMain.handle('viewer:openAdjacent', async (event, sessionId, direction) => (
        openAdjacentViewer(event, sessionId, direction)
    ));
    ipcMain.handle('viewer:openAudioQueueItem', async (event, sessionId, fileName) => (
        openAudioQueueItem(event, sessionId, fileName)
    ));
    ipcMain.handle('viewer:getCurrentSession', async event => {
        const context = viewerContextForSender(event.sender);
        if (!context) return null;
        return context.currentSession || sessions.current(context.kind);
    });
    ipcMain.handle('viewer:listComicPages', async (event, sessionId) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.listComicPages(sessionId);
    });
    ipcMain.handle('viewer:getComicPage', async (event, sessionId, entryName) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.getComicPage(sessionId, entryName);
    });
    ipcMain.handle('viewer:getDocumentData', async (event, sessionId) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.getDocumentData(sessionId);
    });
    ipcMain.handle('viewer:getAudioData', async (event, sessionId) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.getAudioData(sessionId);
    });
    ipcMain.handle('viewer:listAudioQueue', async (event, sessionId) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.listAudioQueue(sessionId);
    });
    ipcMain.handle('viewer:getText', async (event, sessionId, options = {}) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.getText(sessionId, options);
    });
    ipcMain.handle('viewer:getEpubText', async (event, sessionId) => {
        viewerContextForSessionRequest(event, sessionId);
        return sessions.getEpubText(sessionId);
    });
    ipcMain.handle('viewer:saveReadingState', async (event, sessionId, state = {}) => {
        const context = viewerContextForSender(event.sender);
        if (!context) return { success: false, stale: true };
        viewerContextForCurrentSessionRequest(event, sessionId);
        return recordReadingState(sessions.get(sessionId), state);
    });
    ipcMain.on('viewer:audio-track-state', (event, state = {}) => {
        const resolved = audioContextForPublishedState(event, state);
        if (!resolved) return;
        resolved.context.audioTrackState = sanitizeAudioTrackState(state, resolved.session);
        sendAudioMiniPlayerState(resolved.context, 'track');
    });
    ipcMain.on('viewer:audio-playback-state', (event, state = {}) => {
        const resolved = audioContextForPublishedState(event, state);
        if (!resolved) return;
        resolved.context.audioPlaybackState = sanitizeAudioPlaybackState(state, resolved.session);
        sendAudioMiniPlayerState(resolved.context, 'playback');
    });
    ipcMain.handle('viewer:getAudioMiniPlayerState', async event => {
        if (!mainWindowForSender(event.sender)) {
            throw new Error('Audio mini player state is only available from the main window.');
        }
        const context = viewerContexts.audio;
        return context.miniPlayerActive
            ? audioMiniPlayerSnapshot(context, 'show')
            : { type: 'clear', visible: false };
    });
    ipcMain.handle('viewer:controlAudioMiniPlayer', async (event, command = {}) => (
        controlAudioMiniPlayer(event, command)
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
    ipcMain.handle('viewer:openTtsSettings', async event => {
        if (!viewerContextForSender(event.sender)) {
            throw new Error('TTS settings are only available from a viewer window.');
        }
        const window = focusMainAppWindow();
        if (!window) return { success: false };
        window.webContents.send('app:open-settings', { tab: 'ttsApi' });
        return { success: true };
    });
    ipcMain.handle('viewer:openExternal', async (event, url) => {
        const safeUrl = normalizeExternalUrl(url);
        if (!safeUrl) throw new Error('External URL was blocked.');
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
            || activeViewerWindow(viewerContexts.reader)
            || activeViewerWindow(viewerContexts.audio);
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
    ipcMain.handle('viewer:closeWindow', async event => {
        const context = viewerContextForSender(event.sender);
        const targetWindow = activeViewerWindow(context);
        if (!targetWindow) return { success: false };
        return requestViewerClose(context, targetWindow);
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

    const getOpenViewerWindows = () => Object.values(viewerContexts)
        .map(activeViewerWindow)
        .filter(Boolean);

    return {
        openViewer,
        refreshAudioMetadata,
        getWindow: () => (
            activeViewerWindow(viewerContexts.reader)
            || activeViewerWindow(viewerContexts.audio)
        ),
        prepareForAppQuit: () => {
            const context = viewerContexts.audio;
            context.allowClose = true;
            context.closeRequestVersion += 1;
            clearAudioMiniPlayer(context);
        },
        closeAllWindows: (options = {}) => {
            if (options.force === true) {
                for (const context of Object.values(viewerContexts)) {
                    forceCloseViewerContext(context);
                }
                return;
            }
            for (const window of getOpenViewerWindows()) {
                window.close();
            }
        },
    };
}
