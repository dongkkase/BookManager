import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./components/folder/FolderSidebar.jsx', import.meta.url)), 'utf8');
const folderTabSource = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');
const folderTabStyles = readFileSync(fileURLToPath(new URL('./styles/FolderTab.css', import.meta.url)), 'utf8');
const treeSource = readFileSync(fileURLToPath(new URL('./components/folder/FolderTree.jsx', import.meta.url)), 'utf8');

test('탐색기 트리의 라이브러리 루트는 라이브러리 컨텍스트 메뉴를 연다', () => {
    assert.match(source, /isLibraryRoot:\s*true/);
    assert.match(source, /if\s*\(node\.isLibraryRoot\)\s*{[\s\S]*onLibraryContextMenu\?\.\(event,\s*node\.path\)/);
    assert.match(source, /onFolderContextMenu\?\.\(event,\s*node\.path,\s*siblingPaths\)/);
});

test('폴더탭 탐색기 패널의 아이콘은 이모지 대신 FontAwesome을 사용한다', () => {
    const forbidden = /[➕⭐✖🔴📂📌▶▼☰▦☷]/u;
    assert.doesNotMatch(source, forbidden);
    assert.doesNotMatch(treeSource, forbidden);
    assert.doesNotMatch(folderTabSource, forbidden);
    assert.match(folderTabSource, /import\s+\{\s*FaIcon\s*\}\s+from\s+['"]\.\.\/components\/FaIcon['"]/);
    assert.match(source, /<FaIcon name="plus"/);
    assert.match(source, /<FaIcon name="star"/);
    assert.match(source, /<FaIcon name="ellipsisVertical"/);
    assert.match(treeSource, /name=\{row\.expanded \? 'angleDown' : 'chevronRight'\}/);
    assert.match(folderTabSource, /icon="folderOpen"/);
    assert.match(folderTabSource, /icon=\{isFavoriteFolder[\s\S]*\? 'star' : 'pin'\}/);
    assert.match(source, /<FaIcon name="circle"/);
    assert.match(folderTabSource, /<FaIcon name="bars"/);
    assert.match(folderTabSource, /<FaIcon name="microsoft"/);
    assert.match(folderTabSource, /<FaIcon name="list"/);
});

test('폴더탭 탐색기 아이콘 버튼은 hover 툴팁 정보를 가진다', () => {
    assert.match(source, /className="folder-sidebar-icon-btn folder-sidebar-tooltip-btn"/);
    assert.match(source, /className="library-menu-btn folder-sidebar-tooltip-btn"/);
    assert.match(source, /data-tooltip=\{t\('folder\.sidebar\.more_actions'\)\}/);
    assert.match(source, /data-tooltip=\{label\}/);
});

test('라이브러리 메뉴 툴팁은 스크롤 경계에서 잘리지 않도록 행 안쪽 왼편에 열린다', () => {
    const libraryMenuSelector = /\.library-menu-btn\[data-tooltip\]/;
    assert.match(folderTabStyles, new RegExp(`${libraryMenuSelector.source}::before\\s*\\{[\\s\\S]*?top:\\s*50%;[\\s\\S]*?right:\\s*calc\\(100% \\+ 8px\\);[\\s\\S]*?transform:\\s*translateY\\(-50%\\);`));
    assert.match(folderTabStyles, new RegExp(`${libraryMenuSelector.source}::after\\s*\\{[\\s\\S]*?top:\\s*calc\\(50% - 4px\\);[\\s\\S]*?right:\\s*calc\\(100% \\+ 4px\\);`));
});

test('라이브러리 리스트의 행 버튼은 삭제 대신 컨텍스트 메뉴를 연다', () => {
    assert.match(source, /className="library-menu-btn folder-sidebar-tooltip-btn"[\s\S]*onLibraryContextMenu\?\.\(event,\s*lib\)/);
    assert.doesNotMatch(source, /className="library-remove-btn"/);
    assert.match(folderTabSource, /handleContextAction\('remove-library'\)/);
});

test('라이브러리 행은 폴더 수와 인덱스 상태를 함께 표시한다', () => {
    assert.match(source, /libraryFolderCounts/);
    assert.match(source, /folderEntries\[item\.path\]\?\.children\.length/);
    assert.match(source, /folderCount:\s*libraryFolderCounts\[libraryKey\]/);
    assert.match(source, /libraryStatusText\(t,\s*scanState,\s*\{/);
});

test('탐색기 트리는 라이브러리 폴더를 DB 인덱스로 먼저 읽고 없을 때 파일 시스템으로 대체한다', () => {
    assert.match(source, /getLibraryFolderChildren/);
    assert.match(source, /const indexedFolders = await readIndexedLibraryFolderChildren\(folderPath\)/);
    assert.match(source, /return indexedFolders \|\| await readLiveFolderChildren\(folderPath\)/);
    assert.match(source, /entries=\{folderEntries\}/);
    assert.match(source, /onSelectFolder\?\.\(folderPath,\s*\{\s*source:\s*'tree'\s*\}\)/);
    assert.doesNotMatch(source, /skipExistsCheck:\s*true/);
});

test('탐색기 트리는 공유 로더를 연결하고 선택 변경으로 포커스를 빼앗지 않는다', () => {
    assert.match(source, /createFolderTreeLoader\(\{/);
    assert.match(source, /onRetry=\{loadFolder\}/);
    assert.match(source, /folderLoaderRef\.current\?\.reset\(\)/);
    assert.match(source, /loader\.dispose\(\)/);
    assert.doesNotMatch(source, /focusSelectedNode/);
    assert.doesNotMatch(source, /behavior:\s*'smooth'/);
});
