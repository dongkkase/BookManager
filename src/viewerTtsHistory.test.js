import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createViewerTtsRequests } from './viewerTtsRequests.js';

const source = readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

function section(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source section: ${start}`);
    return source.slice(startIndex, endIndex);
}

function statementAt(index) {
    let depth = 0;
    let quote = '';
    for (let cursor = index; cursor < source.length; cursor += 1) {
        const character = source[cursor];
        if (quote) {
            if (character === '\\') cursor += 1;
            else if (character === quote) quote = '';
            continue;
        }
        if ('\'"`'.includes(character)) quote = character;
        else if ('([{'.includes(character)) depth += 1;
        else if (')]}'.includes(character)) depth -= 1;
        else if (character === ';' && depth === 0) return source.slice(index, cursor + 1);
    }
    assert.fail(`Missing statement ending at ${index}`);
}

function declaration(name) {
    const index = source.indexOf(`const ${name} =`);
    assert.ok(index >= 0, `Missing declaration: ${name}`);
    return statementAt(index);
}

function effectContaining(text) {
    const index = source.indexOf(text);
    assert.ok(index >= 0, `Missing effect: ${text}`);
    return statementAt(source.lastIndexOf('useEffect(() => {', index));
}

const textFunctions = section('const TTS_BRACKETED_TEXT_PATTERN', 'function systemVoiceMatchesLanguage(');
const constants = [
    'OPENAI_TTS_MODEL', 'OPENAI_TTS_MAX_INPUT_LENGTH', 'SUPERTONIC_TTS_MAX_INPUT_LENGTH',
    'REMOTE_TTS_PREFETCH_PAGE_LIMIT', 'REMOTE_TTS_HISTORY_PAGE_LIMIT',
].map(declaration).join('\n');
const pageWindows = Function('flowItems', 'pageIndex', 'flowMode', 'isReaderDocument', `
    const useCallback = callback => callback;
    const useMemo = callback => callback();
    ${constants}
    ${textFunctions}
    ${section('function readerItemTtsText(', 'function getPageEffectDirection(')}
    ${['ttsPageTextAt', 'ttsPageWindow', 'ttsPreviousPages'].map(declaration).join('\n')}
    return { current: ttsPageWindow[0], next: ttsPageWindow.slice(1), previous: ttsPreviousPages };
`);

const makeHarness = Function('createViewerTtsRequests', 'createSpeech', 'initialEngine', `
    const useCallback = callback => callback;
    const useMemo = callback => callback();
    const useRef = current => ({ current });
    const effects = [];
    let effectIndex = 0;
    const useEffect = (callback, dependencies) => {
        const index = effectIndex++;
        const previous = effects[index];
        effects[index] = dependencies;
        if (!previous || dependencies.some((value, key) => !Object.is(value, previous[key]))) callback();
    };
    const calls = [];
    const cancelled = [];
    const createAudio = payload => {
        calls.push(payload);
        return createSpeech ? createSpeech(payload, calls.length) : Promise.resolve({
            success: true, dataUrl: 'data:audio/wav;base64,' + calls.length,
        });
    };
    const window = { viewerAPI: {
        createOpenAiTts: createAudio, createGoogleTts: createAudio, createSupertonicTts: createAudio,
        cancelTts: requestId => cancelled.push(requestId),
    } };
    let settings = {
        engine: initialEngine, openaiVoice: 'marin', googleVoice: 'ko-KR', supertonicVoice: 'M1', rate: 1,
    };
    let language = 'ko';
    let sessionId = 'first-book';
    ${constants}
    ${textFunctions}
    ${section('function splitTtsTextIntoChunks(', 'let detachedRemoteTtsAudio =')}
    ${section('function getRemoteTtsApi(', 'function applyTtsAudioPlaybackRate(')}
    ${section('function remoteTtsFallbackCode(', 'function stopDetachedRemoteTtsAudio(')}
    ${[
        'remoteTtsPageCacheRef', 'remoteTtsPagePromiseRef', 'remoteTtsPageRequestsRef',
        'remoteTtsCacheGenerationRef', 'remoteTtsAllowedCacheKeysRef', 'remoteTtsPrefetchRunRef',
        'cancelRemoteTtsRequests', 'loadRemoteTtsPageAudio',
    ].map(declaration).join('\n')}
    function render({ current, next = [], previous = [] }, options = {}) {
        if (options.settings) settings = { ...settings, ...options.settings };
        if (options.sessionId) sessionId = options.sessionId;
        if (options.language) language = options.language;
        const pageIndex = current.pageIndex;
        const speechText = normalizeTtsText(current.text);
        const prefetchPages = next;
        const previousPages = previous;
        ${[
            'normalizedPrefetchPages', 'normalizedPreviousPages', 'remoteTtsPageWindow',
            'remoteTtsCacheConfigKey', 'remoteTtsAllowedCacheKeys', 'remoteTtsRetainedCacheKeys',
        ].map(declaration).join('\n')}
        effectIndex = 0;
        ${effectContaining('remoteTtsCacheGenerationRef.current += 1;')}
        ${effectContaining('remoteTtsAllowedCacheKeysRef.current = remoteTtsAllowedCacheKeys;')}
    }
    return {
        render, load: loadRemoteTtsPageAudio, stop: cancelRemoteTtsRequests, calls, cancelled,
        cache: remoteTtsPageCacheRef.current, pending: remoteTtsPagePromiseRef.current,
    };
`);

