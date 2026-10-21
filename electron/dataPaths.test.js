import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    resolveApiCacheDbPath,
    resolveApiCoverCacheDir,
    resolveAppDataDir,
    resolveConfigPath,
    resolveContentIndexDbPath,
    resolveContentIndexDir,
    migrateLegacyAppDataDir,
    resolveLibraryDbPath,
    resolveLegacyAppDataDirs,
    resolvePortableBaseDir,
    resolveRenameHistoryPath,
    resolveThumbnailDir,
} from './dataPaths.js';

test('Linux 앱 데이터 경로는 실행 폴더의 BookManagerData 하위를 유지한다', () => {
    const executableDir = path.join('/portable', 'BookManager');

    assert.equal(resolveAppDataDir(executableDir, 'linux'), path.join(executableDir, 'BookManagerData'));
    assert.equal(resolveLibraryDbPath(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'library.db'));
    assert.equal(resolveContentIndexDir(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'content_index'));
    assert.equal(resolveContentIndexDbPath(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'content_index', 'content.db'));
    assert.equal(resolveApiCacheDbPath(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', '.api_cache.db'));
    assert.equal(resolveConfigPath(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'config.json'));
    assert.equal(resolveRenameHistoryPath(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'rename_history.json'));
    assert.equal(resolveThumbnailDir(executableDir, 'linux'), path.join(executableDir, 'BookManagerData', 'thumbnails'));
});

test('macOS의 모든 앱 데이터는 사용자 Application Support에 저장한다', () => {
    const executableDir = path.join('/portable', 'BookManager.app', 'Contents', 'MacOS');
    const env = { HOME: '/Users/reader' };
    const dataDir = path.join(env.HOME, 'Library', 'Application Support', 'BookManagerData');

    assert.equal(resolvePortableBaseDir(executableDir, 'darwin'), '/portable');
    assert.equal(resolveAppDataDir(executableDir, 'darwin', env), dataDir);
    assert.equal(resolveAppDataDir('/development/BookManager', 'darwin', env), dataDir);
    assert.equal(resolveAppDataDir(executableDir, 'darwin', {}), path.join(os.homedir(), 'Library', 'Application Support', 'BookManagerData'));
    assert.equal(resolveLibraryDbPath(executableDir, 'darwin', env), path.join(dataDir, 'library.db'));
    assert.equal(resolveContentIndexDbPath(executableDir, 'darwin', env), path.join(dataDir, 'content_index', 'content.db'));
    assert.equal(resolveApiCacheDbPath(executableDir, 'darwin', env), path.join(dataDir, '.api_cache.db'));
    assert.equal(resolveApiCoverCacheDir(executableDir, 'darwin', env), path.join(dataDir, 'api_cover_cache'));
    assert.equal(resolveConfigPath(executableDir, 'darwin', env), path.join(dataDir, 'config.json'));
    assert.equal(resolveRenameHistoryPath(executableDir, 'darwin', env), path.join(dataDir, 'rename_history.json'));
    assert.equal(resolveThumbnailDir(executableDir, 'darwin', env), path.join(dataDir, 'thumbnails'));
    assert.deepEqual(resolveLegacyAppDataDirs(executableDir, 'darwin', env), [
        path.join('/portable', 'BookManagerData'),
        path.join('/portable', 'data'),
        path.join(executableDir, 'BookManagerData'),
        path.join(executableDir, 'data'),
    ]);
});

test('Windows portable은 임시 추출 경로 대신 원본 exe 폴더에 BookManagerData를 둔다', () => {
    const extractedExecutableDir = path.join('C:\\Users\\Reader\\AppData\\Local\\Temp', 'BookManager');
    const portableDir = path.join('D:\\Apps', 'BookManager');
    const env = {
        PORTABLE_EXECUTABLE_DIR: portableDir,
        PORTABLE_EXECUTABLE_FILE: path.join(portableDir, 'BookManager.exe'),
    };

    assert.equal(resolvePortableBaseDir(extractedExecutableDir, 'win32', env), portableDir);
    assert.equal(resolveAppDataDir(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData'));
    assert.equal(resolveLibraryDbPath(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', 'library.db'));
    assert.equal(resolveContentIndexDbPath(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', 'content_index', 'content.db'));
    assert.equal(resolveApiCacheDbPath(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', '.api_cache.db'));
    assert.equal(resolveConfigPath(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', 'config.json'));
    assert.equal(resolveRenameHistoryPath(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', 'rename_history.json'));
    assert.equal(resolveThumbnailDir(extractedExecutableDir, 'win32', env), path.join(portableDir, 'BookManagerData', 'thumbnails'));
});

test('기존 data 폴더는 BookManagerData로 이동한다', () => {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'bookmanager-data-paths-'));
    try {
        const legacyDir = path.join(root, 'data');
        const nextDir = path.join(root, 'BookManagerData');
        fs.mkdirSync(path.join(legacyDir, 'thumbnails'), { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'library.db'), 'db');
        fs.writeFileSync(path.join(legacyDir, 'thumbnails', 'cover.jpg'), 'cover');

        assert.deepEqual(resolveLegacyAppDataDirs(root, 'linux'), [legacyDir]);
        assert.equal(migrateLegacyAppDataDir(root, 'linux'), nextDir);
        assert.equal(fs.existsSync(legacyDir), false);
        assert.equal(fs.readFileSync(path.join(nextDir, 'library.db'), 'utf8'), 'db');
        assert.equal(fs.readFileSync(path.join(nextDir, 'thumbnails', 'cover.jpg'), 'utf8'), 'cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('IPC의 DB, 캐시 파일, 썸네일 경로는 BookManagerData 경로 정책을 사용한다', () => {
    const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    const libraryTask = fs.readFileSync(new URL('./tasks/libraryTask.js', import.meta.url), 'utf8');
    const configManager = fs.readFileSync(new URL('./configManager.js', import.meta.url), 'utf8');

    assert.match(source, /resolveLibraryDbPath/);
    assert.match(source, /resolveContentIndexDbPath/);
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
