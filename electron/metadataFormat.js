import { SCAN_TARGET_EXTENSIONS } from './scanTargets.js';

export const FILE_EXTENSION_FORMAT_VALUES = Object.freeze(
    SCAN_TARGET_EXTENSIONS.map(ext => String(ext || '').replace(/^\./, '').toUpperCase())
        .filter(Boolean),
);

const FILE_EXTENSION_FORMATS = new Set(FILE_EXTENSION_FORMAT_VALUES);

function normalizeFormatToken(value = '') {
    return String(value || '').trim().replace(/^\./, '').toUpperCase();
}

export function isFileExtensionFormat(value = '') {
    return FILE_EXTENSION_FORMATS.has(normalizeFormatToken(value));
}

export function normalizeMetadataFormat(value = '') {
    const format = String(value || '').trim();
    if (!format || isFileExtensionFormat(format)) return '';
    return format;
}
