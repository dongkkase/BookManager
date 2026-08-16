import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    buildFlipBookGroups,
    buildFlipBookPageModel,
    buildFlipBookStructureKey,
    finishAndTurnFlipBookToPage,
    flipBookLeafSourcesForGroup,
    getFlipBookAmbientEntries,
    getFlipBookCurrentGroupEntries,
    getFlipBookNearbyGroupEntries,
    getSplitSpreadFrameStyle,
} from './viewerFlipBook.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('./utils/i18n.js', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');
const viewerFlipBookSource = viewerSource.slice(
    viewerSource.indexOf('function ViewerFlipBook('),
    viewerSource.indexOf('function storageKey('),
);
const comicPageFrameSource = viewerSource.slice(
    viewerSource.indexOf('function ComicPageFrame('),
    viewerSource.indexOf('function ComicFlipBookAmbientPage('),
);

test('플립북 그룹은 페이지별 가변 step 크기를 순서대로 적용한다', () => {
    const stepSizes = new Map([
        [0, 1],
        [1, 1],
        [2, 2],
        [4, 1],
        [5, 2],
    ]);

    assert.deepEqual(
        buildFlipBookGroups({
            pageCount: 7,
            spread: true,
            getStepSizeForIndex: index => stepSizes.get(index),
        }),
        [
            { startIndex: 0, indexes: [0] },
            { startIndex: 1, indexes: [1] },
            { startIndex: 2, indexes: [2, 3] },
            { startIndex: 4, indexes: [4] },
            { startIndex: 5, indexes: [5, 6] },
        ],
    );
});

test('가로 단독 페이지는 양쪽 leaf가 같은 원본을 사용하고 세로 단독 페이지는 빈 leaf를 유지한다', () => {
    const group = { startIndex: 2, indexes: [2] };

    assert.deepEqual(
        flipBookLeafSourcesForGroup(group, { spread: true, readingDirection: 'ltr' }),
        [2, null],
    );
    assert.deepEqual(
        flipBookLeafSourcesForGroup(group, { spread: true, readingDirection: 'rtl' }),
        [null, 2],
    );
    assert.deepEqual(
        flipBookLeafSourcesForGroup(group, {
            spread: true,
            readingDirection: 'ltr',
            shouldSplitSinglePage: index => index === 2,
        }),
        [2, 2],
    );
    assert.deepEqual(
        flipBookLeafSourcesForGroup(group, {
            spread: false,
            shouldSplitSinglePage: () => true,
        }),
        [2],
    );
});

test('LTR 플립북 모델은 분할 단독 페이지만 같은 원본을 두 leaf에 매핑한다', () => {
    const model = buildFlipBookPageModel({
        pageCount: 5,
        spread: true,
        readingDirection: 'ltr',
        getStepSizeForIndex: index => index <= 1 || index === 4 ? 1 : 2,
        shouldSplitSinglePage: index => index === 1,
    });

    assert.deepEqual(
        model.entries.map(({ groupStartIndex, sourceIndex, side, blank, splitSpread }) => ({
            groupStartIndex,
            sourceIndex,
            side,
            blank,
            splitSpread,
        })),
        [
            { groupStartIndex: 0, sourceIndex: null, side: 'left', blank: true, splitSpread: false },
            { groupStartIndex: 0, sourceIndex: 0, side: 'right', blank: false, splitSpread: false },
            { groupStartIndex: 1, sourceIndex: 1, side: 'left', blank: false, splitSpread: true },
            { groupStartIndex: 1, sourceIndex: 1, side: 'right', blank: false, splitSpread: true },
            { groupStartIndex: 2, sourceIndex: 2, side: 'left', blank: false, splitSpread: false },
            { groupStartIndex: 2, sourceIndex: 3, side: 'right', blank: false, splitSpread: false },
            { groupStartIndex: 4, sourceIndex: 4, side: 'left', blank: false, splitSpread: false },
            { groupStartIndex: 4, sourceIndex: null, side: 'right', blank: true, splitSpread: false },
        ],
    );
    assert.deepEqual([...model.pageToBookIndex], [[0, 0], [1, 2], [2, 4], [3, 4], [4, 6]]);
    assert.deepEqual([...model.bookToPageIndex], [
        [0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2], [6, 4], [7, 4],
    ]);
});

