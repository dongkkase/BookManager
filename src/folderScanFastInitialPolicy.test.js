import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    FOLDER_FILE_CACHE_LIMIT,
    rememberFolderFileCacheKey,
    trimFolderFileDataCache,
} from './hooks/useFolderScan.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(path.join(root, 'hooks', 'useFolderScan.js'), 'utf8');
const taskSource = readFileSync(path.join(root, '..', 'electron', 'tasks', 'folderScanTask.js'), 'utf8');
const ipcSource = readFileSync(path.join(root, '..', 'electron', 'ipcHandlers.js'), 'utf8');
const folderTabSource = readFileSync(path.join(root, 'tabs', 'FolderTab.jsx'), 'utf8');

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
    assert.match(taskSource, /if \(!thumbnailPathForCache && options\.skipCoverExtraction === true\)/);
    assert.match(taskSource, /thumb_path:\s*thumbnailPathForCache/);
    assert.match(taskSource, /let folderUtilsPromise = null/);
    assert.match(taskSource, /folderUtilsPromise = import\(folderUtilsUrl\)/);
});

test('폴더 변경은 새 스캔 시작 시 메인 프로세스에서 이전 폴더 스캔을 취소한다', () => {
    assert.match(ipcSource, /cancellationRegistry\.cancel\(event\.sender\.id,\s*taskId\)[\s\S]*cancellationRegistry\.start\(event\.sender\.id,\s*taskId\)/);
    assert.match(folderTabSource, /await scanFolder\(nextFolderPath,\s*scanOptions\)/);
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
