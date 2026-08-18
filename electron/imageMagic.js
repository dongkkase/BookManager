const IMAGE_MIME_EXTENSIONS = Object.freeze({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
});

const IMAGE_EXTENSION_MIME_TYPES = Object.freeze({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
});

function bytesEqual(bytes, offset, expected) {
    if (!bytes || bytes.length < offset + expected.length) return false;
    return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiEqual(bytes, offset, expected) {
    return bytesEqual(bytes, offset, [...expected].map(character => character.charCodeAt(0)));
}

export function normalizeSupportedImageMimeType(value = '') {
    const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
    return Object.hasOwn(IMAGE_MIME_EXTENSIONS, mimeType) ? mimeType : '';
}

export function supportedImageExtensionForMimeType(value = '') {
    const mimeType = normalizeSupportedImageMimeType(value);
    return mimeType ? IMAGE_MIME_EXTENSIONS[mimeType] : '';
}

export function supportedImageMimeTypeForPath(filePath = '') {
    const cleanPath = String(filePath || '').split(/[?#]/, 1)[0].trim().toLowerCase();
    const match = cleanPath.match(/\.[^./\\]+$/);
    return match ? IMAGE_EXTENSION_MIME_TYPES[match[0]] || '' : '';
}

export function detectImageMimeType(buffer) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) return '';
    const bytes = buffer;

    if (bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png';
    }
    if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (asciiEqual(bytes, 0, 'GIF87a') || asciiEqual(bytes, 0, 'GIF89a')) return 'image/gif';
    if (asciiEqual(bytes, 0, 'RIFF') && asciiEqual(bytes, 8, 'WEBP')) return 'image/webp';
    if (asciiEqual(bytes, 0, 'BM')) return 'image/bmp';
    return '';
}

export function imageBytesMatchMimeType(buffer, declaredMimeType = '') {
    const mimeType = normalizeSupportedImageMimeType(declaredMimeType);
    return Boolean(mimeType && detectImageMimeType(buffer) === mimeType);
}
