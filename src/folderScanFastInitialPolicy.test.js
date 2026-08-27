import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    appendUniqueFolderFiles,
    FOLDER_FILE_CACHE_LIMIT,
    hasReusableFolderFileCache,
    rememberFolderFileCacheKey,
    trimFolderFileDataCache,
} from './hooks/useFolderScan.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(path.join(root, 'hooks', 'useFolderScan.js'), 'utf8');
const taskSource = readFileSync(path.join(root, '..', 'electron', 'tasks', 'folderScanTask.js'), 'utf8');
const ipcSource = readFileSync(path.join(root, '..', 'electron', 'ipcHandlers.js'), 'utf8');
const preloadSource = readFileSync(path.join(root, '..', 'electron', 'preload.js'), 'utf8');
const preloadCjsSource = readFileSync(path.join(root, '..', 'electron', 'preload.cjs'), 'utf8');
const folderTabSource = readFileSync(path.join(root, 'tabs', 'FolderTab.jsx'), 'utf8');
const folderStyles = readFileSync(path.join(root, 'styles', 'FolderTab.css'), 'utf8');

test('폴더 클릭의 빠른 1차 목록은 readDir로 먼저 표시하고 무거운 조회를 뒤로 미룬다', () => {
    assert.match(hookSource, /async function readQuickListFiles/);
    assert.match(hookSource, /window\.electronAPI\?\.readDir\?\.\(folderPath\)/);
    assert.match(hookSource, /cache_source:\s*'renderer-quick'/);
    assert.match(hookSource, /const refreshInBackground = async/);
    assert.match(hookSource, /background:\s*true/);
    assert.match(hookSource, /skipArchiveExtraction:\s*true/);
    assert.match(hookSource, /skipLibraryCache:\s*true/);
    assert.match(taskSource, /const cached = options\.skipLibraryCache === true[\s\S]*await safeGetCachedFileInfo/);
    assert.match(taskSource, /options\.libraryDb && options\.skipLibraryCache !== true/);
    assert.match(taskSource, /function createQuickFileData/);
    assert.match(taskSource, /if \(quickListOnly\) \{[\s\S]*await scanQuickList\(folderPath\)/);
    assert.match(taskSource, /if \(!thumbnailPathForCache && !thumbnailRefreshCompleted && options\.skipCoverExtraction === true\)/);
    assert.match(taskSource, /thumb_path:\s*thumbnailPathForCache/);
    assert.match(taskSource, /let folderUtilsPromise = null/);
    assert.match(taskSource, /folderUtilsPromise = import\(folderUtilsUrl\)/);
});

test('폴더 변경은 새 스캔 시작 시 메인 프로세스에서 이전 폴더 스캔을 취소한다', () => {
    assert.match(ipcSource, /cancellationRegistry\.cancel\(event\.sender\.id,\s*taskId\)[\s\S]*cancellationRegistry\.start\(event\.sender\.id,\s*taskId\)/);
    assert.match(folderTabSource, /await scanFolder\(nextFolderPath,\s*scanOptions\)/);
});

test('하위 폴더 빠른 목록은 경량 재귀 탐색이 끝날 때까지 로딩 상태를 표시한다', () => {
    assert.match(hookSource, /includeSubfolders\s*\?\s*\{ quickListOnly:\s*true,\s*skipArchiveExtraction:\s*true \}/);
    assert.match(hookSource, /reportTaskProgress:\s*includeSubfolders/);
    assert.match(hookSource, /reportQuickFiles:\s*includeSubfolders/);
    assert.match(hookSource, /resultCacheKey:\s*cacheKey/);
    assert.match(hookSource, /const initialFiles = includeSubfolders \? \[\] : await readQuickListFiles\(folderPath\)/);
    assert.match(hookSource, /onFolderQuickFiles/);
    assert.match(hookSource, /removeQuickFiles\(\)/);
    assert.match(hookSource, /startTransition\(updateCache\)/);
    assert.match(hookSource, /QUICK_FILES_FLUSH_DELAY_MS/);
    assert.match(hookSource, /const applyQuickFileEvents =[\s\S]*isCurrentScanEvent\(data\)[\s\S]*pendingScanCacheKeysRef\.current\.has\(data\.cacheKey\)/);
    assert.match(hookSource, /const updateCache =[\s\S]*pendingScanCacheKeysRef\.current\.has\(cacheKey\)[\s\S]*isCurrentScanEvent\(data\)/);
    assert.match(hookSource, /if \(includeSubfolders\) \{\s*return await refreshInBackground\(\);/);
    assert.match(taskSource, /async function scanQuickList[\s\S]*folder:quickFiles/);
    assert.match(taskSource, /const pendingDirectories = \[rootPath\]/);
    assert.match(preloadSource, /onFolderQuickFiles:\s*\(callback\) => \{\s*const handler = \(_, data\) => callback\(data\);/);
    assert.match(preloadCjsSource, /onFolderQuickFiles:\s*\(callback\) => \{\s*const handler = \(_, data\) => callback\(data\);/);
    assert.match(preloadSource, /onFolderQuickFiles:[\s\S]*ipcRenderer\.on\('folder:quickFiles', handler\)[\s\S]*removeListener\('folder:quickFiles', handler\)/);
    assert.match(preloadCjsSource, /onFolderQuickFiles:[\s\S]*ipcRenderer\.on\('folder:quickFiles', handler\)[\s\S]*removeListener\('folder:quickFiles', handler\)/);
    assert.match(folderTabSource, /aria-busy=\{!isRecentReading && scanning\}/);
    assert.match(folderTabSource, /<FolderScanFeedback[\s\S]*message=\{statusMessage\}/);
    assert.match(folderTabSource, /role="status"[\s\S]*aria-live="polite"/);
    assert.match(folderTabSource, /onCancel=\{cancelScan\}/);
    assert.match(hookSource, /scanRequestIdRef\.current \+= 1;[\s\S]*stopTask\?\.\('folder:scan'\)/);
    assert.match(folderStyles, /\.folder-scan-feedback\.is-empty/);
    assert.match(folderStyles, /\.folder-scan-feedback\.is-compact/);
});

test('재귀 빠른 목록 배치는 기존 순서를 유지하며 새 경로만 추가한다', () => {
    const rootFile = { path: '/books/Root Book.cbz', cache_source: 'renderer-quick' };
    const nestedFile = { path: '/books/nested/Nested Book.pdf', cache_source: 'quick' };
    const current = [rootFile];
    const merged = appendUniqueFolderFiles(current, [rootFile, nestedFile, nestedFile, {}, null]);

    assert.deepEqual(merged, [rootFile, nestedFile]);
    assert.equal(appendUniqueFolderFiles(merged, []), merged);
    assert.equal(appendUniqueFolderFiles(merged, [nestedFile]), merged);
});

test('완료되지 않은 재귀 목록 캐시는 취소 후 다시 사용하지 않는다', () => {
    const cacheKey = JSON.stringify({ folderPath: '/books', includeSubfolders: true });
    const cache = { [cacheKey]: [{ path: '/books/Root Book.cbz' }] };

    assert.equal(hasReusableFolderFileCache(cache, new Set(), cacheKey), true);
    assert.equal(hasReusableFolderFileCache(cache, new Set([cacheKey]), cacheKey), false);
});

test('폴더 파일 캐시는 오래된 폴더 항목을 제한한다', () => {
    let order = [];
    const cache = {};

    for (let index = 0; index < FOLDER_FILE_CACHE_LIMIT + 2; index += 1) {
        const cacheKey = JSON.stringify({ folderPath: `/books/${index}` });
        order = rememberFolderFileCacheKey(order, cacheKey);
        cache[cacheKey] = [{ path: `/books/${index}/1.cbz` }];
    }

    const trimmed = trimFolderFileDataCache(cache, order);
    assert.equal(Object.keys(trimmed).length, FOLDER_FILE_CACHE_LIMIT);
    assert.equal(trimmed[JSON.stringify({ folderPath: '/books/0' })], undefined);
    assert.deepEqual(
        trimmed[JSON.stringify({ folderPath: `/books/${FOLDER_FILE_CACHE_LIMIT + 1}` })],
        [{ path: `/books/${FOLDER_FILE_CACHE_LIMIT + 1}/1.cbz` }],
    );

    const keptKey = JSON.stringify({ folderPath: '/books/0' });
    const kept = trimFolderFileDataCache(cache, order, keptKey);
    assert.equal(Object.keys(kept).length, FOLDER_FILE_CACHE_LIMIT);
    assert.deepEqual(kept[keptKey], [{ path: '/books/0/1.cbz' }]);
});
