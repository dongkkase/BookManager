import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

test('만화책, PDF, EPUB, TXT는 저장한 페이지를 불러오고 페이지 수가 준비된 뒤 보정한다', () => {
    const loadSessionStart = viewerSource.indexOf('const loadSession = useCallback');
    const loadSessionEnd = viewerSource.indexOf('\n\n  const loadComicPage = useCallback', loadSessionStart);
    const normalizationStart = viewerSource.indexOf("if (!['comic', 'pdf', 'epub', 'text'].includes(session?.type)) return;");
    const normalizationEnd = viewerSource.indexOf('\n\n  const movePage = useCallback', normalizationStart);

    assert.notEqual(loadSessionStart, -1, '뷰어 세션 로드 함수를 찾을 수 없습니다.');
    assert.notEqual(loadSessionEnd, -1, '뷰어 세션 로드 함수의 끝을 찾을 수 없습니다.');
    assert.notEqual(normalizationStart, -1, '페이지 보정 영역을 찾을 수 없습니다.');
    assert.notEqual(normalizationEnd, -1, '페이지 보정 영역의 끝을 찾을 수 없습니다.');

    const loadSessionSource = viewerSource.slice(loadSessionStart, loadSessionEnd);
    const normalizationSource = viewerSource.slice(normalizationStart, normalizationEnd);
    assert.match(loadSessionSource, /const savedPageIndex = Math\.max\(0, Number\(savedFileState\.pageIndex\) \|\| 0\)/);
    assert.match(loadSessionSource, /setPageIndexSynced\(savedPageIndex\)/);
    assert.match(loadSessionSource, /nextSession\.type === 'comic'[\s\S]*?setPageIndexSynced\(clamp\(savedPageIndex/);
    assert.match(loadSessionSource, /nextSession\.type === 'pdf'[\s\S]*?const initialPageIndex = clamp\(savedPageIndex/);
    assert.match(loadSessionSource, /nextSession\.type === 'epub'/);
    assert.match(loadSessionSource, /nextSession\.type === 'text'/);
    assert.match(viewerSource, /const pageCountReadyForNavigation = pageCount > 0 && !\(/);
    assert.match(viewerSource, /session\?\.type === 'epub'[\s\S]*?&& !epubMeasurementReady/);
    assert.match(normalizationSource, /if \(!pageCountReadyForNavigation\) return;/);
});

test('뷰어 종료 직전에는 최신 페이지 ref와 실제 스크롤 위치를 동기 저장한다', () => {
    const persistStart = viewerSource.indexOf('const persistCurrentPosition = useCallback');
    const restoreStart = viewerSource.indexOf('\n\n  const restoreSavedScrollPosition = useCallback', persistStart);

    assert.notEqual(persistStart, -1, '종료 직전 위치 저장 함수를 찾을 수 없습니다.');
    assert.notEqual(restoreStart, -1, '종료 직전 위치 저장 함수의 끝을 찾을 수 없습니다.');

    const persistSource = viewerSource.slice(persistStart, restoreStart);
    assert.match(persistSource, /pageIndex: pageIndexRef\.current/);
    assert.match(persistSource, /node\.scrollTop \/ maxScrollTop/);
    assert.match(persistSource, /window\.addEventListener\('beforeunload', handleViewerExit\)/);
    assert.match(persistSource, /window\.addEventListener\('pagehide', handleViewerExit\)/);
});
