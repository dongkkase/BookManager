import assert from 'node:assert/strict';
import test from 'node:test';

import {
    decodeMetadataCoverDataUrl,
    defaultMetadataCoverName,
} from './metadataCoverExport.js';

const PNG_1X1 = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100f5fe51b90000000049454e44ae426082',
    'hex',
);

function createBmpHeader() {
    const buffer = Buffer.alloc(54);
    buffer.write('BM', 0, 'ascii');
    buffer.writeUInt32LE(buffer.length, 2);
    buffer.writeUInt32LE(54, 10);
    buffer.writeUInt32LE(40, 14);
    buffer.writeInt32LE(1, 18);
    buffer.writeInt32LE(1, 22);
    buffer.writeUInt16LE(1, 26);
    buffer.writeUInt16LE(24, 28);
    return buffer;
}

test('오디오북 표지 Data URL을 원본 바이트와 확장자로 변환한다', () => {
    const source = PNG_1X1;
    const decoded = decodeMetadataCoverDataUrl(`data:image/png;base64,${source.toString('base64')}`);

    assert.equal(decoded.mimeType, 'image/png');
    assert.equal(decoded.extension, '.png');
    assert.deepEqual(decoded.buffer, source);
    assert.equal(defaultMetadataCoverName('/books/Chapter 01.m4b', decoded.extension), 'Chapter 01-cover.png');
});

test('BMP 오디오북 표지 Data URL을 원본 바이트와 확장자로 변환한다', () => {
    const source = createBmpHeader();
    const decoded = decodeMetadataCoverDataUrl(`data:image/bmp;base64,${source.toString('base64')}`);

    assert.equal(decoded.mimeType, 'image/bmp');
    assert.equal(decoded.extension, '.bmp');
    assert.deepEqual(decoded.buffer, source);
    assert.equal(defaultMetadataCoverName('/books/Chapter 01.m4b', decoded.extension), 'Chapter 01-cover.bmp');
});

test('이미지가 아닌 Data URL과 비어 있는 표지는 거부한다', () => {
    assert.equal(decodeMetadataCoverDataUrl('data:text/plain;base64,dGV4dA=='), null);
    assert.equal(decodeMetadataCoverDataUrl(`data:image/jpeg;base64,${PNG_1X1.toString('base64')}`), null);
    assert.equal(decodeMetadataCoverDataUrl(`data:image/png;base64,${Buffer.from('plain text').toString('base64')}`), null);
    assert.equal(decodeMetadataCoverDataUrl(''), null);
});
