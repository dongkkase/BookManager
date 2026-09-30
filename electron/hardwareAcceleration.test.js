import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigManager } from './configManager.js';
import { resolveConfigPath } from './dataPaths.js';
import { configureHardwareAcceleration } from './hardwareAcceleration.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-gpu-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('missing, invalid and legacy settings preserve the default without writing files', t => {
    const root = fixture(t);
    const app = { disableHardwareAcceleration: () => assert.fail('Acceleration should keep its default') };
    assert.equal(configureHardwareAcceleration(app, root), true);
    assert.deepEqual(fs.readdirSync(root), []);
    const configPath = resolveConfigPath(root);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    for (const content of ['{broken', 'null', '{}', '{"hardware_acceleration":true}', '{"hardware_acceleration":"false"}']) {
        fs.writeFileSync(configPath, content);
        assert.equal(configureHardwareAcceleration(app, root), true);
        assert.equal(fs.readFileSync(configPath, 'utf8'), content);
    }
});

test('the saved preference survives unrelated saves and controls acceleration on the next launch', t => {
    const root = fixture(t);
    const manager = new ConfigManager(root, root);
    assert.equal(manager.loadConfig().hardware_acceleration, true);
    assert.equal(manager.saveConfig({ hardware_acceleration: false }), true);
    assert.equal(manager.saveConfig({ language: 'en' }), true);
    assert.equal(new ConfigManager(root, root).loadConfig().hardware_acceleration, false);
    let calls = 0;
    const app = { disableHardwareAcceleration: () => { calls += 1; } };
    assert.equal(configureHardwareAcceleration(app, root), false);
    assert.equal(calls, 1);
    assert.equal(manager.saveConfig({ hardware_acceleration: true }), true);
    assert.equal(configureHardwareAcceleration(app, root), true);
    assert.equal(calls, 1);
});

test('startup reads the same config as Settings for Windows portable and macOS bundles', t => {
    const root = fixture(t);
    const cases = [
        { executableDir: path.join(root, 'extracted'), platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: path.join(root, 'portable') } },
        { executableDir: path.join(root, 'mac', 'BookManager.app', 'Contents', 'MacOS'), platform: 'darwin', env: {} },
    ];
    for (const options of cases) {
        const manager = new ConfigManager(root, options.executableDir, options);
        manager.loadConfig();
        manager.saveConfig({ hardware_acceleration: false });
        let disabled = false;
        configureHardwareAcceleration({ disableHardwareAcceleration: () => { disabled = true; } }, options.executableDir, options);
        assert.equal(disabled, true, options.platform);
    }
});
