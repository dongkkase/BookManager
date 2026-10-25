import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { ALL_METADATA_API_SOURCES, UNIFIED_METADATA_API_SOURCE } from './metadataApiPolicy.js';
import { metadataSearchResultKey } from './metadataSearch.js';
import { comicVineSearchThumbnail } from './comicVineSearchEnrichment.js';
import { translate } from './utils/i18n.js';

const source = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const mergeFunction = fragment('function mergeComicVineDetail(', 'function apiResultCoverUrl(');
const resolveCallback = fragment('const resolveComicVineDetail = useCallback(', 'const handleLoadLatest =');
const pendingState = fragment('const comicVineDetailPending =', 'const selectedResultKey =');
const detailEffectStart = source.lastIndexOf('useEffect(() => {', source.indexOf('if (!comicVineDetailPending || rawSelected.comicVineDetailLoading)'));
const detailEffect = source.slice(detailEffectStart, source.indexOf('const runSearch =', detailEffectStart));
const shortcutCallback = source.slice(source.indexOf('const handleShortcut = useCallback((event) => {', source.indexOf('function MetadataSearchDialog(')), source.indexOf("  useEffect(() => {\n    window.addEventListener('keydown', handleShortcut", source.indexOf('function MetadataSearchDialog(')));

function harness(results = [{ id: 42, apiSource: 'Vine', title: 'Volume', coverUrl: 'https://images.test/search.jpg' }]) {
    let state = { open: true, requestId: 1, apiSource: '통합검색', results };
    const requests = [];
    const requestRef = { current: 1 };
    const context = vm.createContext({
        metadataSearchResultKey,
        apiSearchRequestRef: requestRef,
        comicVineDetailsRef: { current: { requestId: 0, requests: new Map() } },
        setApiSearch: update => { state = update(state); },
        useCallback: callback => callback,
        text: (key, fallback) => fallback,
        window: { electronAPI: {
            fetchComicVineDetail: (volumeId, options) => new Promise((resolve, reject) => requests.push({ volumeId, options, resolve, reject })),
        } },
    });
    vm.runInContext(`${mergeFunction}\n${resolveCallback}\nglobalThis.resolveDetail = resolveComicVineDetail;`, context);
    return {
        requests,
        state: () => state,
        resolve: result => context.resolveDetail(result || state.results[0]),
        close: () => { requestRef.current += 1; state = { ...state, open: false }; },
        search: (results = state.results) => {
            requestRef.current += 1;
            state = { ...state, open: true, requestId: requestRef.current, results };
        },
    };
}

test('selected Comic Vine volume is requested once and details preserve identity and nonempty search fields', async () => {
    const original = { id: 42, ID: '42', apiSource: 'Vine', title: 'Search title', author: 'Search writer', coverUrl: 'https://images.test/search.jpg', coverCacheUrl: 'bookmanager-thumbnail://api-cover/search.jpg', metadata: { Title: 'Search title', Writer: 'Search writer', Penciller: 'Search artist' } };
    const other = { id: 42, apiSource: '리디북스', title: 'Other provider' };
    const h = harness([original, other]);
    const resolving = h.resolve(original);
    assert.equal(h.resolve(original), resolving);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].volumeId, 42);
    assert.equal(h.requests[0].options.deferImages, true);
    assert.equal(h.state().results[0].comicVineDetailLoading, true);
    h.requests[0].resolve({ success: true, result: {
        id: 99, ID: '99', apiSource: 'wrong', title: '', author: '', coverUrl: '', CoverUrls: [],
        summary: 'Full description', metadata: { Title: '', Writer: '', Penciller: '', Characters: 'Character', Publisher: 'Publisher' },
    } });
    await resolving;
    const result = h.state().results[0];
    assert.equal(result.id, 42);
    assert.equal(result.ID, '42');
    assert.equal(result.apiSource, 'Vine');
    assert.equal(result.title, 'Search title');
    assert.equal(result.metadata.Title, 'Search title');
    assert.equal(result.metadata.Writer, 'Search writer');
    assert.equal(result.author, 'Search writer');
    assert.equal(result.metadata.Penciller, 'Search artist');
    assert.equal(result.metadata.Characters, 'Character');
    assert.equal(result.summary, 'Full description');
    assert.equal(result.coverUrl, original.coverUrl);
    assert.equal(result.coverCacheUrl, original.coverCacheUrl);
    assert.equal(result.comicVineDetailResolved, true);
    assert.equal(result.comicVineDetailLoading, false);
    assert.equal(h.state().results[1], other);
    await h.resolve(original);
    assert.equal(h.requests.length, 1);
});

