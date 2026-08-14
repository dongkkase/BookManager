import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    assert.notEqual(startIndex, -1, `Missing source marker: ${startMarker}`);
    const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);
    assert.notEqual(endIndex, -1, `Missing source marker: ${endMarker}`);
    return source.slice(startIndex, endIndex);
}

function balancedBlock(source, marker) {
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `Missing block marker: ${marker}`);
    const openIndex = source.indexOf('{', markerIndex + marker.length);
    assert.notEqual(openIndex, -1, `Missing opening brace after: ${marker}`);

    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] !== '}') continue;
        depth -= 1;
        if (depth === 0) return source.slice(openIndex + 1, index);
    }
    assert.fail(`Missing closing brace after: ${marker}`);
}

function cssRuleContaining(...tokens) {
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of viewerCss.matchAll(rulePattern)) {
        const selector = match[1];
        if (tokens.every(token => selector.includes(token))) {
            return { selector, declarations: match[2] };
        }
    }
    assert.fail(`Missing CSS rule containing: ${tokens.join(', ')}`);
}

function animationNameForRule(...tokens) {
    const { declarations } = cssRuleContaining(...tokens);
    const animationMatch = declarations.match(/animation(?:-name)?\s*:\s*([\w-]+)/);
    assert.ok(animationMatch, `Missing animation declaration for: ${tokens.join(', ')}`);
    return animationMatch[1];
}

function assertKeyframeProperty(animationName, fromValue, toValue) {
    const keyframes = balancedBlock(viewerCss, `@keyframes ${animationName}`)
        .replace(/\s+/g, ' ');
    const escapedFrom = fromValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedTo = toValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
        keyframes,
        new RegExp(`(?:from|0%)\\s*\\{[^}]*${escapedFrom}`),
        `${animationName} must start with ${fromValue}`,
    );
    assert.match(
        keyframes,
        new RegExp(`(?:to|100%)\\s*\\{[^}]*${escapedTo}`),
        `${animationName} must end with ${toValue}`,
    );
}

function assertTokensNear(source, firstToken, secondToken, maximumDistance = 4000) {
    const firstIndexes = [];
    const secondIndexes = [];
    let index = source.indexOf(firstToken);
    while (index >= 0) {
        firstIndexes.push(index);
        index = source.indexOf(firstToken, index + firstToken.length);
    }
    index = source.indexOf(secondToken);
    while (index >= 0) {
        secondIndexes.push(index);
        index = source.indexOf(secondToken, index + secondToken.length);
    }
    assert.ok(firstIndexes.length > 0, `Missing token: ${firstToken}`);
    assert.ok(secondIndexes.length > 0, `Missing token: ${secondToken}`);
    assert.ok(
        firstIndexes.some(first => secondIndexes.some(second => Math.abs(first - second) <= maximumDistance)),
        `${firstToken} and ${secondToken} must belong to the same transition implementation`,
    );
}

test('일반 comic, reader, pdf 페이지는 공통 전환 레이어를 사용한다', () => {
    const formatSources = [
        ['comic', sourceBetween(viewerSource, '  const renderComic = () => {', '  const renderReaderPageBody =')],
        ['reader', sourceBetween(viewerSource, '  const renderReaderPages = items => {', '  const renderPdf = () => {')],
        ['pdf', sourceBetween(viewerSource, '  const renderPdf = () => {', '  const renderContent = () => {')],
    ];

    assert.ok(
        viewerSource.includes('viewer-page-transition-layer'),
        'ViewerApp must define the shared viewer-page-transition-layer',
    );
    for (const [format, source] of formatSources) {
        assert.match(
            source,
            /(?:viewer-page-transition-layer|[Pp]ageTransition)/,
            `${format} page rendering must use the shared page transition layer`,
        );
    }
});

test('slide와 fade 전환은 outgoing과 incoming 페이지를 같은 시점에 유지한다', () => {
    assertTokensNear(viewerSource, 'viewer-page-transition-layer', 'outgoing');
    assertTokensNear(viewerSource, 'viewer-page-transition-layer', 'incoming');
    assertTokensNear(viewerSource, 'pageTurn.fromIndex', 'outgoing');
    assertTokensNear(viewerSource, 'pageTurn.toIndex', 'incoming');
    assertTokensNear(viewerSource, 'pageTurn.active', 'viewer-page-transition-layer');
    assertTokensNear(viewerSource, 'pageTurn.effect', 'viewer-page-transition-layer');
});

