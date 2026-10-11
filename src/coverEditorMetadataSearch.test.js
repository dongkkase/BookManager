import assert from 'node:assert/strict';
import test from 'node:test';
import {
    coverEditorMetadataCoverUrl,
    coverEditorMetadataThumbnail,
    searchCoverEditorMetadata,
    upgradeCoverEditorMetadataThumbnails,
} from './coverEditorMetadataSearch.js';
import { enabledMetadataApiSourcesForBookType, UNIFIED_METADATA_API_SOURCE } from './metadataApiPolicy.js';
import { metadataSearchResultKey } from './metadataSearch.js';

const options = { query: '작품', page: 1, bookType: 'book', apiKeys: {} };
const allKeys = { yes24: 'test', aladin: 'test', google: 'test', vine: 'test' };
const cover = id => ({ id, title: '작품', coverUrl: `https://example.test/${id}.jpg` });
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test('표지 검색은 통합검색의 책 유형과 API 키 설정을 그대로 사용한다', async () => {
    for (const bookType of ['comic', 'book', 'pdf', 'audio']) {
        for (const apiKeys of [{}, allKeys]) {
            const calls = [];
            const result = await searchCoverEditorMetadata({ ...options, bookType, apiKeys, page: 3 }, async request => {
                calls.push(request);
                return { success: true, results: [cover(1)], cached: true };
            });
            const providers = enabledMetadataApiSourcesForBookType(bookType, apiKeys).map(source => source.value);
            assert.deepEqual(calls.map(request => request.apiSource), providers);
            assert.ok(calls.every(request => request.query === '작품' && request.bookType === bookType && request.page === 3));
            assert.equal(result.api, UNIFIED_METADATA_API_SOURCE);
            assert.equal(result.cached, true);
            assert.equal(result.results.length, providers.length);
        }
    }
});

test('선택한 API만 검색하고 표지 필터링 후에도 페이지 정보를 유지한다', async () => {
    const calls = [];
    const response = await searchCoverEditorMetadata({ ...options, apiSource: 'Google Books', apiKeys: allKeys, page: 3 }, async request => {
        calls.push(request);
        return {
            success: true,
            cached: true,
            results: [cover(1), cover(1), ...Array.from({ length: 18 }, (_, id) => ({ id: id + 2, title: '표지 없음' }))],
        };
    });
    assert.deepEqual(calls, [{ ...options, apiSource: 'Google Books', apiKeys: allKeys, page: 3 }]);
    assert.equal(response.api, 'Google Books');
    assert.equal(response.success, true);
    assert.equal(response.cached, true);
    assert.equal(response.hasNext, true);
    assert.deepEqual(response.results, [{ ...cover(1), apiSource: 'Google Books' }]);
});

test('알 수 없거나 책 종류에서 지원하지 않는 API는 통합검색으로 처리한다', async () => {
    for (const [apiSource, bookType] of [['없는 제공자', 'comic'], ['Anilist', 'book'], ['Amazon', 'comic']]) {
        const calls = [];
        const response = await searchCoverEditorMetadata({ ...options, apiSource, bookType }, async request => {
            calls.push(request.apiSource);
            return { success: true, results: [] };
        });
        assert.equal(response.api, UNIFIED_METADATA_API_SOURCE);
        assert.deepEqual(calls, enabledMetadataApiSourcesForBookType(bookType, options.apiKeys).map(source => source.value));
    }
});

test('표지 검색도 기존 통합검색의 최대 세 제공자 동시 실행 제한을 유지한다', async () => {
    const sources = enabledMetadataApiSourcesForBookType('comic', allKeys).map(source => source.value);
    const gates = new Map(sources.map(source => [source, deferred()]));
    const started = [];
    let active = 0;
    let peak = 0;
    const pending = searchCoverEditorMetadata({ ...options, bookType: 'comic', apiKeys: allKeys }, async request => {
        started.push(request.apiSource);
        active += 1;
        peak = Math.max(peak, active);
        await gates.get(request.apiSource).promise;
        active -= 1;
        return { success: true, results: [cover(1)] };
    });
    assert.equal(started.length, 3);
    gates.get(started[1]).resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, 4);
    assert.equal(active, 3);
    for (const gate of gates.values()) gate.resolve();
    const response = await pending;
    assert.equal(peak, 3);
    assert.deepEqual(response.results.map(result => result.apiSource), sources);
});

