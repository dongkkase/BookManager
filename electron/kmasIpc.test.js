import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { searchKmas } from './kmasSearch.js';
import { setLanguage, t } from './utils/i18n.js';

setLanguage('ko');
const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const sampleItem = {
    MASTR_ID: '2024020423',
    LIST_SE_CD: '1',
    TITLE_N: '나 혼자 부활한다',
    SNTNC_WRITR_NM: '앵무새',
    PICTR_WRITR_NM: '스튜디오 크힛',
    FILE_IMAGE_ID: 'd326e47c-d06d-42e7-9b07-18bef0d8ecbc',
};

function sourceFunction(name) {
    const start = ipcSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const prefix = ipcSource.slice(start - 6, start) === 'async ' ? 'async ' : '';
    return prefix + ipcSource.slice(start, ipcSource.indexOf('\n}', start) + 2);
}

function createIpcHarness(requestText) {
    const helpers = [
        'normalizeApiSource', 'normalizeSearchBookType', 'isMetadataApiAllowedForBookType',
        'normalizeSearchResult', 'stripTransientApiImageFields', 'stripTransientApiImageFieldsFromResults',
    ].map(sourceFunction).join('\n');
    const start = ipcSource.indexOf("  ipcMain.handle('api:fetch',");
    const end = ipcSource.indexOf("  ipcMain.handle('api:ridiBookDetail',", start);
    assert.ok(start >= 0 && end > start);
    let handler;
    let opened = 0;
    let closed = 0;
    const cached = new Map();
    vm.runInNewContext(`${helpers}\n${ipcSource.slice(start, end)}`, {
        ipcMain: { handle(_name, callback) { handler = callback; } },
        configManager: { getConfig: () => ({}) },
        searchKmas,
        requestKmasText: requestText,
        i18nT: t,
        metadataSearchLog: () => {},
        openApiCacheDbSafe: () => { opened += 1; return { close() { closed += 1; } }; },
        getCachedApiResults: (_db, api, query) => cached.get(`${api}:${query}`),
        setCachedApiResults: async (_db, api, query, results) => {
            cached.set(`${api}:${query}`, JSON.parse(JSON.stringify(results)));
        },
        apiCoverCacheDir: () => '',
        enrichResultImages: async results => results.map(result => ({ ...result, coverCacheUrl: 'cached-cover' })),
    });
    return { handler, cached, get opened() { return opened; }, get closed() { return closed; } };
}

function searchResponse(total = 21) {
    return JSON.stringify({
        result: 'success',
        pageInfo: { totalRecordCount: total },
        allDataObj: { dataList: [sampleItem] },
    });
}

test('한국웹툰 IPC는 별칭과 한글 NFC를 정규화하고 검색 캐시에 페이지 정보를 보존한다', async () => {
    const requests = [];
    const harness = createIpcHarness(async (url, headers, timeout, options) => {
        requests.push({ url, headers, timeout, options });
        return options?.method === 'POST' ? searchResponse() : '<html></html>';
    });
    const first = await harness.handler({}, {
        apiSource: 'KMAS', query: `  ${sampleItem.TITLE_N.normalize('NFD')}  `, bookType: 'comic',
    });
    assert.equal(first.success, true);
    assert.equal(first.api, '한국웹툰');
    assert.equal(first.actualQuery, sampleItem.TITLE_N);
    assert.equal(first.cached, false);
    assert.equal(first.hasNext, true);
    assert.equal(first.results.length, 1);
    assert.equal(first.results[0].id, sampleItem.MASTR_ID);
    assert.equal(first.results[0].metadata.Writer, sampleItem.SNTNC_WRITR_NM);
    assert.equal(first.results[0].metadata.Penciller, sampleItem.PICTR_WRITR_NM);
    assert.equal(first.results[0].metadata.Manga, 'No');
    assert.equal(first.results[0].metadata.Format, 'Webtoon');
    assert.equal(first.results[0].coverCacheUrl, 'cached-cover');
    const post = requests.find(request => request.options?.method === 'POST');
    assert.equal(new URLSearchParams(post.options.body).get('keyword1'), sampleItem.TITLE_N);
    assert.equal(new URLSearchParams(post.options.body).get('pageIndex'), '1');
    const saved = [...harness.cached.values()][0][0];
    assert.equal(saved.kmasHasNext, true);
    assert.equal(saved.coverCacheUrl, undefined);
    const requestCount = requests.length;
    for (const apiSource of ['한국웹툰', 'kmas']) {
        const cached = await harness.handler({}, { apiSource, query: sampleItem.TITLE_N, bookType: 'comic' });
        assert.equal(cached.cached, true);
        assert.equal(cached.hasNext, true);
        assert.equal(cached.results[0].coverCacheUrl, 'cached-cover');
    }
    assert.equal(requests.length, requestCount);
    const last = await harness.handler({}, { apiSource: '한국웹툰', query: sampleItem.TITLE_N, page: 3 });
    assert.equal(last.cached, false);
    assert.equal(last.hasNext, false);
    assert.equal(harness.cached.size, 2);
    const lastCached = await harness.handler({}, { apiSource: '한국웹툰', query: sampleItem.TITLE_N, page: 3 });
    assert.equal(lastCached.cached, true);
    assert.equal(lastCached.hasNext, false);
    assert.equal(harness.closed, harness.opened);
});

