import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { ConfigManager } from './configManager.js';
import { LibraryDB } from './database/library_db.js';
import { migrateLegacyAppDataDir, resolveAppDataDir, resolveLegacyAppDataDirs } from './dataPaths.js';
import { assertAppDataDirWritable } from './macDataMigration.js';
import { configureHardwareAcceleration } from './hardwareAcceleration.js';
import { createBoundedLogWriter, resolveRuntimeLogPaths } from './utils/runtimeLog.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-mac-data-'));
    const executableDir = path.join(root, 'Applications', 'BookManager.app', 'Contents', 'MacOS');
    const env = { HOME: path.join(root, '사용자 홈') };
    const options = { platform: 'darwin', env };
    const destination = resolveAppDataDir(executableDir, 'darwin', env);
    const legacy = path.join(root, 'Applications', 'BookManagerData');
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, executableDir, env, options, destination, legacy };
}

function writeFile(directory, relativePath, value) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
    return filePath;
}

test('신규 macOS 설치는 앱 폴더에 쓰지 않고 사용자 데이터 폴더를 만든다', t => {
    const f = fixture(t);
    assert.equal(migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env), f.destination);
    assertAppDataDirWritable(f.destination);
    assert.equal(fs.existsSync(path.dirname(f.legacy)), false);
    assert.deepEqual(fs.readdirSync(f.destination), []);
    if (process.platform !== 'win32') assert.equal(fs.statSync(f.destination).mode & 0o777, 0o700);
});

test('업데이트 후 설정 초기화 전에 전체 데이터를 복사하고 재실행 시 새 데이터를 유지한다', async t => {
    const f = fixture(t);
    const config = { language: 'en', libraries: ['/Books'], hardware_acceleration: false, api_keys: { custom: 'kept' } };
    writeFile(f.legacy, 'config.json', JSON.stringify(config));
    for (const name of ['thumbnails/cover.jpg', 'text-thumbnails/text.webp', 'content_index/content.db',
        'models/supertonic-3/model.onnx', '.api_cache.db', 'rename_history.json']) {
        writeFile(f.legacy, name, name);
    }
    const manager = new ConfigManager(path.join(f.root, 'profile'), f.executableDir, f.options);
    await manager.initialize();
    assert.equal(manager.configPath, path.join(f.destination, 'config.json'));
    assert.deepEqual(manager.getConfig().libraries, ['/Books']);
    assert.equal(manager.getConfig().api_keys.custom, 'kept');
    for (const name of ['thumbnails/cover.jpg', 'text-thumbnails/text.webp', 'content_index/content.db',
        'models/supertonic-3/model.onnx', '.api_cache.db', 'rename_history.json']) {
        assert.equal(fs.readFileSync(path.join(f.destination, name), 'utf8'), name);
        assert.equal(fs.readFileSync(path.join(f.legacy, name), 'utf8'), name);
    }
    let disabled = false;
    configureHardwareAcceleration({ disableHardwareAcceleration: () => { disabled = true; } }, f.executableDir, f.options);
    assert.equal(disabled, true);
    const logPaths = resolveRuntimeLogPaths(f.executableDir, 'darwin', f.env);
    const writer = createBoundedLogWriter({ paths: logPaths });
    assert.equal(writer.writeLine('test', 'migrated'), true);
    writer.close();
    assert.equal(logPaths.logDir, path.join(f.destination, 'logs'));
    assert.equal(manager.saveConfig({ language: 'ja' }), true);
    migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env);
    assert.equal(new ConfigManager(f.root, f.executableDir, f.options).loadConfig().language, 'ja');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.legacy, 'config.json'), 'utf8')), config);
});

test('macOS의 이전 폴더 위치 네 가지를 지원하고 앱 옆 BookManagerData를 우선한다', t => {
    const f = fixture(t);
    const sources = resolveLegacyAppDataDirs(f.executableDir, 'darwin', f.env);
    for (const [index, source] of sources.entries()) writeFile(source, 'config.json', JSON.stringify({ index }));
    for (const [index, source] of sources.entries()) {
        migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env);
        assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, 'config.json'))).index, index);
        fs.rmSync(f.destination, { recursive: true });
        fs.rmSync(source, { recursive: true });
    }
});

