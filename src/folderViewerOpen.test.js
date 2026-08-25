import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const folderTabSource = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');
const ipcSource = readFileSync(fileURLToPath(new URL('../electron/ipcHandlers.js', import.meta.url)), 'utf8');
const viewSources = {
    fileTable: readFileSync(fileURLToPath(new URL('./components/folder/FileTableView.jsx', import.meta.url)), 'utf8'),
    thumbnail: readFileSync(fileURLToPath(new URL('./components/folder/ThumbnailView.jsx', import.meta.url)), 'utf8'),
    tile: readFileSync(fileURLToPath(new URL('./components/folder/TileView.jsx', import.meta.url)), 'utf8'),
};

test('폴더 탭 파일 더블 클릭은 클릭한 파일을 뷰어로 연다', () => {
    const start = folderTabSource.indexOf('const openFileInViewer = useCallback');
    assert.notEqual(start, -1);
    const end = folderTabSource.indexOf('const deleteSelectedFiles', start);
    const block = folderTabSource.slice(start, end);

    assert.match(block, /const target = typeof file === 'string' \? file : file\?\.full_path \|\| file\?\.path/);
    assert.match(block, /const explicitViewerPath = typeSpecificViewerPath\(config,\s*target\)/);
    assert.match(block, /openWithViewer\?\.\(explicitViewerPath,\s*target\)/);
    assert.doesNotMatch(block, /const defaultViewerPath = configuredViewerPath\(config\?\.viewer_path\)/);
    assert.doesNotMatch(block, /openWithViewer\?\.\(defaultViewerPath,\s*target\)/);
    assert.match(block, /const handleFileOpen = useCallback/);
    assert.match(block, /selectFile\(file\.path,\s*null,\s*index\)/);
    assert.match(folderTabSource, /onOpenFile:\s*handleFileOpen/);
    assert.match(folderTabSource, /onOpenFile=\{handleFileOpen\}/);
});

test('폴더 탭에 드롭한 파일은 뷰어로 열고 폴더는 해당 위치로 이동한다', () => {
    const start = folderTabSource.indexOf('const handleDroppedPaths = useCallback');
    assert.notEqual(start, -1);
    const end = folderTabSource.indexOf('const deleteSelectedFiles', start);
    const block = folderTabSource.slice(start, end);

    assert.match(block, /window\.electronAPI\?\.stat\?\.\(droppedPath\)/);
    assert.match(block, /if \(stat\?\.isDirectory\)[\s\S]*?handleFolderChange\(droppedPath\)[\s\S]*?return/);
    assert.match(block, /if \(stat\?\.isFile\)[\s\S]*?openFileInViewer\(droppedPath\)[\s\S]*?return/);
    assert.match(block, /paths\?\.length[\s\S]*?folder\.drop\.first_file_only/);
    assert.match(block, /catch \(error\)[\s\S]*?showToast/);
    assert.match(folderTabSource, /action === 'drop-paths'\) handleDroppedPaths\(event\.detail\?\.paths\)/);
});

test('설정된 외부 뷰어는 macOS 앱 번들과 비동기 실행 오류를 처리하는 공통 실행기를 사용한다', () => {
    const start = ipcSource.indexOf("ipcMain.handle('fs:openWithViewer'");
    assert.notEqual(start, -1);
    const end = ipcSource.indexOf('// 2. 다중 파일 이름 변경', start);
    const block = ipcSource.slice(start, end);

    assert.match(ipcSource, /import \{ launchExternalViewer \} from '\.\/associatedFileOpener\.js'/);
    assert.match(block, /await launchExternalViewer\(viewerPath, filePath\)/);
    assert.doesNotMatch(block, /spawn\(viewerPath/);
});

test('폴더 리스트 뷰들은 더블 클릭 이벤트를 파일 열기 핸들러에 연결한다', () => {
    for (const [name, source] of Object.entries(viewSources)) {
        assert.match(source, /onOpenFile/, `${name}에 onOpenFile prop이 있어야 합니다.`);
        assert.match(source, /onDoubleClick=\{\(event\) => handle\w+DoubleClick\(file,\s*event,\s*fileIndex\)\}/, `${name}에 더블 클릭 연결이 있어야 합니다.`);
        assert.match(source, /onOpenFile\?\.\(file,\s*event,\s*index\)/, `${name}이 클릭한 파일 객체를 전달해야 합니다.`);
    }
});