test('RTL 플립북 모델은 그룹과 일반 쌍만 뒤집고 분할 페이지의 물리적 좌우를 유지한다', () => {
    const model = buildFlipBookPageModel({
        pageCount: 4,
        spread: true,
        readingDirection: 'rtl',
        getStepSizeForIndex: index => index <= 1 ? 1 : 2,
        shouldSplitSinglePage: index => index === 1,
    });

    assert.deepEqual(
        model.entries.map(entry => ({
            groupStartIndex: entry.groupStartIndex,
            sourceIndex: entry.sourceIndex,
            side: entry.side,
            splitSpread: entry.splitSpread,
        })),
        [
            { groupStartIndex: 2, sourceIndex: 3, side: 'left', splitSpread: false },
            { groupStartIndex: 2, sourceIndex: 2, side: 'right', splitSpread: false },
            { groupStartIndex: 1, sourceIndex: 1, side: 'left', splitSpread: true },
            { groupStartIndex: 1, sourceIndex: 1, side: 'right', splitSpread: true },
            { groupStartIndex: 0, sourceIndex: 0, side: 'left', splitSpread: false },
            { groupStartIndex: 0, sourceIndex: null, side: 'right', splitSpread: false },
        ],
    );
    assert.deepEqual([...model.pageToBookIndex], [[2, 0], [3, 0], [1, 2], [0, 4]]);
});

test('첫 페이지와 마지막 페이지가 가로형이면 표지나 끝의 빈 leaf 없이 각각 분할한다', () => {
    const model = buildFlipBookPageModel({
        pageCount: 3,
        spread: true,
        getStepSizeForIndex: () => 1,
        shouldSplitSinglePage: index => index !== 1,
    });

    assert.deepEqual(
        model.entries.map(({ sourceIndex, side, blank, splitSpread }) => ({
            sourceIndex,
            side,
            blank,
            splitSpread,
        })),
        [
            { sourceIndex: 0, side: 'left', blank: false, splitSpread: true },
            { sourceIndex: 0, side: 'right', blank: false, splitSpread: true },
            { sourceIndex: 1, side: 'left', blank: false, splitSpread: false },
            { sourceIndex: null, side: 'right', blank: true, splitSpread: false },
            { sourceIndex: 2, side: 'left', blank: false, splitSpread: true },
            { sourceIndex: 2, side: 'right', blank: false, splitSpread: true },
        ],
    );
});

test('단독 페이지 분할 여부가 바뀌면 플립북 구조 키도 변경된다', () => {
    const commonOptions = {
        pageCount: 1,
        spread: true,
        readingDirection: 'ltr',
        getStepSizeForIndex: () => 1,
    };
    const portraitModel = buildFlipBookPageModel(commonOptions);
    const splitModel = buildFlipBookPageModel({
        ...commonOptions,
        shouldSplitSinglePage: () => true,
    });

    assert.notEqual(
        buildFlipBookStructureKey(portraitModel.entries),
        buildFlipBookStructureKey(splitModel.entries),
    );
});

test('가로 분할 페이지의 ambient는 같은 원본을 펼침면 전체에 한 번만 사용한다', () => {
    const entries = [
        { bookIndex: 0, groupStartIndex: 3, sourceIndex: 3, side: 'left', splitSpread: true },
        { bookIndex: 1, groupStartIndex: 3, sourceIndex: 3, side: 'right', splitSpread: true },
    ];

    assert.deepEqual(getFlipBookAmbientEntries(entries), [entries[0]]);
});

