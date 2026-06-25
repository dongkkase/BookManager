import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigManager } from './configManager.js';

function dataConfigPath(root) {
    return path.join(root, 'BookManagerData', 'config.json');
}

function legacyDataConfigPath(root) {
    return path.join(root, 'data', 'config.json');
}

function writeDataConfig(root, config) {
    const configPath = dataConfigPath(root);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config));
    return configPath;
}

test('config는 실행 경로의 BookManagerData 폴더에 둔다', () => {
    const manager = new ConfigManager('/user/data', '/portable/app');
    assert.equal(manager.configPath, path.join('/portable/app', 'BookManagerData', 'config.json'));
});

test('useUserData 옵션이 있어도 config는 실행 경로의 BookManagerData 폴더에 둔다', () => {
    const manager = new ConfigManager('/user/data', '/Applications/BookManager.app/Contents/MacOS', {
        platform: 'darwin',
        useUserData: true,
    });
    assert.equal(manager.configPath, path.join('/Applications', 'BookManagerData', 'config.json'));
});

test('기존 설정의 알 수 없는 key와 API key를 손실 없이 유지한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-'));
    try {
        const configPath = writeDataConfig(root, {
            lang: 'ja',
            legacy_plugin_option: { enabled: true },
            api_keys: { custom_provider: 'secret', aladin: 'key' },
        });
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(loaded.lang, 'ja');
        assert.equal(loaded.language, 'ja');
        assert.deepEqual(loaded.legacy_plugin_option, { enabled: true });
        manager.saveConfig({ target_format: 'cbz', api_keys: { google: 'g' } });
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.deepEqual(saved.legacy_plugin_option, { enabled: true });
        assert.equal(saved.api_keys.custom_provider, 'secret');
        assert.equal(saved.api_keys.aladin, 'key');
        assert.equal(saved.api_keys.google, 'g');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('경로 목록과 즐겨찾기는 형식을 유지하며 중복을 제거한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-paths-'));
    try {
        writeDataConfig(root, {
            libraries: ['/Books/', '/Comics'],
            dup_check_folders: ['/books', '/Manga'],
            favorites: [
                '/Books/A',
                { name: 'A duplicate', path: '/books/a/' },
                { name: 'B', path: '/Books/B' },
            ],
        });
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.deepEqual(loaded.libraries, ['/Books/', '/Comics', '/Manga']);
        assert.deepEqual(loaded.dup_check_folders, loaded.libraries);
        assert.deepEqual(loaded.favorites, ['/Books/A', { name: 'B', path: '/Books/B' }]);
        assert.deepEqual(loaded.folder_favorites, loaded.favorites);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('config가 없으면 기본 설정을 생성한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-default-'));
    try {
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(fs.existsSync(dataConfigPath(root)), true);
        assert.equal(loaded.target_format, 'none');
        assert.equal(loaded.completion_sound, 'Default.wav');
        assert.equal(loaded.last_tab_id, 'folder');
        assert.equal(loaded.folder_last_path, '');
        assert.equal(loaded.last_meta_api, '리디북스');
        assert.equal(loaded.preferred_meta_api_comic, '리디북스');
        assert.equal(loaded.preferred_meta_api_book, '리디북스');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('기존 마지막 검색 API를 책 타입별 기본 검색 API로 승계한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-meta-api-'));
    try {
        writeDataConfig(root, {
            last_meta_api: 'Google Books',
        });
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(loaded.preferred_meta_api_comic, 'Google Books');
        assert.equal(loaded.preferred_meta_api_book, 'Google Books');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('손상된 config를 백업하고 안전한 기본값으로 복구한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-corrupt-'));
    try {
        const configPath = dataConfigPath(root);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, '{broken');
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(loaded.lang, 'ko');
        assert.equal(fs.existsSync(configPath), true);
        assert.equal(
            fs.readdirSync(path.dirname(configPath)).some(name => name.startsWith('config.json.corrupt-') && name.endsWith('.bak')),
            true,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('연속 부분 저장은 이전 변경과 임시 파일 정리를 유지한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-writes-'));
    try {
        const manager = new ConfigManager(root, root);
        manager.loadConfig();
        manager.updateConfig({ width: 1400 });
        manager.updateConfig({ height: 900 });
        manager.updateConfig({ folder_view_mode: 'tile' });
        const configPath = dataConfigPath(root);
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(saved.width, 1400);
        assert.equal(saved.height, 900);
        assert.equal(saved.folder_view_mode, 'tile');
        assert.deepEqual(fs.readdirSync(path.dirname(configPath)).filter(name => name.endsWith('.tmp')), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('언어 부분 저장은 lang과 language를 같은 값으로 동기화한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-language-'));
    try {
        writeDataConfig(root, {
            lang: 'ko',
            language: 'ko',
        });
        const manager = new ConfigManager(root, root);
        manager.loadConfig();
        manager.updateConfig({ lang: 'en' });
        let saved = JSON.parse(fs.readFileSync(dataConfigPath(root), 'utf8'));
        assert.equal(saved.lang, 'en');
        assert.equal(saved.language, 'en');

        manager.updateConfig({ language: 'ja' });
        saved = JSON.parse(fs.readFileSync(dataConfigPath(root), 'utf8'));
        assert.equal(saved.lang, 'ja');
        assert.equal(saved.language, 'ja');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('루트의 기존 config.json은 BookManagerData/config.json으로 복사해 읽는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-legacy-'));
    try {
        fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({
            language: 'en',
            target_format: 'cbz',
        }));
        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(loaded.language, 'en');
        assert.equal(loaded.target_format, 'cbz');
        assert.equal(fs.existsSync(dataConfigPath(root)), true);
        assert.equal(fs.existsSync(path.join(root, 'config.json')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('userData의 기존 config.json도 BookManagerData/config.json으로 복사해 읽는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-userdata-'));
    const userData = path.join(root, 'userdata');
    const executableDir = path.join(root, 'app');
    try {
        fs.mkdirSync(userData, { recursive: true });
        fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
            language: 'ja',
            play_sound: false,
        }));
        const manager = new ConfigManager(userData, executableDir);
        const loaded = manager.loadConfig();
        assert.equal(loaded.language, 'ja');
        assert.equal(loaded.play_sound, false);
        assert.equal(fs.existsSync(dataConfigPath(executableDir)), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('기존 data 폴더는 BookManagerData로 이동해 읽는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-legacy-data-'));
    try {
        const configPath = legacyDataConfigPath(root);
        fs.mkdirSync(path.join(root, 'data', 'thumbnails'), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            language: 'en',
            target_format: 'zip',
        }));
        fs.writeFileSync(path.join(root, 'data', 'library.db'), 'db');
        fs.writeFileSync(path.join(root, 'data', 'thumbnails', 'cover.jpg'), 'cover');

        const manager = new ConfigManager(root, root);
        const loaded = manager.loadConfig();
        assert.equal(loaded.language, 'en');
        assert.equal(loaded.target_format, 'zip');
        assert.equal(fs.existsSync(path.join(root, 'data')), false);
        assert.equal(fs.existsSync(dataConfigPath(root)), true);
        assert.equal(fs.readFileSync(path.join(root, 'BookManagerData', 'library.db'), 'utf8'), 'db');
        assert.equal(fs.readFileSync(path.join(root, 'BookManagerData', 'thumbnails', 'cover.jpg'), 'utf8'), 'cover');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('macOS 앱 번들 내부 data의 기존 config도 앱 옆 BookManagerData/config.json으로 복사해 읽는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-mac-bundle-'));
    const executableDir = path.join(root, 'BookManager.app', 'Contents', 'MacOS');
    try {
        fs.mkdirSync(path.join(executableDir, 'data'), { recursive: true });
        fs.writeFileSync(path.join(executableDir, 'data', 'config.json'), JSON.stringify({
            language: 'en',
            target_format: 'webp',
        }));
        const manager = new ConfigManager(root, executableDir, { platform: 'darwin' });
        const loaded = manager.loadConfig();
        assert.equal(loaded.language, 'en');
        assert.equal(loaded.target_format, 'webp');
        assert.equal(fs.existsSync(dataConfigPath(root)), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