test('a changed detail cover cannot keep displaying the previous cached image', async () => {
    const h = harness([{ id: 42, apiSource: 'Vine', coverUrl: 'https://images.test/old.jpg', coverCacheUrl: 'bookmanager-thumbnail://api-cover/old.jpg' }]);
    const resolving = h.resolve();
    h.requests[0].resolve({ success: true, result: { coverUrl: 'https://images.test/new.jpg', metadata: {} } });
    await resolving;
    assert.equal(h.state().results[0].coverUrl, 'https://images.test/new.jpg');
    assert.equal(h.state().results[0].coverCacheUrl, '');
});

test('detail keeps the downloaded fallback when it belongs to the same cover candidates', async () => {
    const h = harness([{ id: 42, apiSource: 'Vine', coverUrl: 'https://images.test/small.jpg', coverCacheUrl: 'bookmanager-thumbnail://api-cover/small.jpg' }]);
    const resolving = h.resolve();
    h.requests[0].resolve({ success: true, result: {
        coverUrl: 'https://images.test/large.jpg',
        CoverUrls: ['https://images.test/large.jpg', 'https://images.test/small.jpg'],
        metadata: {},
    } });
    await resolving;
    assert.equal(h.state().results[0].coverUrl, 'https://images.test/small.jpg');
    assert.equal(h.state().results[0].coverCacheUrl, 'bookmanager-thumbnail://api-cover/small.jpg');
});

test('detail errors preserve search information and retry only after a new search', async () => {
    const h = harness();
    const original = h.state().results[0];
    const resolving = h.resolve();
    h.requests[0].resolve({ success: false, error: 'API limit reached' });
    await resolving;
    const failed = h.state().results[0];
    assert.equal(failed.title, original.title);
    assert.equal(failed.coverUrl, original.coverUrl);
    assert.equal(failed.comicVineDetailError, 'API limit reached');
    assert.equal(failed.comicVineDetailLoading, false);
    await h.resolve(failed);
    assert.equal(h.requests.length, 1);
    h.search([original]);
    const retrying = h.resolve();
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve({ success: true, result: { metadata: {} } });
    await retrying;
    assert.equal(h.state().results[0].comicVineDetailResolved, true);
});

for (const transition of ['close', 'search']) {
    for (const outcome of ['success', 'failure']) {
        test(`late detail ${outcome} after ${transition} cannot change a closed or replacement search`, async () => {
            const h = harness();
            const resolving = h.resolve();
            h[transition]([{ id: 42, apiSource: 'Vine', title: 'Replacement' }]);
            const state = h.state();
            if (outcome === 'success') h.requests[0].resolve({ success: true, result: { title: 'Late result' } });
            else h.requests[0].reject(new Error('Late error'));
            await resolving;
            assert.equal(h.state(), state);
        });
    }
}

test('the dialog requests only an unresolved selected Comic Vine result', () => {
    const selected = { id: 42, apiSource: 'Vine' };
    for (const [rawSelected, expected] of [
        [selected, 1], [undefined, 0], [{ ...selected, apiSource: '리디북스' }, 0],
        [{ ...selected, comicVineDetailLoading: true }, 0],
        [{ ...selected, comicVineDetailResolved: true }, 0],
        [{ ...selected, comicVineDetailError: 'Unavailable' }, 0],
    ]) {
        const requests = [];
        vm.runInNewContext(`${pendingState}\n${detailEffect}`, {
            rawSelected, state: { requestId: 1, apiSource: '통합검색' },
            useEffect: callback => callback(),
            onResolveComicVineDetail: value => requests.push(value),
        });
        assert.equal(requests.length, expected);
    }
});