test('가로 분할 leaf는 같은 전체 이미지 프레임을 중앙 기준으로 이어서 자른다', () => {
    const frameStyle = {
        width: '820px',
        height: '460px',
        maxWidth: 'none',
        maxHeight: 'none',
    };
    const leftStyle = getSplitSpreadFrameStyle(frameStyle, 'left');
    const rightStyle = getSplitSpreadFrameStyle(frameStyle, 'right');

    assert.equal(leftStyle.width, rightStyle.width);
    assert.equal(leftStyle.height, rightStyle.height);
    assert.equal(leftStyle.left, '100%');
    assert.equal(rightStyle.left, '0');
    assert.equal(leftStyle.top, '50%');
    assert.equal(rightStyle.transform, 'translate(-50%, -50%)');

    const frameWidth = 820;
    const leafWidth = frameWidth / 2;
    const leftAnchor = leftStyle.left === '100%' ? leafWidth : Number.parseFloat(leftStyle.left);
    const rightAnchor = leafWidth + Number.parseFloat(rightStyle.left);
    const leftGlobalFrameOrigin = leftAnchor - (frameWidth / 2);
    const rightGlobalFrameOrigin = rightAnchor - (frameWidth / 2);
    assert.equal(leftGlobalFrameOrigin, rightGlobalFrameOrigin);
});

test('크기를 아직 모르는 가로 페이지도 두 leaf에 걸친 기본 프레임을 사용한다', () => {
    assert.deepEqual(getSplitSpreadFrameStyle(undefined, 'left'), {
        width: '200%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        flex: '0 0 auto',
        position: 'absolute',
        top: '50%',
        left: '100%',
        margin: 0,
        transform: 'translate(-50%, -50%)',
    });
});

test('페이지 수가 같아도 플립북 페이지 묶음이 바뀌면 구조 키가 변경된다', () => {
    const pairedPages = [
        { sourceIndex: 0, side: 'left' },
        { sourceIndex: 1, side: 'right' },
        { sourceIndex: 2, side: 'left' },
        { sourceIndex: 3, side: 'right' },
    ];
    const firstPageAlone = [
        { sourceIndex: null, side: 'left' },
        { sourceIndex: 0, side: 'right' },
        { sourceIndex: 1, side: 'left' },
        { sourceIndex: 2, side: 'right' },
        { sourceIndex: 3, side: 'left' },
        { sourceIndex: null, side: 'right' },
    ];

    assert.notEqual(
        buildFlipBookStructureKey(pairedPages),
        buildFlipBookStructureKey(firstPageAlone),
    );
});

test('플립북 페이지 내용만 갱신될 때는 구조 키가 유지된다', () => {
    const before = [
        { sourceIndex: null, side: 'left', renderState: 'loading' },
        { sourceIndex: 0, side: 'right', renderState: 'loading' },
    ];
    const after = [
        { sourceIndex: null, side: 'left', renderState: 'ready' },
        { sourceIndex: 0, side: 'right', renderState: 'ready' },
    ];

    assert.equal(buildFlipBookStructureKey(before), buildFlipBookStructureKey(after));
});

test('플립북 ambient 레이어는 현재 펼침면의 페이지만 선택한다', () => {
    const entries = [
        { bookIndex: 0, groupStartIndex: 0, sourceIndex: null, side: 'left' },
        { bookIndex: 1, groupStartIndex: 0, sourceIndex: 0, side: 'right' },
        { bookIndex: 2, groupStartIndex: 1, sourceIndex: 1, side: 'left' },
        { bookIndex: 3, groupStartIndex: 1, sourceIndex: 2, side: 'right' },
    ];

    assert.deepEqual(
        getFlipBookCurrentGroupEntries(entries, 1).map(entry => entry.sourceIndex),
        [null, 0],
    );
    assert.deepEqual(
        getFlipBookCurrentGroupEntries(entries, 2).map(entry => entry.sourceIndex),
        [1, 2],
    );
});