test('효과없음도 다음 페이지 준비가 끝날 때까지 현재 페이지를 유지한다', () => {
    const triggerSource = sourceBetween(
        viewerSource,
        '  const triggerTimedPageEffect = useCallback(',
        '  const triggerReaderPageEffect = useCallback(',
    );
    const prepareSource = sourceBetween(
        viewerSource,
        "    if (!pageTurn.active || pageTurn.phase !== 'preparing') return undefined;",
        "    if (!pageTurn.active || pageTurn.phase !== 'animating') return undefined;",
    );

    assert.doesNotMatch(triggerSource, /readerSettings\.pageEffect === 'none'/);
    assert.match(triggerSource, /phase:\s*'preparing'/);
    assert.match(prepareSource, /pageTurn\.effect === 'none'/);
    assert.match(prepareSource, /completeTimedPageEffect\(sequence\)/);
});

test('이전 전환의 늦은 완료 이벤트가 새 페이지 이동을 확정하지 않는다', () => {
    const completionSource = sourceBetween(
        viewerSource,
        '  const completeTimedPageEffect = useCallback(',
        '  const triggerTimedPageEffect = useCallback(',
    );
    const triggerSource = sourceBetween(
        viewerSource,
        '  const triggerTimedPageEffect = useCallback(',
        '  const triggerReaderPageEffect = useCallback(',
    );

    assert.match(triggerSource, /pageTurnCompletionRef\.current = \{ sequence, callback: onComplete \}/);
    assert.match(completionSource, /completion\.sequence !== sequence/);
    assert.match(completionSource, /completion\.callback\?\.\(\)/);
});

test('페이지 전환 레이어는 동일한 stage 영역에 겹쳐 표시된다', () => {
    const { declarations } = cssRuleContaining('viewer-page-transition-layer');
    assert.match(declarations, /position\s*:\s*absolute/);
    assert.match(declarations, /inset\s*:\s*0/);
});

test('slide next 애니메이션은 incoming과 outgoing이 상보적인 전체 폭 이동을 한다', () => {
    const outgoingAnimation = animationNameForRule('effect-slide', 'effect-next', 'outgoing');
    const incomingAnimation = animationNameForRule('effect-slide', 'effect-next', 'incoming');

    assertKeyframeProperty(outgoingAnimation, 'transform: translateX(0)', 'transform: translateX(-100%)');
    assertKeyframeProperty(incomingAnimation, 'transform: translateX(100%)', 'transform: translateX(0)');
});

test('slide previous 애니메이션은 next와 반대 방향으로 전체 폭 이동한다', () => {
    const outgoingAnimation = animationNameForRule('effect-slide', 'effect-previous', 'outgoing');
    const incomingAnimation = animationNameForRule('effect-slide', 'effect-previous', 'incoming');

    assertKeyframeProperty(outgoingAnimation, 'transform: translateX(0)', 'transform: translateX(100%)');
    assertKeyframeProperty(incomingAnimation, 'transform: translateX(-100%)', 'transform: translateX(0)');
});

test('fade 애니메이션은 현재 페이지 밝기를 유지한 채 incoming만 표시한다', () => {
    const outgoingRule = cssRuleContaining('effect-fade', 'outgoing');
    const incomingAnimation = animationNameForRule('effect-fade', 'incoming');

    assert.match(outgoingRule.declarations, /opacity\s*:\s*1/);
    assert.doesNotMatch(outgoingRule.declarations, /animation\s*:/);
    assertKeyframeProperty(incomingAnimation, 'opacity: 0', 'opacity: 1');
});

test('몰입형 fade 애니메이션은 두 페이지를 밝기 보존 방식으로 교차 합성한다', () => {
    const stageRule = cssRuleContaining('viewer-app.is-background-immersive', 'is-animating.effect-fade');
    const outgoingRule = cssRuleContaining(
        'viewer-app.is-background-immersive',
        'effect-fade',
        'viewer-page-transition-layer.is-outgoing',
    );
    const incomingRule = cssRuleContaining(
        'viewer-app.is-background-immersive',
        'effect-fade',
        'viewer-page-transition-layer.is-incoming',
    );
    const outgoingAnimation = animationNameForRule(
        'viewer-app.is-background-immersive',
        'effect-fade',
        'viewer-page-transition-layer.is-outgoing',
    );
    const incomingAnimation = animationNameForRule(
        'viewer-app.is-background-immersive',
        'effect-fade',
        'viewer-page-transition-layer.is-incoming',
    );

    assert.match(stageRule.declarations, /isolation\s*:\s*isolate/);
    assert.match(outgoingRule.declarations, /mix-blend-mode\s*:\s*plus-lighter/);
    assert.match(incomingRule.declarations, /mix-blend-mode\s*:\s*plus-lighter/);
    assertKeyframeProperty(outgoingAnimation, 'opacity: 1', 'opacity: 0');
    assertKeyframeProperty(incomingAnimation, 'opacity: 0', 'opacity: 1');
});

