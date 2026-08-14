import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildComicSlideThumbGroups } from './viewerComicSlideThumbs.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

function comicPages(count) {
    return Array.from({ length: count }, (_, index) => ({
        name: `${String(index + 1).padStart(3, '0')}.jpg`,
    }));
}

test('두 장 보기 썸네일은 표지를 단독으로 두고 이후 페이지를 펼침면으로 묶는다', () => {
    const pages = comicPages(6);
    const groups = buildComicSlideThumbGroups({
        pages,
        spread: true,
        readingDirection: 'ltr',
        getStepSizeForIndex: index => index === 0 ? 1 : 2,
    });

    assert.deepEqual(
        groups.map(group => ({
            groupStartIndex: group.groupStartIndex,
            pageIndexes: group.pageIndexes,
            pageNames: group.pages.map(page => page.name),
        })),
        [
            { groupStartIndex: 0, pageIndexes: [0], pageNames: ['001.jpg'] },
            { groupStartIndex: 1, pageIndexes: [1, 2], pageNames: ['002.jpg', '003.jpg'] },
            { groupStartIndex: 3, pageIndexes: [3, 4], pageNames: ['004.jpg', '005.jpg'] },
            { groupStartIndex: 5, pageIndexes: [5], pageNames: ['006.jpg'] },
        ],
    );
});

test('RTL 두 장 보기 썸네일은 그룹 순서와 이동 대상은 유지하고 그룹 안의 시각 순서만 뒤집는다', () => {
    const pages = comicPages(5);
    const groups = buildComicSlideThumbGroups({
        pages,
        spread: true,
        readingDirection: 'rtl',
        getStepSizeForIndex: index => index === 0 ? 1 : 2,
    });

    assert.deepEqual(groups.map(group => group.groupStartIndex), [0, 1, 3]);
    assert.deepEqual(groups.map(group => group.pageIndexes), [[0], [2, 1], [4, 3]]);
    assert.deepEqual(
        groups.map(group => group.pages.map(page => page.name)),
        [['001.jpg'], ['003.jpg', '002.jpg'], ['005.jpg', '004.jpg']],
    );
});

test('가로형 페이지와 그 직전 페이지는 각각 단독 썸네일이 된다', () => {
    const pages = [
        { name: '001.jpg', ratio: 0.7 },
        { name: '002.jpg', ratio: 1.5 },
        { name: '003.jpg', ratio: 0.7 },
        { name: '004.jpg', ratio: 0.7 },
        { name: '005.jpg', ratio: 1.5 },
    ];
    const groups = buildComicSlideThumbGroups({
        pages,
        spread: true,
        getStepSizeForIndex: index => {
            const currentPage = pages[index];
            const nextPage = pages[index + 1];
            if ((currentPage?.ratio || 0) > 1 || (nextPage?.ratio || 0) > 1) return 1;
            return 2;
        },
    });

    assert.deepEqual(groups.map(group => group.pageIndexes), [[0], [1], [2, 3], [4]]);
    assert.deepEqual(
        groups.filter(group => group.pages.some(page => page.ratio > 1)).map(group => group.pages.length),
        [1, 1],
    );
});

test('합쳐진 썸네일의 클릭 대상은 RTL에서도 해당 펼침면의 논리 시작 페이지다', () => {
    const groups = buildComicSlideThumbGroups({
        pages: comicPages(5),
        spread: true,
        readingDirection: 'rtl',
        getStepSizeForIndex: index => index === 0 ? 1 : 2,
    });
    const pairedGroup = groups.find(group => group.pageIndexes.includes(2));

    assert.deepEqual(pairedGroup.pageIndexes, [2, 1]);
    assert.equal(pairedGroup.groupStartIndex, 1);
});

test('만화 슬라이드 탐색기는 그룹을 렌더링하고 클릭 시 펼침면 시작 페이지로 이동한다', () => {
    assert.match(
        viewerSource,
        /const comicSlideThumbGroups = buildComicSlideThumbGroups\(\{\s*pages,\s*spread: flowMode === 'spread',\s*readingDirection,\s*getStepSizeForIndex,\s*\}\);/,
    );
    assert.match(viewerSource, /return comicSlideThumbGroups\.map\(group => \{/);
    assert.match(viewerSource, /const items = group\.pageIndexes\.map\(\(index, itemIndex\) => \{/);
    assert.match(viewerSource, /active=\{group\.pageIndexes\.includes\(pageIndex\)\}/);
    assert.match(
        viewerSource,
        /onClick=\{runToolbarAction\(\(\) => goSlideNavPage\(group\.groupStartIndex\)\)\}/,
    );
});

test('두 장 썸네일은 넓어진 한 버튼 안에서 두 페이지가 같은 폭을 나눠 가진다', () => {
    assert.match(viewerSource, /const isSpread = items\.length > 1;/);
    assert.match(viewerSource, /isSpread && 'is-spread'/);
    assert.match(viewerSource, /\{items\.map\(item => \(\s*<span[\s\S]*?className="viewer-slide-thumb-comic-page"/);
    assert.match(
        viewerCss,
        /\.viewer-slide-thumb\.is-comic\.is-spread \{\s*width:\s*110px;/,
    );
    assert.match(
        viewerCss,
        /\.viewer-slide-thumb\.is-comic\.is-spread \.viewer-slide-thumb-comic-page \{\s*flex:\s*1 1 0;\s*width:\s*auto;/,
    );
});

test('한 장 보기에서는 모든 썸네일이 원본 페이지 하나와 같은 이동 대상을 가진다', () => {
    const groups = buildComicSlideThumbGroups({
        pages: comicPages(3),
        spread: false,
        readingDirection: 'rtl',
        getStepSizeForIndex: () => 2,
    });

    assert.deepEqual(groups.map(group => group.pageIndexes), [[0], [1], [2]]);
    assert.deepEqual(groups.map(group => group.groupStartIndex), [0, 1, 2]);
});
