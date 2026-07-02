import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(root, '..');
const viewerWindowSource = readFileSync(path.join(root, 'viewerWindow.js'), 'utf8');
const viewerSessionSource = readFileSync(path.join(root, 'viewerSessions.js'), 'utf8');
const viewerPreloadSource = readFileSync(path.join(root, 'viewerPreload.cjs'), 'utf8');
const preloadSource = readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const mainSource = readFileSync(path.join(root, 'main.js'), 'utf8');
const folderTabSource = readFileSync(path.join(projectRoot, 'src', 'tabs', 'FolderTab.jsx'), 'utf8');
const appEntrySource = readFileSync(path.join(projectRoot, 'src', 'main.jsx'), 'utf8');
const viewerAppSource = readFileSync(path.join(projectRoot, 'src', 'ViewerApp.jsx'), 'utf8');
const indexSource = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

test('내부 뷰어는 모달이 아니라 단일 BrowserWindow를 재사용한다', () => {
    assert.match(viewerWindowSource, /let viewerWindow = null/);
    assert.match(viewerWindowSource, /if \(viewerWindow && !viewerWindow\.isDestroyed\(\)\) return viewerWindow/);
    assert.match(viewerWindowSource, /viewerWindow = new BrowserWindow/);
    assert.match(viewerWindowSource, /ipcMain\.handle\('viewer:open'/);
    assert.match(viewerWindowSource, /webContents\.send\('viewer:load-session'/);
    assert.match(viewerWindowSource, /isLoadingMainFrame/);
    assert.match(viewerWindowSource, /plugins:\s*true/);
    assert.match(viewerWindowSource, /protocol\.handle\('bookmanager-comic'/);
    assert.match(viewerWindowSource, /protocol\.handle\('bookmanager-document'/);
    assert.match(mainSource, /setupViewerWindowManager/);
    assert.match(mainSource, /viewerWindow\.close\(\)/);
    assert.doesNotMatch(viewerWindowSource, /modal:\s*true/);
});

test('메인 앱은 내부 뷰어 IPC를 우선 사용하고 외부 뷰어를 fallback으로 유지한다', () => {
    assert.match(preloadSource, /openInternalViewer:\s*\(filePath\) => ipcRenderer\.invoke\('viewer:open', filePath\)/);
    assert.match(folderTabSource, /openInternalViewer\?\.\(target\)/);
    assert.match(folderTabSource, /if \(internalResult\?\.success\) return/);
    assert.match(folderTabSource, /openWithViewer\?\.\(config\.viewer_path,\s*target\)/);
});

test('뷰어 창은 같은 React 번들의 전용 viewer 모드로 로드된다', () => {
    assert.match(viewerWindowSource, /\?viewer=1/);
    assert.match(viewerWindowSource, /loadFile\(distIndexPath,\s*\{\s*query:\s*\{\s*viewer:\s*'1'\s*\}\s*\}\)/);
    assert.match(appEntrySource, /get\('viewer'\) === '1'/);
    assert.match(appEntrySource, /import\('\.\/ViewerApp\.jsx'\)/);
    assert.match(appEntrySource, /renderRoot\(App\)/);
    assert.doesNotMatch(appEntrySource, /import ViewerApp from/);
    assert.match(indexSource, /frame-src[^;]*data:/);
    assert.match(indexSource, /frame-src[^;]*bookmanager-document:/);
    assert.match(indexSource, /img-src[^;]*bookmanager-comic:/);
});

test('뷰어 창은 F12와 Ctrl+Shift+I로 개발자 도구를 토글한다', () => {
    assert.match(viewerWindowSource, /before-input-event/);
    assert.match(viewerWindowSource, /key === 'f12'/);
    assert.match(viewerWindowSource, /input\.control && input\.shift && key === 'i'/);
    assert.match(viewerWindowSource, /isDevToolsOpened\(\)/);
    assert.match(viewerWindowSource, /openDevTools\(\{\s*mode:\s*'detach'\s*\}\)/);
    assert.match(viewerWindowSource, /closeDevTools\(\)/);
});

test('뷰어 preload는 세션과 포맷별 읽기 API만 노출한다', () => {
    assert.match(viewerPreloadSource, /contextBridge\.exposeInMainWorld\('viewerAPI'/);
    assert.match(viewerPreloadSource, /listComicPages/);
    assert.match(viewerPreloadSource, /getComicPage/);
    assert.match(viewerPreloadSource, /getDocumentData/);
    assert.match(viewerPreloadSource, /getText/);
    assert.match(viewerPreloadSource, /getEpubText/);
    assert.match(viewerPreloadSource, /openAdjacent/);
    assert.doesNotMatch(viewerPreloadSource, /deleteFiles|renameFile|saveConfig/);
});

test('뷰어 툴바는 커스텀 드롭다운과 책갈피 아이콘을 사용한다', () => {
    assert.match(viewerAppSource, /function ViewerDropdown/);
    assert.doesNotMatch(viewerAppSource, /<select/);
    assert.match(viewerAppSource, /icon="bookmark"/);
    assert.doesNotMatch(viewerAppSource, /title="닫기 \(Esc\)"/);
});

test('뷰어 인접권 버튼은 사용 가능할 때만 동작한다', () => {
    assert.match(viewerSessionSource, /adjacent:\s*adjacentBookState\(normalizedPath\)/);
    assert.match(viewerSessionSource, /MAX_VIEWER_SESSIONS/);
    assert.doesNotMatch(viewerSessionSource, /this\.sessions\.clear\(\)/);
    assert.match(viewerSessionSource, /hasPrevious/);
    assert.match(viewerSessionSource, /hasNext/);
    assert.match(viewerAppSource, /const hasPreviousBook = Boolean\(session\?\.adjacent\?\.hasPrevious\)/);
    assert.match(viewerAppSource, /const hasNextBook = Boolean\(session\?\.adjacent\?\.hasNext\)/);
    assert.match(viewerAppSource, /disabled=\{!hasPreviousBook \|\| adjacentLoading\}/);
    assert.match(viewerAppSource, /disabled=\{!hasNextBook \|\| adjacentLoading\}/);
    assert.match(viewerAppSource, /if \(!session \|\| !hasAdjacentBook \|\| adjacentLoadingRef\.current\) return/);
    assert.match(viewerAppSource, /adjacentLoadingRef/);
    assert.match(viewerAppSource, /await loadSession\(result\.session\)/);
    assert.doesNotMatch(viewerWindowSource, /openAdjacentViewer[\s\S]*sendSession\(session\)/);
    assert.match(viewerAppSource, /message === 'No adjacent book\.'/);
});

test('뷰어 세션은 만화책, PDF, EPUB, TXT 형식을 분기한다', () => {
    assert.match(viewerSessionSource, /COMIC_EXTENSIONS = new Set\(\['\.zip', '\.cbz', '\.rar', '\.cbr', '\.7z', '\.cb7'\]\)/);
    assert.match(viewerSessionSource, /PDF_EXTENSIONS = new Set\(\['\.pdf'\]\)/);
    assert.match(viewerSessionSource, /EPUB_EXTENSIONS = new Set\(\['\.epub'\]\)/);
    assert.match(viewerSessionSource, /TEXT_EXTENSIONS = new Set/);
    assert.match(viewerSessionSource, /listComicPages/);
    assert.match(viewerSessionSource, /pageUrl:\s*comicPageProtocolUrl/);
    assert.match(mainSource, /scheme:\s*'bookmanager-comic'/);
    assert.match(viewerSessionSource, /documentUrl/);
    assert.match(viewerSessionSource, /bookmanager-document/);
    assert.match(viewerWindowSource, /fs\.createReadStream\(document\.filePath,\s*\{\s*start,\s*end\s*\}\)/);
    assert.match(viewerWindowSource, /Readable\.toWeb/);
    assert.match(viewerWindowSource, /Accept-Ranges': 'bytes'/);
    assert.match(viewerSessionSource, /getEpubText/);
});

test('PDF 뷰어는 blob iframe과 내부 문서 URL fetch를 사용한다', () => {
    assert.match(viewerAppSource, /<iframe/);
    assert.match(viewerAppSource, /fetch\(result\.documentUrl/);
    assert.match(viewerAppSource, /URL\.createObjectURL/);
    assert.match(viewerAppSource, /URL\.revokeObjectURL/);
    assert.match(viewerAppSource, /documentBlobUrlRef/);
    assert.match(indexSource, /frame-src[^;]*blob:/);
    assert.match(indexSource, /connect-src[^;]*bookmanager-document:/);
    assert.match(viewerAppSource, /nextAnimationFrame/);
    assert.match(viewerAppSource, /loadSequenceRef/);
    assert.match(viewerAppSource, /setDocumentFrameKey/);
    assert.match(viewerAppSource, /setDocumentUrl\(blobUrl\)/);
    assert.doesNotMatch(viewerAppSource, /<embed/);
    assert.doesNotMatch(viewerAppSource, /setDocumentUrl\(result\.fileUrl/);
    assert.doesNotMatch(viewerSessionSource, /fileUrl/);
    assert.doesNotMatch(viewerSessionSource, /MAX_DOCUMENT_DATA_URL_BYTES/);
    assert.doesNotMatch(viewerAppSource, /<object className="viewer-document-frame"/);
});

test('만화책 페이지 이미지는 전용 프로토콜 실패 시 IPC data URL로 fallback 한다', () => {
    assert.match(viewerAppSource, /const src = pageData\[page\.name\] \|\| page\?\.pageUrl/);
    assert.match(viewerAppSource, /loadComicPage\(index,\s*\{\s*force:\s*true\s*\}\)/);
    assert.match(viewerAppSource, /const \{\s*naturalWidth,\s*naturalHeight\s*\} = event\.currentTarget/);
    assert.doesNotMatch(viewerAppSource, /event\.currentTarget\.naturalWidth\s*\//);
    assert.match(viewerAppSource, /setPageErrors/);
    assert.match(viewerAppSource, /viewer-comic-placeholder is-error/);
    assert.match(viewerSessionSource, /if \(buffer\) return buffer/);
    assert.match(viewerWindowSource, /new Uint8Array\(page\.buffer\)/);
});
