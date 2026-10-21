import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { ConfigManager } from './configManager.js';
import { revokeConfigTelemetryConsent, saveConfigWithTelemetryConsent } from './observabilityConsent.js';
import { createTelemetry } from './telemetry.js';

const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const handlerStart = source.indexOf("  ipcMain.handle('config:save', async (_, config) => {");
const handlerEnd = source.indexOf('\n  // ========== 폰트 관련', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
const handlerSource = source.slice(handlerStart, handlerEnd);

function setup(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-config-save-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const configPath = path.join(root, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        language: 'ko', libraries: [], telemetry_error_reports: true, telemetry_usage_stats: true,
    }));
    const manager = new ConfigManager(root, root, { configPath });
    manager.loadConfig();
    const reports = [];
    const notifications = [];
    const languageChanges = [];
    let handler;
    const context = {
        configManager: manager,
        revokeConfigTelemetryConsent: (value, next) => revokeConfigTelemetryConsent(value, next, overrides.applyConsent || (() => {})),
        saveConfigWithTelemetryConsent: (value, next) => saveConfigWithTelemetryConsent(value, next, overrides.applyConsent || (() => {})),
        reportTelemetryError: (error, tags) => reports.push({ error, tags }),
        libraryDataMaintenance: { withIdle: operation => operation(), run: async () => {} },
        setLanguage: language => languageChanges.push(language),
        supertonicModelManager: { status: () => ({ installed: false }) },
        BrowserWindow: {
            getAllWindows: () => [{
                isDestroyed: () => false,
                webContents: { isDestroyed: () => false, send: (...args) => notifications.push(args) },
            }],
        },
        ...overrides,
        ipcMain: { handle: (_channel, callback) => { handler = callback; } },
    };
    vm.runInNewContext(handlerSource, context);
    return { root, configPath, manager, reports, notifications, languageChanges, save: updates => handler(null, updates) };
}

for (const [method, stage, code, syscall] of [
    ['writeFileSync', 'config-write', 'ENOSPC', 'write'],
    ['renameSync', 'config-replace', 'EPERM', 'rename'],
]) {
    test(`settings ${stage} failures retain the original diagnostics and preserve the previous configuration`, async t => {
        const fixture = setup(t);
        const previous = fixture.manager.getConfig();
        const previousBytes = fs.readFileSync(fixture.configPath);
        const original = Object.assign(new Error('private settings path'), { code, syscall });
        const nativeWrite = fs.writeFileSync;
        const nativeMethod = fs[method];
        const mocked = t.mock.method(fs, method, (...args) => {
            if (String(args[0]).startsWith(`${fixture.configPath}.`)) {
                if (method === 'writeFileSync') nativeWrite(args[0], 'partial write');
                throw original;
            }
            return nativeMethod(...args);
        });
        t.mock.method(console, 'error', () => {});

        await assert.rejects(fixture.save({ language: 'en' }), error => {
            assert.equal(error.code, 'CONFIG_SAVE_FAILED');
            assert.equal(error.cause, original);
            assert.equal(error.telemetryStage, stage);
            return true;
        });
        assert.equal(fixture.manager.getConfig(), previous);
        assert.deepEqual(fs.readFileSync(fixture.configPath), previousBytes);
        assert.deepEqual(fs.readdirSync(fixture.root), ['config.json']);
        assert.equal(fixture.manager.getLastSaveFailure().error, original);
        assert.equal(fixture.reports.length, 1);
        const { error, tags } = fixture.reports[0];
        assert.equal(error.code, code);
        assert.equal(error.syscall, syscall);
        assert.equal(error.stack, original.stack);
        assert.equal(error.telemetryStage, stage);
        assert.equal(tags.source, 'ipc');
        assert.equal(tags.ipc_channel, 'config:save');
        assert.equal(error.message, undefined);
        assert.deepEqual(fixture.notifications, []);

        mocked.mock.restore();
        const saved = await fixture.save({ language: 'en' });
        assert.equal(saved.language, 'en');
        assert.equal(fixture.manager.getLastSaveFailure(), null);
        assert.equal(fixture.manager.getConfig().lastSaveFailure, undefined);
        assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).lastSaveFailure, undefined);
    });
}

