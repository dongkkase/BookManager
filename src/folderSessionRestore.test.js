import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(fileURLToPath(new URL('./App.jsx', import.meta.url)), 'utf8');
const folderSource = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('앱은 마지막 탭 id를 우선 복원하고 index fallback을 유지한다', () => {
    assert.match(appSource, /resolveTabId\(config\.last_tab_id,\s*config\.last_tab_index\)/);
    assert.match(appSource, /last_tab_id:\s*tabId/);
    assert.match(appSource, /last_tab_id:\s*'folder',\s*last_tab_index:\s*0/);
});

test('폴더 탭은 마지막으로 본 폴더 경로를 저장하고 시작 시 복원한다', () => {
    assert.match(folderSource, /restoredFolderPathRef/);
    assert.match(folderSource, /saveConfig\?\.\(\{\s*folder_last_path:\s*nextFolderPath\s*\}\)/);
    assert.match(folderSource, /config\.folder_last_path/);
    assert.match(folderSource, /config\.last_selected_library/);
    assert.match(folderSource, /handleSafeFolderNavigation\(folderPath\)/);
});
