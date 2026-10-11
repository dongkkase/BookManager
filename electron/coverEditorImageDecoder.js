import { detectImageMimeType } from './imageMagic.js';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 64000000;
const DECODE_TIMEOUT_MS = 30000;
const DECODER_DOCUMENT = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'"><title>Cover image decoder</title>');

function imageError(code) {
    return Object.assign(new Error('The cover image could not be decoded.'), { code });
}

function checkDimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw imageError('COVER_IMAGE_INVALID');
    if (width * height > MAX_IMAGE_PIXELS) throw imageError('COVER_IMAGE_TOO_MANY_PIXELS');
}

function rasterDimensions(buffer, mimeType) {
    if (mimeType === 'image/gif' && buffer.length >= 10) return [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
    if (mimeType === 'image/bmp' && buffer.length >= 26) {
        return buffer.readUInt32LE(14) === 12
            ? [buffer.readUInt16LE(18), buffer.readUInt16LE(20)]
            : [buffer.readInt32LE(18), Math.abs(buffer.readInt32LE(22))];
    }
    if (mimeType === 'image/webp' && buffer.length >= 30) {
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X') return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
        if (chunk === 'VP8L' && buffer[20] === 0x2f) {
            const bits = buffer.readUInt32LE(21);
            return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        }
        if (chunk === 'VP8 ') return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
    }
    return null;
}

async function rasterToPng(base64, mimeType, maxPixels, maxBytes) {
    let image;
    try {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        image = await createImageBitmap(new Blob([bytes], { type: mimeType }));
        if (!image.width || !image.height) return { code: 'COVER_IMAGE_INVALID' };
        if (image.width * image.height > maxPixels) return { code: 'COVER_IMAGE_TOO_MANY_PIXELS' };
        const canvas = new OffscreenCanvas(image.width, image.height);
        canvas.getContext('2d').drawImage(image, 0, 0);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        if (!png.size || png.size > maxBytes) return { code: 'COVER_IMAGE_CONVERSION_FAILED' };
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(png);
        });
        return { dataUrl, width: image.width, height: image.height };
    } catch {
        return { code: 'COVER_IMAGE_INVALID' };
    } finally {
        image?.close();
    }
}

export async function convertCoverEditorRaster(buffer, mimeType, options = {}) {
    const electronModule = options.electron || await import('electron');
    const { BrowserWindow } = electronModule.default || electronModule;
    const window = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        width: 1,
        height: 1,
        webPreferences: {
            partition: 'cover-editor-image-decoder',
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            allowRunningInsecureContent: false,
            backgroundThrottling: false,
            devTools: false,
        },
    });
    let timer;
    try {
        window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        window.webContents.session.setPermissionCheckHandler(() => false);
        window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== DECODER_DOCUMENT }));
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) window.webContents.on(event, event => event.preventDefault());
        const interrupted = new Promise((_resolve, reject) => {
            const fail = () => reject(imageError('COVER_IMAGE_CONVERSION_FAILED'));
            timer = setTimeout(fail, options.timeoutMs || DECODE_TIMEOUT_MS);
            window.once('closed', fail);
            window.webContents.once('render-process-gone', fail);
        });
        const result = await Promise.race([interrupted, (async () => {
            await window.loadURL(DECODER_DOCUMENT);
            const args = [buffer.toString('base64'), mimeType, MAX_IMAGE_PIXELS, MAX_IMAGE_BYTES].map(value => JSON.stringify(value)).join(',');
            return window.webContents.executeJavaScript(`(${rasterToPng.toString()})(${args})`);
        })()]);
        if (result?.code) throw imageError(result.code);
        checkDimensions(result?.width, result?.height);
        if (typeof result?.dataUrl !== 'string' || !result.dataUrl.startsWith('data:image/png;base64,')
            || result.dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) throw imageError('COVER_IMAGE_CONVERSION_FAILED');
        const output = Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64');
        if (!output.length || output.length > MAX_IMAGE_BYTES || detectImageMimeType(output) !== 'image/png') throw imageError('COVER_IMAGE_CONVERSION_FAILED');
        return output;
    } catch (error) {
        if (error?.code?.startsWith('COVER_IMAGE_')) throw error;
        throw imageError('COVER_IMAGE_CONVERSION_FAILED');
    } finally {
        clearTimeout(timer);
        if (!window.isDestroyed()) window.destroy();
    }
}

export async function decodeCoverEditorImage(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw imageError('COVER_IMAGE_INVALID');
    if (buffer.length > MAX_IMAGE_BYTES) throw imageError('COVER_IMAGE_TOO_LARGE');
    const mimeType = detectImageMimeType(buffer);
    if (!mimeType) throw imageError('COVER_IMAGE_UNSUPPORTED_FORMAT');
    const dimensions = rasterDimensions(buffer, mimeType);
    if (dimensions) checkDimensions(...dimensions);
    const electronModule = options.nativeImage ? null : await import('electron');
    const nativeImage = options.nativeImage || (electronModule.default || electronModule).nativeImage;
    let image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty() && ['image/webp', 'image/gif', 'image/bmp'].includes(mimeType)) {
        const converted = await (options.convertRaster || convertCoverEditorRaster)(buffer, mimeType, options);
        image = nativeImage.createFromBuffer(converted);
    }
    if (image.isEmpty()) throw imageError('COVER_IMAGE_INVALID');
    const { width, height } = image.getSize();
    checkDimensions(width, height);
    return image;
}