const items = Array.from({ length: 20 }, (_, index) => `Page ${index} body.`);
const windowAt = (index, entries = items, mode = 'single') => pageWindows(entries, index, mode, true);
const harness = (createSpeech, engine = 'openai') => makeHarness(createViewerTtsRequests, createSpeech, engine);
const cachedIndexes = h => [...h.cache.values()].map(page => page.pageIndex).sort((a, b) => a - b);

test('이전 네 페이지의 완성 음성은 뒤로 이동해도 재합성 없이 재사용하고 다섯 페이지 전 음성은 정리한다', async () => {
    const h = harness();
    const completed = [];
    for (let index = 0; index <= 5; index += 1) {
        const window = windowAt(index);
        h.render(window);
        completed.push(await h.load(window.current));
    }
    assert.deepEqual(cachedIndexes(h), [1, 2, 3, 4, 5]);
    for (let index = 4; index >= 1; index -= 1) {
        const window = windowAt(index);
        h.render(window);
        assert.equal(await h.load(window.current), completed[index]);
    }
    assert.equal(h.calls.length, 6);
    h.render(windowAt(0));
    assert.notEqual(await h.load(windowAt(0).current), completed[0]);
    assert.equal(h.calls.length, 7);
});

test('완성 음성은 이전 네 페이지와 현재 페이지 및 다음 세 페이지 범위만 남는다', async () => {
    const h = harness();
    for (let index = 0; index <= 5; index += 1) {
        const window = windowAt(index);
        h.render(window);
        await h.load(window.current);
        for (const page of window.next) await h.load(page);
    }
    assert.deepEqual(cachedIndexes(h), [1, 2, 3, 4, 5, 6, 7, 8]);
    h.render(windowAt(19));
    assert.equal(h.cache.size, 0);
    assert.equal(h.calls.length, 9);
});

test('빈 페이지는 이전 음성 보관 수에 포함하지 않고 두 장 모드는 화면 단위로 네 개를 유지한다', () => {
    const sparse = ['', 'One', '', 'Three', '', '', 'Six', 'Seven', '', 'Nine', 'Ten', '', 'Twelve', '', 'Fourteen'];
    const single = windowAt(10, sparse);
    assert.deepEqual(single.previous.map(page => page.pageIndex), [9, 7, 6, 3]);
    assert.deepEqual(single.next.map(page => page.pageIndex), [12, 14]);
    assert.equal(single.current.text, 'Ten');
    const spread = windowAt(10, sparse, 'spread');
    assert.deepEqual(spread.previous.map(page => page.pageIndex), [8, 6, 2, 0]);
    assert.deepEqual(spread.previous.map(page => page.text), ['Nine', 'Six\n\nSeven', 'Three', 'One']);
    assert.deepEqual(spread.next.map(page => page.pageIndex), [12, 14]);
    assert.deepEqual(windowAt(0, sparse).previous, []);
    assert.deepEqual(pageWindows(sparse, 10, 'single', false), { current: undefined, next: [], previous: [] });
});

