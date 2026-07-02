import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { BrowserWindow, ipcMain, protocol } from 'electron';
import { ViewerSessionManager } from './viewerSessions.js';

let documentProtocolRegistered = false;
let comicProtocolRegistered = false;

function isDevToolsShortcut(input = {}) {
    const key = String(input.key || '').toLowerCase();
    return key === 'f12' || (input.control && input.shift && key === 'i');
}

function toggleDevTools(webContents) {
    if (webContents.isDevToolsOpened()) {
        webContents.closeDevTools();
        return;
    }
    webContents.openDevTools({ mode: 'detach' });
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
        const document = sessions.resolveDocumentRequest(request.url);
        if (!document) return new Response('Not found', { status: 404 });
        try {
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
    } = options;

    const sessions = new ViewerSessionManager({ getSevenZPath });
    registerDocumentProtocol(sessions);
    registerComicProtocol(sessions);
    let viewerWindow = null;
    let pendingSession = null;

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

        viewerWindow = new BrowserWindow({
            width: 1280,
            height: 860,
            minWidth: 820,
            minHeight: 560,
            title: 'BookManager Viewer',
            icon: getIconPath(),
            autoHideMenuBar: true,
            backgroundColor: '#111111',
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: false,
                plugins: true,
            },
            show: false,
        });

        if (process.platform !== 'darwin') {
            viewerWindow.setMenu(null);
        }

        viewerWindow.webContents.on('before-input-event', (event, input) => {
            if (!isDevToolsShortcut(input)) return;
            event.preventDefault();
            toggleDevTools(viewerWindow.webContents);
        });
        viewerWindow.once('ready-to-show', () => {
            viewerWindow?.show();
        });
        viewerWindow.webContents.on('did-finish-load', () => {
            sendSession(pendingSession || sessions.current());
            pendingSession = null;
        });
        viewerWindow.on('closed', () => {
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
        window.setTitle(`BookManager Viewer - ${path.basename(session.filePath)}`);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        sendSession(session);
        return { success: true, session };
    };

    const openAdjacentViewer = async (sessionId, direction) => {
        const session = sessions.createAdjacent(sessionId, direction);
        const window = ensureViewerWindow();
        window.setTitle(`BookManager Viewer - ${path.basename(session.filePath)}`);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return { success: true, session };
    };

    ipcMain.handle('viewer:open', async (_event, filePath) => openViewer(filePath));
    ipcMain.handle('viewer:openAdjacent', async (_event, sessionId, direction) => openAdjacentViewer(sessionId, direction));
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
    ipcMain.handle('viewer:getText', async (_event, sessionId, options = {}) => (
        sessions.getText(sessionId, options)
    ));
    ipcMain.handle('viewer:getEpubText', async (_event, sessionId) => (
        sessions.getEpubText(sessionId)
    ));

    return {
        openViewer,
        getWindow: () => viewerWindow,
    };
}
