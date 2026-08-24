import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { translate } from './utils/i18n.js';

const folderTabSource = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const folderSidebarSource = readFileSync(new URL('./components/folder/FolderSidebar.jsx', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const audiobookSource = readFileSync(new URL('./components/viewer/AudiobookViewer.jsx', import.meta.url), 'utf8');
const viewerWindowSource = readFileSync(new URL('../electron/viewerWindow.js', import.meta.url), 'utf8');
const mainPreloadSource = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const mainPreloadEsmSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
const viewerPreloadSource = readFileSync(new URL('../electron/viewerPreload.cjs', import.meta.url), 'utf8');
const ipcHandlersSource = readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');

test('최근 읽음은 SQLite 기록과 메인·뷰어 IPC를 통해 연결된다', () => {
    assert.match(viewerWindowSource, /upsertReadingState\(session\.filePath/);
    assert.match(viewerWindowSource, /ipcMain\.handle\('viewer:saveReadingState'/);
    assert.match(viewerPreloadSource, /saveReadingState:\s*\(sessionId, state\)/);
    assert.match(mainPreloadSource, /listRecentReading:/);
    assert.match(mainPreloadSource, /removeRecentReading:/);
    assert.match(mainPreloadSource, /clearRecentReading:/);
    assert.match(mainPreloadSource, /onRecentReadingChanged:/);
    assert.match(mainPreloadEsmSource, /listRecentReading:/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('reading:listRecent'/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('reading:remove'/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('reading:clear'/);
    assert.match(ipcHandlersSource, /await recordReadingOpened\(filePath\)/);
});

test('모든 내부 뷰어는 현재 읽기 위치와 형식별 로케이터를 저장한다', () => {
    assert.match(viewerSource, /function viewerReadingLocator/);
    assert.match(viewerSource, /window\.viewerAPI\?\.saveReadingState/);
    assert.match(viewerSource, /kind:\s*session\?\.type === 'epub' \? 'epub-page'/);
    assert.match(audiobookSource, /window\.viewerAPI\?\.saveReadingState/);
    assert.match(audiobookSource, /kind:\s*'audio-time'/);
});

test('폴더 탭은 최근 읽음을 가상 목록으로 표시하고 기록 삭제를 파일 삭제와 분리한다', () => {
    assert.match(folderSidebarSource, /folder\.sidebar\.recent_reading/);
    assert.match(folderSidebarSource, /onSelectRecentReading/);
    assert.match(folderTabSource, /const RECENT_READING_LIMIT = 50/);
    assert.match(folderTabSource, /folderSource === 'recent-reading'/);
    assert.match(folderTabSource, /groupFolderFiles\(filteredFileData, 'none', 'lastReadAt', 'desc'\)/);
    assert.match(folderTabSource, /action === 'remove-recent'/);
    assert.match(folderTabSource, /if \(isRecentReading\) removeRecentReading\(activeSelectedPath\)/);
    assert.match(folderTabSource, /folder\.recent\.clear_confirm/);
});

test('최근 읽음 문구는 세 언어로 제공된다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        assert.notEqual(translate('folder.sidebar.recent_reading', language), 'folder.sidebar.recent_reading');
        assert.notEqual(translate('folder.recent.empty', language), 'folder.recent.empty');
        assert.notEqual(translate('folder.recent.remove', language), 'folder.recent.remove');
    }
});
