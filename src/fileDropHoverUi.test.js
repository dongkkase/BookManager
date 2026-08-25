import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { translate } from './utils/i18n.js';

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const appStyles = readFileSync(new URL('./styles/App.css', import.meta.url), 'utf8');

test('드롭을 허용하는 작업 탭은 외부 파일 드래그 중 공통 드롭존 오버레이를 표시한다', () => {
    assert.match(appSource, /const dropInteractionBlocked = isAppLocked \|\| showSettings/);
    assert.match(appSource, /fileDropHoverEnabled = canAcceptGlobalDrop\(activeTab, dropInteractionBlocked\)/);
    assert.match(appSource, /canAcceptGlobalDrop\(activeTab, dropInteractionBlocked\)/);
    assert.match(appSource, /isExternalFileDrag\(event\.dataTransfer\)/);
    assert.match(appSource, /showFileDropHover && <FileDropHoverOverlay opensViewer=\{activeTab === 'folder'\} t=\{t\} \/>/);
    assert.match(appSource, /role="status"/);
    assert.match(appSource, /aria-live="polite"/);
});

test('폴더 탭 드롭존은 파일이 뷰어로 열린다는 안내를 구분해 표시한다', () => {
    assert.match(appSource, /name=\{opensViewer \? 'bookOpen' : 'fileCirclePlus'\}/);
    assert.match(appSource, /t\(opensViewer \? 'folder\.drop\.open_in_viewer' : 'drag_drop'\)/);
    assert.match(appSource, /opensViewer \? 'is-viewer-open' : ''/);
    assert.match(appStyles, /\.app-file-drop-hover\.is-viewer-open\s*\{/);

    const expected = {
        ko: '지원 파일은 뷰어로 열고, 폴더는 해당 위치로 이동합니다',
        en: 'Drop a supported file to open it in the viewer, or a folder to navigate to it',
        ja: '対応ファイルはビューアで開き、フォルダーはその場所へ移動します',
    };
    for (const [language, message] of Object.entries(expected)) {
        assert.equal(translate('folder.drop.open_in_viewer', language), message);
        assert.notEqual(translate('folder.drop.first_file_only', language), 'folder.drop.first_file_only');
    }
});

test('중첩 드롭존 이동과 드롭 완료 시 호버 상태를 안정적으로 초기화한다', () => {
    assert.match(appSource, /fileDragDepthRef\.current \+= 1/);
    assert.match(appSource, /Math\.max\(0, fileDragDepthRef\.current - 1\)/);
    assert.match(appSource, /onDragEnter=\{handleGlobalDragEnter\}/);
    assert.match(appSource, /onDragLeave=\{handleGlobalDragLeave\}/);
    assert.match(appSource, /onDragEnd=\{resetFileDropHover\}/);
    assert.match(appSource, /const handleGlobalDrop = useCallback\(async \(event\) => \{\s+event\.preventDefault\(\);\s+resetFileDropHover\(\);/);
});

test('드롭존 효과는 입력을 막지 않고 모션 감소 설정을 따른다', () => {
    assert.match(appStyles, /\.app-file-drop-hover\s*\{[^}]*border:\s*2px dashed[^}]*pointer-events:\s*none/s);
    assert.match(appStyles, /@keyframes app-file-drop-hover-in/);
    assert.match(appStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-file-drop-hover\s*\{\s*animation:\s*none;/);
});
