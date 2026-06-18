import assert from 'node:assert/strict';
import test from 'node:test';
import {
    APP_NAME,
    ISSUE_URL,
    TABS,
    canAcceptGlobalDrop,
    formatAppTitle,
    isFileToolbarEnabled,
    normalizeDroppedPaths,
} from './appShell.js';

test('탭 순서가 원본 순서를 유지한다', () => {
    assert.deepEqual(
        TABS.map(tab => tab.id),
        ['folder', 'organizer', 'renamer', 'metadata', 'sharing', 'releases'],
    );
});

test('공통 파일 툴바는 파일 작업 탭에서만 활성화된다', () => {
    assert.equal(isFileToolbarEnabled('folder'), false);
    assert.equal(isFileToolbarEnabled('organizer'), true);
    assert.equal(isFileToolbarEnabled('renamer'), true);
    assert.equal(isFileToolbarEnabled('metadata'), true);
    assert.equal(isFileToolbarEnabled('sharing'), false);
    assert.equal(isFileToolbarEnabled('releases'), false);
    assert.equal(isFileToolbarEnabled('organizer', true), false);
});

test('앱 제목에 BookManager 이름과 현재 버전을 사용한다', () => {
    assert.equal(APP_NAME, 'BookManager');
    assert.equal(formatAppTitle('3.0.0'), 'BookManager v3.0.0');
    assert.equal(formatAppTitle(''), 'BookManager');
});

test('버그 신고 URL은 원본 저장소 이슈 주소를 유지한다', () => {
    assert.equal(ISSUE_URL, 'https://github.com/dongkkase/ComicZIP_Optimizer/issues');
});

test('공유 서버와 릴리즈 탭 및 작업 중에는 전역 드롭을 무시한다', () => {
    assert.equal(canAcceptGlobalDrop('folder'), true);
    assert.equal(canAcceptGlobalDrop('organizer'), true);
    assert.equal(canAcceptGlobalDrop('sharing'), false);
    assert.equal(canAcceptGlobalDrop('releases'), false);
    assert.equal(canAcceptGlobalDrop('metadata', true), false);
});

test('드롭 경로는 입력 순서를 유지하며 중복과 빈 값을 제거한다', () => {
    assert.deepEqual(
        normalizeDroppedPaths(['/books/a.cbz', '', '/books/b.zip', '/books/a.cbz']),
        ['/books/a.cbz', '/books/b.zip'],
    );
});
