import assert from 'node:assert/strict';
import test from 'node:test';
import {
    folderToggleLabelKey,
    shouldDisableFolderToggles,
} from './folderToggleState.js';

test('하위 폴더와 중복 검사 토글은 상태별 원본 문구 키를 사용한다', () => {
    assert.equal(folderToggleLabelKey('subfolders', false), 'folder_inc_sub_off');
    assert.equal(folderToggleLabelKey('subfolders', true), 'folder_inc_sub_on');
    assert.equal(folderToggleLabelKey('duplicates', false), 'folder_dup_check_off');
    assert.equal(folderToggleLabelKey('duplicates', true), 'folder_dup_check_on');
});

test('스캔 또는 중복 준비 중에는 토글 중복 실행을 막는다', () => {
    assert.equal(shouldDisableFolderToggles(false, false), false);
    assert.equal(shouldDisableFolderToggles(true, false), true);
    assert.equal(shouldDisableFolderToggles(false, true), true);
});