test('normalization failure is reported before any configuration file is replaced', async t => {
    const fixture = setup(t);
    const original = new TypeError('private setting value');
    const previous = fixture.manager.getConfig();
    const bytes = fs.readFileSync(fixture.configPath);
    t.mock.method(console, 'error', () => {});
    t.mock.method(fixture.manager, 'normalizeConfig', () => { throw original; });
    await assert.rejects(fixture.save({ language: 'en' }), error => error.cause === original);
    assert.equal(fixture.manager.getConfig(), previous);
    assert.deepEqual(fs.readFileSync(fixture.configPath), bytes);
    assert.deepEqual(fs.readdirSync(fixture.root), ['config.json']);
    assert.equal(fixture.reports.length, 1);
    assert.equal(fixture.reports[0].error.name, 'TypeError');
    assert.equal(fixture.reports[0].error.telemetryStage, 'config-normalize');
});

test('invalid cyclic library updates report preparation failure without changing settings', async t => {
    const fixture = setup(t);
    const libraries = [];
    libraries.push(libraries);
    const previous = fixture.manager.getConfig();
    const bytes = fs.readFileSync(fixture.configPath);
    await assert.rejects(fixture.save({ libraries }), error => error.name === 'TypeError');
    assert.equal(fixture.manager.getConfig(), previous);
    assert.deepEqual(fs.readFileSync(fixture.configPath), bytes);
    assert.equal(fixture.reports.length, 1);
    assert.equal(fixture.reports[0].error.name, 'TypeError');
    assert.equal(fixture.reports[0].error.telemetryStage, 'config-normalize');
    assert.deepEqual(fixture.notifications, []);
});

test('temporary cleanup failure does not replace the original settings write failure', t => {
    const fixture = setup(t);
    const original = Object.assign(new Error('write failed'), { code: 'ENOSPC' });
    const remove = fs.rmSync;
    t.mock.method(console, 'error', () => {});
    t.mock.method(fs, 'writeFileSync', () => { throw original; });
    t.mock.method(fs, 'rmSync', (target, options) => {
        if (String(target).endsWith('.tmp')) throw new Error('cleanup failed');
        return remove(target, options);
    });
    assert.equal(fixture.manager.saveConfig({ language: 'en' }), false);
    assert.equal(fixture.manager.getLastSaveFailure().error, original);
});