test('모든 생성형 TTS는 정지와 배속 변경에 완성 음성을 유지하고 음성 언어 책 변경에는 비운다', async () => {
    for (const engine of ['openai', 'google', 'supertonic']) {
        const h = harness(undefined, engine);
        const window = windowAt(2);
        h.render(window);
        const original = await h.load(window.current);
        h.stop();
        h.render(window, { settings: { rate: 1.6 } });
        assert.equal(await h.load(window.current), original);
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0].speed, 1);
        const voice = engine === 'google' ? { googleVoice: 'en-US' }
            : engine === 'supertonic' ? { supertonicVoice: 'F1' } : { openaiVoice: 'alloy' };
        h.render(window, { settings: voice });
        assert.equal(h.cache.size, 0);
        await h.load(window.current);
        h.render(window, { language: 'en' });
        assert.equal(h.cache.size, 0);
        await h.load(window.current);
        h.render(window, { sessionId: 'second-book' });
        assert.equal(h.cache.size, 0);
        await h.load(window.current);
        assert.equal(h.calls.length, 4);
    }
});

test('이전 페이지의 완성 음성만 유지하고 미완성 합성은 취소하여 후속 청크를 보내지 않는다', async () => {
    let finish;
    const h = harness((payload, count) => count === 1
        ? Promise.resolve({ success: true, dataUrl: 'complete' })
        : new Promise(resolve => { finish = resolve; }));
    const entries = [...items];
    entries[1] = 'Long text. '.repeat(600);
    h.render(windowAt(0, entries));
    const complete = await h.load(windowAt(0, entries).current);
    h.render(windowAt(1, entries));
    const pending = h.load(windowAt(1, entries).current);
    const rejected = assert.rejects(pending, { code: 'TTS_CANCELLED' });
    h.render(windowAt(2, entries));
    assert.equal(h.cache.get(complete.cacheKey), complete);
    assert.equal(h.cancelled.length, 1);
    assert.equal(h.pending.size, 0);
    finish({ success: true, dataUrl: 'late' });
    await rejected;
    assert.deepEqual(cachedIndexes(h), [0]);
    assert.equal(h.calls.length, 2);
});

test('책 변경 후 늦게 도착한 이전 요청은 새 음성을 덮어쓰거나 기록 캐시를 되살리지 않는다', async () => {
    let finish;
    const h = harness((payload, count) => count === 1
        ? new Promise(resolve => { finish = resolve; })
        : Promise.resolve({ success: true, dataUrl: 'new-book-audio' }));
    const window = windowAt(0);
    h.render(window);
    const old = h.load(window.current);
    const rejected = assert.rejects(old, { code: 'TTS_CANCELLED' });
    h.render(window, { sessionId: 'second-book' });
    const current = await h.load(window.current);
    finish({ success: true, dataUrl: 'old-book-audio' });
    await rejected;
    assert.equal(h.cache.size, 1);
    assert.equal(h.cache.get(current.cacheKey), current);
    assert.deepEqual(current.audioDataUrls, ['new-book-audio']);
    assert.equal(h.calls.length, 2);
});

test('페이지 나눔으로 같은 페이지 번호의 본문이 바뀌면 이전 음성을 재사용하지 않는다', async () => {
    const h = harness();
    h.render(windowAt(2));
    const old = await h.load(windowAt(2).current);
    const changedItems = [...items];
    changedItems[2] = 'New text after resizing the reader.';
    const changed = windowAt(2, changedItems);
    h.render(changed);
    assert.equal(h.cache.has(old.cacheKey), false);
    const current = await h.load(changed.current);
    assert.notEqual(current.cacheKey, old.cacheKey);
    assert.equal(h.calls.length, 2);
});
