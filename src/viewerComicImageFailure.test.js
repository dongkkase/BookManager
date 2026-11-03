import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const renderStart = source.indexOf('  const renderComicImage = ');
const renderEnd = source.indexOf('\n  const renderComic = ', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const renderSource = transformSync(source.slice(renderStart, renderEnd), { loader: 'jsx', target: 'es2022' }).code;
const gateStart = source.indexOf('function viewerImageIsPrepared(');
const gateEnd = source.indexOf('\nfunction clamp(', gateStart);
assert.ok(gateStart >= 0 && gateEnd > gateStart);
const initialRenderIsPrepared = new Function('VIEWER_IMAGE_DECODE_STATE', `${source.slice(gateStart, gateEnd)}; return viewerInitialRenderIsPrepared;`)(new WeakMap());

function fixture() {
    const page = { index: 0, name: 'page.png', basename: 'page.png', pageUrl: 'bookmanager-comic://session/book/page.png' };
    let fallbackRequests = 0;
    const state = {
        React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
        ComicPageFrame: () => {},
        ComicScrollPngPage: () => {},
        flowMode: 'scroll',
        scrollRef: { current: null },
        pageData: {},
        pageErrors: {},
        session: { id: 'book' },
        comicViewMode: 'fit',
        imageClassName: 'viewer-comic-image',
        backgroundMode: 'plain',
        getComicImageStyle: () => undefined,
        supportsHighQualityComicDownsample: () => false,
        rememberComicPageImageSize() {},
        viewerText: (_key, fallback, values) => fallback.replace('{name}', values.name),
        loadComicPage: () => { fallbackRequests += 1; },
        setPageErrors: update => { state.pageErrors = update(state.pageErrors); },
    };
    return {
        page,
        state,
        get fallbackRequests() { return fallbackRequests; },
        render() {
            const render = new Function(...Object.keys(state), `${renderSource}; return renderComicImage;`)(...Object.values(state));
            return render(page);
        },
        fail(tree, failedSource) {
            tree.props.onImageError({ currentTarget: { currentSrc: failedSource, getAttribute: () => failedSource } });
        },
    };
}

function isPrepared(tree, flowMode) {
    const isError = tree.type === 'div' && tree.props.className === 'viewer-comic-placeholder is-error';
    const failedImage = { complete: true, naturalWidth: 0, naturalHeight: 0 };
    const target = {
        matches: selector => isError
            ? selector === '.viewer-comic-placeholder.is-error'
            : selector === '.viewer-comic-page-frame',
        querySelectorAll: () => [],
        querySelector: selector => selector === '.viewer-comic-image' && !isError ? failedImage : null,
        dataset: {},
        classList: { contains: () => false },
    };
    const root = {
        querySelector: selector => selector === '.viewer-error' || selector === '.viewer-flipbook-stage' ? null : target,
    };
    return initialRenderIsPrepared(root, { format: 'comic', flowMode, pageIndex: 0 });
}

test('프로토콜과 대체 이미지 디코딩이 모두 실패하면 오류를 표시하고 초기 로딩을 끝낸다', () => {
    const f = fixture();
    f.fail(f.render(), f.page.pageUrl);
    assert.equal(f.fallbackRequests, 1);
    const dataUrl = 'data:image/png;base64,aW52YWxpZC1pbWFnZQ==';
    f.state.pageData[f.page.name] = dataUrl;
    const failedFrame = f.render();
    assert.equal(isPrepared(failedFrame, 'scroll'), false);
    f.fail(failedFrame, dataUrl);
    const error = f.render();
    assert.equal(f.fallbackRequests, 1);
    assert.equal(error.props.className, 'viewer-comic-placeholder is-error');
    assert.equal(isPrepared(error, 'scroll'), true);
    assert.equal(isPrepared(error, 'single'), true);
});

test('공유 캐시에서 제거된 대체 이미지의 디코딩 실패도 재요청 없이 오류로 마무리한다', () => {
    const f = fixture();
    const dataUrl = 'data:image/png;base64,aW52YWxpZC1pbWFnZQ==';
    f.state.pageData[f.page.name] = dataUrl;
    const frame = f.render();
    delete f.state.pageData[f.page.name];
    f.fail(frame, dataUrl);
    assert.equal(f.fallbackRequests, 0);
    assert.equal(isPrepared(f.render(), 'scroll'), true);
});

test('압축 파일 읽기 자체의 실패도 기존 초기 로딩 종료 경로를 유지한다', () => {
    const f = fixture();
    f.state.pageErrors[f.page.name] = 'Read failed';
    assert.equal(isPrepared(f.render(), 'scroll'), true);
    assert.equal(isPrepared(f.render(), 'single'), true);
});
