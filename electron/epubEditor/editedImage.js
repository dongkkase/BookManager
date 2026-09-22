import { inflateSync } from 'node:zlib';
import { crc32 } from '../core/zipArchive.js';
import { projectError } from './model.js';

export const MAX_EDITED_IMAGE_SIDE = 8192;
export const MAX_EDITED_IMAGE_PIXELS = 32 * 1024 * 1024;
export const MAX_EDITED_IMAGE_BYTES = 20 * 1024 * 1024;

export function validateEditedImage(input) {
    const data = Buffer.from(input);
    if (data.length > MAX_EDITED_IMAGE_BYTES) throw projectError('ASSET_TOO_LARGE');
    if (data.length < 45 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw projectError('INVALID_ASSET');
    let width;
    let height;
    let channels;
    let offset = 8;
    let ended = false;
    let dataEnded = false;
    let palette = false;
    const compressed = [];
    while (offset + 12 <= data.length) {
        const length = data.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > data.length) throw projectError('INVALID_ASSET');
        const type = data.toString('ascii', offset + 4, offset + 8);
        if (!/^[A-Za-z]{4}$/.test(type) || crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw projectError('INVALID_ASSET');
        if (offset === 8 && type !== 'IHDR') throw projectError('INVALID_ASSET');
        if (type === 'IHDR') {
            if (offset !== 8 || length !== 13) throw projectError('INVALID_ASSET');
            width = data.readUInt32BE(offset + 8);
            height = data.readUInt32BE(offset + 12);
            if (!width || !height) throw projectError('INVALID_ASSET');
            if (width > MAX_EDITED_IMAGE_SIDE || height > MAX_EDITED_IMAGE_SIDE || width * height > MAX_EDITED_IMAGE_PIXELS) throw projectError('IMAGE_DIMENSIONS_EXCEEDED');
            // Canvas output is a non-interlaced, eight-bit RGB or RGBA PNG.
            channels = data[offset + 17] === 2 ? 3 : data[offset + 17] === 6 ? 4 : 0;
            if (data[offset + 16] !== 8 || !channels || data[offset + 18] !== 0 || data[offset + 19] !== 0 || data[offset + 20] !== 0) throw projectError('INVALID_ASSET');
        } else if (type === 'IDAT') {
            if (dataEnded) throw projectError('INVALID_ASSET');
            compressed.push(data.subarray(offset + 8, end - 4));
        } else if (type === 'IEND') {
            if (length !== 0 || !compressed.length || end !== data.length) throw projectError('INVALID_ASSET');
            ended = true;
        } else {
            if (compressed.length) dataEnded = true;
            if (type === 'PLTE') {
                if (palette || compressed.length || !length || length > 768 || length % 3) throw projectError('INVALID_ASSET');
                palette = true;
            } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || type[0] === type[0].toUpperCase()) throw projectError('INVALID_ASSET');
        }
        offset = end;
    }
    if (!ended || offset !== data.length) throw projectError('INVALID_ASSET');
    const stride = width * channels + 1;
    const expectedBytes = stride * height;
    let decoded;
    try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedBytes }); }
    catch { throw projectError('INVALID_ASSET'); }
    if (decoded.length !== expectedBytes) throw projectError('INVALID_ASSET');
    for (let row = 0; row < height; row += 1) {
        if (decoded[row * stride] > 4) throw projectError('INVALID_ASSET');
    }
    return { width, height };
}
