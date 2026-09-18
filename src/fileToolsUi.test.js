import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const toolsTabSource = fs.readFileSync(new URL('./tabs/ToolsTab.jsx', import.meta.url), 'utf8');
const textCleanerSearchSource = fs.readFileSync(new URL('./components/TextCleanerSearch.jsx', import.meta.url), 'utf8');
const textCleanerSource = fs.readFileSync(new URL('./tabs/TextCleanerTool.jsx', import.meta.url), 'utf8');
const textCleanerWorkerSource = fs.readFileSync(new URL('./workers/textCleanerWorker.js', import.meta.url), 'utf8');
const textCleanerEditorSource = fs.readFileSync(new URL('./textCleanerEditor.js', import.meta.url), 'utf8');
const folderSource = fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const tabBarSource = fs.readFileSync(new URL('./components/TabBar.jsx', import.meta.url), 'utf8');
const fileTableSource = fs.readFileSync(new URL('./components/folder/FileTableView.jsx', import.meta.url), 'utf8');
const tileSource = fs.readFileSync(new URL('./components/folder/TileView.jsx', import.meta.url), 'utf8');
const thumbnailSource = fs.readFileSync(new URL('./components/folder/ThumbnailView.jsx', import.meta.url), 'utf8');
const toolsCssSource = fs.readFileSync(new URL('./styles/ToolsTab.css', import.meta.url), 'utf8');
const preloadSource = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
const preloadCjsSource = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const ipcSource = fs.readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');

test('파일 도구 탭은 지연 로딩되고 기존 탭 이동 콜백을 사용한다', () => {
    assert.match(appSource, /lazyTab\(\(\) => import\('\.\/tabs\/ToolsTab'\)\)/);
    assert.match(appSource, /loadedTabs\.has\('tools'\)/);
    assert.match(appSource, /<MemoToolsTab t=\{t\} onOpenTab=\{handleTabChange\} showToast=\{showToast\} \/>/);
});

test('파일 도구 화면은 레지스트리 기반 카테고리와 상태를 표시한다', () => {
    assert.match(toolsTabSource, /FILE_TOOL_CATEGORIES\.map/);
    assert.match(toolsTabSource, /fileToolsByCategory\(category\.id\)\.map/);
    assert.match(toolsTabSource, /tool\.status === 'available'/);
    assert.match(toolsTabSource, /onOpenTab\(tool\.target\.tabId\)/);
    assert.match(toolsTabSource, /data-tool-id=\{tool\.id\}/);
});

test('파일 도구 화면은 좁은 창에서 한 열로 재배치된다', () => {
    assert.match(toolsCssSource, /@media \(max-width: 760px\)/);
    assert.match(toolsCssSource, /grid-template-columns: 1fr;/);
});

