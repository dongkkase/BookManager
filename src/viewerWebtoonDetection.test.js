import assert from 'node:assert/strict';
import test from 'node:test';

import * as detection from './viewerWebtoonDetection.js';

const { classifyWebtoon, createWebtoonDetectionSession, getWebtoonSampleIndices } = detection;
const MiB = 1024 * 1024;
const tick = () => new Promise(resolve => setImmediate(resolve));

function edge(seed) {
    let state = seed + 1;
    return Array.from({ length: 192 }, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state >>> 24;
    });
}

function samples(count, overrides = {}) {
    return getWebtoonSampleIndices(count).map(index => ({
        index, name: `${String(index).padStart(5, '0')}.jpg`,
        width: 800, height: 1000, encodedBytes: 90 * 1024,
        top: edge(index), bottom: edge(index + 1), ...overrides,
    }));
}

test('archive size takes priority at an average of at most 128 KiB regardless of page count', () => {
    for (const [count, bytes] of [[1, 1024], [15, 15 * 120 * 1024], [19, 19 * 128 * 1024], [20, 20 * 128 * 1024], [96, 8_942_710], [156, 15_725_305]]) {
        assert.equal(detection.isWebtoonByArchiveSize(count, bytes), true);
    }
    for (const [count, bytes] of [
        [19, 19 * 128 * 1024 + 1], [20, 20 * 128 * 1024 + 1], [156, 33_931_008],
        [0, 1], [20.5, 100], [NaN, 100], [Infinity, 100],
        [20, null], [20, undefined], [20, 0], [20, 19], [20, -1], [20, NaN], [20, Infinity],
        [20, 100.5], [20, Number.MAX_SAFE_INTEGER + 1],
    ]) assert.equal(detection.isWebtoonByArchiveSize(count, bytes), false);
});

function variableRatioEpisode() {
    return samples(36, { width: 690, height: 1600, top: undefined, bottom: undefined }).map(page => ({
        ...page,
        height: ({ 14: 1149, 22: 1525, 34: 936, 35: 1200 })[page.index] ?? page.height,
        width: page.index === 35 ? 1200 : page.width,
    }));
}

test('archives between 128 and 200 KiB per image can use varying body ratios without seam pixels', () => {
    const episode = variableRatioEpisode();
    for (const bytes of [36 * 128 * 1024 + 1, 5_225_763, 36 * 200 * 1024]) {
        assert.equal(detection.isWebtoonByArchiveRatios(36, bytes, episode), true);
    }
    for (const bytes of [36 * 128 * 1024, 36 * 200 * 1024 + 1, null, undefined, 0, -1, NaN, Infinity, 1.5]) {
        assert.equal(detection.isWebtoonByArchiveRatios(36, bytes, episode), false);
    }
    assert.equal(detection.isWebtoonByArchiveRatios(19, 19 * 150 * 1024, samples(19)), false);
});

test('ratio classification uses sufficient body samples without requiring twenty archive pages', () => {
    const heights = [837, 1836, 1187, 1104, 1919, 1920, 1878, 846, 1212, 1804, 1830, 1848, 924, 1242, 1200];
    const episode = samples(15, { width: 690, top: undefined, bottom: undefined }).map(page => ({
        ...page,
        width: page.index === 14 ? 1200 : 690,
        height: heights[page.index],
    }));
    assert.equal(detection.isWebtoonByArchiveRatios(15, 2_031_309, episode), true);
    assert.equal(detection.isWebtoonByArchiveRatios(15, 15 * 200 * 1024, episode), true);
    assert.equal(detection.isWebtoonByArchiveRatios(15, 15 * 200 * 1024 + 1, episode), false);
    assert.equal(detection.isWebtoonByArchiveRatios(8, 8 * 150 * 1024, samples(8, { height: 2000 })), false);
    assert.equal(detection.isWebtoonByArchiveRatios(0, 100, []), false);
});

test('uniform comic ratios, resolution changes and minor crop differences do not imply webtoons', () => {
    const ordinary = samples(36, { width: 800, height: 1200, top: undefined, bottom: undefined });
    for (const pages of [
        ordinary,
        ordinary.map((page, index) => ({ ...page, width: page.width * (index % 2 + 1), height: page.height * (index % 2 + 1) })),
        ordinary.map((page, index) => ({ ...page, height: 1200 + (index % 2 ? 60 : -60) })),
        ordinary.map(page => [14, 34].includes(page.index) ? { ...page, width: 1600 } : page),
        ordinary.map(page => page.index === 35 ? { ...page, width: 1200, height: 1200 } : page),
    ]) assert.equal(detection.isWebtoonByArchiveRatios(36, 36 * 150 * 1024, pages), false);
});

