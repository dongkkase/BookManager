import assert from 'node:assert/strict';
import test from 'node:test';
import { comicDataUrlBytes, createComicPageRequest, limitComicPageData, retainComicImageSource } from './viewerComicResources.js';

test('comic fallback cache retains a bounded number of pages during long reading sessions', () => {
    let data = {};
    for (let index = 0; index < 2000; index += 1) {
        const name = `${index}.png`;
        data = limitComicPageData({ ...data, [name]: 'data:image/png;base64,YQ==' }, name);
        assert.ok(Object.keys(data).length <= 24);
    }
    assert.equal(data['0.png'], undefined);
    assert.ok(data['1999.png']);
});

test('comic fallback byte budget evicts old large pages while preserving current display sources', () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
    let data = {};
    for (let index = 0; index < 100; index += 1) {
        const name = `${index}.png`;
        data = limitComicPageData({ ...data, [name]: image }, name);
        assert.ok(Object.values(data).reduce((sum, value) => sum + comicDataUrlBytes(value), 0) <= 64 * 1024 * 1024);
    }
    assert.equal(retainComicImageSource(image, 'bookmanager-comic://session/page'), image);
    assert.equal(retainComicImageSource('', 'bookmanager-comic://session/page'), 'bookmanager-comic://session/page');
});

test('current oversized image remains readable without retaining older cache entries', () => {
    const large = 'data:image/png;base64,' + 'A'.repeat(90 * 1024 * 1024);
    const result = limitComicPageData({ old: 'data:image/png;base64,YQ==', current: large }, 'current');
    assert.deepEqual(Object.keys(result), ['current']);
});

test('each mounted comic consumer has independent explicit cancellation, including before image loading', () => {
    const cancelled = [];
    const api = { cancelComicPageRequest: (...args) => cancelled.push(args) };
    const source = 'bookmanager-comic://session/book/chapter%2F001.png?priority=background';
    const first = createComicPageRequest(source, api);
    const second = createComicPageRequest(source, api);
    assert.notEqual(first.url, second.url);
    assert.equal(new URL(first.url).searchParams.get('priority'), 'background');
    first.release();
    first.release();
    assert.deepEqual(cancelled, [['book', new URL(first.url).searchParams.get('requestId')]]);
    second.release();
    assert.equal(cancelled.length, 2);
    assert.equal(createComicPageRequest('data:image/png;base64,YQ==', api).url, 'data:image/png;base64,YQ==');
});
