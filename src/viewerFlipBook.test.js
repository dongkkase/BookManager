import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    buildFlipBookStructureKey,
    finishAndTurnFlipBookToPage,
    getFlipBookCurrentGroupEntries,
    getFlipBookNearbyGroupEntries,
} from './viewerFlipBook.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('./utils/i18n.js', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

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
    assert.match(viewerSource, /setLayers\(current => \[\s*\.\.\.current,\s*\{ id: nextLayerId, groupKey, entries, visible: false \},\s*\]\)/);
    assert.match(viewerSource, /visible:\s*layer\.id === nextLayerId/);
    assert.match(viewerSource, /BOOK_PAGE_TURN_DURATION \+ BOOK_AMBIENT_FADE_CLEANUP_BUFFER/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-layer \{[\s\S]*isolation:\s*isolate;/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer \{[\s\S]*transition:\s*opacity var\(--viewer-flipbook-ambient-fade-duration, 720ms\) ease-in-out;/);
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
