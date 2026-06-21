import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isLibraryIndexingPhase,
    resolveEffectiveWorkingTab,
    shouldCollectLibraryScanSlideItem,
    shouldUseLibraryScanSlide,
} from './appLockState.js';

test('명시적인 working tab이 있으면 우선 사용한다', () => {
    assert.equal(resolveEffectiveWorkingTab('folder', {
        metadata: { phase: 'executing' },
    }, 'metadata'), 'folder');
});

test('working-state가 없어도 활성 status phase가 있으면 락 대상 탭을 계산한다', () => {
    assert.equal(resolveEffectiveWorkingTab('', {
        folder: { phase: 'executing' },
    }, 'folder'), 'folder');
});

test('현재 탭의 실행 상태를 다른 탭보다 우선한다', () => {
    assert.equal(resolveEffectiveWorkingTab('', {
        folder: { phase: 'executing' },
        metadata: { phase: 'executing' },
    }, 'metadata'), 'metadata');
});

test('실행 중인 상태가 없으면 락 대상이 없다', () => {
    assert.equal(resolveEffectiveWorkingTab('', {
        folder: { phase: 'idle' },
    }, 'folder'), null);
});

test('라이브러리 인덱싱은 전용 책정보 슬라이드 표시 대상으로 판정한다', () => {
    assert.equal(shouldUseLibraryScanSlide('folder', {
        task: 'folder:updateIndex',
        phase: 'executing',
    }), true);
});

test('일반 폴더 스캔은 전용 책정보 슬라이드 표시 대상이 아니다', () => {
    assert.equal(shouldUseLibraryScanSlide('folder', {
        task: 'folder:scan',
        phase: 'executing',
    }), false);
});

test('빠른 라이브러리 누락 분석은 전용 책정보 슬라이드 표시 대상이 아니다', () => {
    assert.equal(shouldUseLibraryScanSlide('folder', {
        task: 'folder:libraryScan',
        phase: 'executing',
    }), false);
});

test('library-slide 표시 플래그가 있으면 전용 책정보 슬라이드 표시 대상으로 판정한다', () => {
    assert.equal(shouldUseLibraryScanSlide('folder', {
        task: 'folder:scan',
        display: 'library-slide',
        phase: 'executing',
    }), true);
});

test('라이브러리 스캔의 현재 파일 진행 상태는 슬라이드 수집 대상이 아니다', () => {
    assert.equal(shouldCollectLibraryScanSlideItem('folder', {
        task: 'folder:updateIndex',
        phase: 'executing',
        libraryPhase: 'metadata',
        currentItem: '/Books/A.cbz',
    }), false);
});

test('라이브러리 인덱싱 단계의 현재 파일은 슬라이드 수집 대상이 아니다', () => {
    const status = {
        task: 'folder:updateIndex',
        phase: 'executing',
        libraryPhase: 'indexing',
        currentItem: '/Books/A.cbz',
    };

    assert.equal(isLibraryIndexingPhase(status), true);
    assert.equal(shouldCollectLibraryScanSlideItem('folder', status), false);
});

test('메타데이터 최적화 모드는 인덱싱 phase 진행 중에도 작업 이미지 표시 대상이 아니다', () => {
    assert.equal(isLibraryIndexingPhase({
        task: 'folder:updateIndex',
        phase: 'executing',
        libraryPhase: 'indexing',
        libraryTaskMode: 'metadata',
    }), false);
});

test('최초 등록 메타데이터 작업의 인덱싱 phase는 작업 이미지 표시 대상으로 유지한다', () => {
    assert.equal(isLibraryIndexingPhase({
        task: 'folder:updateIndex',
        phase: 'executing',
        libraryPhase: 'indexing',
        libraryTaskMode: 'metadata-initial',
    }), true);
});

test('라이브러리 스캔의 준비 완료 항목은 슬라이드 수집 대상으로 판정한다', () => {
    assert.equal(shouldCollectLibraryScanSlideItem('folder', {
        task: 'folder:updateIndex',
        phase: 'executing',
        libraryPhase: 'metadata',
        slideItemReady: true,
        currentItem: '/Books/A.cbz',
    }), true);
});
