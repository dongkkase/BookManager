import path from 'path';
import {
    detectImageMimeType,
    normalizeSupportedImageMimeType,
    supportedImageExtensionForMimeType,
    supportedImageMimeTypeForPath,
} from './imageMagic.js';

export const MAX_METADATA_COVER_BYTES = 32 * 1024 * 1024;

export function decodeMetadataCoverDataUrl(value = '') {
    const match = String(value || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) return null;
    const mimeType = normalizeSupportedImageMimeType(match[1]);
    if (!mimeType) return null;
    const encoded = match[2].replace(/\s+/g, '');
    if (!encoded) return null;
    if (encoded.length > Math.ceil(MAX_METADATA_COVER_BYTES * 4 / 3) + 4) return null;
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > MAX_METADATA_COVER_BYTES) return null;
    if (detectImageMimeType(buffer) !== mimeType) return null;
    return {
        buffer,
        extension: supportedImageExtensionForMimeType(mimeType),
        mimeType,
    };
}

export function defaultMetadataCoverName(filePath = '', extension = '.jpg') {
    const stem = path.basename(String(filePath || ''), path.extname(String(filePath || ''))).trim() || 'audiobook';
    const mimeType = supportedImageMimeTypeForPath(`cover${extension}`);
    const safeExtension = mimeType ? supportedImageExtensionForMimeType(mimeType) : '.jpg';
    return `${stem}-cover${safeExtension}`;
}