test('일부 제공자 실패 시 정상 표지와 원래 제목·저자·메타데이터를 유지한다', async () => {
    const metadata = { Title: '작품', Writer: '원래 저자' };
    const original = { ...cover(3), author: '원래 저자', metadata, custom: '보존' };
    const response = await searchCoverEditorMetadata(options, async request => {
        if (request.apiSource === '리디북스') throw new Error('unavailable');
        return { success: true, results: request.apiSource === '문피아' ? [original] : [] };
    });
    assert.equal(response.success, true);
    assert.deepEqual(response.failures, [{ apiSource: '리디북스', error: 'unavailable' }]);
    assert.deepEqual(response.results, [{ ...original, apiSource: '문피아' }]);
    assert.equal(response.results[0].metadata, metadata);
    assert.equal(original.apiSource, undefined);
    const failed = await searchCoverEditorMetadata(options, async () => ({ success: false, error: 'offline' }));
    assert.equal(failed.code, 'ALL_APIS_FAILED');
    assert.equal(failed.success, false);
    assert.deepEqual(failed.results, []);
});

test('표지 없는 결과를 걸러도 원래 다음 페이지 정보는 유지한다', async () => {
    const response = await searchCoverEditorMetadata(options, async () => ({
        success: true, results: Array.from({ length: 20 }, (_, id) => ({ id, title: '표지 없음' })),
    }));
    assert.deepEqual(response.results, []);
    assert.equal(response.success, true);
    assert.equal(response.hasNext, true);
    const cachedOnly = await searchCoverEditorMetadata(options, async request => ({
        success: true,
        results: request.apiSource === '문피아' ? [
            { id: 1, coverCacheUrl: 'bookmanager-thumbnail://api-cover/a.jpg' },
            { id: 2, metadata: { coverDataUrl: 'data:image/png;base64,image' } },
            { id: 3, coverUrl: '   ', CoverUrl: '' },
        ] : [],
    }));
    assert.deepEqual(cachedOnly.results.map(result => result.id), [1, 2]);
});

test('같은 제공자의 같은 결과만 제거하고 다른 제공자의 같은 ID는 유지한다', async () => {
    const response = await searchCoverEditorMetadata(options, async request => ({
        success: true,
        results: request.apiSource === 'Amazon' ? [] : [
            cover(0), { ...cover(0), coverUrl: 'https://example.test/duplicate.jpg' },
            { title: '작품', author: '저자', coverUrl: 'https://example.test/no-id.jpg' },
            { title: '작품', author: '저자', coverUrl: 'https://example.test/no-id-duplicate.jpg' },
        ],
    }));
    assert.equal(response.results.length, 4);
    assert.deepEqual(response.results.map(result => [result.apiSource, result.id]), [
        ['리디북스', 0], ['리디북스', undefined], ['문피아', 0], ['문피아', undefined],
    ]);
    assert.equal(response.results[0].coverUrl, 'https://example.test/0.jpg');
});

test('목록 썸네일은 캐시·data URL·원격 URL 순으로 사용한다', () => {
    const result = {
        coverCacheUrl: 'bookmanager-thumbnail://api-cover/local.jpg',
        coverDataUrl: 'data:image/png;base64,data', coverUrl: 'https://example.test/cover.jpg',
    };
    assert.equal(coverEditorMetadataThumbnail(result), result.coverCacheUrl);
    assert.equal(coverEditorMetadataThumbnail({ ...result, coverCacheUrl: '' }), result.coverDataUrl);
    assert.equal(coverEditorMetadataThumbnail({ coverUrl: result.coverUrl }), result.coverUrl);
    assert.equal(coverEditorMetadataThumbnail({ CoverUrl: result.coverUrl }), result.coverUrl);
    assert.equal(coverEditorMetadataThumbnail({ metadata: result }), result.coverCacheUrl);
    assert.equal(coverEditorMetadataThumbnail({ coverUrl: result.coverUrl, metadata: { coverCacheUrl: result.coverCacheUrl } }), result.coverCacheUrl);
    assert.equal(coverEditorMetadataThumbnail({ coverUrl: false, coverCacheUrl: 42 }), '');
});