test('한국웹툰 IPC는 만화 이외의 타입과 빈 검색어에 네트워크 요청을 보내지 않는다', async () => {
    let requestCount = 0;
    const harness = createIpcHarness(async () => { requestCount += 1; return searchResponse(); });
    for (const bookType of ['book', 'epub', 'txt', 'pdf', 'audio', 'audiobook']) {
        const result = await harness.handler({}, { apiSource: '한국웹툰', query: '제목', bookType });
        assert.equal(result.success, false, bookType);
        assert.match(result.error, /한국웹툰/);
    }
    const empty = await harness.handler({}, { apiSource: '한국웹툰', query: '  ', bookType: 'comic' });
    assert.equal(empty.success, true);
    assert.equal(empty.results.length, 0);
    assert.equal(requestCount, 0);
    assert.equal(harness.cached.size, 0);
});

test('한국웹툰 IPC는 요청 실패와 잘못된 검색 응답을 캐시에 저장하지 않는다', async () => {
    for (const failure of [
        new Error('network unavailable'),
        JSON.stringify({ result: 'fail', resultMsg: '검색 서버 오류' }),
        JSON.stringify({ vaildErrorMsg: '잘못된 요청' }),
        '<html>upstream error</html>',
    ]) {
        const harness = createIpcHarness(async (_url, _headers, _timeout, options) => {
            if (!options) return '<html></html>';
            if (failure instanceof Error) throw failure;
            return failure;
        });
        const result = await harness.handler({}, { apiSource: '한국웹툰', query: '제목', bookType: 'comic' });
        assert.equal(result.success, false);
        assert.ok(result.error);
        assert.equal(result.cached, false);
        assert.equal(harness.cached.size, 0);
        assert.equal(harness.closed, harness.opened);
    }
});

function createNetworkHarness(kind, responses) {
    const calls = [];
    const timers = new Map();
    let timerId = 0;
    const request = (urlOrOptions, options, onResponse, protocol) => {
        const plan = responses[calls.length] || {};
        const req = new EventEmitter();
        const call = {
            url: kind === 'electron' ? urlOrOptions.url : urlOrOptions,
            options: kind === 'electron' ? urlOrOptions : options,
            headers: {}, writes: [], protocol, aborted: false,
        };
        calls.push(call);
        req.setHeader = (key, value) => { call.headers[key] = value; };
        req.write = body => call.writes.push(body);
        req.abort = () => { call.aborted = true; };
        req.destroy = error => { call.destroyError = error; req.emit('error', error); };
        req.end = () => queueMicrotask(() => {
            if (plan.error) { req.emit('error', new Error(plan.error)); return; }
            if (plan.timeout) {
                if (kind === 'electron') [...timers.values()][0]();
                else req.emit('timeout');
                return;
            }
            const response = new EventEmitter();
            response.statusCode = plan.status || 200;
            response.headers = plan.headers || {};
            response.setEncoding = encoding => { call.encoding = encoding; };
            if (kind === 'electron') req.emit('response', response);
            else onResponse(response);
            response.emit('data', Buffer.from(plan.body || 'response body'));
            response.emit('end');
        });
        return req;
    };
    const context = {
        URL,
        i18nT: t,
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id),
        net: { request: options => request(options) },
        http: { request: (url, options, callback) => request(url, options, callback, 'http') },
        https: { request: (url, options, callback) => request(url, options, callback, 'https') },
    };
    const name = kind === 'electron' ? 'requestTextWithElectronNet' : 'requestTextGeneric';
    const fetchText = vm.runInNewContext(`${sourceFunction(name)}\n${name}`, context);
    return { fetchText, calls, timers };
}