test('ratio variation needs two meaningful changes even within the same sampled region', () => {
    const ordinary = samples(36, { width: 800, height: 1200 });
    const changing = (indices, height) => ordinary.map(page => indices.includes(page.index) ? { ...page, height } : page);
    const classify = pages => detection.isWebtoonByArchiveRatios(36, 36 * 150 * 1024, pages);
    assert.equal(classify(changing([14], 900)), false);
    assert.equal(classify(changing([12, 14], 900)), true);
    assert.equal(classify(changing([14, 34], 1021)), false);
    assert.equal(classify(changing([14, 34], 1020)), true);
    assert.equal(classify(changing([14, 34], 1380)), true);
});

test('a seventeen-page episode keeps ratio evidence concentrated in one sampled group', () => {
    const heights = [837, 2252, 1972, 2000, 1346, 2156, 1892, 2312, 1534, 2180, 2508, 1728, 1551, 2248, 2216, 540, 1200];
    const episode = samples(17, { top: undefined, bottom: undefined }).map(page => ({
        ...page,
        width: page.index === 16 ? 1200 : 690,
        height: heights[page.index],
    }));
    assert.equal(detection.isWebtoonByArchiveRatios(17, 2_698_957, episode), true);
    assert.equal(detection.isWebtoonByArchiveRatios(17, 17 * 200 * 1024 + 1, episode), false);
});

test('ratio fallback ignores a short final remainder and requires complete valid measurements', () => {
    const episode = variableRatioEpisode().map(page => ({ ...page, width: page.index === 35 ? 1200 : 1000 }));
    const classify = pages => detection.isWebtoonByArchiveRatios(36, 36 * 150 * 1024, pages);
    assert.equal(classify(episode.map(page => page.index === 34 ? { ...page, height: 1600 } : page)), false);
    assert.equal(classify(samples(36, { width: 1000, height: 1600 }).map(page => ({
        ...page,
        height: page.index === 14 ? 1149 : page.index === 35 ? 100 : page.height,
    }))), false);
    for (const invalid of [null, [], episode.slice(1), [...episode].reverse(), episode.map(page => ({ ...page, width: 0 }))]) {
        assert.equal(classify(invalid), false);
    }
});

test('moderate archive averages recognize consistent tall cuts without ratio variation or filenames', () => {
    const episode = samples(27, { width: 690, height: 1600, top: undefined, bottom: undefined }).map(page => ({
        ...page,
        width: page.index === 26 ? 1200 : 690,
        height: page.index === 26 ? 1200 : page.index === 25 ? 817 : 1600,
    }));
    for (const bytes of [27 * 128 * 1024 + 1, 3_846_930, 27 * 200 * 1024]) {
        assert.equal(detection.isWebtoonByArchiveRatios(27, bytes, episode), true);
    }
    assert.equal(detection.isWebtoonByArchiveRatios(27, 27 * 200 * 1024 + 1, episode), false);
    assert.equal(detection.isWebtoonByArchiveRatios(8, 8 * 150 * 1024, samples(8, { height: 1600 })), false);
    assert.equal(detection.isWebtoonByArchiveRatios(9, 9 * 150 * 1024, samples(9, { height: 1600 })), true);
    for (const height of [1200, 1599, 1600]) {
        assert.equal(detection.isWebtoonByArchiveRatios(27, 3_846_930, samples(27, { width: 800, height })), height === 1600);
    }
    for (const shortCount of [1, 2]) {
        const pages = samples(11, { width: 800, height: 1600 }).map((page, index) => ({
            ...page, height: index < shortCount ? 800 : 1600,
            width: index < shortCount ? 1600 : 800,
        }));
        assert.equal(detection.isWebtoonByArchiveRatios(11, 11 * 150 * 1024, pages), shortCount === 1);
    }
});

test('samples skip the cover and stay bounded across short episodes and very large collections', () => {
    assert.deepEqual(getWebtoonSampleIndices(1), [0]);
    for (const count of [2, 9, 13, 14, 100, 200, 3340, 1_000_000]) {
        const indices = getWebtoonSampleIndices(count);
        assert.equal(new Set(indices).size, indices.length);
        assert.ok(indices.length <= 12);
        assert.equal(indices[0], 1);
        assert.equal(indices.at(-1), count - 1);
        assert.ok(indices.every(index => Number.isInteger(index) && index > 0 && index < count));
    }
    for (const count of [0, -1, NaN, Infinity, 1.2]) assert.deepEqual(getWebtoonSampleIndices(count), []);
});

