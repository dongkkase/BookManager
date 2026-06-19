import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ConfigManager } from './configManager.js';

test('개발 및 Windows portable 환경은 실행 경로에 config를 둔다', () => {
    const manager = new ConfigManager('/user/data', '/portable/app');
    assert.equal(manager.configPath, path.join('/portable/app', 'config.json'));
});

test('macOS 패키지는 사용자 데이터 경로에 config를 둔다', () => {
    const manager = new ConfigManager('/user/data', '/Applications/BookManager.app/Contents/MacOS', {
        useUserData: true,
    });
    assert.equal(manager.configPath, path.join('/user/data', 'config.json'));
});
