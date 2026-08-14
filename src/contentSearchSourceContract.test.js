import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('내용 검색 IPC는 preload 양쪽과 main handler에 같은 계약으로 연결된다', () => {
    const preload = read('electron/preload.js');
    const preloadCjs = read('electron/preload.cjs');
    const handlers = read('electron/ipcHandlers.js');

    for (const source of [preload, preloadCjs]) {
        assert.match(source, /searchLibraryContent:[\s\S]*folder:searchLibraryContent/);
        assert.match(source, /getContentIndexStatus:[\s\S]*folder:getContentIndexStatus/);
        assert.match(source, /startContentIndex:[\s\S]*folder:startContentIndex/);
        assert.match(source, /stopContentIndex:[\s\S]*folder:stopContentIndex/);
        assert.match(source, /clearContentIndex:[\s\S]*folder:clearContentIndex/);
        assert.match(source, /onContentIndexProgress:[\s\S]*folder:contentIndexProgress/);
    }
    assert.match(handlers, /new ContentIndexService\(contentIndexDbPath\(\)\)/);
    assert.match(handlers, /ipcMain\.handle\('folder:searchLibraryContent'/);
    assert.match(handlers, /ipcMain\.handle\('folder:startContentIndex'/);
    assert.match(handlers, /activeLibraries,[\s\S]*authoritativeLibraries/);
    assert.match(handlers, /contentIndexService\.close\(\)/);
});

test('내용 인덱스는 별도 DB에 원문과 위치 없이 contentless postings만 저장한다', () => {
    const paths = read('electron/dataPaths.js');
    const database = read('electron/database/content_index_db.js');

    assert.match(paths, /'content_index'[\s\S]*'content\.db'/);
    assert.match(database, /CREATE TABLE IF NOT EXISTS documents/);
    assert.match(database, /content\s*=\s*''/);
    assert.match(database, /detail\s*=\s*none/);
    assert.doesNotMatch(database.match(/CREATE TABLE IF NOT EXISTS documents \([\s\S]*?\);/)?.[0] || '', /\b(?:body|content|snippet|position|frequency)\b/i);
});

test('폴더탭은 파일 정보, 내용, 전체 검색과 별도 인덱스 관리 창을 제공한다', () => {
    const folderTab = read('src/tabs/FolderTab.jsx');
    const folderStyles = read('src/styles/FolderTab.css');

    assert.match(folderTab, /FOLDER_SEARCH_SCOPES = new Set\(\['metadata', 'content', 'all'\]\)/);
    assert.match(folderTab, /searchLibraryFiles/);
    assert.match(folderTab, /searchLibraryContent/);
    assert.match(folderTab, /mergeLibrarySearchResults/);
    assert.match(folderTab, /className="content-index-dialog"/);
    assert.match(folderTab, /startContentIndex/);
    assert.match(folderTab, /stopContentIndex/);
    assert.match(folderTab, /clearContentIndex/);
    assert.match(folderTab, /const contentIndexRunning = Boolean\(contentIndexStatus\?\.running \|\| contentIndexProgress\.running\)/);
    assert.match(folderTab, /contentIndexRunning \? \(\s*<span className="content-index-spinner" aria-hidden="true">\s*<FaIcon name="spinner" size=\{12\} \/>/);
    assert.match(folderTab, /:\s*\(\s*<FaIcon name="fileLines" size=\{12\} \/>/);
    assert.match(folderTab, /aria-busy=\{contentIndexRunning\}/);
    assert.match(folderStyles, /\.content-index-spinner\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?animation:\s*folder-content-index-spin 800ms linear infinite;/);
    assert.match(folderStyles, /@keyframes folder-content-index-spin\s*\{[\s\S]*?rotate\(0deg\)[\s\S]*?rotate\(360deg\)/);
    assert.match(folderStyles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.content-index-spinner\s*\{[\s\S]*?animation-duration:\s*1600ms;/);
    assert.doesNotMatch(folderTab, /content-search-result-dialog/);
});
