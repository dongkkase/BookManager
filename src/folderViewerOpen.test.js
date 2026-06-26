import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const folderTabSource = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');
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
    assert.match(block, /openWithViewer\?\.\(config\.viewer_path,\s*target\)/);
    assert.match(block, /const handleFileOpen = useCallback/);
    assert.match(block, /selectFile\(file\.path,\s*null,\s*index\)/);
    assert.match(folderTabSource, /onOpenFile:\s*handleFileOpen/);
    assert.match(folderTabSource, /onOpenFile=\{handleFileOpen\}/);
});

test('폴더 리스트 뷰들은 더블 클릭 이벤트를 파일 열기 핸들러에 연결한다', () => {
    for (const [name, source] of Object.entries(viewSources)) {
        assert.match(source, /onOpenFile/, `${name}에 onOpenFile prop이 있어야 합니다.`);
        assert.match(source, /onDoubleClick=\{\(event\) => handle\w+DoubleClick\(file,\s*event,\s*fileIndex\)\}/, `${name}에 더블 클릭 연결이 있어야 합니다.`);
        assert.match(source, /onOpenFile\?\.\(file,\s*event,\s*index\)/, `${name}이 클릭한 파일 객체를 전달해야 합니다.`);
    }
});