test('very tall episodes are recognized without filenames, file-count or archive-size assumptions', () => {
    for (const count of [1, 2, 3, 100, 200, 3340]) {
        assert.equal(classifyWebtoon(count, samples(count, { height: 4000, top: undefined, bottom: undefined }), '001.zip'), 'scroll');
    }
    assert.equal(classifyWebtoon(1, samples(1, { height: 2500 }), 'ch001.zip'), 'paged');
    assert.equal(classifyWebtoon(200, samples(200, { height: 2700 }), '0001.zip'), 'scroll');
});

test('ordinary pages, mixed layouts and missing or invalid measurements stay paged even with chapter hints', () => {
    const ordinary = samples(200, { top: undefined, bottom: undefined });
    assert.equal(classifyWebtoon(200, ordinary, '1화 ch001 c001.zip'), 'paged');
    const tall = samples(200, { height: 4000 });
    for (const changed of [tall.slice(1), [...tall].reverse(), tall.map((page, index) => ({
        ...page, width: index % 2 ? 1600 : 800,
    })), tall.map(page => ({ ...page, width: NaN })), tall.map(page => ({ ...page, encodedBytes: 0 }))]) {
        assert.equal(classifyWebtoon(200, changed, '1화.zip'), 'paged');
    }
    assert.equal(classifyWebtoon(2, samples(2, { height: 3199 }), '1화.zip'), 'paged');
});

test('sliced numeric episodes and compilations require many distinct continuous drawings across the book', () => {
    for (const count of [9, 100, 200, 3340]) {
        assert.equal(classifyWebtoon(count, samples(count), '001.zip'), 'scroll');
    }
    const lossy = samples(200).map(page => ({ ...page, top: page.top.map(value => Math.min(255, value + 4)) }));
    assert.equal(classifyWebtoon(200, lossy, 'chapter 12.zip'), 'scroll');
    assert.equal(classifyWebtoon(7, samples(7), '1화.zip'), 'paged');
});

test('chapter names and small images only lower the required number of actual seams', () => {
    const sparse = samples(200, { encodedBytes: MiB });
    for (const page of sparse) {
        if (![1, 2, 197, 198].includes(page.index)) page.bottom = Array(192).fill(255);
    }
    assert.equal(classifyWebtoon(200, sparse, 'ch 12.zip'), 'scroll');
    assert.equal(classifyWebtoon(200, sparse, '001.zip'), 'paged');
    assert.equal(classifyWebtoon(200, sparse, 'vol 12 ch 12.zip'), 'paged');
    assert.equal(classifyWebtoon(200, sparse.map(page => ({ ...page, encodedBytes: 90 * 1024 })), '001.zip'), 'scroll');
    assert.equal(classifyWebtoon(200, samples(200, { encodedBytes: MiB }), 'vol 12.zip'), 'scroll');
});

test('blank gutters, identical or alternating decorations and unrelated drawings never count as evidence', () => {
    for (const flat of [0, 240, 255]) {
        assert.equal(classifyWebtoon(200, samples(200, { top: Array(192).fill(flat), bottom: Array(192).fill(flat) }), '1화.zip'), 'paged');
    }
    assert.equal(classifyWebtoon(200, samples(200, { top: edge(1), bottom: edge(1) }), '1화.zip'), 'paged');
    assert.equal(classifyWebtoon(200, samples(200).map(page => ({
        ...page, top: edge(page.index % 2), bottom: edge((page.index + 1) % 2),
    })), '1화.zip'), 'paged');
    assert.equal(classifyWebtoon(200, samples(200).map(page => ({ ...page, bottom: edge(page.index + 1000) })), '1화.zip'), 'paged');
});

test('continuity confined to one region, inconsistent widths and excessively thin slices stay paged', () => {
    const region = samples(200).map(page => page.index < 20 ? page : { ...page, bottom: undefined });
    assert.equal(classifyWebtoon(200, region, '1화.zip'), 'paged');
    assert.equal(classifyWebtoon(200, samples(200).map((page, index) => ({ ...page, width: index % 2 ? 850 : 800 })), '1화.zip'), 'paged');
    assert.equal(classifyWebtoon(200, samples(200, { height: 150 }), '1화.zip'), 'paged');
});

function middleTripletEpisode() {
    return samples(96, { width: 1080 }).map(page => ({
        ...page,
        height: page.index % 2 ? 1234 : 1176,
        top: [33, 34, 63, 64].includes(page.index) ? edge(page.index) : Array(192).fill(255),
        bottom: [32, 33, 62, 63].includes(page.index) ? edge(page.index + 1) : Array(192).fill(255),
    }));
}