test('리디 결과는 원본 표지를 고르고 다른 제공자의 원본 URL은 바꾸지 않는다', () => {
    const expected = 'https://img.ridicdn.net/cover/42/xxlarge?dpi=xxhdpi#1';
    for (const fields of [
        { id: 42 }, { b_id: 42 }, { metadata: { id: 42 } },
        { Web: 'https://ridibooks.com/books/42' },
        { metadata: { Web: 'https://ridibooks.com/books/42' } },
        { coverUrl: 'https://img.ridicdn.net/cover/42/small' },
    ]) assert.equal(coverEditorMetadataCoverUrl({ ...fields, apiSource: '리디북스' }), expected);
    const remote = 'https://example.test/original.jpg';
    assert.equal(coverEditorMetadataCoverUrl({ apiSource: '문피아', id: 42, coverUrl: remote }), remote);
    assert.equal(coverEditorMetadataCoverUrl({ coverUrl: remote, coverCacheUrl: 'bookmanager-thumbnail://api-cover/small.jpg' }), remote);
    assert.equal(coverEditorMetadataCoverUrl({ metadata: { CoverUrl: remote } }), remote);
    assert.equal(coverEditorMetadataCoverUrl({ metadata: { coverDataUrl: 'data:image/png;base64,image' } }), 'data:image/png;base64,image');
    assert.equal(coverEditorMetadataCoverUrl({}), '');
});

test('검색 취소는 후속 제공자를 시작하지 않고 늦은 결과를 반환하지 않는다', async () => {
    let calls = 0;
    assert.equal((await searchCoverEditorMetadata(options, () => { calls += 1; }, {
        isCancelled: () => true,
    })).cancelled, true);
    assert.equal(calls, 0);
    const gate = deferred();
    let cancelled = false;
    const pending = searchCoverEditorMetadata({ ...options, apiKeys: allKeys }, async () => {
        calls += 1;
        await gate.promise;
        return { success: true, results: [cover(1)] };
    }, { isCancelled: () => cancelled });
    assert.equal(calls, 3);
    cancelled = true;
    gate.resolve();
    const response = await pending;
    assert.equal(calls, 3);
    assert.equal(response.cancelled, true);
    assert.deepEqual(response.results, []);
});

test('개별 API 검색도 취소 후 도착한 표지를 반환하지 않는다', async () => {
    const gate = deferred();
    let cancelled = false;
    const pending = searchCoverEditorMetadata({ ...options, apiSource: '문피아' }, async () => {
        await gate.promise;
        return { success: true, results: [cover(1)] };
    }, { isCancelled: () => cancelled });
    cancelled = true;
    gate.resolve();
    const response = await pending;
    assert.equal(response.cancelled, true);
    assert.deepEqual(response.results, []);
});

