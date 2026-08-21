import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildSlideThumbGroups } from './viewerComicSlideThumbs.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

function slideItems(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `page-${index + 1}`,
    }));
}

function componentSource(componentName, nextComponentName) {
    const start = viewerSource.indexOf(`function ${componentName}(`);
    const end = viewerSource.indexOf(`\nfunction ${nextComponentName}(`, start);

    assert.notEqual(start, -1, `${componentName} 컴포넌트를 찾을 수 없습니다.`);
    assert.notEqual(end, -1, `${nextComponentName} 컴포넌트를 찾을 수 없습니다.`);
    return viewerSource.slice(start, end);
}

test('일반 두 장 보기 그룹은 PDF와 리더 항목을 두 페이지씩 묶고 홀수 마지막 페이지는 단독으로 둔다', () => {
    const groups = buildSlideThumbGroups({
        items: slideItems(5),
        spread: true,
    });

    assert.deepEqual(groups.map(group => group.groupStartIndex), [0, 2, 4]);
    assert.deepEqual(groups.map(group => group.pageIndexes), [[0, 1], [2, 3], [4]]);
    assert.deepEqual(
        groups.map(group => group.items.map(page => page.id)),
        [['page-1', 'page-2'], ['page-3', 'page-4'], ['page-5']],
    );
});

test('한 장 보기 그룹은 PDF와 리더의 모든 페이지를 각각 별도 탐색 항목으로 유지한다', () => {
    const groups = buildSlideThumbGroups({
        items: slideItems(3),
        spread: false,
    });

    assert.deepEqual(groups.map(group => group.groupStartIndex), [0, 1, 2]);
    assert.deepEqual(groups.map(group => group.pageIndexes), [[0], [1], [2]]);
});

test('11·12페이지 펼침면에서 12페이지 선택 인덱스는 유지하고 렌더 시작점만 11페이지로 계산한다', () => {
    const groups = buildSlideThumbGroups({
        items: slideItems(12),
        spread: true,
    });
    const selectedPageIndex = 11;
    const renderGroup = groups.find(group => group.pageIndexes.includes(selectedPageIndex));

    assert.equal(selectedPageIndex, 11);
    assert.deepEqual(renderGroup.pageIndexes, [10, 11]);
    assert.equal(renderGroup.groupStartIndex, 10);
});

test('선택 페이지 옵션은 공통 동기화 함수를 통해 PDF와 EPUB/TXT 이동 경로까지 전달된다', () => {
    assert.match(viewerSource, /const \[selectedPageIndex, setSelectedPageIndex\] = useState\(0\);/);

    const syncStart = viewerSource.indexOf('const setPageIndexSynced = useCallback');
    const syncEnd = viewerSource.indexOf('\n\n  useEffect(() => {', syncStart);
    const pdfStart = viewerSource.indexOf('const goPdfPage = useCallback');
    const readerStart = viewerSource.indexOf('const goPageIndex = useCallback', pdfStart);
    const readerEnd = viewerSource.indexOf('\n\n  useEffect(() => {', readerStart);

    assert.notEqual(syncStart, -1, '페이지 인덱스 동기화 함수를 찾을 수 없습니다.');
    assert.notEqual(syncEnd, -1, '페이지 인덱스 동기화 함수의 끝을 찾을 수 없습니다.');
    assert.notEqual(pdfStart, -1, 'PDF 페이지 이동 함수를 찾을 수 없습니다.');
    assert.notEqual(readerStart, -1, '공통 페이지 이동 함수를 찾을 수 없습니다.');
    assert.notEqual(readerEnd, -1, '공통 페이지 이동 함수의 끝을 찾을 수 없습니다.');

    const syncSource = viewerSource.slice(syncStart, syncEnd);
    const pdfSource = viewerSource.slice(pdfStart, readerStart);
    const readerSource = viewerSource.slice(readerStart, readerEnd);
    assert.match(syncSource, /Number\(options\.selectedPageIndex\)/);
    assert.match(syncSource, /setSelectedPageIndex\(normalizedSelectedPageIndex\);/);
    assert.match(pdfSource, /setPageIndexSynced\(targetIndex, options\);/);
    assert.match(readerSource, /goPdfPage\(targetIndex, options\);/);
    assert.match(readerSource, /setPageIndexSynced\(targetIndex, options\);/);
});

