import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(path.join(root, 'hooks', 'useFolderScan.js'), 'utf8');
const taskSource = readFileSync(path.join(root, '..', 'electron', 'tasks', 'folderScanTask.js'), 'utf8');

test('폴더 클릭의 빠른 1차 스캔은 라이브러리 DB 캐시 조회를 건너뛴다', () => {
    assert.match(hookSource, /skipArchiveExtraction:\s*true/);
    assert.match(hookSource, /skipLibraryCache:\s*true/);
    assert.match(taskSource, /const cached = options\.skipLibraryCache === true[\s\S]*await safeGetCachedFileInfo/);
    assert.match(taskSource, /options\.libraryDb && options\.skipLibraryCache !== true/);
    assert.match(taskSource, /let folderUtilsPromise = null/);
    assert.match(taskSource, /folderUtilsPromise = import\(folderUtilsUrl\)/);
});
