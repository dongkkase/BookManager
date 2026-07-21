import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildFlipBookStructureKey, getFlipBookCurrentGroupEntries } from './viewerFlipBook.js';

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

test('책넘김 시 이전 배경과 새 배경이 책넘김 시간에 맞춰 교차 페이드된다', () => {
    assert.match(viewerSource, /current\.map\(layer => \(\{ \.\.\.layer, visible: false \}\)\)/);
    assert.match(viewerSource, /visible:\s*layer\.id === nextLayerId/);
    assert.match(viewerSource, /BOOK_PAGE_TURN_DURATION \+ BOOK_AMBIENT_FADE_CLEANUP_BUFFER/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer \{[\s\S]*transition:\s*opacity var\(--viewer-flipbook-ambient-fade-duration, 720ms\) ease-in-out;/);
    assert.match(viewerCss, /\.viewer-flipbook-ambient-fade-layer\.is-visible \{\s*opacity:\s*1;/);
});