test('플립북 고품질 렌더링은 현재 펼침면과 앞뒤 펼침면만 선택한다', () => {
    const entries = Array.from({ length: 8 }, (_, bookIndex) => ({
        bookIndex,
        groupStartIndex: bookIndex - (bookIndex % 2),
        sourceIndex: bookIndex,
        side: bookIndex % 2 === 0 ? 'left' : 'right',
    }));

    assert.deepEqual(
        getFlipBookNearbyGroupEntries(entries, 3).map(entry => entry.bookIndex),
        [0, 1, 2, 3, 4, 5],
    );
    assert.deepEqual(
        getFlipBookNearbyGroupEntries(entries, 0).map(entry => entry.bookIndex),
        [0, 1, 2, 3],
    );
    assert.deepEqual(
        getFlipBookNearbyGroupEntries([...entries].reverse(), 4).map(entry => entry.bookIndex),
        [7, 6, 5, 4, 3, 2],
    );
});

test('RTL 플립북의 현재 표시 인접 집합은 페이지 순서와 빈 leaf를 보존한다', () => {
    const entries = [
        { bookIndex: 0, groupStartIndex: 5, sourceIndex: null, blank: true, side: 'left' },
        { bookIndex: 1, groupStartIndex: 5, sourceIndex: 5, blank: false, side: 'right' },
        { bookIndex: 2, groupStartIndex: 3, sourceIndex: 4, blank: false, side: 'left' },
        { bookIndex: 3, groupStartIndex: 3, sourceIndex: 3, blank: false, side: 'right' },
        { bookIndex: 4, groupStartIndex: 1, sourceIndex: 2, blank: false, side: 'left' },
        { bookIndex: 5, groupStartIndex: 1, sourceIndex: 1, blank: false, side: 'right' },
        { bookIndex: 6, groupStartIndex: 0, sourceIndex: 0, blank: false, side: 'left' },
        { bookIndex: 7, groupStartIndex: 0, sourceIndex: null, blank: true, side: 'right' },
    ];
    const currentEntries = getFlipBookCurrentGroupEntries(entries, 2);
    const displayedEntries = getFlipBookCurrentGroupEntries(entries, 4);
    const nearbyEntries = getFlipBookNearbyGroupEntries(entries, 2);
    const initialBookIndexes = new Set([
        ...currentEntries.map(entry => entry.bookIndex),
        ...displayedEntries.map(entry => entry.bookIndex),
    ]);
    const preloadedBookIndexes = new Set([
        ...initialBookIndexes,
        ...nearbyEntries.map(entry => entry.bookIndex),
    ]);

    assert.deepEqual(currentEntries.map(entry => entry.sourceIndex), [4, 3]);
    assert.deepEqual(displayedEntries.map(entry => entry.sourceIndex), [2, 1]);
    assert.deepEqual(nearbyEntries.map(entry => entry.sourceIndex), [null, 5, 4, 3, 2, 1]);
    assert.deepEqual([...initialBookIndexes], [2, 3, 4, 5]);
    assert.deepEqual([...preloadedBookIndexes], [2, 3, 4, 5, 0, 1]);
});

