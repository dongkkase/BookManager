import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const folderTabSource = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const pathBarSource = readFileSync(new URL('./components/folder/FolderPathBar.jsx', import.meta.url), 'utf8');
const folderCssSource = readFileSync(new URL('./styles/FolderTab.css', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../electron/configManager.js', import.meta.url), 'utf8');

test('경로 이동 입력은 리스트 툴바와 파일 목록 사이에 항상 표시된다', () => {
    const toolbarIndex = folderTabSource.indexOf('className="right-toolbar"');
    const pathBarIndex = folderTabSource.indexOf('<FolderPathBar');
    const viewIndex = folderTabSource.indexOf('className="view-container"');

    assert.ok(toolbarIndex >= 0);
    assert.ok(pathBarIndex > toolbarIndex);
    assert.ok(viewIndex > pathBarIndex);
    assert.match(folderCssSource, /\.folder-goto-path-bar\s*\{/);
});

test('Ctrl 또는 Cmd+G는 일반 입력 단축키 필터 전에 경로 입력으로 포커스를 옮긴다', () => {
    const shortcutIndex = folderTabSource.indexOf("isShortcutKey(event, 'g')");
    const globalShortcutGuardIndex = folderTabSource.indexOf('if (!shouldHandleGlobalShortcut(event)) return;', shortcutIndex);

    assert.ok(shortcutIndex >= 0);
    assert.ok(globalShortcutGuardIndex > shortcutIndex);
    assert.match(folderTabSource, /gotoPathInputRef\.current\?\.focus\(\)/);
    assert.match(folderTabSource, /gotoPathInputRef\.current\?\.select\(\)/);
    assert.match(folderTabSource, /formatPrimaryShortcut\('G', runtimePlatform\)/);
    assert.match(folderTabSource, /&& canFocusGotoPath\(\)/);
    assert.match(folderTabSource, /document\.querySelector\('\.modal-overlay'\)/);
    assert.match(folderTabSource, /document\.querySelector\('\.app-lock-screen'\)/);
});

test('경로 입력은 키보드 조작 가능한 최근 경로 콤보박스를 제공한다', () => {
    assert.match(pathBarSource, /role="combobox"/);
    assert.match(pathBarSource, /role="listbox"/);
    assert.match(pathBarSource, /role="option"/);
    assert.match(pathBarSource, /aria-label=\{t\('folder\.goto\.recent'\)\}/);
    assert.match(pathBarSource, /onClick=\{\(\) => onOpenChange\(true\)\}/);
    assert.match(pathBarSource, /event\.key === 'ArrowDown'/);
    assert.match(pathBarSource, /event\.key === 'ArrowUp'/);
    assert.match(pathBarSource, /event\.key === 'Escape'/);
    assert.match(pathBarSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
    assert.match(pathBarSource, /void onNavigate\(selectedPath\)/);
});

test('최근 경로는 설정에 저장되고 폴더 경로만 이동 대상으로 인정한다', () => {
    assert.match(configSource, /folder_goto_history:\s*\[\]/);
    assert.match(folderTabSource, /saveConfig\?\.\(\{ folder_goto_history: nextHistory \}\)/);
    assert.match(folderTabSource, /if \(!stat\?\.isDirectory\) return false;/);
});