test('Electron 텍스트 요청은 기존 GET 세션과 새 POST 본문을 유지한다', async () => {
    const harness = createNetworkHarness('electron', [{}, {}]);
    assert.equal(await harness.fetchText('https://example.test/page', { Referer: 'https://example.test/' }), 'response body');
    assert.equal(harness.calls[0].options.method, 'GET');
    assert.equal(harness.calls[0].options.useSessionCookies, true);
    assert.equal(harness.calls[0].headers.Referer, 'https://example.test/');
    assert.deepEqual(harness.calls[0].writes, []);
    await harness.fetchText('https://example.test/api', { 'Content-Type': 'application/x-www-form-urlencoded' }, 1000, {
        method: 'POST', body: 'keyword1=%EB%82%98',
    });
    assert.equal(harness.calls[1].options.method, 'POST');
    assert.deepEqual(harness.calls[1].writes, ['keyword1=%EB%82%98']);
    assert.equal(harness.timers.size, 0);
});

test('Electron 텍스트 요청의 HTTP 오류·연결 오류·시간 초과를 거부한다', async () => {
    for (const [plan, error] of [
        [{ status: 503 }, /HTTP 503/],
        [{ error: 'connection failed' }, /connection failed/],
        [{ timeout: true }, /.+/],
    ]) {
        const harness = createNetworkHarness('electron', [plan]);
        await assert.rejects(harness.fetchText('https://example.test/'), error);
        if (plan.timeout) assert.equal(harness.calls[0].aborted, true);
        else assert.equal(harness.timers.size, 0);
    }
});

test('일반 텍스트 요청은 GET 기본값과 POST 본문을 HTTP와 HTTPS에 전달한다', async () => {
    const harness = createNetworkHarness('generic', [{}, {}]);
    await harness.fetchText('http://example.test/page', { Referer: 'http://example.test/' }, 7000);
    assert.equal(harness.calls[0].protocol, 'http');
    assert.equal(harness.calls[0].options.method, 'GET');
    assert.equal(harness.calls[0].options.timeout, 7000);
    assert.equal(harness.calls[0].options.headers.Referer, 'http://example.test/');
    assert.deepEqual(harness.calls[0].writes, []);
    await harness.fetchText('https://example.test/api', {}, 8000, 3, { method: 'POST', body: 'keyword1=test' });
    assert.equal(harness.calls[1].protocol, 'https');
    assert.equal(harness.calls[1].options.method, 'POST');
    assert.deepEqual(harness.calls[1].writes, ['keyword1=test']);
});

test('일반 POST 리다이렉트는 307 본문을 보존하고 303은 GET으로 전환한다', async () => {
    for (const status of [307, 303]) {
        const harness = createNetworkHarness('generic', [{ status, headers: { location: '/next' } }, {}]);
        assert.equal(await harness.fetchText('https://example.test/api', {}, 1000, 3, {
            method: 'POST', body: 'keyword1=test',
        }), 'response body');
        assert.equal(harness.calls[1].url, 'https://example.test/next');
        assert.equal(harness.calls[1].options.method, status === 307 ? 'POST' : 'GET');
        assert.deepEqual(harness.calls[1].writes, status === 307 ? ['keyword1=test'] : []);
    }
});

test('일반 텍스트 요청의 HTTP 오류·연결 오류·시간 초과를 거부한다', async () => {
    for (const [plan, error] of [
        [{ status: 500 }, /HTTP 500/],
        [{ error: 'connection failed' }, /connection failed/],
        [{ timeout: true }, /.+/],
    ]) {
        const harness = createNetworkHarness('generic', [plan]);
        await assert.rejects(harness.fetchText('https://example.test/'), error);
        if (plan.timeout) assert.ok(harness.calls[0].destroyError);
    }
});

test('한국웹툰은 Electron 성공 응답을 쓰고 실패할 때 같은 POST를 일반 요청으로 재시도한다', async () => {
    for (const primaryFails of [false, true]) {
        const calls = [];
        const fetchText = vm.runInNewContext(`${sourceFunction('requestKmasText')}\nrequestKmasText`, {
            requestTextWithElectronNet: async (...args) => {
                calls.push({ kind: 'electron', args });
                if (primaryFails) throw new Error('electron failure');
                return 'primary response';
            },
            requestTextGeneric: async (...args) => { calls.push({ kind: 'generic', args }); return 'fallback response'; },
        });
        const headers = { Referer: 'https://www.kmas.or.kr/' };
        const options = { method: 'POST', body: 'keyword1=test' };
        const result = await fetchText('https://www.kmas.or.kr/search/engin/callDetailApi.ajax', headers, 7000, options);
        assert.equal(result, primaryFails ? 'fallback response' : 'primary response');
        assert.equal(calls.length, primaryFails ? 2 : 1);
        assert.deepEqual(calls[0].args.slice(1), [headers, 7000, options]);
        if (primaryFails) assert.deepEqual(calls[1].args.slice(1), [headers, 7000, 3, options]);
    }
});
