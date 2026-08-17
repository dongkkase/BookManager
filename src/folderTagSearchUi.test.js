import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const folderTabSource = readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('./components/folder/FolderTagSearchDialog.jsx', import.meta.url), 'utf8');
const folderStyles = readFileSync(new URL('./styles/FolderTab.css', import.meta.url), 'utf8');
const ipcSource = readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
const workerSource = readFileSync(new URL('../electron/librarySearchWorker.js', import.meta.url), 'utf8');

test('#태그 버튼은 파일 정보 검색 왼쪽에서 활성 필터 개수를 표시한다', () => {
    const buttonIndex = folderTabSource.indexOf('className={`folder-tag-search-btn');
    const searchIndex = folderTabSource.indexOf('className="folder-search-control"', buttonIndex);

    assert.ok(buttonIndex >= 0);
    assert.ok(searchIndex > buttonIndex);
    assert.match(folderTabSource, /folderTagSelections\.length > 0[\s\S]*folder_tag_selected_count/);
    assert.match(folderTabSource, /aria-pressed=\{folderTagSelections\.length > 0\}/);
});

test('태그 모달은 compact DB 집계를 받고 적용할 때만 파일을 조회한다', () => {
    assert.match(preloadSource, /getLibraryTagFacets:[\s\S]*folder:getLibraryTagFacets/);
    assert.match(preloadSource, /searchLibraryTags:[\s\S]*folder:searchLibraryTags/);
    assert.match(ipcSource, /folder:getLibraryTagFacets[\s\S]*librarySearchService\.tagFacets/);
    assert.match(ipcSource, /folder:searchLibraryTags[\s\S]*librarySearchService\.searchTags/);
    assert.match(workerSource, /getDataVersion\(\)[\s\S]*tagMetadataCache[\s\S]*collectFolderTagCategories/);
    assert.match(workerSource, /filterFilesByFolderTags[\s\S]*listFilesByPaths/);
    assert.match(
        folderTabSource,
        /getLibraryTagFacets\?\.\(folderTagDatabaseScopes\)[\s\S]*searchLibraryTags\?\.\([\s\S]*folderTagDatabaseScopes[\s\S]*selections[\s\S]*matchMode/,
    );
    assert.match(
        folderTabSource,
        /<FolderTagSearchDialog[\s\S]*categories=\{folderTagCategories\}[\s\S]*totalFileCount=\{folderTagDatabaseFileCount\}[\s\S]*loading=\{folderTagLoading\}/,
    );
});

test('태그 검색 모달은 값 검색, AND·OR 선택, 선택 해제와 적용을 제공한다', () => {
    assert.match(dialogSource, /role="dialog"/);
    assert.match(dialogSource, /folder_tag_search_value_placeholder/);
    assert.match(dialogSource, /setDraftMatchMode\('all'\)/);
    assert.match(dialogSource, /setDraftMatchMode\('any'\)/);
    assert.match(dialogSource, /setDraftSelections\(\[\]\)/);
    assert.match(dialogSource, /onApply\(\{ selections: draftSelections, matchMode: draftMatchMode \}\)/);
    assert.match(dialogSource, /folder_tag_database_note/);
    assert.match(dialogSource, /role="status">\{t\('folder_tag_loading'\)\}/);
    assert.match(folderStyles, /\.folder-tag-browser\s*\{/);
    assert.match(folderStyles, /\.folder-tag-values button\.active\s*\{/);
});

test('대량 태그 UI는 카테고리 탐색, 정렬과 단계적 더 보기를 사용한다', () => {
    assert.match(dialogSource, /INITIAL_TAG_VALUE_LIMIT = 120/);
    assert.match(dialogSource, /folder-tag-category-nav/);
    assert.match(dialogSource, /categorySelectionCounts/);
    assert.match(dialogSource, /sortMode === 'frequency'/);
    assert.match(dialogSource, /activeCategory\?\.values\.slice\(0, visibleValueLimit\)/);
    assert.match(dialogSource, /valuesContainerRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
    assert.match(dialogSource, /folder-tag-show-more/);
    assert.match(dialogSource, /limit \+ TAG_VALUE_LIMIT_INCREMENT/);
    assert.match(folderStyles, /grid-template-columns: 210px minmax\(0, 1fr\)/);
    assert.match(folderStyles, /\.folder-tag-category-nav-list\s*\{/);
    assert.match(folderStyles, /\.folder-tag-results\s*\{/);
});