test('라이브러리·TXT 표지 경로를 새 위치로 갱신하고 외부 책 경로와 읽기 기록은 유지한다', async t => {
    const f = fixture(t);
    const coverPath = writeFile(f.legacy, 'text-thumbnails/cover.webp', 'cover');
    const externalCover = path.join(f.root, 'external.jpg');
    const filePath = path.join(f.root, 'Books', 'book.txt');
    const library = new LibraryDB({ dbPath: path.join(f.legacy, 'library.db') });
    await library.saveTextMetadataRecord({
        contentHash: 'hash', metadata: { Title: 'Saved' },
        record: { path: filePath, thumb_path: coverPath, cover_override_path: coverPath }, coverPath,
    });
    await library.upsertFileInfo({ path: filePath, title: 'Saved', thumb_path: coverPath, cover_override_path: coverPath });
    await library.upsertFileInfo({ path: `${filePath}.external`, thumb_path: externalCover });
    await library.upsertReadingState(filePath, { format: 'text', pageIndex: 12 });
    t.after(() => library.close());
    const sourceDb = library.getConnection();
    sourceDb.exec('CREATE TABLE file_info (path TEXT, thumbnail TEXT)');
    sourceDb.prepare('INSERT INTO file_info VALUES (?, ?)').run('/Books/old.cbz', coverPath);
    // Leave committed WAL data present to verify it is copied with the database.
    assert.equal(fs.existsSync(`${library.dbPath}-wal`), true);

    migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env);
    const migrated = new Database(path.join(f.destination, 'library.db'));
    try {
        const expectedCover = path.join(f.destination, 'text-thumbnails/cover.webp');
        const record = migrated.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
        assert.equal(record.title, 'Saved');
        assert.equal(record.thumb_path, expectedCover);
        assert.equal(record.cover_override_path, expectedCover);
        assert.equal(fs.readFileSync(record.thumb_path, 'utf8'), 'cover');
        assert.equal(migrated.prepare('SELECT thumb_path FROM files WHERE path = ?').get(`${filePath}.external`).thumb_path, externalCover);
        const text = migrated.prepare('SELECT * FROM text_metadata').get();
        assert.equal(text.cover_path, expectedCover);
        assert.equal(JSON.parse(text.record_json).cover_override_path, expectedCover);
        assert.equal(JSON.parse(text.record_json).path, filePath);
        assert.equal(migrated.prepare('SELECT thumbnail FROM file_info').get().thumbnail, expectedCover);
        assert.equal(migrated.prepare('SELECT page_index FROM reading_states WHERE file_path = ?').get(filePath).page_index, 12);
        assert.equal(sourceDb.prepare('SELECT cover_path FROM text_metadata').get().cover_path, coverPath);
        assert.equal(migrated.pragma('quick_check', { simple: true }), 'ok');
    } finally {
        migrated.close();
        await library.close();
    }
});

test('읽기 전용 원본·상위 폴더에서도 복사하고 새 데이터에는 사용자 쓰기 권한을 부여한다', t => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX user permissions required');
    const f = fixture(t);
    const config = writeFile(f.legacy, 'config.json', '{"language":"en"}');
    const thumbnailDir = path.join(f.legacy, 'thumbnails');
    const thumbnail = writeFile(f.legacy, 'thumbnails/cover.jpg', 'cover');
    const parent = path.dirname(f.legacy);
    try {
        fs.chmodSync(config, 0o444);
        fs.chmodSync(thumbnail, 0o444);
        fs.chmodSync(thumbnailDir, 0o555);
        fs.chmodSync(f.legacy, 0o555);
        fs.chmodSync(parent, 0o555);
        migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env);
        assert.doesNotThrow(() => assertAppDataDirWritable(f.destination));
        fs.writeFileSync(path.join(f.destination, 'config.json'), '{"language":"ja"}');
        fs.writeFileSync(path.join(f.destination, 'thumbnails/cover.jpg'), 'new');
        assert.equal(fs.readFileSync(config, 'utf8'), '{"language":"en"}');
        assert.equal(fs.statSync(config).mode & 0o777, 0o444);
    } finally {
        for (const directory of [parent, f.legacy, thumbnailDir]) fs.chmodSync(directory, 0o700);
    }
});

