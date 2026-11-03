import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { webtoonWidthReference } from './viewerAutoFlow.js';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const selectorStart = source.indexOf('function zoomAnchorSelectorForTarget(');
const selectorEnd = source.indexOf('\nfunction ', selectorStart + 1);
const anchorStart = source.indexOf('const createScrollZoomAnchor =');
const anchorEnd = source.indexOf('const restoreScrollZoomAnchor =', anchorStart);
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart && anchorStart >= 0 && anchorEnd > anchorStart);
const createAnchor = new Function('scrollRef', 'document', 'useCallback', 'clamp', `
${source.slice(selectorStart, selectorEnd)}
${source.slice(anchorStart, anchorEnd)}
return createScrollZoomAnchor;
`);
const section = (start, end = '\nfunction ') => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
};
const createSizeRecorder = new Function('scope', `
const { pages, pageSizes, readerViewport, selectedFlowMode, viewMode, zoom,
    webtoonZoomRef, webtoonWidthReference, createScrollZoomAnchor, setPageSizes } = scope;
const useCallback = callback => callback;
const setPageRatios = () => {};
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
${section('function fitScaleForViewMode(')}
${section('function scaledPageSizeForViewMode(')}
${section('const rememberComicPageImageSize =', 'const clearPageTurnRuntime =')}
return rememberComicPageImageSize;
`);
const createRestore = new Function('scope', `
const { scrollRef, scrollZoomAnchorCleanupRef, scrollZoomAnchorSequenceRef,
    scrollZoomAnchorApplyRef, window, ResizeObserver } = scope;
const useCallback = callback => callback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
${section('const restoreScrollZoomAnchor =', 'const webtoonZoomRef =')}
return restoreScrollZoomAnchor;
`);

