import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    resolveApiCacheDbPath,
    resolveAppDataDir,
    resolveConfigPath,
    resolveLibraryDbPath,
    resolvePortableBaseDir,
    resolveRenameHistoryPath,
    resolveThumbnailDir,
} from './dataPaths.js';

test('앱 데이터 경로는 실행 폴더의 data 하위로 고정한다', () => {
    const executableDir = path.join('/portable', 'BookManager');

    assert.equal(resolveAppDataDir(executableDir), path.join(executableDir, 'data'));
    assert.equal(resolveLibraryDbPath(executableDir), path.join(executableDir, 'data', 'library.db'));
    assert.equal(resolveApiCacheDbPath(executableDir), path.join(executableDir, 'data', '.api_cache.db'));
    assert.equal(resolveConfigPath(executableDir), path.join(executableDir, 'data', 'config.json'));
    assert.equal(resolveRenameHistoryPath(executableDir), path.join(executableDir, 'data', 'rename_history.json'));
    assert.equal(resolveThumbnailDir(executableDir), path.join(executableDir, 'data', 'thumbnails'));
});

test('macOS .app 내부 실행 경로는 앱 번들 옆 data 폴더로 변환한다', () => {
    const executableDir = path.join('/portable', 'BookManager.app', 'Contents', 'MacOS');

    assert.equal(resolvePortableBaseDir(executableDir, 'darwin'), '/portable');
    assert.equal(resolveAppDataDir(executableDir, 'darwin'), path.join('/portable', 'data'));
    assert.equal(resolveLibraryDbPath(executableDir, 'darwin'), path.join('/portable', 'data', 'library.db'));
    assert.equal(resolveApiCacheDbPath(executableDir, 'darwin'), path.join('/portable', 'data', '.api_cache.db'));
    assert.equal(resolveConfigPath(executableDir, 'darwin'), path.join('/portable', 'data', 'config.json'));
    assert.equal(resolveRenameHistoryPath(executableDir, 'darwin'), path.join('/portable', 'data', 'rename_history.json'));
    assert.equal(resolveThumbnailDir(executableDir, 'darwin'), path.join('/portable', 'data', 'thumbnails'));
});

test('IPC의 DB, 캐시 파일, 썸네일 경로는 data 경로 정책을 사용한다', () => {
    const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    const libraryTask = fs.readFileSync(new URL('./tasks/libraryTask.js', import.meta.url), 'utf8');
    const configManager = fs.readFileSync(new URL('./configManager.js', import.meta.url), 'utf8');

    assert.match(source, /resolveLibraryDbPath/);
    assert.match(source, /resolveApiCacheDbPath/);
    assert.match(source, /resolveRenameHistoryPath/);
    assert.match(source, /resolveThumbnailDir/);
    assert.match(source, /openApiCacheDb\(apiCacheDbPath\(\)\)/);
    assert.match(source, /new LibraryDB\(\{ dbPath: libraryDbPath\(\) \}\)/);
    assert.match(configManager, /resolveConfigPath/);
    assert.match(libraryTask, /resolveThumbnailDir\(process\.cwd\(\)\)/);
    assert.doesNotMatch(source, /path\.join\(configManager\.userDataPath,\s*'library\.db'\)/);
    assert.doesNotMatch(source, /path\.join\(configManager\.userDataPath,\s*'rename_history\.json'\)/);
});