test('selection and cover shortcuts wait for Comic Vine details', () => {
    for (const waiting of [true, false]) {
        const applied = [];
        const context = vm.createContext({
            comicVineDetailPending: waiting, dialogApi: 'Vine', dialogQuery: 'Volume',
            dialogQueryInputRef: { current: null }, dialogRef: { current: null },
            selected: { id: 42 }, selectedCoverUrl: 'https://images.test/cover.jpg',
            state: { loading: false, results: [{ id: 42 }] },
            useCallback: callback => callback,
            shortcutCode: event => event.code, isMetadataTextInput: () => false,
            onSearch: () => {}, moveSelectedResult: () => {},
            onSelect: result => applied.push(['metadata', result.id]),
            onUseCover: result => applied.push(['cover', result.id]),
        });
        vm.runInContext(`${shortcutCallback}\nglobalThis.shortcut = handleShortcut;`, context);
        for (const code of ['KeyC', 'KeyX']) context.shortcut({ code, preventDefault() {}, stopPropagation() {} });
        assert.equal(applied.length, waiting ? 0 : 2);
    }
});

test('both preload entry points expose the Comic Vine detail IPC', async () => {
    for (const entry of ['preload.js', 'preload.cjs']) {
        const preload = readFileSync(new URL(`../electron/${entry}`, import.meta.url), 'utf8');
        const expression = preload.match(/fetchComicVineDetail:\s*(\([^\n]+),/)[1];
        const calls = [];
        const fetchDetail = vm.runInNewContext(expression, { ipcRenderer: { invoke: (...args) => calls.push(args) } });
        await fetchDetail(42);
        assert.equal(calls[0][0], 'api:comicVineDetail');
        assert.equal(calls[0][1], 42);
        assert.deepEqual({ ...calls[0][2] }, {});
        await fetchDetail(42, { deferImages: true });
        assert.deepEqual(calls[1], ['api:comicVineDetail', 42, { deferImages: true }]);
    }
});

test('both preload entry points expose the background Comic Vine cover batch IPC', async () => {
    for (const entry of ['preload.js', 'preload.cjs']) {
        const preload = readFileSync(new URL(`../electron/${entry}`, import.meta.url), 'utf8');
        const expression = preload.match(/fetchComicVineCovers:\s*(\([^\n]+),/)[1];
        const calls = [];
        const fetchCovers = vm.runInNewContext(expression, { ipcRenderer: { invoke: (...args) => calls.push(args) } });
        await fetchCovers(['167989', '170759']);
        assert.deepEqual(calls, [['api:comicVineCovers', ['167989', '170759']]]);
    }
});

const dialogComponent = transformSync(fragment('function MetadataSearchDialog(', 'function RemoteCoverImage('), {
    loader: 'jsx',
    jsx: 'transform',
}).code;

function renderSearchDialog(results, { apiSource = 'Vine', language = 'en' } = {}) {
    const context = vm.createContext({
        React,
        useState: React.useState,
        useRef: React.useRef,
        useCallback: React.useCallback,
        useEffect() {},
        useLayoutEffect() {},
        FaIcon: () => null,
        RemoteCoverImage: () => null,
        ALL_METADATA_API_SOURCES,
        UNIFIED_METADATA_API_SOURCE,
        metadataSearchResultKey,
        comicVineSearchThumbnail,
        apiResultCoverUrl: result => result.coverUrl || '',
    });
    vm.runInContext(`${dialogComponent}\nglobalThis.Component = MetadataSearchDialog;`, context);
    return renderToStaticMarkup(React.createElement(context.Component, {
        state: { results, apiSource, query: 'Volume', page: 1, requestId: 1 },
        apiSources: [{ value: apiSource, labelKey: apiSource }],
        t: (key, values) => translate(key, language, values),
    }));
}

test('Comic Vine search results immediately render separate writer and penciller labels before details load', () => {
    const html = renderSearchDialog([
        { id: 1, apiSource: 'Vine', title: 'Selected volume', author: 'Stale author', metadata: { Writer: 'Selected writer', Penciller: 'Selected artist' } },
        { id: 2, apiSource: 'Vine', title: 'Unselected volume', Writer: 'Other writer', Penciller: 'Other artist' },
    ]);
    const list = html.slice(html.indexOf('class="meta-api-results"'), html.indexOf('class="meta-api-page-controls"'));
    assert.match(list, /Writer: Selected writer/);
    assert.match(list, /Penciller: Selected artist/);
    assert.match(list, /Writer: Other writer/);
    assert.match(list, /Penciller: Other artist/);
    assert.doesNotMatch(list, /Stale author/);
    assert.match(html, /<dt><span>Writer<\/span><\/dt><dd><span[^>]*>Selected writer<\/span><\/dd>/);
    assert.match(html, /<dt><span>Penciller<\/span><\/dt><dd><span[^>]*>Selected artist<\/span><\/dd>/);
});

test('Comic Vine creators stay separated and translated inside unified search', () => {
    const html = renderSearchDialog([
        { id: 1, apiSource: '리디북스', title: 'Book', author: 'Book author' },
        { id: 2, apiSource: 'Vine', title: 'Comic', metadata: { Writer: '글 담당', Penciller: '그림 담당' } },
    ], { apiSource: UNIFIED_METADATA_API_SOURCE, language: 'ko' });
    const list = html.slice(html.indexOf('class="meta-api-results"'), html.indexOf('class="meta-api-page-controls"'));
    assert.match(list, /<span>Book author<\/span>/);
    assert.match(list, /작가: 글 담당/);
    assert.match(list, /그림 작가: 그림 담당/);
});

test('an illustrator-only Comic Vine record does not appear as its writer', () => {
    const html = renderSearchDialog([{ id: 1, apiSource: 'Vine', title: 'Comic', author: 'Only artist', Writer: '', metadata: { Writer: '', Penciller: 'Only artist' } }]);
    assert.match(html, /Writer: -/);
    assert.match(html, /Penciller: Only artist/);
    assert.match(html, /<dt><span>Writer<\/span><\/dt><dd><span[^>]*>-<\/span><\/dd>/);
    assert.match(html, /<dt><span>Penciller<\/span><\/dt><dd><span[^>]*>Only artist<\/span><\/dd>/);
});

test('first-issue credits are identified in the list tooltip and detail preview in all app languages', () => {
    const result = {
        id: 1, apiSource: 'Vine', title: 'Comic',
        metadata: { Writer: 'Writer', Penciller: 'Artist' },
        comicVineCreditsIssueId: 1140412,
        comicVineCreditsIssueNumber: '1',
        comicVineCreditsIssueWeb: 'https://comicvine.gamespot.com/issue/4000-1140412/',
    };
    for (const language of ['ko', 'en', 'ja']) {
        const html = renderSearchDialog([result], { language });
        const note = translate('meta_comicvine_first_issue_credits', language);
        assert.notEqual(note, 'meta_comicvine_first_issue_credits');
        assert.ok(html.includes(`class="meta-api-result-meta" title="${note}"`));
        assert.ok(html.includes(`<small class="meta-api-result-meta">${note}</small>`));
    }
    const withoutIssue = renderSearchDialog([{ ...result, comicVineCreditsIssueId: undefined }]);
    assert.ok(!withoutIssue.includes('Based on first issue credits'));
    const otherProvider = renderSearchDialog([{ ...result, apiSource: '리디북스' }]);
    assert.ok(!otherProvider.includes('Based on first issue credits'));
});
