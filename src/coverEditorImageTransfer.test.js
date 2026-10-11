import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { extractCoverImageTransfer, isCoverImageTransfer } from './coverEditorImageTransfer.js';

const parseHtml = html => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
const transfer = (values = {}, files = [], items = []) => ({
    files, items, types: Object.keys(values), getData: type => values[type] || '',
});
const extract = value => extractCoverImageTransfer(value, { parseHtml });

test('파일 데이터는 HTML과 URL보다 우선하고 바이트를 읽지 않는다', () => {
    const file = { type: 'image/png', name: 'image.png', arrayBuffer: () => assert.fail('아직 읽지 않아야 한다') };
    assert.deepEqual(extract(transfer({ 'text/html': '<img src="https://other.test/image">', 'text/uri-list': 'https://other.test/' }, [file])), { file });
    assert.deepEqual(extract(transfer({}, [], [{ kind: 'file', type: 'image/png', getAsFile: () => file }])), { file });
    assert.deepEqual(extract(transfer({}, [file], [{ kind: 'file', type: 'image/png', getAsFile: () => file }])), { file });
});

test('브라우저 드래그는 링크가 아닌 실제 이미지 주소를 읽고 HTML을 실행하지 않는다', () => {
    const html = '<a href="https://site.test/page"><img src="https://images.test/cover?id=12&amp;size=2" onerror="bad()" /></a><script>bad()</script>';
    assert.deepEqual(extract(transfer({ 'text/html': html, 'text/uri-list': 'https://site.test/page' })), {
        url: 'https://images.test/cover?id=12&size=2',
    });
});

test('URI 목록 주석과 확장자 없는 이미지 URL 및 data 이미지를 지원한다', () => {
    assert.deepEqual(extract(transfer({ 'text/uri-list': '# source\r\nhttps://images.test/asset?id=1\r\n' })), { url: 'https://images.test/asset?id=1' });
    assert.deepEqual(extract(transfer({ 'text/plain': ' https://images.test/asset?id=2 ' })), { url: 'https://images.test/asset?id=2' });
    assert.deepEqual(extract(transfer({ 'text/html': '<img src="data:image/png;base64,aGVsbG8=" />' })), { url: 'data:image/png;base64,aGVsbG8=' });
});

test('프로토콜을 생략한 브라우저 이미지 주소는 HTTPS로 불러오고 일반 상대 경로는 거절한다', () => {
    assert.deepEqual(extract(transfer({ 'text/html': '<img src="//i.namu.wiki/i/image.webp" />' })), {
        url: 'https://i.namu.wiki/i/image.webp',
    });
    assert.deepEqual(extract(transfer({ 'text/uri-list': '//i.namu.wiki/i/image.webp' })), {
        url: 'https://i.namu.wiki/i/image.webp',
    });
    assert.deepEqual(extract(transfer({ 'text/html': '<img src="/i/image.webp" />' })), {
        errorKey: 'cover_editor_image_import_failed',
    });
    assert.deepEqual(extract(transfer({ 'text/uri-list': '//user:secret@i.namu.wiki/i/image.webp' })), {
        errorKey: 'cover_editor_image_import_failed',
    });
    assert.equal(extract(transfer({ 'text/plain': '//ordinary/text' })), null);
});

test('여러 이미지나 주소를 전달하면 하나를 임의로 고르지 않는다', () => {
    const multiple = { errorKey: 'cover_editor_drop_one' };
    assert.deepEqual(extract(transfer({}, [{ type: 'image/jpeg' }, { type: 'image/png' }])), multiple);
    assert.deepEqual(extract(transfer({ 'text/html': '<img src="https://a.test/1" /><img src="https://a.test/2" />' })), multiple);
    assert.deepEqual(extract(transfer({ 'text/uri-list': 'https://a.test/1\nhttps://a.test/2' })), multiple);
    assert.deepEqual(extract(transfer({ 'text/plain': 'https://a.test/1\nhttps://a.test/2' })), multiple);
});

test('사용할 수 없는 이미지 주소는 링크 주소로 바꾸지 않고 오류를 반환한다', () => {
    for (const url of ['blob:https://site.test/id', 'file:///private/cover.png', 'javascript:bad()', 'data:image/svg+xml;base64,PHN2Zy8+', '/relative.png', 'https://user:secret@site.test/cover']) {
        assert.deepEqual(extract(transfer({ 'text/html': `<img src="${url}" />`, 'text/uri-list': 'https://site.test/page' })), {
            errorKey: 'cover_editor_image_import_failed',
        });
    }
    assert.deepEqual(extract(transfer({ 'text/uri-list': 'file:///private/cover.png' })), { errorKey: 'cover_editor_image_import_failed' });
});

test('URL 해석을 끈 호출과 일반 텍스트는 이미지로 처리하지 않는다', () => {
    const data = transfer({ 'text/html': '<img src="https://site.test/image" />', 'text/plain': 'https://site.test/image' });
    assert.equal(extractCoverImageTransfer(data, { allowUrls: false, parseHtml: () => assert.fail('HTML을 읽지 않아야 한다') }), null);
    assert.equal(extract(transfer({ 'text/plain': '일반 텍스트' })), null);
    assert.equal(extract(transfer({}, [{ type: 'text/plain', name: 'book.txt' }])), null);
});

test('내용이 없는 브라우저 임시 파일은 실제 이미지 URL로 가져오고 주소가 없으면 파일 검증을 유지한다', () => {
    const file = { name: 'cover.webp', type: 'image/webp', size: 0 };
    const html = '<a href="https://namu.wiki/page"><img src="https://i.namu.wiki/i/image.webp" /></a>';
    assert.deepEqual(extract(transfer({ 'text/html': html, 'text/uri-list': 'https://namu.wiki/page' }, [file])), {
        url: 'https://i.namu.wiki/i/image.webp',
    });
    assert.deepEqual(extract(transfer({}, [file])), { file });
    assert.deepEqual(extract(transfer({ 'text/uri-list': 'https://i.namu.wiki/i/image.webp' }, [file, { ...file }])), {
        errorKey: 'cover_editor_drop_one',
    });
});

test('보호된 드래그 데이터는 유형으로 호버를 판단하며 실제 값 읽기를 요구하지 않는다', () => {
    assert.equal(isCoverImageTransfer({ types: ['text/html', 'text/uri-list'], getData: () => '' }), true);
    assert.equal(isCoverImageTransfer({ items: [{ kind: 'file', type: 'image/png' }] }), true);
    assert.equal(isCoverImageTransfer(transfer({ 'text/plain': 'https://images.test/no-extension' })), true);
    assert.equal(isCoverImageTransfer(transfer({ 'text/plain': '일반 텍스트' })), false);
    assert.equal(isCoverImageTransfer(transfer({}, [{ name: 'cover.JPG' }, { name: 'book.cbz' }])), false);
});
