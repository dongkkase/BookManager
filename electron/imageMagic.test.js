import assert from 'node:assert/strict';
import test from 'node:test';

import {
    detectImageMimeType,
    imageBytesMatchMimeType,
    supportedImageExtensionForMimeType,
    supportedImageMimeTypeForPath,
} from './imageMagic.js';

const FIXTURES = [
    ['image/jpeg', Buffer.from('ffd8ffe000104a464946', 'hex')],
    ['image/png', Buffer.from('89504e470d0a1a0a', 'hex')],
    ['image/webp', Buffer.from('524946460400000057454250', 'hex')],
    ['image/gif', Buffer.from('GIF89a', 'ascii')],
    ['image/bmp', Buffer.from('424d36000000', 'hex')],
];

test('지원 이미지 형식을 magic byte로 식별한다', () => {
    for (const [mimeType, buffer] of FIXTURES) {
        assert.equal(detectImageMimeType(buffer), mimeType);
        assert.equal(imageBytesMatchMimeType(buffer, mimeType), true);
    }
    assert.equal(detectImageMimeType(Buffer.from('plain text')), '');
});

test('선언 MIME과 실제 이미지 바이트가 다르면 일치하지 않는다', () => {
    const png = FIXTURES.find(([mimeType]) => mimeType === 'image/png')[1];
    assert.equal(imageBytesMatchMimeType(png, 'image/jpeg'), false);
    assert.equal(imageBytesMatchMimeType(Buffer.from('not an image'), 'image/png'), false);
});

test('지원 확장자와 MIME을 정규화한다', () => {
    assert.equal(supportedImageMimeTypeForPath('/covers/book.JPEG'), 'image/jpeg');
    assert.equal(supportedImageMimeTypeForPath('/covers/book.bmp'), 'image/bmp');
    assert.equal(supportedImageExtensionForMimeType('image/bmp'), '.bmp');
    assert.equal(supportedImageMimeTypeForPath('/covers/book.svg'), '');
});