function restoreWithRoundedGeometry(axis, clampOnTranslation) {
    const frames = new Map();
    let sequence = 0;
    let position = 2_500_000;
    let translation = 0;
    let translationCount = 0;
    const translationSteps = [];
    const node = {
        clientWidth: 800,
        clientHeight: 800,
        scrollWidth: axis === 'x' ? 4_000_000 : 800,
        scrollHeight: axis === 'y' ? 4_000_000 : 800,
        get scrollLeft() { return axis === 'x' ? position : 0; },
        set scrollLeft(value) { if (axis === 'x') position = Math.round(value); },
        get scrollTop() { return axis === 'y' ? position : 0; },
        set scrollTop(value) { if (axis === 'y') position = Math.round(value); },
        getBoundingClientRect: () => rect(0, 0, 800, 800),
        querySelector: () => target,
        querySelectorAll: () => [],
        firstElementChild: {},
        style: {
            removeProperty() { translation = 0; },
            setProperty(_name, value) {
                const before = position;
                translation = Number.parseFloat(value.split(' ')[axis === 'x' ? 0 : 1]);
                if (clampOnTranslation && translationCount === 0) position -= 1;
                translationCount += 1;
                translationSteps.push({ before, after: position });
            },
        },
    };
    const target = {
        getBoundingClientRect() {
            const rounding = translation === 0 ? 0 : 1 / 64;
            const offset = 2_499_950.02 - position + translation + rounding;
            return axis === 'x' ? rect(offset, 0, 900, 800) : rect(0, offset, 800, 900);
        },
    };
    const cleanupRef = { current: null };
    const restore = createRestore({
        scrollRef: { current: node },
        scrollZoomAnchorCleanupRef: cleanupRef,
        scrollZoomAnchorSequenceRef: { current: 0 },
        scrollZoomAnchorApplyRef: { current: null },
        window: {
            requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
            cancelAnimationFrame(id) { frames.delete(id); },
            setTimeout: () => 1,
            clearTimeout() {},
            addEventListener() {},
            removeEventListener() {},
        },
        ResizeObserver: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
    restore({ centered: true, target: { selector: '[data-page-index="212"]', ratioX: 0.5, ratioY: 0.5 } });
    const [frameId, callback] = frames.entries().next().value;
    frames.delete(frameId);
    callback();
    cleanupRef.current();
    return { position, translation, translationSteps, target: target.getBoundingClientRect() };
}

function sizeRecorder({ pages = ['known', 'new'], pageSizes = { known: { width: 690, height: 1800 } },
    selectedFlowMode = 'auto', viewMode = 'fit' } = {}) {
    const reference = webtoonWidthReference(pages.map(name => ({ name })), pageSizes);
    const state = {
        referenceWidth: reference.width,
        referenceHeight: reference.height,
        active: true,
        ready: true,
        resizeAnchor: null,
    };
    let updatedSizes = pageSizes;
    const remember = createSizeRecorder({
        pages: pages.map(name => ({ name })), pageSizes, selectedFlowMode, viewMode,
        readerViewport: { width: 1440, height: 889 }, zoom: 100,
        webtoonZoomRef: { current: state }, webtoonWidthReference,
        createScrollZoomAnchor: () => ({ target: 'current-page' }),
        setPageSizes: update => { updatedSizes = update(updatedSizes); },
    });
    return { remember, state, get sizes() { return updatedSizes; } };
}

function rect(left, top, width, height) {
    return { left, top, width, height, right: left + width, bottom: top + height };
}

function fixture({ pages, hitIndex, hitRect }) {
    const nodes = pages.map(({ index, bounds }) => ({
        index,
        getBoundingClientRect: () => bounds,
        hasAttribute: name => name === 'data-page-index',
        getAttribute: name => name === 'data-page-index' ? String(index) : null,
        closest(selector) { return selector === '.viewer-flipbook-stage' ? null : this; },
    }));
    const hitPage = nodes.find(node => node.index === hitIndex);
    const image = {
        getBoundingClientRect: () => hitRect,
        closest: selector => selector === '.viewer-flipbook-stage' ? null : hitPage,
    };
    const viewport = rect(0, 43, 1440, 889);
    const scroll = {
        clientWidth: viewport.width,
        clientHeight: viewport.height,
        scrollLeft: 0,
        scrollTop: 16299,
        scrollWidth: viewport.width,
        scrollHeight: 2_000_000,
        contains: target => target === image || nodes.includes(target),
        getBoundingClientRect: () => viewport,
        querySelector: selector => nodes.find(node => selector === `[data-page-index="${node.index}"]`),
        querySelectorAll: () => nodes,
    };
    const anchor = createAnchor(
        { current: scroll }, { elementFromPoint: () => image }, callback => callback,
        (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    );
    return { anchor, image };
}

test('늦게 디코딩된 이전 PNG가 다음 페이지를 덮어도 현재 페이지를 줌 기준으로 삼는다', () => {
    const state = fixture({
        pages: [
            { index: 16, bounds: rect(12, -845, 1406, 889) },
            { index: 17, bounds: rect(12, 43, 1406, 889) },
        ],
        hitIndex: 16,
        hitRect: rect(370, -845, 690, 1800),
    });
    const anchor = state.anchor();
    assert.equal(anchor.target.selector, '[data-page-index="17"]');
    assert.equal(anchor.target.ratioY, 0.5);
    assert.equal(anchor.centered, true);
});

test('이전 이미지의 잇따른 로드도 wrapper 밖 비율로 다음 페이지까지 이동시키지 않는다', () => {
    const state = fixture({
        pages: [
            { index: 17, bounds: rect(12, -553.15625, 1406, 889) },
            { index: 18, bounds: rect(12, 334.84375, 1406, 889) },
        ],
        hitIndex: 17,
        hitRect: rect(370, -553.15625, 690, 1800),
    });
    const anchor = state.anchor();
    assert.equal(anchor.target.selector, '[data-page-index="18"]');
    assert.ok(anchor.target.ratioY >= 0 && anchor.target.ratioY <= 1);
});

test('페이지 안의 마우스 줌은 지정한 이미지 위치를 유지한다', () => {
    const bounds = rect(315.5, 43, 799, 2084);
    const state = fixture({ pages: [{ index: 17, bounds }], hitIndex: 17, hitRect: bounds });
    const anchor = state.anchor({ target: state.image, clientX: 515.25, clientY: 564 });
    assert.equal(anchor.target.selector, '[data-page-index="17"]');
    assert.equal(anchor.target.ratioX, 0.25);
    assert.equal(anchor.target.ratioY, 0.25);
    assert.equal(anchor.centered, false);
});

test('페이지 바깥 배경은 화면에 보이는 가장 가까운 페이지를 사용한다', () => {
    const state = fixture({
        pages: [
            { index: 16, bounds: rect(315.5, -900, 799, 889) },
            { index: 17, bounds: rect(315.5, 43, 799, 2084) },
        ],
        hitIndex: 16,
        hitRect: rect(0, 0, 1440, 932),
    });
    const anchor = state.anchor({ target: state.image, clientX: 250, clientY: 300 });
    assert.equal(anchor.target.selector, '[data-page-index="17"]');
    assert.equal(anchor.offsetX, 250);
    assert.equal(anchor.offsetY, 257);
});

test('같은 표시폭의 지연 로드는 추정높이 중앙 대신 페이지 시작 위치를 유지한다', () => {
    for (const viewMode of ['fit', 'width', 'actual']) {
        const state = sizeRecorder({ viewMode });
        state.remember('new', 690, 1800);
        assert.equal(state.state.resizeAnchor, null, viewMode);
        assert.deepEqual(state.sizes.new, { width: 690, height: 1800 });
    }
    const earlierPage = sizeRecorder({ pages: ['new', 'known'] });
    earlierPage.remember('new', 690, 1200);
    assert.equal(earlierPage.state.resizeAnchor, null, 'Automatic fit uses width, so a changed reference height does not resize pages.');
});

test('실제 표시폭을 바꾸는 좁은 웹툰 페이지는 기존 중앙 위치 보정을 유지한다', () => {
    const state = sizeRecorder({ viewMode: 'actual' });
    state.remember('new', 530, 1200);
    assert.deepEqual(state.state.resizeAnchor, { target: 'current-page' });
});

test('높이 맞춤은 기준 페이지 높이가 표시폭을 바꿀 때만 중앙을 보정한다', () => {
    for (const viewMode of ['height', 'fit']) {
        const earlier = sizeRecorder({ pages: ['new', 'known'], selectedFlowMode: 'scroll', viewMode });
        earlier.remember('new', 690, 1200);
        assert.deepEqual(earlier.state.resizeAnchor, { target: 'current-page' }, viewMode);
        const later = sizeRecorder({ selectedFlowMode: 'scroll', viewMode });
        later.remember('new', 690, 1200);
        assert.equal(later.state.resizeAnchor, null, viewMode);
    }
});

test('큰 스크롤 좌표의 1/64px 오차를 스크롤 한계로 오인하지 않는다', () => {
    for (const axis of ['x', 'y']) {
        const result = restoreWithRoundedGeometry(axis, false);
        assert.deepEqual(result.translationSteps[0], { before: 2_500_000, after: 2_500_000 });
        assert.equal(result.position, 2_500_000, 'Rounding without a browser clamp must not remove earlier content from the scroll range.');
        assert.ok(Math.abs(result.translation) < 1);
        assert.equal(result.target[axis === 'x' ? 'left' : 'top'], -50);
    }
});

test('음수 이동이 실제 스크롤 한계를 줄였을 때는 기존 줌 위치 보정을 유지한다', () => {
    for (const axis of ['x', 'y']) {
        const result = restoreWithRoundedGeometry(axis, true);
        assert.deepEqual(result.translationSteps[0], { before: 2_500_000, after: 2_499_999 });
        assert.equal(result.position, 0);
        assert.ok(Math.abs(result.translation + 2_500_000.035625) < 0.001);
        assert.equal(result.target[axis === 'x' ? 'left' : 'top'], -50);
    }
});