test('middle sample triplets remain separate regions even when both lie in the middle third', () => {
    const pages = middleTripletEpisode();
    assert.deepEqual(getWebtoonSampleIndices(96), [1, 2, 3, 32, 33, 34, 62, 63, 64, 93, 94, 95]);
    assert.equal(classifyWebtoon(96, pages, '001화.zip'), 'scroll');
    const oneTriplet = pages.map(page => page.index >= 62 ? { ...page, bottom: undefined } : page);
    assert.equal(classifyWebtoon(96, oneTriplet, '001화.zip'), 'paged');
});

test('a short final remainder does not veto continuous portrait slices or contribute evidence', () => {
    const pages = middleTripletEpisode();
    pages.at(-1).height = 157;
    assert.equal(classifyWebtoon(96, pages, '001화.zip'), 'scroll');
    for (const changed of [
        pages.map(page => ({ ...page, top: Array(192).fill(255), bottom: Array(192).fill(255) })),
        pages.map(page => ({ ...page, bottom: edge(page.index + 2000) })),
        pages.map(page => page.index === 34 ? { ...page, height: 157 } : page),
        pages.map(page => page.index === 95 ? { ...page, width: 1113 } : page),
        pages.map(page => page.index >= 62 ? { ...page, bottom: undefined } : page),
    ]) assert.equal(classifyWebtoon(96, changed, '001화.zip'), 'paged');
});

function slicedEpisode() {
    const pages = samples(51, { width: 690, height: 1600 });
    // Independent synthetic edges model three connected cuts, blank gaps and one different cut.
    for (const page of pages) {
        if ([1, 33, 48].includes(page.index)) {
            const next = pages.find(candidate => candidate.index === page.index + 1);
            next.top = page.bottom.map(value => Math.min(255, value + (page.index === 1 ? 2 : 18)));
        } else {
            page.bottom = [2, 17, 32].includes(page.index) ? Array(192).fill(255) : edge(page.index + 2000);
        }
    }
    Object.assign(pages.at(-1), { width: 1200, height: 1200, encodedBytes: 522525 });
    pages.at(-2).height = 1491;
    return pages;
}

test('regular tall episode slices retain multiple real seams despite blank cuts and a final square end card', () => {
    const pages = slicedEpisode();
    assert.equal(classifyWebtoon(51, pages, '0001 - 1화.zip'), 'scroll');
    assert.equal(classifyWebtoon(51, pages, '001.zip'), 'paged', 'numeric names require more independent seams');
    assert.equal(classifyWebtoon(51, pages, '1권.zip'), 'paged');
});

test('Korean chapter and volume hints handle composed and decomposed archive and entry names equally', () => {
    for (const normalization of ['NFC', 'NFD']) {
        const episode = slicedEpisode();
        assert.equal(classifyWebtoon(51, episode, '0309 - 306화.zip'.normalize(normalization)), 'scroll');
        assert.equal(classifyWebtoon(51, episode, '306화 1권.zip'.normalize(normalization)), 'paged');
        assert.equal(classifyWebtoon(51, episode.map(page => ({ ...page, name: `306화/${page.name}`.normalize(normalization) })), '0309.zip'), 'scroll');
        assert.equal(classifyWebtoon(51, episode.map(page => ({ ...page, name: `1권/${page.name}`.normalize(normalization) })), '306화.zip'), 'paged');
    }
});

test('tall slice evidence cannot be replaced by chapter names, small files or white margins', () => {
    for (const change of [
        page => ({ ...page, top: Array(192).fill(255), bottom: Array(192).fill(255) }),
        page => ({ ...page, bottom: edge(page.index + 5000) }),
        page => ({ ...page, height: page.index % 2 ? 1200 : 1600 }),
        page => ({ ...page, encodedBytes: MiB }),
        page => ({ ...page, height: page.width * 1.45 }),
    ]) assert.equal(classifyWebtoon(51, slicedEpisode().map(change), '1화.zip'), 'paged');
    const interiorOutlier = slicedEpisode();
    interiorOutlier[4].width = 1200;
    assert.equal(classifyWebtoon(51, interiorOutlier, '1화.zip'), 'paged');
});

test('a single final square card does not veto otherwise consistently very tall chapters', () => {
    const pages = samples(51, { height: 4000 });
    Object.assign(pages.at(-1), { width: 1200, height: 1200 });
    assert.equal(classifyWebtoon(51, pages, '001.zip'), 'scroll');
    assert.equal(classifyWebtoon(2, [pages.at(-1)], '1화.zip'), 'paged');
});