const ridiCover = id => ({
    id, title: '작품', apiSource: '리디북스',
    coverUrl: `https://img.ridicdn.net/cover/${id}/large`,
    coverCacheUrl: `bookmanager-thumbnail://api-cover/small-${id}.jpg`,
});
const highCover = id => `bookmanager-thumbnail://api-cover/high-${id}.jpg`;
const measuredSize = src => ({ width: src.includes('/high-') ? 1200 : 480, height: src.includes('/high-') ? 1800 : 720 });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('검색 목록은 검증한 고화질 캐시를 우선하고 원래 결과와 표지 선택 주소를 유지한다', async () => {
    const result = Object.freeze({ ...ridiCover(42), metadata: Object.freeze({ Title: '원래 제목' }) });
    const updates = [];
    const calls = [];
    const imageUrl = coverEditorMetadataCoverUrl(result);
    await upgradeCoverEditorMetadataThumbnails([result], async url => {
        calls.push(url);
        return { filePath: '/cache/high-42.jpg', coverCacheUrl: highCover(42) };
    }, { readImageSize: measuredSize, onThumbnail: update => updates.push(update) });
    assert.deepEqual(calls, [imageUrl]);
    assert.deepEqual(updates, [{ resultKey: metadataSearchResultKey(result), imageUrl,
        thumbnail: highCover(42), width: 1200, height: 1800, fallback: result.coverCacheUrl }]);
    assert.equal(coverEditorMetadataThumbnail(result), result.coverCacheUrl);
    const upgraded = { ...result, highQualityCoverCacheUrl: updates[0].thumbnail };
    assert.equal(coverEditorMetadataThumbnail(upgraded), highCover(42));
    assert.equal(coverEditorMetadataCoverUrl(upgraded), imageUrl);
});

test('고화질 썸네일 확인은 최대 세 항목씩 진행한다', async () => {
    const results = Array.from({ length: 7 }, (_, id) => ridiCover(id + 1));
    const gates = new Map(results.map(result => [coverEditorMetadataCoverUrl(result), deferred()]));
    const started = [];
    const updates = [];
    let active = 0;
    let peak = 0;
    const pending = upgradeCoverEditorMetadataThumbnails(results, async url => {
        started.push(url);
        active += 1;
        peak = Math.max(peak, active);
        await gates.get(url).promise;
        active -= 1;
        return { coverCacheUrl: highCover(url.match(/cover\/(\d+)/)[1]) };
    }, { readImageSize: measuredSize, onThumbnail: update => updates.push(update) });
    await tick();
    assert.equal(started.length, 3);
    gates.get(started[1]).resolve();
    await tick();
    assert.equal(started.length, 4);
    assert.equal(active, 3);
    for (const gate of gates.values()) gate.resolve();
    await pending;
    assert.equal(peak, 3);
    assert.equal(updates.length, 7);
});

test('같은 고화질 URL의 다운로드와 이미지 크기 확인을 재사용한다', async () => {
    const results = [ridiCover(42), { ...ridiCover(42), id: 43, b_id: 42 }];
    const calls = [];
    const measured = [];
    const updates = [];
    await upgradeCoverEditorMetadataThumbnails(results, async url => {
        calls.push(url);
        return { coverCacheUrl: highCover(42) };
    }, {
        readImageSize: src => { measured.push(src); return measuredSize(src); },
        onThumbnail: update => updates.push(update),
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(measured, [highCover(42), results[0].coverCacheUrl]);
    assert.deepEqual(updates.map(update => update.resultKey), results.map(result => metadataSearchResultKey(result)));
});

test('이미 원본 주소를 사용하거나 별도 고화질 주소가 없는 결과는 추가로 요청하지 않는다', async () => {
    let calls = 0;
    const high = { ...ridiCover(42), coverUrl: coverEditorMetadataCoverUrl(ridiCover(42)) };
    await upgradeCoverEditorMetadataThumbnails([
        high,
        { ...ridiCover(42), coverUrl: '', metadata: { CoverUrl: high.coverUrl } },
        { ...ridiCover(42), highQualityCoverCacheUrl: highCover(42) },
        { coverDataUrl: 'data:image/png;base64,image' },
        ...['문피아', 'YES24', 'Anilist', '알라딘'].map(apiSource => ({ ...cover(42), apiSource })),
    ], () => { calls += 1; }, { readImageSize: () => { throw new Error('Unexpected image read'); } });
    assert.equal(calls, 0);
});

test('고화질 다운로드 실패·빈 캐시·잘못된 이미지에서도 기존 썸네일을 유지한다', async () => {
    for (const mode of ['download', 'empty', 'invalid', 'decode']) {
        const updates = [];
        await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], async () => {
            if (mode === 'download') throw new Error('offline');
            return { coverCacheUrl: mode === 'empty' ? '' : highCover(42) };
        }, {
            readImageSize: () => {
                if (mode === 'decode') throw new Error('invalid image');
                return { width: 0, height: 1800 };
            },
            onThumbnail: update => updates.push(update),
        });
        assert.deepEqual(updates, [], mode);
    }
});

