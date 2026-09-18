import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { findBinaryPath } from './binaryPolicy.js';
import { crc32 } from './core/zipArchive.js';
import { detectImageMimeType } from './imageMagic.js';
import { encodeTextCover } from './textCoverEncoder.js';

const cwebpExe = findBinaryPath('cwebp');

function pngImage(width, height, alpha = false) {
    const chunk = (name, data) => {
        const body = Buffer.concat([Buffer.from(name), data]);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(data.length);
        const checksum = Buffer.alloc(4);
        checksum.writeUInt32BE(crc32(body));
        return Buffer.concat([size, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = alpha ? 6 : 2;
    const stride = width * (alpha ? 4 : 3) + 1;
    const pixels = Buffer.alloc(stride * height, 128);
    for (let row = 0; row < height; row += 1) pixels[row * stride] = 0;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

function webpSize(buffer) {
    assert.equal(detectImageMimeType(buffer), 'image/webp');
    assert.equal(buffer.readUInt32LE(4) + 8, buffer.length);
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
    assert.equal(chunk, 'VP8 ');
    return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
}

test('TXT WebP conversion preserves large, small, and transparent image dimensions', { skip: !cwebpExe }, async () => {
    for (const [width, height, alpha] of [[1200, 1800, false], [37, 53, false], [720, 1080, true]]) {
        const source = pngImage(width, height, alpha);
        const before = Buffer.from(source);
        const encoded = await encodeTextCover(source, { cwebpExe });
        assert.deepEqual(webpSize(encoded), [width, height]);
        assert.deepEqual(source, before);
        if (alpha) {
            assert.equal(encoded.toString('ascii', 12, 16), 'VP8X');
            assert.ok(encoded[20] & 0x10);
        }
        assert.equal(await encodeTextCover(encoded), encoded);
    }
});

test('TXT GIF and BMP normalization retains the decoded image dimensions', { skip: !cwebpExe }, async () => {
    for (const signature of ['GIF89a', 'BM']) {
        const source = Buffer.from(signature);
        const encoded = await encodeTextCover(source, {
            cwebpExe,
            normalizeImage(buffer) {
                assert.equal(buffer, source);
                return pngImage(641, 953);
            },
        });
        assert.deepEqual(webpSize(encoded), [641, 953]);
    }
});

test('TXT WebP conversion reports unavailable encoders and invalid images', async () => {
    await assert.rejects(encodeTextCover(pngImage(1, 1)), /encoder is unavailable/);
    await assert.rejects(encodeTextCover(Buffer.from('BM'), {
        cwebpExe: 'unused',
        normalizeImage: () => null,
    }), /could not be decoded/);
    if (cwebpExe) {
        await assert.rejects(encodeTextCover(Buffer.from('89504e470d0a1a0a', 'hex'), { cwebpExe }));
    }
});
