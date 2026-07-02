import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./components/folder/FolderSidebar.jsx', import.meta.url)), 'utf8');
const folderTabSource = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('탐색기 트리의 라이브러리 루트는 라이브러리 컨텍스트 메뉴를 연다', () => {
    assert.match(source, /isLibraryRoot:\s*true/);
    assert.match(source, /if\s*\(node\.isLibraryRoot\)\s*{[\s\S]*onLibraryContextMenu\?\.\(event,\s*node\.path\)/);
    assert.match(source, /onFolderContextMenu\?\.\(event,\s*node\.path,\s*siblings\.map/);
});

test('폴더탭 탐색기 패널의 아이콘은 이모지 대신 FontAwesome을 사용한다', () => {
    const forbidden = /[➕⭐✖🔴📂📌▶▼☰▦☷]/u;
    assert.doesNotMatch(source, forbidden);
    assert.doesNotMatch(folderTabSource, forbidden);
    assert.match(folderTabSource, /import\s+\{\s*FaIcon\s*\}\s+from\s+['"]\.\.\/components\/FaIcon['"]/);
    assert.match(source, /<FaIcon name="plus"/);
    assert.match(source, /<FaIcon name="star"/);
    assert.match(source, /<FaIcon name="ellipsisVertical"/);
    assert.match(source, /name=\{isExpanded \? 'angleDown' : 'chevronRight'\}/);
    assert.match(folderTabSource, /icon="folderOpen"/);
    assert.match(folderTabSource, /icon=\{isFavoriteFolder[\s\S]*\? 'star' : 'pin'\}/);
    assert.match(folderTabSource, /<FaIcon name="circle"/);
    assert.match(folderTabSource, /<FaIcon name="bars"/);
    assert.match(folderTabSource, /<FaIcon name="microsoft"/);
    assert.match(folderTabSource, /<FaIcon name="list"/);
});

test('폴더탭 탐색기 아이콘 버튼은 hover 툴팁 정보를 가진다', () => {
    assert.match(source, /className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"/);
    assert.match(source, /className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn favorite-add-btn"/);
    assert.match(source, /className="favorite-menu-btn folder-sidebar-tooltip-btn"/);
    assert.match(source, /className="library-menu-btn folder-sidebar-tooltip-btn"/);
    assert.match(source, /data-tooltip=\{t\('folder\.sidebar\.add_favorite'\)\}/);
    assert.match(source, /data-tooltip=\{t\('folder\.sidebar\.more_actions'\)\}/);
    assert.match(source, /data-tooltip=\{label\}/);
});

test('라이브러리와 즐겨찾기 리스트의 행 버튼은 삭제 대신 컨텍스트 메뉴를 연다', () => {
    assert.match(source, /className="library-menu-btn folder-sidebar-tooltip-btn"[\s\S]*onLibraryContextMenu\?\.\(event,\s*lib\)/);
    assert.match(source, /className="favorite-menu-btn folder-sidebar-tooltip-btn"[\s\S]*onFolderContextMenu\?\.\(event,\s*fav\.path\)/);
    assert.doesNotMatch(source, /className="library-remove-btn"/);
    assert.doesNotMatch(source, /className="favorite-remove-btn"/);
    assert.match(folderTabSource, /handleContextAction\('remove-library'\)/);
});

test('라이브러리 행은 폴더 수와 인덱스 상태를 함께 표시한다', () => {
    assert.match(source, /libraryFolderCounts/);
    assert.match(source, /const indexedChildren = await readIndexedLibraryFolderChildren\(lib\)/);
    assert.match(source, /const liveChildren = await readLiveFolderChildren\(lib\)/);
    assert.match(source, /folderCount:\s*libraryFolderCounts\[libraryKey\]/);
    assert.match(source, /libraryStatusText\(t,\s*scanState,\s*\{/);
});

test('탐색기 트리는 라이브러리 폴더를 DB 인덱스로 먼저 읽고 없을 때 파일 시스템으로 대체한다', () => {
    assert.match(source, /getLibraryFolderChildren/);
    assert.match(source, /const indexedFolders = await readIndexedLibraryFolderChildren\(folderPath\)/);
    assert.match(source, /const folders = indexedFolders \|\| await readLiveFolderChildren\(folderPath\)/);
    assert.match(source, /node\.childFolderCount !== undefined \? node\.childFolderCount > 0 : true/);
    assert.match(source, /onSelectFolder\?\.\(node\.path,\s*\{\s*source:\s*'tree'\s*\}\)/);
    assert.doesNotMatch(source, /skipExistsCheck:\s*true/);
});

test('탐색기 트리는 중복 폴더 읽기와 부드러운 자동 스크롤을 피한다', () => {
    assert.match(source, /folderCacheRef/);
    assert.match(source, /folderLoadPromisesRef/);
    assert.match(source, /folderLoadPromisesRef\.current\.has\(folderPath\)/);
    assert.match(source, /scrollIntoView\?\.\(\{\s*block,\s*inline:\s*'nearest',\s*behavior\s*\}\)/);
    assert.match(source, /focusSelectedNode\('nearest'\)/);
    assert.doesNotMatch(source, /behavior:\s*'smooth'/);
});