test('플립북은 전체 leaf shell을 유지하고 현재 펼침면부터 인접 펼침면까지만 단계적으로 마운트한다', () => {
    assert.match(
        viewerFlipBookSource,
        /const pageElements = useMemo\(\(\) => model\.entries\.map\(entry => \(/,
    );
    assert.match(
        viewerSource,
        /if \(renderState\.mountedBookIndexes && !renderState\.mountedBookIndexes\.has\(entry\.bookIndex\)\) return null;/,
    );
    assert.match(
        viewerFlipBookSource,
        /const mountedBookIndexes = useMemo\(\(\) => \{[\s\S]*?\.\.\.currentGroupEntries\.map\(entry => entry\.bookIndex\),[\s\S]*?\.\.\.displayedGroupEntries\.map\(entry => entry\.bookIndex\),/,
    );
    assert.match(
        viewerFlipBookSource,
        /if \(nearbyPreloadPhase >= 1\) \{\s*nearbyBookIndexes\?\.forEach\(bookIndex => indexes\.add\(bookIndex\)\);/,
    );
});

test('플립북 페이지 렌더 상태는 현재 펼침면과 인접 펼침면을 구분한다', () => {
    assert.match(
        viewerFlipBookSource,
        /const currentGroupEntries = useMemo\(\s*\(\) => getFlipBookCurrentGroupEntries\(model\.entries, currentBookIndex\)/,
    );
    assert.match(
        viewerFlipBookSource,
        /const currentBookIndexes = useMemo\(\s*\(\) => new Set\(currentGroupEntries\.map\(entry => entry\.bookIndex\)\)/,
    );
    assert.match(
        viewerFlipBookSource,
        /const nearbyBookIndexes = useMemo\([\s\S]*?getFlipBookNearbyGroupEntries\(model\.entries, currentBookIndex\)/,
    );
    assert.match(
        viewerSource,
        /isCurrentGroup:\s*renderState\.currentBookIndexes\?\.has\(entry\.bookIndex\) \|\| false/,
    );
    assert.match(
        viewerSource,
        /isNearCurrent:\s*renderState\.nearbyBookIndexes\?\.has\(entry\.bookIndex\) \|\| false/,
    );
});

test('초기 로딩 중에는 현재 및 표시 중인 펼침면만 고품질로 렌더링한다', () => {
    assert.match(
        viewerFlipBookSource,
        /if \(initialRenderLoading \|\| effectiveDisplayedBookIndex !== currentBookIndex\) \{[\s\S]*?\{ key: preloadKey, phase: 0 \}/,
    );
    assert.match(
        viewerFlipBookSource,
        /const highQualityBookIndexes = useMemo\(\(\) => \{[\s\S]*?\.\.\.currentGroupEntries\.map\(entry => entry\.bookIndex\),[\s\S]*?\.\.\.displayedGroupEntries\.map\(entry => entry\.bookIndex\),[\s\S]*?if \(nearbyPreloadPhase >= 2\) \{\s*nearbyBookIndexes\?\.forEach\(bookIndex => indexes\.add\(bookIndex\)\);/,
    );
    assert.match(
        viewerSource,
        /shouldRenderHighQuality:\s*renderState\.highQualityBookIndexes\?\.has\(entry\.bookIndex\) \|\| false/,
    );
    assert.match(
        viewerSource,
        /highQuality:\s*Boolean\(renderState\?\.shouldRenderHighQuality\)/,
    );
});

test('플립북 ambient는 저장된 현재 펼침면에서 시작하고 초기 본문 렌더 뒤에 마운트한다', () => {
    assert.doesNotMatch(
        viewerFlipBookSource,
        /const \[ambientBookIndex, setAmbientBookIndex\] = useState\(0\)/,
    );
    assert.match(
        viewerFlipBookSource,
        /const \[ambientBookIndex, setAmbientBookIndex\] = useState\(\(\) => currentBookIndex\)/,
    );
    assert.match(
        viewerSource,
        /renderAmbientPage=\{backgroundMode === 'immersive' && !initialRenderLoading \? \(sourceIndex, entry\) => \{/,
    );
});

test('가로형 페이지 발견으로 플립북 구조가 바뀌어도 표시 중인 원본 페이지를 보존한다', () => {
    assert.match(
        viewerFlipBookSource,
        /const displayedSourceIndexRef = useRef\(currentSourceIndex\)/,
    );
    assert.match(
        viewerFlipBookSource,
        /const remappedDisplayedBookIndex = model\.pageToBookIndex\.get\(preservedDisplayedSourceIndex\)[\s\S]*?initialBookIndexRef\.current = remappedDisplayedBookIndex/,
    );
    assert.match(
        viewerFlipBookSource,
        /const displayedGroupEntries = useMemo\(\s*\(\) => getFlipBookCurrentGroupEntries\(model\.entries, effectiveDisplayedBookIndex\)/,
    );
    assert.match(
        viewerFlipBookSource,
        /pageChangeStateRef\.current = \{ currentBookIndex, model, onPageIndexChange, spread \}[\s\S]*?if \(normalizedBookIndex !== pageChangeState\.currentBookIndex\) return/,
    );
});

test('만화 책넘김은 가로 단독 페이지를 같은 전체 이미지의 좌우 leaf로 렌더링한다', () => {
    assert.match(viewerSource, /shouldSplitSinglePage=\{isComicLandscapePage\}/);
    assert.match(
        viewerSource,
        /entry\?\.splitSpread[\s\S]*?getSplitSpreadFrameStyle\([\s\S]*?getComicImageStyle\(page, 1, flipBookRenderZoom\)[\s\S]*?entry\.side/,
    );
    assert.match(viewerSource, /data-spread-segment=\{entry\.splitSpread \? entry\.side : undefined\}/);
    assert.match(
        viewerSource,
        /getFlipBookAmbientEntries\(layer\.entries\)[\s\S]*?entry\.splitSpread && 'is-split-spread'/,
    );
    assert.match(
        viewerCss,
        /\.viewer-flipbook-ambient-slot\.is-split-spread \{\s*flex:\s*1 0 100%;\s*justify-content:\s*center;/,
    );
    assert.match(
        viewerCss,
        /\.viewer-comic-stage\.is-spread:not\(\.viewer-flipbook-stage\) \.viewer-page-transition-layer\.has-spread-pair \.viewer-comic-image/,
    );
});

test('몰입형 책넘김의 본문 프레임은 중복 ambient 캔버스를 생성하지 않는다', () => {
    assert.match(comicPageFrameSource, /renderAmbientCanvas = true/);
    assert.match(comicPageFrameSource, /if \(!renderAmbientCanvas\) return false;/);
    assert.match(comicPageFrameSource, /\{renderAmbientCanvas && \(\s*<span className="viewer-ambient-clip"/);
    assert.match(
        viewerSource,
        /renderAmbientCanvas=\{options\.renderAmbientCanvas !== false && backgroundMode === 'immersive'\}/,
    );
    assert.match(
        viewerSource,
        /renderPage=\{\(sourceIndex, entry, renderState\) => \{[\s\S]*?renderAmbientCanvas:\s*false/,
    );
});

test('절대 페이지 이동은 진행 중인 애니메이션을 끝낸 뒤 목표 펼침면을 선택한다', () => {
    const calls = [];
    const pageFlip = {
        getRender: () => ({
            finishAnimation: () => calls.push('finish'),
        }),
        turnToPage: index => calls.push(`turn:${index}`),
    };

    assert.equal(finishAndTurnFlipBookToPage(pageFlip, 0), true);
    assert.deepEqual(calls, ['finish', 'turn:0']);
    assert.match(
        viewerFlipBookSource,
        /absoluteTargetBookIndexRef\.current != null[\s\S]*?absoluteTargetBookIndexRef\.current !== currentBookIndex[\s\S]*?absoluteTargetBookIndexRef\.current = null/,
    );
});

test('몰입형 배경은 책넘김 효과와 함께 유지된다', () => {
    assert.match(
        viewerSource,
        /const backgroundMode = supportsBackgroundSettings\s*\? viewerBackground\.mode\s*:\s*'solid';/,
    );
    assert.doesNotMatch(
        viewerSource,
        /supportsBackgroundSettings\s*&&\s*readerSettings\.pageEffect\s*!==\s*'page'/,
    );
    assert.match(viewerSource, /viewer\.toast\.page_turn_effect_notice[\s\S]*몰입형 배경과 함께 사용할 수 있습니다/);
    assert.match(i18nSource, /Page turn is applied in two-page mode and can be used with the immersive background\./);
    assert.match(i18nSource, /ページめくり効果は2ページ表示で適用され、没入型背景と併用できます。/);
});

test('책넘김 페이지는 라이브러리 초기화가 끝난 뒤 표시된다', () => {
    assert.match(
        viewerCss,
        /\.viewer-flipbook > div:first-child:not\(\.stf__parent\) \{\s*visibility:\s*hidden;/,
    );
    assert.match(viewerCss, /\.viewer-flipbook \.stf__parent,/);
});

test('책넘김 몰입형 배경은 플립 변형 밖의 독립 레이어에서 표시된다', () => {
    assert.match(viewerSource, /className="viewer-flipbook-ambient-layer"/);
    assert.match(viewerSource, /renderAmbientPage=\{backgroundMode === 'immersive'/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-layer \{[\s\S]*position:\s*absolute;[\s\S]*overflow:\s*visible;/);
    assert.match(viewerCss, /\.viewer-app\.is-background-immersive \.viewer-flipbook-page\.is-comic \.viewer-ambient-canvas \{\s*opacity:\s*0;/);
});

test('책넘김 시 이전 배경과 새 배경은 같은 프레임에서 밝기 저하 없이 교차 페이드된다', () => {
    assert.match(viewerSource, /const outgoingLayer = \[\.\.\.current\]\.reverse\(\)\.find\(layer => layer\.visible\)/);
    assert.match(viewerSource, /\.\.\.\(outgoingLayer \? \[outgoingLayer\] : \[\]\)/);
    assert.match(viewerSource, /visible:\s*layer\.id === nextLayerId/);
    assert.match(viewerSource, /BOOK_PAGE_TURN_DURATION \+ BOOK_AMBIENT_FADE_CLEANUP_BUFFER/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-layer \{[\s\S]*isolation:\s*isolate;/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer \{[\s\S]*transition:\s*opacity var\(--viewer-flipbook-ambient-fade-duration, 320ms\) ease-in-out;/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer \{[\s\S]*mix-blend-mode:\s*plus-lighter;/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer\.is-visible \{\s*opacity:\s*1;/);
});

test('책넘김 전용 몰입형 배경에서는 하단 그라데이션이 페이지마다 다시 전환되지 않는다', () => {
    assert.match(
        viewerSource,
        /const flipBookAmbientActive = backgroundMode === 'immersive'[\s\S]*?session\?\.type === 'comic'[\s\S]*?flowMode === 'spread'[\s\S]*?readerSettings\.pageEffect === 'page';/,
    );
    assert.match(
        viewerSource,
        /backgroundImage: immersiveGradientForPage\(flipBookAmbientActive \? 0 : ambientTurnActive \? pageTurn\.fromIndex : pageIndex\)/,
    );
});

test('두장보기 Home과 End 이동은 진행 중인 애니메이션을 끝내고 목표 펼침면으로 즉시 이동한다', () => {
    assert.match(viewerSource, /const \[absolutePageJumpSequence, setAbsolutePageJumpSequence\] = useState\(0\)/);
    assert.match(viewerSource, /absoluteTargetBookIndexRef\.current = currentBookIndex/);
    assert.match(viewerSource, /finishAndTurnFlipBookToPage\(pageFlip, currentBookIndex\)/);
    assert.match(viewerSource, /if \(normalizedBookIndex !== absoluteTargetBookIndexRef\.current\) return/);
    assert.doesNotMatch(viewerSource, /flipBookRef\.current\?\.flip\?\.\(currentBookIndex\)/);
    assert.match(viewerSource, /event\.key === 'Home'[\s\S]*?goNavigationPage\(0\)/);
    assert.match(viewerSource, /event\.key === 'End'[\s\S]*?goNavigationPage\(lastPageIndex\)/);
});