test('두 장 보기에서 목차로 펼침면의 두 번째 페이지를 선택해도 별도 선택 인덱스를 유지한다', () => {
    const resolverStart = viewerSource.indexOf('const resolveSpreadNavigationIndex = useCallback');
    const movePageStart = viewerSource.indexOf('\n  const movePage = useCallback', resolverStart);

    assert.notEqual(resolverStart, -1, '두 장 보기 이동 페이지 계산 함수를 찾을 수 없습니다.');
    assert.notEqual(movePageStart, -1, '두 장 보기 페이지 계산 영역의 끝을 찾을 수 없습니다.');
    const normalizationSource = viewerSource.slice(resolverStart, movePageStart);

    assert.match(
        normalizationSource,
        /return resolveSpreadPageStartIndex\([\s\S]*?session\?\.type === 'comic' \? getStepSizeForIndex : undefined/,
    );
    assert.match(
        normalizationSource,
        /if \(flowMode !== 'spread'\) \{\s*const restoredPageIndex = clamp\(selectedPageIndex, 0, Math\.max\(0, pageCount - 1\)\);\s*if \(pageIndex !== restoredPageIndex\) setPageIndexSynced\(restoredPageIndex\);\s*return;\s*\}/,
    );
    assert.match(
        normalizationSource,
        /\['comic', 'pdf', 'epub', 'text'\]\.includes\(session\?\.type\)/,
    );
    assert.match(
        normalizationSource,
        /const normalizationTargetPageIndex = session\?\.type === 'comic'[\s\S]*?\? clamp\(selectedPageIndex,[\s\S]*?: pageIndex;/,
    );
    assert.match(
        normalizationSource,
        /selectedPageIndex: session\?\.type === 'comic' \? normalizationTargetPageIndex : pageIndex/,
    );
    assert.match(
        normalizationSource,
        /\[flowMode, pageCount, pageCountReadyForNavigation, pageIndex, resolveSpreadNavigationIndex, selectedPageIndex, session\?\.type, setPageIndexSynced\]/,
    );

    const activeTocStart = viewerSource.indexOf('const activeTocId = useMemo');
    const navigationThumbnailStart = viewerSource.indexOf('\n  const navigationThumbnailSrc = useMemo', activeTocStart);
    assert.notEqual(activeTocStart, -1, '활성 목차 계산 영역을 찾을 수 없습니다.');
    assert.notEqual(navigationThumbnailStart, -1, '활성 목차 계산 영역의 끝을 찾을 수 없습니다.');
    const activeTocSource = viewerSource.slice(activeTocStart, navigationThumbnailStart);
    assert.match(activeTocSource, /const currentPageIndex = clamp\(selectedPageIndex,/);
    assert.match(activeTocSource, /\[pageCount, selectedPageIndex, tocItems\]/);

    const readerSource = viewerSource.slice(
        viewerSource.indexOf('const renderReaderPages = items =>'),
        viewerSource.indexOf('\n  const renderPdf = () =>'),
    );
    const pdfSource = viewerSource.slice(
        viewerSource.indexOf('const renderPdf = () =>'),
        viewerSource.indexOf('\n  const renderContent = () =>'),
    );
    assert.match(readerSource, /const displayStartIndex = pageIndex;/);
    assert.match(pdfSource, /const displayStartIndex = pageIndex;/);
});

test('목차와 EPUB 내부 목차 이동은 렌더 시작점과 실제 선택 페이지를 함께 전달한다', () => {
    const epubTargetStart = viewerSource.indexOf('const goEpubInternalTarget = useCallback');
    const navigationStart = viewerSource.indexOf('\n  const goNavigationPage = useCallback', epubTargetStart);
    const slideNavigationStart = viewerSource.indexOf('\n  const goSlideNavPage = useCallback', navigationStart);

    assert.notEqual(epubTargetStart, -1, 'EPUB 내부 목차 이동 함수를 찾을 수 없습니다.');
    assert.notEqual(navigationStart, -1, '목차 이동 함수를 찾을 수 없습니다.');
    assert.notEqual(slideNavigationStart, -1, '목차 이동 함수의 끝을 찾을 수 없습니다.');
    const epubTargetSource = viewerSource.slice(epubTargetStart, navigationStart);
    const navigationSource = viewerSource.slice(navigationStart, slideNavigationStart);

    const spreadSelectionNavigationPattern = /goPageIndex\(\s*resolveSpreadNavigationIndex\(resolvedPageIndex\),\s*\{\s*selectedPageIndex:\s*resolvedPageIndex,?\s*\}\s*\);/;
    assert.match(epubTargetSource, spreadSelectionNavigationPattern);
    assert.match(navigationSource, spreadSelectionNavigationPattern);
});

test('PDF 슬라이드 탐색기는 펼침면 그룹의 활성 상태와 시작 페이지 이동을 사용한다', () => {
    assert.match(viewerSource, /const pdfSlideThumbGroups = buildSlideThumbGroups\(\{/);
    assert.match(viewerSource, /return pdfSlideThumbGroups\.map\(group =>/);
    assert.match(viewerSource, /<PdfSlideThumb[\s\S]*?active=\{group\.pageIndexes\.includes\(pageIndex\)\}/);
    assert.match(
        viewerSource,
        /<PdfSlideThumb[\s\S]*?onClick=\{runToolbarAction\(\(\) => goSlideNavPage\(group\.groupStartIndex\)\)\}/,
    );
});

test('PDF 펼침면 썸네일은 한 버튼 안에 비버튼 페이지 슬롯 두 개를 배치한다', () => {
    const pageSource = componentSource('PdfThumbnailCanvas', 'PdfSlideThumb');
    const thumbSource = componentSource('PdfSlideThumb', 'ComicSlideThumb');

    assert.doesNotMatch(pageSource, /<button\b/);
    assert.match(thumbSource, /<button\b/);
    assert.equal((thumbSource.match(/<button\b/g) || []).length, 1);
    assert.match(thumbSource, /\{items\.map\(item => \([\s\S]*?<PdfThumbnailCanvas/);
});

test('EPUB과 TXT 슬라이드 탐색기는 펼침면 그룹의 활성 상태와 시작 페이지 이동을 사용한다', () => {
    assert.match(viewerSource, /const readerSlideThumbGroups = buildSlideThumbGroups\(\{/);
    assert.match(viewerSource, /readerSlideThumbGroups[\s\S]*?\.map\(group =>/);
    assert.match(viewerSource, /<ReaderSlideThumb[\s\S]*?active=\{group\.pageIndexes\.includes\(pageIndex\)\}/);
    assert.match(
        viewerSource,
        /<ReaderSlideThumb[\s\S]*?onClick=\{runToolbarAction\(\(\) => goSlideNavPage\(group\.groupStartIndex\)\)\}/,
    );
});

test('EPUB과 TXT 펼침면 썸네일은 한 버튼 안에 비버튼 미리보기 슬롯 두 개를 배치한다', () => {
    const thumbSource = componentSource('ReaderSlideThumb', 'ViewerNavigationPanel');

    assert.match(thumbSource, /<button\b/);
    assert.equal((thumbSource.match(/<button\b/g) || []).length, 1);
    assert.match(
        thumbSource,
        /\{items\.map\(item => (?:\(|\{)[\s\S]*?className="viewer-slide-thumb-reader-page"/,
    );
});
