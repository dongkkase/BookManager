import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildComicSlideThumbGroups } from './viewerComicSlideThumbs.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

function componentSource(componentName, nextComponentName) {
    const start = viewerSource.indexOf(`function ${componentName}(`);
    const end = viewerSource.indexOf(`\nfunction ${nextComponentName}(`, start);

    assert.notEqual(start, -1, `${componentName} 컴포넌트를 찾을 수 없습니다.`);
    assert.notEqual(end, -1, `${nextComponentName} 컴포넌트를 찾을 수 없습니다.`);
    return viewerSource.slice(start, end);
}

test('만화 슬라이드 탐색 방향은 읽기 방향을 따르고 다른 뷰어는 LTR을 유지한다', () => {
    assert.match(
        viewerSource,
        /const slideNavDirection = session\?\.type === 'comic' && readingDirection === 'rtl' \? 'rtl' : 'ltr';/,
    );
    assert.match(
        viewerSource,
        /className="viewer-slide-strip"[\s\S]*?dir=\{slideNavDirection\}/,
    );
});

test('RTL에서는 첫 논리 그룹이 오른쪽부터 흐르고 펼침면 내부 시각 순서는 한 번만 반전된다', () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({ name: `${index + 1}.jpg` }));
    const groups = buildComicSlideThumbGroups({
        pages,
        spread: true,
        readingDirection: 'rtl',
        getStepSizeForIndex: index => index === 0 ? 1 : 2,
    });

    assert.deepEqual(groups.map(group => group.groupStartIndex), [0, 1, 3]);
    assert.deepEqual(groups.map(group => group.pageIndexes), [[0], [2, 1], [4, 3]]);
    assert.match(viewerSource, /return comicSlideThumbGroups\.map\(group => \{/);
    assert.match(
        viewerCss,
        /\.viewer-slide-strip\[dir=["']rtl["']\]\s*>\s*\.viewer-slide-thumb\s*\{[\s\S]*?direction:\s*ltr;/,
    );
});

test('RTL 슬라이드 탐색기는 세로 휠을 반전하고 네이티브 가로 휠 값은 유지한다', () => {
    const callbackStart = viewerSource.indexOf('const handleSlideNavWheel = useCallback');
    const callbackEnd = viewerSource.indexOf('\n\n  useEffect(() => {', callbackStart);

    assert.notEqual(callbackStart, -1, '슬라이드 탐색기 휠 핸들러를 찾을 수 없습니다.');
    assert.notEqual(callbackEnd, -1, '슬라이드 탐색기 휠 핸들러의 끝을 찾을 수 없습니다.');
    const callbackSource = viewerSource.slice(callbackStart, callbackEnd);

    assert.match(callbackSource, /const isRtl = event\.currentTarget\.dir === 'rtl';/);
    assert.match(
        callbackSource,
        /const horizontalDelta = event\.deltaY\s*\? \(isRtl \? -event\.deltaY : event\.deltaY\)\s*: event\.deltaX;/,
    );
    assert.match(callbackSource, /scrollBy\(\{\s*left:\s*horizontalDelta,/);
});

test('읽기 방향 변경 시 활성 만화 썸네일을 새 흐름의 가운데로 다시 정렬한다', () => {
    const comicThumbSource = componentSource('ComicSlideThumb', 'ReaderSlideThumb');

    assert.match(comicThumbSource, /function ComicSlideThumb\(\{[\s\S]*?navigationDirection[\s\S]*?\}\)/);
    assert.match(
        comicThumbSource,
        /scrollIntoView\?\.\(\{\s*block:\s*'nearest',\s*inline:\s*'center'\s*\}\);/,
    );
    assert.match(comicThumbSource, /\}, \[active, navigationDirection\]\);/);
    assert.match(
        viewerSource,
        /<ComicSlideThumb[\s\S]*?navigationDirection=\{slideNavDirection\}/,
    );
});
