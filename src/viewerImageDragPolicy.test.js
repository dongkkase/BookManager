import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('./utils/i18n.js', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);

    assert.notEqual(startIndex, -1, `시작 소스 마커가 필요합니다: ${startMarker}`);
    assert.notEqual(endIndex, -1, `종료 소스 마커가 필요합니다: ${endMarker}`);
    return source.slice(startIndex, endIndex);
}

test('만화책 뷰어 이미지는 브라우저 기본 이미지 드래그를 시작하지 않는다', () => {
    assert.match(viewerSource, /className=\{imageClassName\}[\s\S]*draggable=\{false\}/);
    assert.match(viewerSource, /onDragStart=\{event => event\.preventDefault\(\)\}/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*-webkit-user-drag: none;/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*user-select: none;/);
});

test('만화 이미지는 배율이 변해도 부드러운 기본 보간을 사용한다', () => {
    const imageRule = viewerCss.match(/^\.viewer-comic-image\s*\{([^}]*)\}/m)?.[1] || '';

    assert.match(imageRule, /image-rendering:\s*auto/);
    assert.doesNotMatch(imageRule, /image-rendering:\s*(?:crisp-edges|pixelated|-webkit-optimize-contrast)/);
});

test('현재 표시 중인 만화 이미지는 비동기 고품질 축소를 사용한다', () => {
    const pageFrameSource = sourceBetween(viewerSource, 'function ComicPageFrame({', 'function ComicFlipBookAmbientPage({');

    assert.match(viewerSource, /import \{ comicDownsampleTarget, paintComicDownsample \} from '\.\/comicImageDownsample';/);
    assert.match(pageFrameSource, /const qualityCanvasRef = useRef\(null\);/);
    assert.match(pageFrameSource, /const target = comicDownsampleTarget\(\{/);
    assert.match(pageFrameSource, /await paintComicDownsample\(\{ source: image, canvas, target, cancelToken \}\);/);
    assert.match(pageFrameSource, /crossOrigin=\{src\.startsWith\('bookmanager-comic:'\) \? 'anonymous' : undefined\}/);
    assert.match(pageFrameSource, /qualityScheduleRef\.current\?\.\(0\);/);
    assert.match(pageFrameSource, /className="viewer-comic-quality-canvas"/);
    assert.match(pageFrameSource, /data-high-quality-ready=\{qualityReady \? 'true' : undefined\}/);
    assert.match(viewerCss, /\.viewer-comic-quality-canvas \{[\s\S]*pointer-events:\s*none;/);
    assert.match(viewerCss, /\.viewer-comic-page-frame\[data-high-quality-ready='true'\] \.viewer-comic-image \{[\s\S]*opacity:\s*0;/);
    assert.match(viewerCss, /\.viewer-comic-page-frame\[data-high-quality-ready='true'\] \.viewer-comic-quality-canvas \{[\s\S]*opacity:\s*1;/);
    assert.match(viewerCss, /\.viewer-comic-stage\.is-spread\.has-spread-pair \.viewer-comic-quality-canvas \{[\s\S]*box-shadow:\s*none;/);
});

test('고품질 축소는 주요 래스터 만화 형식을 지원하고 GIF와 벡터 형식은 제외한다', () => {
    const supportSource = sourceBetween(viewerSource, 'function supportsHighQualityComicDownsample', 'function dragPanOverflowStateForTarget');

    assert.match(supportSource, /image\/jpeg/);
    assert.match(supportSource, /image\/png/);
    assert.match(supportSource, /image\/webp/);
    assert.match(supportSource, /image\/bmp/);
    assert.doesNotMatch(supportSource, /image\/gif/);
    assert.doesNotMatch(supportSource, /image\/svg\+xml/);
});

test('고품질 축소는 일반 보기와 책넘김의 현재 인접 펼침면에 적용한다', () => {
    const renderComicSource = sourceBetween(viewerSource, 'const renderComic = () => {', 'const readerStyle = {');
    const scrollBranch = sourceBetween(renderComicSource, "if (flowMode === 'scroll') {", 'const isBookPageEffect');
    const flipBookBranch = sourceBetween(renderComicSource, 'if (isBookPageEffect) {', 'const displayStartIndex');
    const standardBranch = sourceBetween(renderComicSource, 'const displayStartIndex', 'return (\n      <div className={comicStageClassName}>');

    assert.doesNotMatch(scrollBranch, /highQuality/);
    assert.match(flipBookBranch, /highQuality:\s*Boolean\(renderState\?\.isNearCurrent\)/);
    assert.match(flipBookBranch, /qualityScale:\s*renderState\?\.visualScale/);
    assert.match(flipBookBranch, /provideNearbyPageState/);
    assert.match(viewerSource, /getFlipBookNearbyGroupEntries\(model\.entries, currentBookIndex\)/);
    assert.match(viewerSource, /ViewerFlipBookPageRenderContext\.Provider value=\{pageRenderState\}/);
    assert.match(viewerSource, /isNearCurrent:\s*renderState\.nearbyBookIndexes\?\.has\(entry\.bookIndex\)/);
    assert.match(viewerSource, /visualScale:\s*normalizedVisualScale/);
    assert.match(viewerSource, /observedDevicePixelSize\.width \* normalizedQualityScale/);
    assert.match(viewerSource, /styledWidth \* normalizedQualityScale/);
    assert.match(viewerCss, /\.viewer-flipbook-page \.viewer-comic-quality-canvas \{[\s\S]*box-shadow:\s*none;/);
    assert.match(standardBranch, /displayComicPages\.map[\s\S]*\{ highQuality: true \}/);
    assert.match(viewerSource, /highQuality=\{Boolean\(options\.highQuality && supportsHighQualityComicDownsample\(page\)\)\}/);
});

test('고품질 축소는 리사이즈를 지연 처리하고 진행 중인 작업과 자원을 정리한다', () => {
    const pageFrameSource = sourceBetween(viewerSource, 'function ComicPageFrame({', 'function ComicFlipBookAmbientPage({');

    assert.match(viewerSource, /const COMIC_HIGH_QUALITY_RENDER_DELAY_MS = 120;/);
    assert.match(pageFrameSource, /observer = new ResizeObserver\(handleResize\);[\s\S]*device-pixel-content-box/);
    assert.match(pageFrameSource, /const scheduleHighQualityRender = \(delay = COMIC_HIGH_QUALITY_RENDER_DELAY_MS\)[\s\S]*window\.setTimeout\(/);
    assert.match(pageFrameSource, /const cancelToken = new Promise/);
    assert.match(pageFrameSource, /abortActiveRender\(\);[\s\S]*window\.setTimeout\(/);
    assert.match(pageFrameSource, /let generation = 0;/);
    assert.match(pageFrameSource, /currentGeneration !== generation/);
    assert.match(pageFrameSource, /generation \+= 1;/);
    assert.match(pageFrameSource, /if \(timerId !== null\) window\.clearTimeout\(timerId\);/);
    assert.match(pageFrameSource, /error\.name = 'AbortError'/);
    assert.match(pageFrameSource, /observer\?\.disconnect\?\.\(\);/);
    assert.match(pageFrameSource, /qualityScheduleRef\.current = null;[\s\S]*releaseCanvas\(\);/);
});

test('확대된 만화 이미지는 좌상단을 포함한 전체 영역으로 이동할 수 있다', () => {
    const stageRule = viewerCss.match(/\.viewer-comic-stage\s*\{([^}]*)\}/)?.[1] || '';
    const spreadRule = viewerCss.match(/\.viewer-spread-pair\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(stageRule, /align-items:\s*safe center/);
    assert.match(stageRule, /justify-content:\s*safe center/);
    assert.match(spreadRule, /align-items:\s*safe center/);
    assert.match(spreadRule, /justify-content:\s*safe center/);
});

test('뷰어 공통 툴바는 Tab과 hover로 부드럽게 표시 상태를 전환한다', () => {
    assert.match(viewerSource, /import toolbarIcon from '\.\/images\/toolbar\.svg';/);
    assert.match(viewerSource, /const \[toolbarPinnedOpen, setToolbarPinnedOpen\] = useState\(true\);/);
    assert.match(viewerSource, /const toolbarVisible = toolbarPinnedOpen \|\| toolbarPeekOpen;/);
    assert.match(viewerSource, /event\.key === 'Tab'[\s\S]*toggleToolbarPinned\(\)/);
    assert.match(viewerSource, /className="viewer-toolbar-hover-zone"/);
    assert.match(viewerSource, /iconSrc=\{toolbarIcon\}[\s\S]*active=\{toolbarVisible\}/);
    assert.match(viewerCss, /\.viewer-app\.is-toolbar-hidden \.viewer-toolbar \{[\s\S]*transform: translateY/);
    assert.match(viewerCss, /\.viewer-toolbar-hover-zone \{/);
    assert.match(i18nSource, /hide_toolbar: '툴바 숨기기 \(Tab\)'/);
    assert.match(i18nSource, /hide_toolbar: 'Hide toolbar \(Tab\)'/);
    assert.match(i18nSource, /hide_toolbar: 'ツールバーを隠す \(Tab\)'/);
});