test('복사 실패는 최종 폴더와 빈 설정을 만들지 않아 다음 실행에서 재시도할 수 있다', async t => {
    const f = fixture(t);
    writeFile(f.legacy, 'config.json', '{"language":"en"}');
    const manager = new ConfigManager(f.root, f.executableDir, f.options);
    const copy = t.mock.method(fs, 'cpSync', (_source, destination) => {
        writeFile(destination, 'config.json', '{partial');
        throw Object.assign(new Error('No space'), { code: 'ENOSPC' });
    });
    await assert.rejects(manager.initialize(), { code: 'ENOSPC' });
    assert.throws(() => manager.loadConfig(), { code: 'ENOSPC' });
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), []);
    assert.equal(fs.readFileSync(path.join(f.legacy, 'config.json'), 'utf8'), '{"language":"en"}');
    copy.mock.restore();
    await manager.initialize();
    assert.equal(manager.getConfig().language, 'en');
});

test('중단된 임시 폴더를 무시하고 최종 이름 변경 실패 시에도 원본에서 다시 이전한다', t => {
    const f = fixture(t);
    writeFile(f.legacy, 'config.json', '{"language":"en"}');
    const incomplete = path.join(path.dirname(f.destination), '.BookManagerData-migration-interrupted');
    writeFile(incomplete, 'config.json', '{partial');
    const originalRename = fs.renameSync;
    const rename = t.mock.method(fs, 'renameSync', (source, destination) => {
        if (destination === f.destination) throw Object.assign(new Error('Rename denied'), { code: 'EACCES' });
        return originalRename(source, destination);
    });
    assert.throws(() => migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env), { code: 'EACCES' });
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), [path.basename(incomplete)]);
    rename.mock.restore();
    migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env);
    assert.equal(fs.readFileSync(path.join(f.destination, 'config.json'), 'utf8'), '{"language":"en"}');
    assert.equal(fs.readFileSync(path.join(f.legacy, 'config.json'), 'utf8'), '{"language":"en"}');
});

test('읽기 전용 하위 폴더를 복사하다 실패해도 임시 폴더를 정리하고 원래 오류를 전달한다', t => {
    const f = fixture(t);
    writeFile(f.legacy, 'config.json', '{}');
    t.mock.method(fs, 'cpSync', (_source, destination) => {
        writeFile(destination, 'readonly/partial', 'partial');
        fs.chmodSync(path.join(destination, 'readonly'), 0o555);
        throw Object.assign(new Error('Copy interrupted'), { code: 'ENOSPC' });
    });
    assert.throws(() => migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env), { code: 'ENOSPC' });
    assert.equal(fs.existsSync(f.destination), false);
    assert.deepEqual(fs.readdirSync(path.dirname(f.destination)), []);
});

test('읽기 불가 원본과 쓰기 불가 대상은 권한 오류를 전달하고 원본을 유지한다', t => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('POSIX user permissions required');
    const f = fixture(t);
    const config = writeFile(f.legacy, 'config.json', '{}');
    try {
        fs.chmodSync(config, 0o000);
        assert.throws(() => migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env), { code: 'EACCES' });
        assert.equal(fs.existsSync(f.destination), false);
    } finally {
        fs.chmodSync(config, 0o600);
    }
    fs.mkdirSync(path.dirname(f.destination), { recursive: true });
    try {
        fs.chmodSync(path.dirname(f.destination), 0o555);
        assert.throws(() => migrateLegacyAppDataDir(f.executableDir, 'darwin', f.env), { code: 'EACCES' });
        assert.equal(fs.existsSync(f.destination), false);
        assert.equal(fs.readFileSync(config, 'utf8'), '{}');
    } finally {
        fs.chmodSync(path.dirname(f.destination), 0o700);
    }
    assertAppDataDirWritable(f.destination);
    const destinationConfig = writeFile(f.destination, 'config.json', '{}');
    try {
        fs.chmodSync(destinationConfig, 0o444);
        assert.throws(() => assertAppDataDirWritable(f.destination), { code: 'EACCES' });
    } finally {
        fs.chmodSync(destinationConfig, 0o600);
    }
});

test('부트스트랩은 단일 인스턴스 잠금 후 로그·설정 로딩보다 먼저 이전과 권한 검사를 수행한다', () => {
    const source = fs.readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8');
    const operations = [
        'app.requestSingleInstanceLock()', 'migrateLegacyAppDataDir(executableDir)',
        'assertAppDataDirWritable(appDataDir)', 'configureHardwareAcceleration(app, executableDir)',
        'installRuntimeLogging({', "await import('./main.js')",
    ].map(operation => source.indexOf(operation));
    assert.ok(operations.every(index => index !== -1));
    assert.deepEqual(operations, [...operations].sort((a, b) => a - b));
    assert.match(source, /catch \(error\)[\s\S]*dialog\.showErrorBox[\s\S]*app\.exit\(1\)/);
});
