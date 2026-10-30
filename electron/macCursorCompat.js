import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// macOS 27 can replace an application's cursor with the arrow after mouse movement.
// Draw the system cursor image within the active content view; restore native handling on exit.
// BOOKMANAGER_MAC_CURSOR_COMPAT=0 disables this fallback, and =1 opts in on older macOS.
export function isMacCursorCompatEnabled({
    platform = process.platform,
    env = process.env,
    enabled,
    systemVersion = process.getSystemVersion?.() || '',
} = {}) {
    if (platform !== 'darwin') return false;
    if (env.BOOKMANAGER_MAC_CURSOR_COMPAT === '0') return false;
    if (env.BOOKMANAGER_MAC_CURSOR_COMPAT === '1') return true;
    if (typeof enabled === 'boolean') return enabled;
    return Number.parseInt(systemVersion, 10) >= 27;
}

export function installMacCursorCompat({
    app,
    BrowserWindow,
    addon,
    loadAddon = () => require('./native/build/MacCursorCompat.node'),
    logger = console,
    ...policy
}) {
    const inactive = {
        enabled: false,
        attachWindow: () => false,
        suspendWindow: () => {},
        detachWindow: () => {},
        dispose: () => {},
    };
    if (!isMacCursorCompatEnabled(policy)) return inactive;

    try {
        addon ??= loadAddon();
        if (!['attach', 'setCursor', 'suspend', 'detach'].every(name => typeof addon[name] === 'function')) {
            throw new Error('The native cursor helper has an unsupported interface.');
        }
    } catch (error) {
        logger.warn('[BookManager] macOS cursor compatibility is unavailable; using the system cursor.', error.message);
        return inactive;
    }

    let disposed = false;
    const windows = new Map();
    const detachWindow = window => {
        const record = windows.get(window.id);
        if (!record) return;
        windows.delete(window.id);
        for (const cleanup of [...record.cursorSources.values()]) cleanup();
        for (const [target, name, listener] of record.listeners) target.removeListener(name, listener);
        try {
            addon.detach(window.id);
        } catch (error) {
            logger.warn('[BookManager] Could not detach macOS cursor compatibility.', error.message);
        }
    };
    const call = (window, action) => {
        if (disposed || !windows.has(window.id)) return;
        try {
            action();
        } catch (error) {
            logger.warn('[BookManager] macOS cursor compatibility stopped for this window.', error.message);
            detachWindow(window);
        }
    };
    const refreshSuspension = window => {
        const record = windows.get(window.id);
        if (record) call(window, () => addon.suspend(window.id, record.loading || record.rendererGone || record.manualSuspended));
    };
    const suspendWindow = (window, suspended) => {
        const record = windows.get(window.id);
        if (!record) return;
        record.manualSuspended = Boolean(suspended);
        refreshSuspension(window);
    };
    const attachWindow = window => {
        if (disposed || window.isDestroyed() || !window.webContents || windows.has(window.id)) return false;
        const record = {
            window,
            listeners: [],
            cursorSources: new Map(),
            loading: Boolean(window.webContents.isLoading?.()),
            rendererGone: false,
            manualSuspended: false,
        };
        windows.set(window.id, record);
        const listen = (target, name, listener) => {
            target.on(name, listener);
            record.listeners.push([target, name, listener]);
        };
        call(window, () => {
            if (addon.attach(window.getNativeWindowHandle(), window.id) === false) {
                throw new Error('The native window could not be attached.');
            }
        });
        if (!windows.has(window.id)) return false;
        const attachCursorSource = contents => {
            if (!contents || contents.isDestroyed?.() || record.cursorSources.has(contents)) return;
            const onCursor = (_event, type, image, scale, _size, hotspot) => {
                call(window, () => {
                    if (type === 'custom' && image && !image.isEmpty()) {
                        addon.setCursor(window.id, type, image.toPNG(),
                            Number.isFinite(hotspot?.x) ? hotspot.x : 0,
                            Number.isFinite(hotspot?.y) ? hotspot.y : 0,
                            Number.isFinite(scale) && scale > 0 ? scale : 1);
                    } else {
                        // Electron calls the normal arrow "pointer" and the pointing hand "hand".
                        addon.setCursor(window.id, type === 'custom' ? 'pointer' : type);
                    }
                });
            };
            const onGuest = (_event, guest) => attachCursorSource(guest);
            const cleanup = () => {
                contents.removeListener('cursor-changed', onCursor);
                contents.removeListener('did-attach-webview', onGuest);
                contents.removeListener('destroyed', cleanup);
                record.cursorSources.delete(contents);
            };
            record.cursorSources.set(contents, cleanup);
            contents.on('cursor-changed', onCursor);
            contents.on('did-attach-webview', onGuest);
            contents.on('destroyed', cleanup);
        };
        attachCursorSource(window.webContents);
        const attachDevTools = () => attachCursorSource(window.webContents.devToolsWebContents);
        listen(window.webContents, 'devtools-opened', attachDevTools);
        attachDevTools();
        listen(window.webContents, 'did-start-loading', () => {
            record.loading = true;
            record.rendererGone = false;
            refreshSuspension(window);
        });
        listen(window.webContents, 'did-stop-loading', () => {
            record.loading = false;
            refreshSuspension(window);
        });
        listen(window.webContents, 'render-process-gone', () => {
            record.rendererGone = true;
            refreshSuspension(window);
        });
        listen(window.webContents, 'destroyed', () => detachWindow(window));
        listen(window, 'closed', () => detachWindow(window));
        refreshSuspension(window);
        return windows.has(window.id);
    };
    const onWindowCreated = (_event, window) => attachWindow(window);
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        app.removeListener('browser-window-created', onWindowCreated);
        app.removeListener('will-quit', dispose);
        for (const { window } of [...windows.values()]) detachWindow(window);
    };
    app.on('browser-window-created', onWindowCreated);
    app.on('will-quit', dispose);
    for (const window of BrowserWindow.getAllWindows()) attachWindow(window);
    return { enabled: true, attachWindow, suspendWindow, detachWindow, dispose };
}