function portraitSlicedEpisode() {
    const pages = samples(156, { width: 720, height: 1040 });
    for (const page of pages) {
        if ([2, 52, 53].includes(page.index)) {
            const next = pages.find(candidate => candidate.index === page.index + 1);
            const difference = page.index === 2 ? 1 : page.index === 52 ? 8 : 18;
            next.top = page.bottom.map(value => Math.min(255, value + difference));
        } else {
            page.bottom = Array(192).fill(255);
        }
    }
    pages.at(-1).height = 376;
    return pages;
}

test('portrait slices with blank cuts and a short final slice retain continuous drawings across regions', () => {
    for (const name of ['작품 1화.zip', 'chapter 1.zip']) {
        assert.equal(classifyWebtoon(156, portraitSlicedEpisode(), name), 'scroll');
    }
    assert.equal(classifyWebtoon(156, portraitSlicedEpisode(), '001.zip'), 'paged');
    assert.equal(classifyWebtoon(156, portraitSlicedEpisode(), '1권 1화.zip'), 'paged');
    const numericEpisode = portraitSlicedEpisode();
    numericEpisode.find(page => page.index === 102).bottom = edge(103);
    numericEpisode.find(page => page.index === 103).top = edge(103).map(value => Math.min(255, value + 18));
    assert.equal(classifyWebtoon(156, numericEpisode, '001.zip'), 'scroll');
});

test('portrait slice fallback rejects contradictory cuts, sparse strong evidence and irregular heights', () => {
    const contradictory = portraitSlicedEpisode();
    contradictory.find(page => page.index === 102).bottom = edge(2000);
    assert.equal(classifyWebtoon(156, contradictory, '1화.zip'), 'paged');

    const oneStrongRegion = portraitSlicedEpisode();
    oneStrongRegion.find(page => page.index === 3).top = edge(3).map(value => Math.min(255, value + 18));
    oneStrongRegion.find(page => page.index === 54).top = edge(54);
    assert.equal(classifyWebtoon(156, oneStrongRegion, '1화.zip'), 'paged');

    const oneStrongCut = portraitSlicedEpisode();
    oneStrongCut.find(page => page.index === 53).top = edge(53).map(value => Math.min(255, value + 18));
    assert.equal(classifyWebtoon(156, oneStrongCut, '1화.zip'), 'paged');

    const irregular = portraitSlicedEpisode();
    irregular[4].height = 850;
    assert.equal(classifyWebtoon(156, irregular, '1화.zip'), 'paged');
});

test('a successful webtoon decision runs once and retains its result', async () => {
    const session = createWebtoonDetectionSession();
    let calls = 0;
    const probe = async () => { calls += 1; return 'scroll'; };
    const pending = session.detect(probe);
    assert.equal(session.detect(probe), pending);
    assert.equal(await pending, 'scroll');
    assert.equal(await session.detect(probe), 'scroll');
    assert.equal(calls, 1);
    session.dispose();
});

test('ambiguous results retain paged mode and are never reconsidered during the session', async () => {
    const session = createWebtoonDetectionSession();
    assert.equal(await session.detect(async () => 'paged'), 'paged');
    assert.equal(await session.detect(async () => 'scroll'), 'paged');
    const nextBook = createWebtoonDetectionSession();
    assert.equal(await nextBook.detect(async () => 'scroll'), 'scroll');
});

test('timeout, failure and disposal settle paged once and discard late results', async () => {
    const timed = createWebtoonDetectionSession(10);
    let finish;
    let cancelled;
    const pending = timed.detect(signal => { cancelled = signal; return new Promise(resolve => { finish = resolve; }); });
    assert.equal(await pending, 'paged');
    assert.equal(cancelled(), true);
    finish('scroll');
    assert.equal(await timed.detect(async () => 'scroll'), 'paged');
    const failed = createWebtoonDetectionSession();
    assert.equal(await failed.detect(async () => { throw new Error('broken image'); }), 'paged');
    assert.equal(await failed.detect(async () => 'scroll'), 'paged');
    const disposed = createWebtoonDetectionSession();
    const stopped = disposed.detect(async () => new Promise(() => {}));
    disposed.dispose();
    assert.equal(await stopped, 'paged');
    const neverStarted = createWebtoonDetectionSession();
    neverStarted.dispose();
    assert.equal(await neverStarted.detect(async () => assert.fail('disposed probe ran')), 'paged');
});