test('고화질 주소의 실제 크기가 작거나 같으면 교체하지 않는다', async () => {
    for (const size of [{ width: 240, height: 343 }, { width: 480, height: 720 },
        { width: 1200, height: 600 }, { width: 400, height: 1800 }]) {
        const updates = [];
        await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], async () => ({ coverCacheUrl: highCover(42) }), {
            readImageSize: src => src === highCover(42) ? size : measuredSize(src),
            onThumbnail: update => updates.push(update),
        });
        assert.deepEqual(updates, [], JSON.stringify(size));
    }
    const updates = [];
    await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], async () => ({ coverCacheUrl: highCover(42) }), {
        readImageSize: src => src === highCover(42) ? { width: 480, height: 721 } : measuredSize(src),
        onThumbnail: update => updates.push(update),
    });
    assert.equal(updates.length, 1);
});

test('기존 썸네일을 읽지 못해도 유효한 고화질 이미지는 표시한다', async () => {
    const updates = [];
    await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], async () => ({ coverCacheUrl: highCover(42) }), {
        readImageSize: src => {
            if (src !== highCover(42)) throw new Error('missing old thumbnail');
            return measuredSize(src);
        },
        onThumbnail: update => updates.push(update),
    });
    assert.equal(updates.length, 1);
});

test('취소된 검색은 고화질 요청을 시작하지 않는다', async () => {
    let calls = 0;
    await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], () => { calls += 1; }, { isCancelled: () => true });
    assert.equal(calls, 0);
});

test('캐시·고화질·기존 이미지 확인 중 취소하면 늦은 결과와 남은 요청을 무시한다', async () => {
    for (const stage of ['cache', 'high', 'fallback']) {
        const gate = deferred();
        const updates = [];
        const calls = [];
        const measured = [];
        let cancelled = false;
        const pending = upgradeCoverEditorMetadataThumbnails(Array.from({ length: 5 }, (_, id) => ridiCover(id + 1)), async url => {
            calls.push(url);
            if (stage === 'cache') await gate.promise;
            return { coverCacheUrl: highCover(url.match(/cover\/(\d+)/)[1]) };
        }, {
            readImageSize: async src => {
                measured.push(src);
                if ((stage === 'high') === src.includes('/high-')) await gate.promise;
                return measuredSize(src);
            },
            isCancelled: () => cancelled,
            onThumbnail: update => updates.push(update),
        });
        await tick();
        assert.equal(calls.length, 3, stage);
        cancelled = true;
        gate.resolve();
        await pending;
        assert.deepEqual(updates, [], stage);
        assert.equal(calls.length, 3, stage);
        assert.equal(measured.length, stage === 'cache' ? 0 : stage === 'high' ? 3 : 6, stage);
    }
});

test('기본 이미지 크기 확인은 브라우저 이미지의 자연 크기를 읽고 소스를 정리한다', async () => {
    const originalImage = globalThis.Image;
    const loaded = [];
    const released = [];
    globalThis.Image = class {
        set src(value) {
            this.url = value;
            loaded.push(value);
            const { width, height } = measuredSize(value);
            this.naturalWidth = width;
            this.naturalHeight = height;
            queueMicrotask(() => this.onload?.());
        }
        removeAttribute(name) {
            assert.equal(name, 'src');
            released.push(this.url);
        }
    };
    try {
        const updates = [];
        await upgradeCoverEditorMetadataThumbnails([ridiCover(42)], async () => ({ coverCacheUrl: highCover(42) }), {
            onThumbnail: update => updates.push(update),
        });
        assert.equal(updates.length, 1);
        assert.deepEqual(loaded, [highCover(42), ridiCover(42).coverCacheUrl]);
        assert.deepEqual(released, loaded);
    } finally {
        if (originalImage === undefined) delete globalThis.Image;
        else globalThis.Image = originalImage;
    }
});