test('텍본 정리기는 별도 청크와 워커로 지연 로딩된다', () => {
    assert.match(toolsTabSource, /lazy\(\(\) => import\('\.\/TextCleanerTool'\)\)/);
    assert.match(textCleanerSource, /new Worker\(new URL\('\.\.\/workers\/textCleanerWorker\.js'/);
    assert.match(textCleanerSource, /loadTextCleanerFile/);
    assert.match(textCleanerSource, /saveTextCleanerFile/);
});

test('텍본 정리기는 원본과 편집 가능한 결과 및 변경 전후를 제공한다', () => {
    assert.match(textCleanerSource, /ref=\{sourceAreaRef\}[\s\S]*?readOnly/);
    assert.match(textCleanerSource, /ref=\{resultAreaRef\}[\s\S]*?onInput=\{handleResultInput\}/);
    assert.equal((textCleanerSource.match(/<TextCleanerEditor/g) || []).length, 2);
    assert.match(textCleanerEditorSource, /EditorView\.lineWrapping/);
    assert.match(toolsCssSource, /\.text-cleaner-virtual-editor \.cm-scroller\s*\{[\s\S]*?overflow: auto;/);
    assert.match(textCleanerSource, /selectedChange\.before/);
    assert.match(textCleanerSource, /selectedChange\.after/);
    assert.match(textCleanerSource, /event\.stopPropagation\(\)/);
});

test('텍본 정리기 스크롤과 변경 전후 탐색은 서로 위치를 연동한다', () => {
    assert.match(textCleanerSource, /const handleEditorScroll = useCallback/);
    assert.match(textCleanerSource, /mapTextOffsetByCanonical\([\s\S]*?sourceText,[\s\S]*?targetText/);
    assert.match(textCleanerSource, /textOffsetForEditorScroll\(source, textLength, layout\)/);
    assert.match(textCleanerSource, /wrapMetrics: editorWrapMetrics\(sourceAreaRef\.current\)/);
    assert.match(textCleanerSource, /centerEditorAtTextOffset\(target, targetOffset\)/);
    assert.match(textCleanerSource, /closestTextChangeIndex\(changes, visibleOffset, offsetKey\)/);
    assert.match(textCleanerSource, /editorScrollTopForTextOffset\([\s\S]*?change\.sourceStart/);
    assert.match(textCleanerSource, /editorScrollTopForTextOffset\([\s\S]*?change\.resultStart/);
    assert.equal((textCleanerSource.match(/onScroll=\{\(\) => handleEditorScroll\(/g) || []).length, 2);
});

test('텍본 정리기는 원본과 결과를 각각 검색하고 라인 수를 표시한다', () => {
    assert.equal((textCleanerSource.match(/<TextCleanerSearch/g) || []).length, 2);
    assert.match(textCleanerSource, /startSearch\('source', sourceSearchQuery, sourceSearchOptions\)/);
    assert.match(textCleanerSource, /type: 'resultReview', requestId, text: resultTextRef\.current/);
    assert.match(textCleanerWorkerSource, /findTextMatches\(message\.text, message\.query\)/);
    assert.match(textCleanerSearchSource, /clear_search/);
    assert.match(textCleanerSource, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
    assert.equal((textCleanerSource.match(/moveSearch\('(source|result)', direction, focusTarget\)/g) || []).length, 2);
    assert.match(textCleanerSource, /searchResult\.query !== query/);
    assert.match(textCleanerSource, /editorScrollTopForTextOffset\([\s\S]*?matchOffset/);
    assert.match(textCleanerSource, /setSelectionRange\(activeMatch\.start, activeMatch\.end\)/);
    assert.match(textCleanerSource, /positionSearchHighlight\(/);
    assert.match(textCleanerSource, /editorWrappedRowPrefixWidth\(/);
    assert.match(textCleanerSource, /searchMirrorGeometry\(/);
    assert.match(textCleanerSource, /document\.createRange\(\)/);
    assert.match(textCleanerSource, /geometry\.top - \(\(editor\.clientHeight/);
    assert.match(textCleanerSource, /new ResizeObserver/);
    assert.match(textCleanerSource, /type: 'layout'/);
    assert.match(textCleanerSource, /restoreEditorsAfterLayout\(\)/);
    assert.match(textCleanerSource, /type: 'characterWidths'/);
    assert.match(textCleanerWorkerSource, /type: 'measureCharacters'/);
    assert.match(textCleanerWorkerSource, /characterWidths: message\.widths/);
    assert.match(textCleanerWorkerSource, /type: 'layoutResult'/);
    assert.equal((textCleanerSource.match(/className="text-cleaner-search-highlight"/g) || []).length, 2);
    assert.match(textCleanerSource, /lineCounts\.source/);
    assert.match(textCleanerSource, /lineCounts\.result/);
    assert.match(toolsCssSource, /\.text-cleaner-search\s*\{/);
    assert.match(toolsCssSource, /\.text-cleaner-search-highlight\s*\{/);
    assert.match(toolsCssSource, /\.text-cleaner-editor-pane > footer\s*\{/);
});

test('다른 텍본을 열 때 기존 대용량 편집 자원을 먼저 해제하고 로딩 화면을 그린다', () => {
    assert.match(textCleanerSource, /workerRef\.current\?\.terminate\(\)/);
    assert.match(textCleanerSource, /sourceAreaRef\.current\.value = ''/);
    assert.match(textCleanerSource, /resultAreaRef\.current\.value = ''/);
    assert.match(
        textCleanerSource,
        /setFileInfo\(null\)[\s\S]*?await waitForRendererPaint\(\)[\s\S]*?loadTextCleanerFile\?\.\(filePath\)/,
    );
    assert.match(textCleanerSource, /requestId !== loadRequestIdRef\.current/);
});

test('텍본 파일 입출력 IPC는 두 preload와 메인 프로세스에 연결된다', () => {
    for (const source of [preloadSource, preloadCjsSource]) {
        assert.match(source, /loadTextCleanerFile:[\s\S]*tools:textCleaner:load/);
        assert.match(source, /saveTextCleanerFile:[\s\S]*tools:textCleaner:save/);
    }
    assert.match(ipcSource, /ipcMain\.handle\('tools:textCleaner:load'/);
    assert.match(ipcSource, /ipcMain\.handle\('tools:textCleaner:save'/);
});

test('폴더 항목을 탭으로 드래그하거나 우클릭해 텍본 정리기로 전달할 수 있다', () => {
    for (const source of [fileTableSource, tileSource, thumbnailSource]) {
        assert.match(source, /draggable=\{Boolean\(file\.full_path \|\| file\.path\)\}/);
        assert.match(source, /onDragStart=\{\(event\) => onFileDragStart\?\.\(event, file\)\}/);
    }
    assert.match(folderSource, /BOOKMANAGER_PATHS_MIME/);
    assert.match(folderSource, /send-file-text-cleaner/);
    assert.match(folderSource, /toolId: 'text-cleaner'/);
    assert.match(folderSource, /<ContextMenuSubmenu label=\{t\('tools\.context_menu'\)\}/);
    assert.match(folderSource, /createPortal\(/);
    assert.match(folderSource, /const fitsRight =/);
    assert.match(folderSource, /fitsRight \? 'right' : 'left'/);
    assert.match(folderSource, /<FaIcon name="chevronRight" size=\{10\} \/>/);
    assert.doesNotMatch(folderSource, /placement === 'left' \? 'chevronLeft'/);
});

test('파일 드래그 중 탭에 머물면 페이지를 전환하고 드롭 경로를 전달한다', () => {
    assert.match(tabBarSource, /window\.setTimeout\(\(\) => \{[\s\S]*?onTabChange\(tabId\);[\s\S]*?\}, 350\)/);
    assert.match(tabBarSource, /onTabDrop\?\.\(tabId, event\.dataTransfer\)/);
    assert.match(appSource, /<TabBar[\s\S]*?onTabDrop=\{handleTabDrop\}/);
    assert.match(toolsTabSource, /bookmanager:tab-ready/);
    assert.match(toolsTabSource, /bookmanager:action/);
    assert.match(textCleanerSource, /openRequest\?\.path/);
    assert.match(textCleanerSource, /droppedPathsFromDataTransfer\(event\.dataTransfer\)/);
});