test('revoking error reports is effective before a failed settings save reaches main diagnostics', async t => {
    let imports = 0;
    const accepted = [];
    const telemetry = createTelemetry({
        env: {},
        loadSentry: async () => { imports += 1; throw new Error('unexpected SDK load'); },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true, telemetry_usage_stats: false },
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    const fixture = setup(t, {
        applyConsent: telemetry.updateTelemetryConsent,
        reportTelemetryError: (...args) => accepted.push(telemetry.reportTelemetryError(...args)),
    });
    t.mock.method(console, 'error', () => {});
    t.mock.method(fs, 'writeFileSync', () => { throw Object.assign(new Error('write failed'), { code: 'ENOSPC' }); });
    await assert.rejects(fixture.save({ telemetry_error_reports: false }), { code: 'CONFIG_SAVE_FAILED' });
    await telemetry.flushTelemetry();
    assert.equal(fixture.manager.getConfig().telemetry_error_reports, false);
    assert.deepEqual(accepted, [false]);
    assert.equal(imports, 0);
});

test('preparation errors cannot bypass requested revocation or enable reporting on an unrelated later save', async t => {
    let imports = 0;
    let requests = 0;
    const accepted = [];
    const telemetry = createTelemetry({
        env: {},
        loadSentry: async () => { imports += 1; throw new Error('unexpected SDK load'); },
        fetch: async () => { requests += 1; return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    assert.equal(telemetry.getTelemetryStatus().errorReportsEnabled, true);
    const fixture = setup(t, {
        applyConsent: telemetry.updateTelemetryConsent,
        reportTelemetryError: (...args) => accepted.push(telemetry.reportTelemetryError(...args)),
    });
    const libraries = [];
    libraries.push(libraries);
    await assert.rejects(fixture.save({ telemetry_error_reports: false, libraries }), error => error.name === 'TypeError');
    await telemetry.flushTelemetry();
    assert.equal(fixture.manager.getConfig().telemetry_error_reports, false);
    assert.equal(telemetry.getTelemetryStatus().errorReportsEnabled, false);
    assert.deepEqual(accepted, [false]);
    await fixture.save({ language: 'en' });
    assert.equal(telemetry.getTelemetryStatus().errorReportsEnabled, false);
    assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).telemetry_error_reports, false);
    assert.equal(imports, 0);
    assert.equal(requests, 0);
});

test('requested revocation takes effect before waiting for library maintenance to become idle', async t => {
    let imports = 0;
    let requests = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const telemetry = createTelemetry({
        env: {},
        loadSentry: async () => { imports += 1; throw new Error('unexpected SDK load'); },
        fetch: async () => { requests += 1; return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    const fixture = setup(t, {
        applyConsent: telemetry.updateTelemetryConsent,
        libraryDataMaintenance: { withIdle: async operation => { await pending; return operation(); }, run: async () => {} },
    });
    const saving = fixture.save({ telemetry_error_reports: false, libraries: [fixture.root] });
    assert.equal(telemetry.getTelemetryStatus().errorReportsEnabled, false);
    assert.equal(fixture.manager.getConfig().telemetry_error_reports, false);
    assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).telemetry_error_reports, true);
    assert.equal(telemetry.reportTelemetryError(new Error('must remain local')), false);
    release();
    await saving;
    await telemetry.flushTelemetry();
    assert.equal(imports, 0);
    assert.equal(requests, 0);
});

test('destroyed windows and web contents cannot turn a successful settings save into a rejection', async t => {
    const fixture = setup(t, {
        BrowserWindow: { getAllWindows: () => [
            { isDestroyed: () => true, get webContents() { assert.fail('Destroyed window must be skipped'); } },
            { isDestroyed: () => false, webContents: { isDestroyed: () => true, send() { assert.fail('Destroyed web contents must be skipped'); } } },
        ] },
    });
    const saved = await fixture.save({ language: 'en' });
    assert.equal(saved.language, 'en');
    assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).language, 'en');
    assert.deepEqual(fixture.reports, []);
});

test('failed notifications report once and do not block other windows or reject persisted settings', async t => {
    const original = Object.assign(new Error('private failed notification'), { code: 'EPIPE', syscall: 'write' });
    const delivered = [];
    const fixture = setup(t, {
        BrowserWindow: { getAllWindows: () => [
            { isDestroyed: () => false, webContents: { isDestroyed: () => false, send() { throw original; } } },
            { isDestroyed: () => false, webContents: { isDestroyed: () => false, send() { throw new Error('another failure'); } } },
            { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => delivered.push(args) } },
        ] },
    });
    const saved = await fixture.save({ language: 'en' });
    assert.equal(saved.language, 'en');
    assert.equal(JSON.parse(fs.readFileSync(fixture.configPath, 'utf8')).language, 'en');
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0][0], 'viewer:config-change');
    assert.equal(delivered[0][1].language, 'en');
    assert.equal(fixture.reports.length, 1);
    assert.equal(fixture.reports[0].error.code, 'EPIPE');
    assert.equal(fixture.reports[0].error.stack, original.stack);
    assert.equal(fixture.reports[0].error.telemetryStage, 'config-notify');
});

test('post-save library maintenance failures retain their identity and stage without claiming a write failure', async t => {
    const original = Object.assign(new Error('maintenance failed'), { code: 'EIO' });
    const fixture = setup(t, {
        libraryDataMaintenance: { withIdle: operation => operation(), run: async () => { throw original; } },
    });
    await assert.rejects(fixture.save({ libraries: [fixture.root] }), error => error === original);
    assert.deepEqual([...fixture.manager.getConfig().libraries], [fixture.root]);
    assert.equal(fixture.reports.length, 1);
    assert.equal(fixture.reports[0].error.code, 'EIO');
    assert.equal(fixture.reports[0].error.telemetryStage, 'config-maintenance');
});