test('페이지 전환은 이미지와 고품질 축소의 terminal 상태를 기다린다', () => {
    const imageReadinessSource = sourceBetween(
        viewerSource,
        'function viewerImageIsPrepared(',
        'function viewerPageTargetIsPrepared(',
    );
    const targetReadinessSource = sourceBetween(
        viewerSource,
        'function viewerPageTargetIsPrepared(',
        'function clamp(',
    );

    assert.match(viewerSource, /data-high-quality-settled=\{qualitySettled \? 'true' : undefined\}/);
    assert.match(targetReadinessSource, /targetLayer\.querySelectorAll\('img'\)/);
    assert.match(targetReadinessSource, /images\.every\(viewerImageIsPrepared\)/);
    assert.match(imageReadinessSource, /image\?\.complete/);
    assert.match(imageReadinessSource, /image\.decode\(\)/);
    assert.match(targetReadinessSource, /frame\.dataset\.highQualitySettled === 'true'/);
});

test('플립북은 고정 startPage로 초기화하고 준비된 페이지 이동만 외부 effect에서 요청한다', () => {
    const flipBookSource = sourceBetween(viewerSource, 'function ViewerFlipBook({', '\nfunction storageKey(');
    const reactFlipBookTag = flipBookSource.match(/<ReactFlipBook\b[\s\S]*?>/)?.[0] || '';

    assert.ok(reactFlipBookTag, 'ViewerFlipBook must render ReactFlipBook');
    assert.doesNotMatch(reactFlipBookTag, /\bcurrentPage\s*=/);
    assert.match(
        flipBookSource,
        /const\s+(?:\[\s*)?initialBookIndex\w*(?:\s*\])?\s*=\s*use(?:Ref|State)\(/,
    );
    assert.match(reactFlipBookTag, /startPage=\{initialBookIndex(?:Ref\.current)?\}/);
    assert.match(reactFlipBookTag, /renderOnlyPageLengthChange/);
    assert.match(
        flipBookSource,
        /useEffect\(\(\) => \{[\s\S]*?targetReady[\s\S]*?pageFlip(?:\.flip|\?\.flip\?\.)\(currentBookIndex\)/,
    );
});

test('책넘김은 페이지 크기를 유지하고 진행 중 추가 이동으로 애니메이션을 끊지 않는다', () => {
    const triggerSource = sourceBetween(
        viewerSource,
        '  const triggerTimedPageEffect = useCallback(',
        '  const triggerReaderPageEffect = useCallback(',
    );
    const completionSource = sourceBetween(
        viewerSource,
        '  const handleFlipBookPageIndexChange = useCallback(',
        '  const getFlipBookPageSize = useCallback(',
    );

    assert.match(viewerSource, /const pageSize = getFlipBookPageSize\(pageSlots, 160\)/);
    assert.doesNotMatch(viewerSource, /getComicFlipBookPageSize/);
    assert.match(triggerSource, /readerSettings\.pageEffect === 'page'[\s\S]*pageTurnPendingRef\.current/);
    assert.match(triggerSource, /bookPageTurnTargetRef\.current = targetIndex/);
    assert.match(completionSource, /bookPageTurnTargetRef\.current !== normalizedIndex/);
});

test('플립북 페이지 content는 Context를 통해 갱신된다', () => {
    const contentSource = sourceBetween(
        viewerSource,
        'function ViewerFlipBookPageContent(',
        '\nfunction ViewerFlipBook({',
    );
    const contextValueSource = sourceBetween(
        viewerSource,
        '  const pageRenderState = useMemo(() => ({',
        '  const pageElements = useMemo(',
    );

    assert.doesNotMatch(contentSource, /function ViewerFlipBookPageContent\(\{[^}]*renderPage/);
    assert.match(contentSource, /useContext\(ViewerFlipBookPageRenderContext\)/);
    assert.match(contentSource, /render(?:Page|Content)/);
    assert.match(contextValueSource, /render(?:Page|Content)/);
    assert.match(contextValueSource, /(?:pageRenderDependency|renderKey|contentRevision|contentVersion)/);
});

test('플립북 pageElements는 구조 변경에만 의존한다', () => {
    const pageElementsSource = sourceBetween(
        viewerSource,
        '  const pageElements = useMemo(',
        '  if (normalizedPageCount <= 0',
    );
    const dependencyStart = pageElementsSource.lastIndexOf('[');
    const dependencyEnd = pageElementsSource.lastIndexOf(']');
    assert.ok(dependencyStart >= 0 && dependencyEnd > dependencyStart, 'Missing pageElements dependency array');
    const dependencies = pageElementsSource.slice(dependencyStart + 1, dependencyEnd);

    assert.match(pageElementsSource, /<ViewerFlipBookPageContent\b/);
    assert.doesNotMatch(pageElementsSource, /renderPageRef\.current/);
    assert.doesNotMatch(pageElementsSource, /provideNearbyPageState\s*\?/);
    assert.match(dependencies, /model\.entries/);
    assert.doesNotMatch(
        dependencies,
        /(?:currentBookIndex|currentPageIndex|nearbyBookIndexes|normalizedPageSize|pageRenderDependency|provideNearbyPageState|renderKey|renderPage|visualScale)/,
    );
});

test('초기 렌더 로더는 지정 SVG를 화면 중앙에 표시한다', () => {
    assert.match(viewerSource, /import blocksShuffle4Icon from '\.\/images\/blocks-shuffle-4\.svg'/);
    assert.match(
        viewerSource,
        /\{initialRenderLoading && \([\s\S]*className="viewer-initial-render-loading"[\s\S]*<img src=\{blocksShuffle4Icon\} alt="" \/>/,
    );

    const overlayRule = cssRuleContaining('viewer-initial-render-loading');
    assert.match(overlayRule.declarations, /position\s*:\s*fixed/);
    assert.match(overlayRule.declarations, /inset\s*:\s*0/);
    assert.match(overlayRule.declarations, /display\s*:\s*flex/);
    assert.match(overlayRule.declarations, /align-items\s*:\s*center/);
    assert.match(overlayRule.declarations, /justify-content\s*:\s*center/);
    assert.match(viewerSource, /initialRenderLoading \? 'is-initial-render-loading' : ''/);
    assert.match(
        cssRuleContaining('viewer-app.is-initial-render-loading', 'viewer-state:not(.viewer-error)').declarations,
        /visibility\s*:\s*hidden/,
    );
});

test('초기 렌더 로더는 현재 표시 페이지가 안정된 뒤에만 제거된다', () => {
    const loadSessionSource = sourceBetween(
        viewerSource,
        '  const loadSession = useCallback(async nextSession => {',
        '  const loadComicPage = useCallback(',
    );
    const readinessSource = sourceBetween(
        viewerSource,
        '  useEffect(() => {\n    if (!initialRenderLoading || !viewerSessionResolved)',
        '  const currentTtsText = useMemo(',
    );

    assert.match(viewerSource, /const \[initialRenderLoading, setInitialRenderLoading\] = useState\(true\)/);
    assert.match(loadSessionSource, /setInitialRenderLoading\(true\)/);
    assert.match(readinessSource, /viewerInitialRenderIsPrepared\(scrollRef\.current/);
    assert.match(readinessSource, /document\.fonts\?\.ready/);
    assert.match(readinessSource, /readyFrameCount >= 3/);
    assert.match(readinessSource, /setInitialRenderLoading\(false\)/);
    assert.match(readinessSource, /window\.cancelAnimationFrame\(frameId\)/);
    assert.doesNotMatch(loadSessionSource, /finally[\s\S]*setInitialRenderLoading\(false\)/);
    assert.match(
        viewerSource,
        /const imageReady = Boolean\([\s\S]*image\?\.naturalWidth > 0[\s\S]*viewerImageIsPrepared\(image\)[\s\S]*\)/,
    );
});

test('초기 렌더 로더는 책넘김의 빈 면을 완료된 페이지로 처리한다', () => {
    const readinessSource = sourceBetween(
        viewerSource,
        'function viewerInitialRenderIsPrepared(',
        'function clamp(',
    );

    assert.match(readinessSource, /target\?\.classList\?\.contains\('is-blank'\)/);
    assert.match(readinessSource, /if \(target\?\.classList\?\.contains\('is-blank'\)\) return true/);
});

test('초기 세션 조회의 늦은 응답은 새 세션 로더를 종료하지 않는다', () => {
    const bootstrapSource = sourceBetween(
        viewerSource,
        '  useEffect(() => {\n    const bootstrapSequence = loadSequenceRef.current;',
        '  useEffect(() => () => {',
    );

    assert.match(bootstrapSource, /const bootstrapSequence = loadSequenceRef\.current/);
    assert.match(
        bootstrapSource,
        /\.then\(nextSession => \{\s*if \(loadSequenceRef\.current !== bootstrapSequence\) return undefined/,
    );
    assert.match(
        bootstrapSource,
        /\.catch\(\(\) => \{\s*if \(loadSequenceRef\.current !== bootstrapSequence\) return/,
    );
});

test('초기 렌더 로더 표시 영역은 지정된 여백과 배경을 사용한다', () => {
    const indicatorRule = cssRuleContaining('viewer-initial-render-loading-indicator');
    const iconRule = cssRuleContaining('viewer-initial-render-loading-indicator img');

    assert.match(indicatorRule.declarations, /padding\s*:\s*10px/);
    assert.match(indicatorRule.declarations, /border-radius\s*:\s*5px/);
    assert.match(indicatorRule.declarations, /background\s*:\s*rgba\(0,\s*0,\s*0,\s*0\.5\)/);
    assert.doesNotMatch(iconRule.declarations, /animation\s*:/);
    assert.doesNotMatch(iconRule.declarations, /rotate\s*:/);
});
