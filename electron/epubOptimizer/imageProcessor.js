const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;
const DECODER_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'"><title>EPUB image optimizer</title>');
const failure = code => Object.assign(new Error(code), { code });

async function optimizeImageInBrowser(base64, mimeType, quality, maxDimension, maxBytes, maxPixels) {
    let bitmap;
    try {
        const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
        bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > maxPixels) return { error: 'IMAGE_DIMENSIONS_UNSUPPORTED' };
        const scale = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1;
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: mimeType, quality: quality / 100 });
        if (blob.type !== mimeType || blob.size > maxBytes) return { error: 'IMAGE_OUTPUT_UNSUPPORTED' };
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        return { dataUrl, width, height };
    } catch {
        return { error: 'IMAGE_DECODE_FAILED' };
    } finally {
        bitmap?.close();
    }
}

export function createImageProcessor({ BrowserWindow, timeoutMs = 30000 } = {}) {
    let decoder;
    let ready;
    const dispose = () => {
        if (decoder && !decoder.isDestroyed()) decoder.destroy();
        decoder = null;
        ready = null;
    };
    const prepare = () => {
        if (ready) return ready;
        decoder = new BrowserWindow({
            show: false,
            skipTaskbar: true,
            width: 1,
            height: 1,
            webPreferences: {
                partition: 'epub-optimizer-image-decoder',
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                webviewTag: false,
                backgroundThrottling: false,
                devTools: false,
            },
        });
        decoder.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        decoder.webContents.session.setPermissionCheckHandler(() => false);
        decoder.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== DECODER_URL }));
        decoder.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) decoder.webContents.on(event, event => event.preventDefault());
        ready = decoder.loadURL(DECODER_URL);
        return ready;
    };
    return {
        dispose,
        async transform({ data, mimeType, settings = {} }, signal) {
            if (signal?.aborted) throw failure('TASK_CANCELLED');
            const bytes = Buffer.from(data);
            if (!bytes.length || bytes.length > MAX_BYTES || !['image/jpeg', 'image/png'].includes(mimeType)) throw failure('IMAGE_UNSUPPORTED');
            const quality = Math.max(40, Math.min(100, Number(settings.quality) || 82));
            const maxDimension = Math.max(0, Math.min(8192, Number(settings.maxDimension) || 0));
            let timeout;
            let abort;
            let fail;
            let contents;
            try {
                const loading = prepare();
                contents = decoder.webContents;
                const interrupted = new Promise((_resolve, reject) => {
                    abort = () => reject(failure('TASK_CANCELLED'));
                    fail = () => reject(failure('IMAGE_DECODE_FAILED'));
                    timeout = setTimeout(() => reject(failure('IMAGE_DECODE_TIMEOUT')), timeoutMs);
                    signal?.addEventListener('abort', abort, { once: true });
                    contents.once('render-process-gone', fail);
                    contents.once('destroyed', fail);
                });
                const result = await Promise.race([interrupted, (async () => {
                    await loading;
                    const args = [bytes.toString('base64'), mimeType, quality, maxDimension, MAX_BYTES, MAX_PIXELS];
                    return contents.executeJavaScript(`(${optimizeImageInBrowser.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`);
                })()]);
                if (result?.error) throw failure(result.error);
                const prefix = `data:${mimeType};base64,`;
                if (typeof result?.dataUrl !== 'string' || !result.dataUrl.startsWith(prefix)
                    || result.dataUrl.length > Math.ceil(MAX_BYTES / 3) * 4 + prefix.length) throw failure('IMAGE_OUTPUT_UNSUPPORTED');
                return Buffer.from(result.dataUrl.slice(prefix.length), 'base64');
            } catch (error) {
                dispose();
                throw error;
            } finally {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abort);
                contents?.removeListener('render-process-gone', fail);
                contents?.removeListener('destroyed', fail);
            }
        },
    };
}
