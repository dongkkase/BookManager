import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { requestAuthorProfileText } from './authorProfileWebRequest.js';

function fixture(responses = [{ status: 200, body: '<html>작가</html>' }]) {
    const calls = [];
    const request = (url, options, receive) => {
        const req = new EventEmitter();
        const call = { url, options, body: '' };
        calls.push(call);
        req.write = body => { call.body += body; };
        req.destroy = () => { req.destroyed = true; };
        req.end = () => queueMicrotask(() => {
            const value = responses.shift();
            if (!value) return;
            const response = new PassThrough();
            response.statusCode = value.status;
            response.headers = value.headers || {};
            receive(response);
            response.end(value.body || '');
        });
        return req;
    };
    return { calls, request };
}

const url = 'https://www.aladin.co.kr/author/search/wauthor_search_name.aspx?SearchWord=test';

test('공개 저자 HTML 전송은 허용된 출처와 회원 목록 문서만 요청한다', async () => {
    for (const value of ['http://www.aladin.co.kr/', 'https://www.aladin.co.kr.attacker.test/', 'https://user@www.aladin.co.kr/',
        'https://www.aladin.co.kr:8443/', 'https://127.0.0.1/', 'https://docs.google.com/spreadsheets/d/private/gviz/tq']) {
        await assert.rejects(requestAuthorProfileText(value, {}, { request: () => assert.fail('No request allowed') }), { code: 'AUTHOR_PROFILE_REQUEST_FAILED' });
    }
    const network = fixture();
    assert.equal(await requestAuthorProfileText(url, {}, network), '<html>작가</html>');
    assert.equal(network.calls.length, 1);
});

test('외부 리디렉션은 거절하고 같은 출처의 제한된 리디렉션만 따른다', async () => {
    const blocked = fixture([{ status: 302, headers: { location: 'https://example.com/author' } }]);
    await assert.rejects(requestAuthorProfileText(url, {}, blocked), { code: 'AUTHOR_PROFILE_REQUEST_FAILED' });
    assert.equal(blocked.calls.length, 1);
    const allowed = fixture([{ status: 302, headers: { location: '/author/new' } }, { status: 200, body: 'Author' }]);
    assert.equal(await requestAuthorProfileText(url, {}, allowed), 'Author');
    assert.equal(allowed.calls.length, 2);
});

test('검색 POST 본문과 압축된 UTF-8 및 EUC-KR 응답을 처리한다', async () => {
    const posted = fixture([{ status: 200, body: gzipSync('한국 작가'), headers: { 'content-encoding': 'gzip' } }]);
    assert.equal(await requestAuthorProfileText(url, { method: 'POST', body: 'name=Author' }, posted), '한국 작가');
    assert.equal(posted.calls[0].body, 'name=Author');
    const korean = fixture([{ status: 200, body: Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]), headers: { 'content-type': 'text/html; charset=euc-kr' } }]);
    assert.equal(await requestAuthorProfileText(url, {}, korean), '한글');
});

test('차단과 호출 한도 및 크기 제한·타임아웃을 구분한다', async () => {
    await assert.rejects(requestAuthorProfileText(url, {}, fixture([{ status: 403 }])), { code: 'AUTHOR_PROFILE_ACCESS_BLOCKED' });
    await assert.rejects(requestAuthorProfileText(url, {}, fixture([{ status: 429, headers: { 'retry-after': '180' } }])), error => {
        assert.equal(error.code, 'AUTHOR_PROFILE_RATE_LIMIT');
        assert.equal(error.retryAfterMs, 180000);
        return true;
    });
    await assert.rejects(requestAuthorProfileText(url, {}, fixture([{ status: 200, body: Buffer.alloc(3 * 1024 * 1024 + 1) }])), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    await assert.rejects(requestAuthorProfileText(url, {}, fixture([{ status: 200, body: gzipSync(Buffer.alloc(3 * 1024 * 1024 + 1)), headers: { 'content-encoding': 'gzip' } }])), { code: 'AUTHOR_PROFILE_INVALID_RESPONSE' });
    await assert.rejects(requestAuthorProfileText(url, {}, { ...fixture([]), timeoutMs: 5 }), { code: 'AUTHOR_PROFILE_TIMEOUT' });
});
