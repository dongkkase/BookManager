import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTelemetry } from './telemetry.js';
import { saveConfigWithTelemetryConsent } from './observabilityConsent.js';

const SERVICE_CONFIG = { sentryDsn: 'https://publickey@errors.example.test/42', posthogToken: 'phc_exampletoken', posthogHost: 'https://analytics.example.test' };
const CONSENT = { telemetry_error_reports: true, telemetry_usage_stats: true };
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(t, options = {}, config = CONSENT) {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-telemetry-'));
    t.after(() => fs.rmSync(storageDir, { recursive: true, force: true }));
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (url, init) => { requests.push({ url, ...init }); return { ok: true }; },
        ...options,
    });
    telemetry.configureTelemetry({ config, storageDir, appVersion: '3.2.1', isPackaged: true, serviceConfig: SERVICE_CONFIG });
    t.after(() => telemetry.updateTelemetryConsent({}));
    return { telemetry, requests, storageDir };
}

test('the transport stays disabled until the normalized settings explicitly enable it', async t => {
    let imports = 0;
    const { telemetry, requests, storageDir } = setup(t, { loadSentry: async () => { imports += 1; throw new Error('unexpected'); } }, {});
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    assert.equal(telemetry.reportTelemetryError(new Error('private details')), false);
    telemetry.updateTelemetryConsent({ telemetry_error_reports: 'true', telemetry_usage_stats: 1 });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 0);
    assert.equal(imports, 0);
    assert.deepEqual(fs.readdirSync(storageDir), []);
});

test('unconfigured services and ordinary development builds do not transmit', async t => {
    const { telemetry, requests, storageDir } = setup(t, {}, {});
    telemetry.configureTelemetry({ config: CONSENT, storageDir, appVersion: '3.2.1', isPackaged: false, serviceConfig: SERVICE_CONFIG });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    assert.equal(telemetry.reportTelemetryError(new Error()), false);
    telemetry.configureTelemetry({ config: CONSENT, storageDir, isPackaged: true, serviceConfig: {} });
    assert.deepEqual(telemetry.getTelemetryStatus(), {
        errorReportingConfigured: false,
        usageAnalyticsConfigured: false,
        errorReportsEnabled: false,
        usageStatsEnabled: false,
    });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    telemetry.configureTelemetry({ config: CONSENT, storageDir, isPackaged: true, serviceConfig: { sentryDsn: 'http://publickey@errors.example.test/42', posthogToken: 'phc_exampletoken', posthogHost: 'http://analytics.example.test' } });
    assert.equal(telemetry.reportTelemetryError(new Error()), false);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 0);
    assert.deepEqual(fs.readdirSync(storageDir), []);
});

test('an explicit development override permits events when usage statistics are enabled', async t => {
    const { telemetry, requests, storageDir } = setup(t, { env: { BOOKMANAGER_TELEMETRY_DEV: '1' } }, {});
    telemetry.configureTelemetry({ config: CONSENT, storageDir, isPackaged: false, appVersion: '3.2.1', serviceConfig: SERVICE_CONFIG });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 1);
});

test('usage payloads use fixed identifiers and never include book data, paths or arbitrary properties', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_usage_stats: true });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'feature_completed', feature: 'text-cleaner', format: 'text', duration_ms: 12.8, source: 'ipc', path: '/Users/private/secret.txt', title: 'Secret Book', query: 'Private Search', properties: { email: 'user@example.test' }, app_version: '/Users/private' }), true);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'unknown_event', feature: 'text-cleaner' }), false);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'feature_started', feature: 'Secret Book' }), false);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: '/Users/private' }), false);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'tool_opened', tool: 'epub-editor', source: 'Secret Book', duration_ms: Infinity }), true);
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 3);
    const first = JSON.parse(requests[1].body);
    assert.deepEqual(Object.keys(first).sort(), ['api_key', 'event', 'properties', 'timestamp', 'uuid']);
    assert.deepEqual(first.properties, {
        feature: 'text-cleaner', format: 'text', source: 'ipc', duration_ms: 13,
        distinct_id: first.properties.distinct_id, app_version: '3.2.1', app_language: 'ko', os: process.platform,
        $process_person_profile: false, $geoip_disable: true, $ip: null,
    });
    assert.match(first.properties.distinct_id, /^[0-9a-f-]{36}$/);
    assert.equal(requests[0].url, 'https://analytics.example.test/capture/');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[0].credentials, 'omit');
    assert.doesNotMatch(requests.map(item => item.body).join(''), /private|Secret Book|Private Search|user@example/);
});

test('usage events include only the supported app language from settings', async t => {
    for (const [config, expected] of [
        [{ language: 'ko' }, 'ko'],
        [{ language: 'en', lang: 'ja' }, 'en'],
        [{ language: 'ja' }, 'ja'],
        [{ lang: 'en' }, 'en'],
        [{}, 'ko'],
        [{ language: '/private/setting', lang: 'en' }, 'ko'],
        [{ language: { value: 'en' } }, 'ko'],
    ]) {
        const { telemetry, requests } = setup(t, {}, { ...CONSENT, ...config });
        telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder', app_language: 'ja', language: '/private/event' });
        await telemetry.flushTelemetry();
        const events = requests.map(request => JSON.parse(request.body));
        assert.deepEqual(events.map(event => event.event), ['app_active', 'menu_opened']);
        for (const event of events) {
            assert.equal(event.properties.app_language, expected);
            assert.equal(event.properties.$process_person_profile, false);
        }
        assert.doesNotMatch(JSON.stringify(events), /private/);
    }
});

test('language changes reach subsequent usage events only after settings are saved', async t => {
    let config = { ...CONSENT, language: 'ko' };
    let saveSucceeds = false;
    const configManager = {
        getConfig: () => config,
        saveConfig: next => {
            if (!saveSucceeds) return false;
            config = { ...next };
            return true;
        },
    };
    const { telemetry, requests } = setup(t, {}, config);
    await telemetry.flushTelemetry();
    const nextConfig = { ...config, language: 'en' };
    assert.throws(() => saveConfigWithTelemetryConsent(configManager, nextConfig, telemetry.updateTelemetryConsent), { code: 'CONFIG_SAVE_FAILED' });
    telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'settings' });
    saveSucceeds = true;
    saveConfigWithTelemetryConsent(configManager, nextConfig, telemetry.updateTelemetryConsent);
    telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body));
    assert.deepEqual(events.map(event => event.properties.app_language), ['ko', 'ko', 'en']);
    assert.equal(new Set(events.map(event => event.properties.distinct_id)).size, 1);
});

test('language changes respect disabled usage statistics and apply when re-enabled', async t => {
    const { telemetry, requests, storageDir } = setup(t, {}, { ...CONSENT, telemetry_usage_stats: false, language: 'ko' });
    telemetry.updateTelemetryConsent({ ...CONSENT, telemetry_usage_stats: false, language: 'ja' });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' }), false);
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 0);
    assert.deepEqual(fs.readdirSync(storageDir), []);
    telemetry.updateTelemetryConsent({ ...CONSENT, language: 'ja' });
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 1);
    const event = JSON.parse(requests[0].body);
    assert.equal(event.event, 'app_active');
    assert.equal(event.properties.app_language, 'ja');
});

test('settings diagnostics distinguish failure stages without transmitting settings or original errors', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    const stages = ['config-normalize', 'config-write', 'config-replace', 'config-maintenance', 'config-notify'];
    for (const stage of stages) {
        const error = Object.assign(new Error('private settings /Users/private/config.json token=secret'), {
            code: stage === 'config-replace' ? 'EPERM' : 'CONFIG_SAVE_FAILED',
            syscall: stage === 'config-replace' ? 'rename' : undefined,
            telemetryStage: stage,
            cause: new Error('private original error'),
            config: { api_keys: { google: 'secret-key' } },
        });
        telemetry.reportTelemetryError(error, { source: 'ipc', ipc_channel: 'config:save' });
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, stages.length);
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    for (const [index, event] of events.entries()) {
        assert.equal(event.tags.error_stage, stages[index]);
        assert.equal(event.tags.ipc_channel, 'config:save');
        assert.ok(event.fingerprint.includes(`error_stage:${stages[index]}`));
    }
    assert.equal(events[2].tags.error_code, 'EPERM');
    assert.equal(events[2].tags.syscall, 'rename');
    assert.doesNotMatch(requests.map(request => request.body).join('\n'), /private|secret|api_keys|cause/);
});

test('TTS analytics only accepts known engine/model pairs with a reader format', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_usage_stats: true });
    const event = { event: 'viewer_tts_used', feature: 'viewer-tts', format: 'epub', tts_engine: 'openai', tts_model: 'tts-1' };
    assert.equal(telemetry.trackTelemetryEvent({ ...event, text: 'private text', voice: 'private voice', sessionId: 'private session' }), true);
    for (const patch of [
        { tts_engine: 'google' }, { tts_model: '/private/model' },
        { format: 'comic' }, { feature: 'viewer-open' }, { tts_model: undefined },
    ]) {
        assert.equal(telemetry.trackTelemetryEvent({ ...event, ...patch }), false);
    }
    telemetry.trackTelemetryEvent({ event: 'feature_completed', feature: 'viewer-open', format: 'epub', tts_engine: 'openai', tts_model: 'tts-1' });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body));
    assert.equal(events.filter(value => value.event === 'viewer_tts_used').length, 1);
    assert.equal(events[1].properties.tts_model, 'tts-1');
    assert.equal(events[2].properties.tts_engine, undefined);
    assert.doesNotMatch(JSON.stringify(events), /private/);
});

test('cover editor tool navigation uses only its fixed identifier', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_usage_stats: true });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'tool_opened', tool: 'cover-editor', source: 'navigation', paths: ['/private/book.cbz'] }), true);
    await telemetry.flushTelemetry();
    const event = requests.map(request => JSON.parse(request.body)).find(request => request.event === 'tool_opened');
    assert.equal(event.properties.tool, 'cover-editor');
    assert.equal(event.properties.source, 'navigation');
    assert.doesNotMatch(JSON.stringify(event), /private|book\.cbz|paths/);
});

test('EPUB optimization accepts its fixed tool and feature identifiers without file data or settings', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_usage_stats: true });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'tool_opened', tool: 'epub-optimizer', source: 'catalog' }), true);
    for (const event of ['feature_started', 'feature_completed', 'feature_failed', 'feature_cancelled']) {
        assert.equal(telemetry.trackTelemetryEvent({ event, feature: 'epub-optimize', format: 'epub', duration_ms: 12,
            filePath: '/private/book.epub', backupPath: '/private/bak/book.epub', operationId: 'private-operation',
            settings: { jpegQuality: 82 }, removedResources: [{ name: 'private-image.jpg' }], savedBytes: 12345 }), true);
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body));
    assert.equal(events.find(event => event.event === 'tool_opened').properties.tool, 'epub-optimizer');
    const operations = events.filter(event => event.event.startsWith('feature_'));
    assert.equal(operations.length, 4);
    assert.ok(operations.every(event => event.properties.feature === 'epub-optimize' && event.properties.format === 'epub'));
    assert.doesNotMatch(JSON.stringify(events), /private|filePath|backupPath|operationId|settings|jpegQuality|removedResources|savedBytes/);
});

test('usage identity survives restart, contains only random state and rotates after revocation', async t => {
    const { telemetry, requests, storageDir } = setup(t, {}, { telemetry_usage_stats: true });
    telemetry.trackTelemetryEvent({ event: 'app_active' });
    await telemetry.flushTelemetry();
    const firstId = JSON.parse(requests[0].body).properties.distinct_id;
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(storageDir, 'telemetry-state.json'), 'utf8')), { version: 1, installationId: firstId });
    telemetry.configureTelemetry({ config: { telemetry_usage_stats: true }, storageDir, appVersion: '3.2.1', isPackaged: true, serviceConfig: SERVICE_CONFIG });
    telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' });
    await telemetry.flushTelemetry();
    assert.equal(JSON.parse(requests[1].body).properties.distinct_id, firstId);
    telemetry.updateTelemetryConsent({});
    assert.equal(fs.existsSync(path.join(storageDir, 'telemetry-state.json')), false);
    telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    telemetry.trackTelemetryEvent({ event: 'app_active' });
    await telemetry.flushTelemetry();
    assert.notEqual(JSON.parse(requests.at(-1).body).properties.distinct_id, firstId);
});

test('revocation rotates identity even when the previous identity file cannot be deleted or overwritten', async t => {
    let allowWrites = true;
    const fsTarget = {
        ...fs,
        unlinkSync() { throw new Error('unlink denied'); },
        writeFileSync(...args) {
            if (!allowWrites) throw new Error('write denied');
            return fs.writeFileSync(...args);
        },
    };
    const { telemetry, requests, storageDir } = setup(t, { fs: fsTarget }, { telemetry_usage_stats: true });
    await telemetry.flushTelemetry();
    const oldId = JSON.parse(requests[0].body).properties.distinct_id;
    allowWrites = false;
    telemetry.updateTelemetryConsent({});
    telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    await telemetry.flushTelemetry();
    const newId = JSON.parse(requests[1].body).properties.distinct_id;
    assert.notEqual(newId, oldId);
    assert.equal(JSON.parse(fs.readFileSync(path.join(storageDir, 'telemetry-state.json'), 'utf8')).installationId, oldId);
    telemetry.configureTelemetry({ config: { telemetry_usage_stats: true }, storageDir, appVersion: '3.2.1', isPackaged: true, serviceConfig: SERVICE_CONFIG });
    await telemetry.flushTelemetry();
    assert.notEqual(JSON.parse(requests[2].body).properties.distinct_id, oldId);
    const restartedRequests = [];
    const restarted = createTelemetry({ env: {}, fs: fsTarget, fetch: async (_url, init) => { restartedRequests.push(JSON.parse(init.body)); return { ok: true }; } });
    restarted.configureTelemetry({ config: {}, storageDir, appVersion: '3.2.1', isPackaged: true, serviceConfig: SERVICE_CONFIG });
    restarted.updateTelemetryConsent({ telemetry_usage_stats: true });
    await restarted.flushTelemetry();
    assert.notEqual(restartedRequests[0].properties.distinct_id, oldId);
    restarted.updateTelemetryConsent({});
});

test('revocation aborts in-flight requests, drops bounded queued events and never replays them on re-enable', async t => {
    const requests = [];
    const { telemetry } = setup(t, { fetch: (_url, init) => { requests.push(init); return new Promise(() => {}); } }, { telemetry_usage_stats: true });
    let accepted = 0;
    for (let index = 0; index < 100; index += 1) {
        if (telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' })) accepted += 1;
    }
    await turn();
    assert.equal(accepted, 39);
    assert.equal(requests.length, 2);
    telemetry.updateTelemetryConsent({});
    assert.ok(requests.every(request => request.signal.aborted));
    assert.equal(await telemetry.flushTelemetry(), true);
    telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    await turn();
    assert.equal(requests.length, 3);
    assert.equal(JSON.parse(requests[2].body).event, 'app_active');
});

test('turning usage consent off before scheduled fetch prevents every outgoing request', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_usage_stats: true });
    telemetry.trackTelemetryEvent({ event: 'app_active' });
    telemetry.updateTelemetryConsent({});
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 0);
});

test('network errors, SDK import failures and unwritable identity storage cannot break the app', async t => {
    const { telemetry } = setup(t, {
        fetch: async () => { throw new Error('offline'); },
        loadSentry: async () => { throw new Error('SDK unavailable'); },
        fs: { readFileSync: () => { throw new Error('read denied'); }, mkdirSync: () => { throw new Error('write denied'); }, unlinkSync: () => { throw new Error('unlink denied'); } },
    });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' }), true);
    assert.equal(telemetry.reportTelemetryError(new Error('private')), true);
    assert.equal(await telemetry.flushTelemetry(), true);
    assert.doesNotThrow(() => telemetry.updateTelemetryConsent({}));
});

test('requests time out without persistent payload storage', async t => {
    const { telemetry, storageDir } = setup(t, { fetch: () => new Promise(() => {}), requestTimeoutMs: 10 }, { telemetry_usage_stats: true });
    telemetry.trackTelemetryEvent({ event: 'app_active' });
    assert.equal(await telemetry.flushTelemetry(500), true);
    assert.deepEqual(fs.readdirSync(storageDir), ['telemetry-state.json']);
});

test('revocation during SDK loading drops the old error even after consent is granted again', async t => {
    let finishImport;
    let captures = 0;
    const { telemetry, requests } = setup(t, {
        loadSentry: () => new Promise(resolve => { finishImport = resolve; }),
    }, { telemetry_error_reports: true });
    telemetry.reportTelemetryError(new Error('old secret'));
    await turn();
    telemetry.updateTelemetryConsent({});
    telemetry.updateTelemetryConsent({ telemetry_error_reports: true });
    finishImport({ NodeClient: class { captureEvent() { captures += 1; } } });
    await telemetry.flushTelemetry();
    assert.equal(captures, 0);
    assert.equal(requests.length, 0);
});

test('Sentry uses the real SDK with no automatic integrations and strips SDK or error-provided private data', async t => {
    const sdk = await import('@sentry/node');
    let clientOptions;
    const { telemetry, requests, storageDir } = setup(t, {
        loadSentry: async () => ({ NodeClient: class extends sdk.NodeClient {
            constructor(options) { super(options); clientOptions = options; }
            captureEvent(event) {
                return super.captureEvent({ ...event, user: { email: 'private@example.test' }, request: { url: 'https://private.example.test/?token=secret' }, contexts: { device: { name: 'private-machine' } }, extra: { contents: 'Secret Book' }, breadcrumbs: [{ message: '/Users/private/secret.txt' }] });
            }
        } }),
    }, { telemetry_error_reports: true });
    const error = Object.assign(new TypeError('Secret Book /Users/private/secret.txt'), {
        code: 'ENOENT',
        stack: `TypeError: Secret Book\n    at privateFunction (${path.join(APP_ROOT, 'electron/telemetry.js')}:42:3)\n    at /Users/private/secret.txt:1:1\n    at ${path.join(APP_ROOT, 'electron/private-book.js')}:2:3\n    at https://private.example.test/token.js:2:3\n    at ${path.join(APP_ROOT, 'src/../outside.js')}:3:4`,
    });
    assert.equal(telemetry.reportTelemetryError(error, { source: 'renderer', feature: 'viewer-open', path: '/Users/private', title: 'Secret Book' }), true);
    assert.equal(await telemetry.flushTelemetry(), true);
    assert.equal(requests.length, 1);
    assert.equal(clientOptions.defaultIntegrations, false);
    assert.deepEqual(clientOptions.integrations, []);
    assert.equal(clientOptions.sendDefaultPii, false);
    assert.equal(clientOptions.includeServerName, false);
    const lines = requests[0].body.split('\n').map(line => JSON.parse(line));
    assert.deepEqual(Object.keys(lines[0]).sort(), ['event_id', 'sent_at']);
    assert.deepEqual(lines[1], { type: 'event' });
    assert.deepEqual(lines[2].exception.values, [{ type: 'TypeError', value: 'TypeError (ENOENT): File or directory not found', stacktrace: { frames: [{ filename: 'app:///electron/telemetry.js', lineno: 42, colno: 3, in_app: true }] } }]);
    assert.deepEqual(lines[2].tags, { feature: 'viewer-open', source: 'renderer', os: process.platform, error_code: 'ENOENT' });
    assert.equal(lines[2].fingerprint, undefined);
    assert.doesNotMatch(requests[0].body, /Secret Book|private|Users|user|contexts|breadcrumbs|contents|request|distinct_id/);
    assert.deepEqual(fs.readdirSync(storageDir), []);
});

test('safe tool diagnostics and trusted frames survive the final Sentry envelope without raw process details', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    const error = Object.assign(new Error('Secret Book C:\\private\\book.cbz token=secret'), {
        code: 'PROCESS_FAILED',
        telemetryStage: 'extract',
        telemetryTool: '7z',
        exitCode: 2,
        signal: 'SIGTERM',
        syscall: 'spawn',
        path: 'C:\\private\\book.cbz',
        stderr: 'Secret Book token=secret',
        stdout: 'private contents',
        command: 'C:\\private\\7z.exe x C:\\private\\book.cbz',
        stack: `Error: Secret Book\n    at privateFunction (${path.join(APP_ROOT, 'electron/tasks/organizerTask.js')}:42:3)\n    at C:\\private\\book.cbz:1:1`,
    });
    telemetry.reportTelemetryError(error, { source: 'ipc', feature: 'archive-organizer' });
    telemetry.reportTelemetryError({ ...error, stack: '' }, { source: 'ipc', feature: 'archive-organizer' });
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 2);
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    for (const event of events) {
        assert.deepEqual(event.tags, {
            feature: 'archive-organizer', source: 'ipc', os: process.platform,
            error_code: 'PROCESS_FAILED', error_stage: 'extract', error_tool: '7z', signal: 'SIGTERM', syscall: 'spawn', exit_code: 2,
        });
        assert.equal(event.exception.values[0].value, 'Error (PROCESS_FAILED): External tool failed');
    }
    assert.deepEqual(events[0].exception.values[0].stacktrace.frames, [{ filename: 'app:///electron/tasks/organizerTask.js', lineno: 42, colno: 3, in_app: true }]);
    assert.deepEqual(events[0].fingerprint, ['{{ default }}', 'PROCESS_FAILED', 'error_stage:extract', 'error_tool:7z', 'exit_code:2', 'signal:SIGTERM', 'syscall:spawn']);
    assert.deepEqual(events[1].fingerprint, ['bookmanager', 'archive-organizer', 'ipc', 'Error', 'PROCESS_FAILED', 'error_stage:extract', 'error_tool:7z', 'exit_code:2', 'signal:SIGTERM', 'syscall:spawn']);
    assert.doesNotMatch(requests.map(request => request.body).join(''), /Secret Book|private|token|stderr|stdout|command/);
});

test('Windows app stacks retain frames across drive and installation path casing differences', async t => {
    const appRoot = 'C:/Apps/BookManager/resources/app.asar';
    const relative = 'dist/assets/index.js';
    const checkedFiles = [];
    const { telemetry, requests } = setup(t, {
        platform: 'win32',
        appRoot,
        fs: {
            ...fs,
            statSync(filename) {
                checkedFiles.push(filename);
                return { isFile: () => true };
            },
        },
    }, { telemetry_error_reports: true });
    for (const filename of [
        `${appRoot}/${relative}`,
        `c:/apps/bookmanager/resources/app.asar/${relative}`,
        `c:\\apps\\bookmanager\\resources\\app.asar\\${relative.replaceAll('/', '\\')}`,
        `app:///${relative}`,
    ]) {
        telemetry.reportTelemetryError({ stack: `Error: private message\n    at privateFunction (${filename}:12:3)` }, { source: 'renderer' });
    }
    for (const filename of [
        `${appRoot}-other/${relative}`,
        `${appRoot}/src/../../private.js`,
        'C:/Users/private/book.js',
    ]) {
        telemetry.reportTelemetryError({ stack: `Error: private message\n    at ${filename}:12:3` }, { source: 'renderer' });
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 7);
    for (const event of events.slice(0, 4)) {
        assert.deepEqual(event.exception.values[0].stacktrace.frames, [{ filename: `app:///${relative}`, lineno: 12, colno: 3, in_app: true }]);
    }
    for (const event of events.slice(4)) assert.equal(event.exception.values[0].stacktrace, undefined);
    assert.ok(checkedFiles.length > 0);
    assert.ok(checkedFiles.every(filename => filename === `${appRoot}/${relative}`));
    assert.doesNotMatch(JSON.stringify(events), /private|C:|c:|resources|app\.asar/);
});

test('app root casing remains significant outside Windows', async t => {
    const appRoot = '/Applications/BookManager/resources/app.asar';
    let fileChecks = 0;
    const { telemetry, requests } = setup(t, {
        platform: 'linux',
        appRoot,
        fs: { ...fs, statSync() { fileChecks += 1; return { isFile: () => true }; } },
    }, { telemetry_error_reports: true });
    telemetry.reportTelemetryError({ stack: 'Error\n    at /applications/bookmanager/resources/app.asar/dist/assets/index.js:12:3' }, { source: 'renderer' });
    await telemetry.flushTelemetry();
    assert.equal(fileChecks, 0);
    assert.equal(JSON.parse(requests[0].body.split('\n')[2]).exception.values[0].stacktrace, undefined);
});

test('shared subprocess stack locations retain default grouping while distinguishing stages and exit codes', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    const stack = `Error: private details\n    at closeCallback (${path.join(APP_ROOT, 'electron/tasks/organizerTask.js')}:42:3)`;
    for (const [telemetryStage, exitCode] of [['extract', 2], ['pack', 2], ['pack', 7]]) {
        telemetry.reportTelemetryError({ name: 'Error', code: 'PROCESS_FAILED', telemetryStage, telemetryTool: '7z', exitCode, stack }, { source: 'ipc', feature: 'archive-organizer' });
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 3);
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.deepEqual(events.map(event => event.fingerprint), [
        ['{{ default }}', 'PROCESS_FAILED', 'error_stage:extract', 'error_tool:7z', 'exit_code:2'],
        ['{{ default }}', 'PROCESS_FAILED', 'error_stage:pack', 'error_tool:7z', 'exit_code:2'],
        ['{{ default }}', 'PROCESS_FAILED', 'error_stage:pack', 'error_tool:7z', 'exit_code:7'],
    ]);
    for (const event of events) {
        assert.deepEqual(event.exception.values[0].stacktrace, events[0].exception.values[0].stacktrace);
    }
});

test('external tool reasons retain fixed descriptions and separate otherwise identical failures with or without stacks', async t => {
    let now = Date.now();
    const { telemetry, requests } = setup(t, { now: () => now }, { telemetry_error_reports: true });
    const reasons = [
        ['password-required', 'Archive requires a password'],
        ['unsupported-method', 'Archive compression method is unsupported'],
        ['invalid-archive', 'File is not a supported archive'],
        ['corrupt-data', 'Archive data is damaged'],
        ['access-denied', 'External tool could not access a file'],
        ['disk-full', 'External tool ran out of storage space'],
        ['path-too-long', 'External tool encountered a path that is too long'],
        ['file-in-use', 'External tool could not access a file in use'],
        ['path-not-found', 'External tool could not find a file or path'],
        ['invalid-path', 'External tool encountered an invalid path'],
        ['io-error', 'External tool encountered a device I/O error'],
        ['out-of-memory', 'External tool ran out of memory'],
        ['file-open-failed', 'External tool could not open a file'],
    ];
    const stack = `Error: Secret Book\n    at closeCallback (${path.join(APP_ROOT, 'electron/tasks/organizerTask.js')}:42:3)`;
    for (const [telemetryReason] of reasons) {
        for (const errorStack of [stack, '']) {
            telemetry.reportTelemetryError({
                name: 'Error', code: 'PROCESS_FAILED', telemetryStage: 'extract-nested', telemetryTool: '7z',
                telemetryReason, exitCode: 2, stack: errorStack,
                message: 'Secret Book token=secret', stderr: '/private/book',
            }, { source: 'ipc', feature: 'archive-organizer' });
        }
        await telemetry.flushTelemetry();
        now += 60000;
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, reasons.length * 2);
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, events.length);
    for (const [index, event] of events.entries()) {
        const [reason, description] = reasons[Math.floor(index / 2)];
        assert.equal(event.tags.error_code, 'PROCESS_FAILED');
        assert.equal(event.tags.error_reason, reason);
        assert.equal(event.exception.values[0].value, `Error (PROCESS_FAILED): ${description}`);
        assert.ok(event.fingerprint.includes(`error_reason:${reason}`));
        assert.equal(event.fingerprint[0], index % 2 === 0 ? '{{ default }}' : 'bookmanager');
    }
    assert.doesNotMatch(requests.map(request => request.body).join(''), /Secret Book|private|secret|stderr|telemetryReason/);
});

test('unknown tool reasons are omitted and reason descriptions do not replace specific error codes', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    for (const telemetryReason of ['Secret Book', 'invalid-archive /private/book', { path: '/private/book' }, undefined]) {
        telemetry.reportTelemetryError({ code: 'PROCESS_FAILED', telemetryReason }, { source: 'ipc' });
    }
    telemetry.reportTelemetryError({ code: 'EACCES', telemetryReason: 'invalid-archive' }, { source: 'ipc' });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 5);
    for (const event of events.slice(0, 4)) {
        assert.equal(event.tags.error_reason, undefined);
        assert.equal(event.exception.values[0].value, 'Error (PROCESS_FAILED): External tool failed');
        assert.deepEqual(event.fingerprint, ['bookmanager', 'app', 'ipc', 'Error', 'PROCESS_FAILED']);
    }
    assert.equal(events[4].exception.values[0].value, 'Error (EACCES): Permission denied');
    assert.doesNotMatch(requests.map(request => request.body).join(''), /Secret Book|private|telemetryReason/);
});

test('Sentry revalidates hostile diagnostics injected after beforeSend at the final transport boundary', async t => {
    const sdk = await import('@sentry/node');
    const { telemetry, requests } = setup(t, {
        loadSentry: async () => ({ NodeClient: class extends sdk.NodeClient {
            constructor(options) {
                super({
                    ...options,
                    transport: transportOptions => {
                        const transport = options.transport(transportOptions);
                        return {
                            ...transport,
                            send: envelope => transport.send([envelope[0], envelope[1].map(([header, item]) => [header, header.type === 'event' ? {
                                ...item,
                                tags: {
                                    ...item.tags,
                                    error_code: 'private-code', error_kind: 'private-kind', error_stage: '/private/stage', error_reason: 'Secret Book', error_tool: 'C:\\private\\7z.exe',
                                    ipc_channel: 'private-user:SecretBook', rejection_type: 'private-user',
                                    process_reason: 'private-reason', process_type: 'Secret Book', window_type: 'private-window', app_lifecycle: 'private-state',
                                    exit_code: '2 secret', signal: 'SIGTERM secret', syscall: 'spawn C:\\private\\7z.exe',
                                    stderr: 'Secret Book token=secret',
                                },
                                exception: { values: [{ type: 'Error', value: 'Secret Book token=secret' }] },
                                extra: { stderr: 'Secret Book token=secret' },
                            } : item])]),
                        };
                    },
                });
            }
        } }),
    }, { telemetry_error_reports: true });
    telemetry.reportTelemetryError({ name: 'Error', code: 'PROCESS_FAILED', telemetryStage: 'pack', telemetryTool: '7z', exitCode: 2 }, { source: 'ipc', feature: 'archive-organizer' });
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 1);
    const event = JSON.parse(requests[0].body.split('\n')[2]);
    assert.deepEqual(event.tags, { feature: 'archive-organizer', source: 'ipc', os: process.platform });
    assert.equal(event.exception.values[0].value, 'Error: details omitted');
    assert.deepEqual(event.fingerprint, ['bookmanager', 'archive-organizer', 'ipc', 'Error', 'unknown']);
    assert.doesNotMatch(requests[0].body, /private|secret|Secret Book|stderr|extra|error_kind|error_stage|error_reason|ipc_channel|rejection_type|process_reason|process_type|window_type|app_lifecycle|exit_code|signal|syscall/);
});

test('Windows renderer control exits retain their known status without being mistaken for JavaScript errors', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    for (const exitCode of [-1073741510, 3221225786]) {
        assert.equal(telemetry.reportTelemetryError({ exitCode }, {
            source: 'render-process-gone', window_type: 'main', app_lifecycle: 'running',
        }), true);
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, 2);
    for (const request of requests) {
        const event = JSON.parse(request.body.split('\n')[2]);
        assert.equal(event.exception.values[0].value, 'Error: Windows console control termination (STATUS_CONTROL_C_EXIT)');
        assert.equal(event.exception.values[0].stacktrace, undefined);
        assert.equal(event.tags.window_type, 'main');
        assert.equal(event.tags.app_lifecycle, 'running');
        assert.equal(event.tags.os, 'win32');
    }
});

test('process exit reasons, child types and window roles survive final Sentry sanitization without private details', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const descriptions = [
        ['crashed', 'Process crashed'],
        ['oom', 'Process ran out of memory'],
        ['killed', 'Process was terminated externally'],
        ['launch-failed', 'Process failed to launch'],
        ['integrity-failure', 'Process failed a Windows code integrity check'],
    ];
    for (const [reason] of descriptions) {
        telemetry.reportTelemetryError({ reason, exitCode: 1, message: 'Secret Book token=secret', path: '/private/book.epub' }, {
            source: 'render-process-gone', window_type: 'viewer', format: 'epub', app_lifecycle: 'running',
        });
    }
    telemetry.reportTelemetryError({ reason: 'crashed', exitCode: 1, type: 'GPU', serviceName: 'Secret Book' }, {
        source: 'child-process-gone', app_lifecycle: 'quitting',
    });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 6);
    for (const [index, [reason, description]] of descriptions.entries()) {
        assert.equal(events[index].exception.values[0].value, `Error: ${description}`);
        assert.deepEqual(events[index].tags, {
            format: 'epub', source: 'render-process-gone', os: 'win32', exit_code: 1,
            process_reason: reason, window_type: 'viewer', app_lifecycle: 'running',
        });
    }
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, 6);
    assert.equal(events[5].tags.process_type, 'GPU');
    assert.equal(events[5].tags.app_lifecycle, 'quitting');
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|secret|Secret Book|serviceName/);
});

test('unresponsive renderer reports retain fixed descriptions and distinct window, lifecycle and format groups', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const contexts = [
        {},
        { window_type: 'main', app_lifecycle: 'running' },
        { window_type: 'main', app_lifecycle: 'quitting' },
        { window_type: 'viewer', app_lifecycle: 'running' },
        { window_type: 'viewer', app_lifecycle: 'running', format: 'epub' },
        { window_type: 'viewer', app_lifecycle: 'running', format: 'pdf' },
        { window_type: 'viewer', app_lifecycle: 'quitting', format: 'pdf' },
    ];
    for (const context of contexts) {
        telemetry.reportTelemetryError({
            reason: 'oom', type: 'GPU', message: 'Secret Book token=secret', path: '/private/book.epub',
        }, { source: 'renderer-unresponsive', ...context });
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, contexts.length);
    for (const [index, context] of contexts.entries()) {
        const event = events[index];
        assert.equal(event.exception.values[0].value, 'Error: Renderer is not responding');
        assert.equal(event.exception.values[0].stacktrace, undefined);
        assert.deepEqual(event.tags, { source: 'renderer-unresponsive', os: 'win32', ...context });
        assert.deepEqual(event.fingerprint, [
            'bookmanager', 'app', 'renderer-unresponsive', 'Error', 'unknown',
            ...(context.window_type ? [`window_type:${context.window_type}`] : []),
            ...(context.app_lifecycle ? [`app_lifecycle:${context.app_lifecycle}`] : []),
            ...(context.format ? [`format:${context.format}`] : []),
        ]);
    }
    assert.equal(new Set(events.map(event => JSON.stringify(event.fingerprint))).size, contexts.length);
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|secret|Secret Book|process_reason|process_type/);
});

test('unresponsive diagnostics reject unknown values without changing unrelated error groups', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    telemetry.reportTelemetryError({ message: 'Secret Book', reason: 'crashed', type: 'GPU' }, {
        source: 'renderer-unresponsive', window_type: 'private-window', app_lifecycle: 'private-state', format: '/private/book',
    });
    for (const source of ['ipc', 'render-process-gone']) {
        telemetry.reportTelemetryError({}, { source, window_type: 'main', app_lifecycle: 'running', format: 'pdf' });
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 3);
    assert.deepEqual(events[0].tags, { source: 'renderer-unresponsive', os: 'win32' });
    assert.equal(events[0].exception.values[0].value, 'Error: Renderer is not responding');
    assert.deepEqual(events[0].fingerprint, ['bookmanager', 'app', 'renderer-unresponsive', 'Error', 'unknown']);
    assert.deepEqual(events[1].tags, { source: 'ipc', os: 'win32', format: 'pdf' });
    assert.equal(events[1].exception.values[0].value, 'Error: details omitted');
    assert.deepEqual(events[1].fingerprint, ['bookmanager', 'app', 'ipc', 'Error', 'unknown']);
    assert.deepEqual(events[2].fingerprint, [
        'bookmanager', 'app', 'render-process-gone', 'Error', 'unknown', 'window_type:main', 'app_lifecycle:running',
    ]);
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|Secret Book|process_reason|process_type/);
});

test('main unresponsive reports retain only fixed menu and task state without changing existing groups', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const contexts = [
        { window_type: 'main', menu: 'folder', task_state: 'busy' },
        { window_type: 'main', menu: 'renamer', task_state: 'idle' },
        { window_type: 'main', menu: 'Secret Book', task_state: '/private/task' },
        { window_type: 'viewer', task_state: 'busy' },
    ];
    for (const context of contexts) {
        telemetry.reportTelemetryError({}, {
            source: 'renderer-unresponsive', app_lifecycle: 'running', ...context,
            path: '/private/book', settings: { api_keys: 'secret' },
        });
    }
    telemetry.reportTelemetryError({}, { source: 'ipc', window_type: 'main', task_state: 'busy' });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 5);
    assert.equal(events[0].tags.menu, 'folder');
    assert.equal(events[0].tags.task_state, 'busy');
    assert.equal(events[1].tags.menu, 'renamer');
    assert.equal(events[1].tags.task_state, 'idle');
    assert.deepEqual(events[0].fingerprint, events[1].fingerprint);
    assert.deepEqual(events[0].fingerprint, events[2].fingerprint);
    assert.equal(events[2].tags.menu, undefined);
    for (const event of events.slice(2)) assert.equal(event.tags.task_state, undefined);
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|Secret Book|settings|api_keys|secret/);
});

test('main renderer memory failures retain fixed runtime context without changing failure details or groups', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const contexts = [
        { window_type: 'main', menu: 'metadata', task_state: 'busy' },
        { window_type: 'main', menu: 'folder', task_state: 'idle' },
        { window_type: 'main', menu: '/private/book', task_state: 'secret-task' },
        { window_type: 'viewer', task_state: 'busy' },
        { source: 'child-process-gone', window_type: 'main', task_state: 'busy' },
    ];
    for (const context of contexts) {
        telemetry.reportTelemetryError({ reason: 'oom', exitCode: -536870904, message: 'Secret Book' }, {
            source: 'render-process-gone', app_lifecycle: 'running', ...context,
        });
    }
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, contexts.length);
    assert.equal(events[0].tags.menu, 'metadata');
    assert.equal(events[0].tags.task_state, 'busy');
    assert.equal(events[1].tags.menu, 'folder');
    assert.equal(events[1].tags.task_state, 'idle');
    assert.deepEqual(events[0].fingerprint, events[1].fingerprint);
    assert.deepEqual(events[0].fingerprint, events[2].fingerprint);
    assert.equal(events[2].tags.menu, undefined);
    for (const event of events.slice(2)) assert.equal(event.tags.task_state, undefined);
    for (const event of events) {
        assert.equal(event.exception.values[0].value, 'Error: Process ran out of memory');
        assert.equal(event.tags.process_reason, 'oom');
        assert.equal(event.tags.exit_code, -536870904);
        assert.equal(event.tags.app_lifecycle, 'running');
    }
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|secret|Secret Book/);
});

test('control exit summaries are Windows-specific and never replace explicit crash or memory failure reasons', async t => {
    const windows = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    for (const reason of ['crashed', 'oom']) {
        windows.telemetry.reportTelemetryError({ reason, exitCode: -1073741510 }, { source: 'render-process-gone' });
    }
    const linux = setup(t, { platform: 'linux' }, { telemetry_error_reports: true });
    linux.telemetry.reportTelemetryError({ reason: 'abnormal-exit', exitCode: -1073741510 }, { source: 'render-process-gone' });
    await Promise.all([windows.telemetry.flushTelemetry(), linux.telemetry.flushTelemetry()]);
    assert.deepEqual(windows.requests.map(request => JSON.parse(request.body.split('\n')[2]).exception.values[0].value), [
        'Error: Process crashed', 'Error: Process ran out of memory',
    ]);
    assert.equal(JSON.parse(linux.requests[0].body.split('\n')[2]).exception.values[0].value, 'Error: Process exited with a non-zero exit code');
});

test('Windows GPU context-loss exits retain their precise description, existing grouping and private-data filtering', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const reasons = ['crashed', 'abnormal-exit', undefined];
    for (const reason of reasons) {
        assert.equal(telemetry.reportTelemetryError({
            reason, type: 'GPU', exitCode: 34, message: 'Secret Book', serviceName: 'private-service', path: '/private/book',
        }, { source: 'child-process-gone', app_lifecycle: 'running' }), true);
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, reasons.length);
    for (const [index, request] of requests.entries()) {
        const event = JSON.parse(request.body.split('\n')[2]);
        const reason = reasons[index];
        assert.equal(event.exception.values[0].value, 'Error: GPU process exited after losing its graphics context (RESULT_CODE_GPU_EXIT_ON_CONTEXT_LOST)');
        assert.equal(event.exception.values[0].stacktrace, undefined);
        assert.equal(event.tags.exit_code, 34);
        assert.equal(event.tags.process_type, 'GPU');
        assert.equal(event.tags.process_reason, reason);
        assert.deepEqual(event.fingerprint, [
            'bookmanager', 'app', 'child-process-gone', 'Error', 'unknown', 'exit_code:34',
            ...(reason ? [`process_reason:${reason}`] : []), 'process_type:GPU', 'app_lifecycle:running',
        ]);
        assert.doesNotMatch(request.body, /Secret Book|private|serviceName/);
    }
});

test('GPU context-loss descriptions do not reinterpret other processes, exit codes or explicit failure reasons', async t => {
    const { telemetry, requests } = setup(t, { platform: 'win32' }, { telemetry_error_reports: true });
    const cases = [
        [{ type: 'Utility', reason: 'crashed', exitCode: 34 }, 'child-process-gone', 'Process crashed'],
        [{ type: 'GPU', reason: 'crashed', exitCode: 34 }, 'render-process-gone', 'Process crashed'],
        [{ type: 'GPU', reason: 'crashed', exitCode: 34 }, 'ipc', 'details omitted'],
        [{ type: 'GPU', reason: 'crashed', exitCode: 1 }, 'child-process-gone', 'Process crashed'],
        [{ type: 'GPU', reason: 'crashed', exitCode: '34' }, 'child-process-gone', 'Process crashed'],
        [{ type: 'GPU', reason: 'killed', exitCode: 34 }, 'child-process-gone', 'Process was terminated externally'],
        [{ type: 'GPU', reason: 'oom', exitCode: 34 }, 'child-process-gone', 'Process ran out of memory'],
        [{ type: 'GPU', reason: 'launch-failed', exitCode: 34 }, 'child-process-gone', 'Process failed to launch'],
        [{ type: 'GPU', reason: 'integrity-failure', exitCode: 34 }, 'child-process-gone', 'Process failed a Windows code integrity check'],
        [{ type: 'GPU', reason: 'clean-exit', exitCode: 34 }, 'child-process-gone', 'Process exited normally'],
    ];
    for (const [details, source] of cases) telemetry.reportTelemetryError(details, { source });
    await telemetry.flushTelemetry();
    assert.deepEqual(requests.map(request => JSON.parse(request.body.split('\n')[2]).exception.values[0].value), cases.map(([, , description]) => `Error: ${description}`));

    const linux = setup(t, { platform: 'linux' }, { telemetry_error_reports: true });
    linux.telemetry.reportTelemetryError({ type: 'GPU', reason: 'crashed', exitCode: 34 }, { source: 'child-process-gone' });
    await linux.telemetry.flushTelemetry();
    assert.equal(JSON.parse(linux.requests[0].body.split('\n')[2]).exception.values[0].value, 'Error: Process crashed');
});

test('unknown process diagnostics and process-like fields on unrelated exceptions are omitted', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    telemetry.reportTelemetryError({ reason: 'private-reason', type: 'Secret Book', exitCode: 1 }, {
        source: 'child-process-gone', window_type: 'private-window', app_lifecycle: 'private-state',
    });
    telemetry.reportTelemetryError({ reason: 'oom', type: 'GPU' }, {
        source: 'ipc', window_type: 'main', app_lifecycle: 'quitting',
    });
    await telemetry.flushTelemetry();
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    assert.equal(events.length, 2);
    assert.deepEqual(events[0].tags, { source: 'child-process-gone', os: process.platform, exit_code: 1 });
    assert.equal(events[0].exception.values[0].value, 'Error: Process exited unexpectedly');
    assert.deepEqual(events[1].tags, { source: 'ipc', os: process.platform });
    assert.equal(events[1].exception.values[0].value, 'Error: details omitted');
    assert.doesNotMatch(requests.map(request => request.body).join(''), /private|Secret Book|process_reason|process_type|window_type|app_lifecycle/);
});

test('error summaries use fixed descriptions and reject unknown diagnostic values and invalid exit codes', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    const cases = [
        [{ code: 'TOOL_MISSING' }, 'Error (TOOL_MISSING): Required tool was not found'],
        [{ code: 'ARCHIVE_NO_IMAGES' }, 'Error (ARCHIVE_NO_IMAGES): Archive contains no images'],
        [{ code: 'EBUSY', syscall: 'rename' }, 'Error (EBUSY): Resource is busy'],
        [{ telemetryStage: 'convert-images', telemetryTool: 'cwebp' }, 'Error: Image conversion failed'],
        [{ telemetryTool: '7z' }, 'Error: External tool failed'],
        [{ code: '/private/code', telemetryStage: 'Secret Book', telemetryTool: '/private/7z', signal: 'secret', syscall: 'spawn /private/7z' }, 'Error: details omitted'],
        ...['2', 2.5, Infinity, NaN, -2147483649, 4294967296].map(exitCode => [{ exitCode }, 'Error: details omitted']),
        ...[-2147483648, 0, 3221225477, 4294967295].map(exitCode => [{ exitCode }, 'Error: details omitted']),
        [{ code: 'ARCHIVE_NO_ENTRIES' }, 'Error (ARCHIVE_NO_ENTRIES): No archive entries would remain'],
        [{ telemetryStage: 'rename-entries' }, 'Error: Archive entry rename failed'],
        [{ telemetryStage: 'delete-entries' }, 'Error: Archive entry removal failed'],
        [{ telemetryStage: 'optimize-images' }, 'Error: Image optimization failed'],
    ];
    for (const [diagnostics] of cases) {
        telemetry.reportTelemetryError({ name: 'Error', message: 'Secret Book token=secret', stderr: '/private/book', ...diagnostics }, { source: 'ipc' });
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, cases.length);
    const events = requests.map(request => JSON.parse(request.body.split('\n')[2]));
    for (const [index, event] of events.entries()) {
        const [diagnostics, description] = cases[index];
        assert.equal(event.exception.values[0].value, description);
        if (Number.isInteger(diagnostics.exitCode) && diagnostics.exitCode >= -2147483648 && diagnostics.exitCode <= 4294967295) {
            assert.equal(event.tags.exit_code, diagnostics.exitCode);
        } else {
            assert.equal(event.tags.exit_code, undefined);
        }
    }
    assert.deepEqual(events[5].tags, { source: 'ipc', os: process.platform });
    assert.doesNotMatch(requests.map(request => request.body).join(''), /Secret Book|private|secret|stderr/);
});

test('metadata diagnostics retain safe stages and output-limit codes without book metadata', async t => {
    const { telemetry, requests } = setup(t, {}, { telemetry_error_reports: true });
    const cases = [
        [{ telemetryStage: 'write-metadata' }, 'Error: Metadata write failed'],
        [{ telemetryStage: 'write-metadata', code: 'ZIP_REWRITE_UNSUPPORTED' }, 'Error (ZIP_REWRITE_UNSUPPORTED): ZIP structure is not supported for update'],
        [{ telemetryStage: 'write-database', code: 'SQLITE_BUSY' }, 'Error (SQLITE_BUSY): Database is busy'],
        [{ telemetryStage: 'write-database', code: 'ERR_DLOPEN_FAILED' }, 'Error (ERR_DLOPEN_FAILED): Native module could not be loaded'],
        [{ telemetryStage: 'inspect', telemetryTool: '7z', code: 'PROCESS_OUTPUT_TOO_LARGE' }, 'Error (PROCESS_OUTPUT_TOO_LARGE): External tool output exceeded the size limit'],
    ];
    for (const [diagnostics] of cases) {
        telemetry.reportTelemetryError({
            name: 'Error', message: 'Private Title by Private Author',
            metadata: { Title: 'Private Title', Writer: 'Private Author' },
            path: '/private/book', stderr: 'private output', ...diagnostics,
        }, { source: 'ipc', feature: 'metadata-save' });
    }
    await telemetry.flushTelemetry();
    assert.equal(requests.length, cases.length);
    for (const [index, request] of requests.entries()) {
        const event = JSON.parse(request.body.split('\n')[2]);
        const [diagnostics, description] = cases[index];
        assert.equal(event.exception.values[0].value, description);
        assert.equal(event.tags.feature, 'metadata-save');
        assert.equal(event.tags.error_stage, diagnostics.telemetryStage);
        assert.equal(event.tags.error_code, diagnostics.code);
        assert.equal(event.tags.error_tool, diagnostics.telemetryTool);
        assert.doesNotMatch(request.body, /Private Title|Private Author|private|stderr|Writer/);
    }
});

test('usage and error reporting remain independently selectable', async t => {
    let imports = 0;
    const { telemetry, requests } = setup(t, { loadSentry: async () => { imports += 1; return import('@sentry/node'); } }, { telemetry_usage_stats: true });
    assert.equal(telemetry.reportTelemetryError(new Error()), false);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    await telemetry.flushTelemetry();
    assert.equal(imports, 0);
    telemetry.updateTelemetryConsent({ telemetry_error_reports: true });
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    assert.equal(telemetry.reportTelemetryError({ name: 'User secret', message: 'Private Book', stack: '' }, { source: 'main' }), true);
    await telemetry.flushTelemetry();
    assert.equal(imports, 1);
    assert.equal(requests.length, 2);
    assert.match(requests[1].body, /Error: details omitted/);
    assert.doesNotMatch(requests[1].body, /Private Book|User secret/);
});

test('error requests are aborted when only error consent is revoked', async t => {
    const requests = [];
    const { telemetry } = setup(t, { fetch: (_url, init) => { requests.push(init); return new Promise(() => {}); } }, { telemetry_error_reports: true });
    telemetry.reportTelemetryError(new Error('private'));
    await telemetry.flushTelemetry(30);
    assert.equal(requests.length, 1);
    telemetry.updateTelemetryConsent({});
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(await telemetry.flushTelemetry(), true);
});

test('activity is counted on consent enable and the next activity of each UTC day without idle events', async t => {
    let now = Date.parse('2026-10-01T23:59:00Z');
    const { telemetry, requests } = setup(t, { now: () => now }, {});
    assert.equal(telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' }), false);
    telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    await telemetry.flushTelemetry();
    assert.deepEqual(requests.map(request => JSON.parse(request.body).event), ['app_active']);
    assert.equal(telemetry.trackTelemetryEvent({ event: 'app_active' }), false);
    telemetry.trackTelemetryEvent({ event: 'menu_opened', menu: 'folder' });
    await telemetry.flushTelemetry();
    now = Date.parse('2026-10-02T00:01:00Z');
    await turn();
    assert.equal(requests.length, 2);
    telemetry.trackTelemetryEvent({ event: 'tool_opened', tool: 'epub-editor' });
    await telemetry.flushTelemetry();
    assert.deepEqual(requests.map(request => JSON.parse(request.body).event), ['app_active', 'menu_opened', 'app_active', 'tool_opened']);
    assert.equal(new Set(requests.map(request => JSON.parse(request.body).uuid)).size, 4);
});

test('operation session tokens reject disabled starts and revoke/re-enable boundaries independently for both channels', t => {
    const { telemetry } = setup(t, {}, {});
    const beforeConsent = telemetry.captureTelemetrySession();
    telemetry.updateTelemetryConsent(CONSENT);
    assert.equal(telemetry.isTelemetrySessionCurrent(beforeConsent), false);
    assert.equal(telemetry.isTelemetrySessionCurrent(beforeConsent, 'errors'), false);
    const enabledSession = telemetry.captureTelemetrySession();
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession), true);
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession, 'errors'), true);
    telemetry.updateTelemetryConsent({ telemetry_error_reports: true });
    telemetry.updateTelemetryConsent(CONSENT);
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession), false);
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession, 'errors'), true);
    telemetry.updateTelemetryConsent({ telemetry_usage_stats: true });
    telemetry.updateTelemetryConsent(CONSENT);
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession, 'errors'), false);
    assert.equal(telemetry.isTelemetrySessionCurrent({ usage: 1, errors: 1 }), false);
    assert.equal(telemetry.isTelemetrySessionCurrent(enabledSession, 'other'), false);
    assert.deepEqual(enabledSession, {});
    assert.equal(Object.isFrozen(enabledSession), true);
});

test('stackless errors group by fixed feature and source and development errors are labeled correctly', async t => {
    const { telemetry, requests, storageDir } = setup(t, { env: { BOOKMANAGER_TELEMETRY_DEV: '1' } }, {});
    telemetry.configureTelemetry({ config: { telemetry_error_reports: true }, storageDir, isPackaged: false, appVersion: '3.2.1', serviceConfig: SERVICE_CONFIG });
    telemetry.reportTelemetryError({ name: 'Error', code: 'TASK_FAILED', message: 'Private Book' }, { feature: 'epub-export', source: 'ipc' });
    await telemetry.flushTelemetry();
    const event = JSON.parse(requests[0].body.split('\n')[2]);
    assert.deepEqual(event.fingerprint, ['bookmanager', 'epub-export', 'ipc', 'Error', 'TASK_FAILED']);
    assert.equal(event.environment, 'development');
    assert.doesNotMatch(requests[0].body, /Private Book/);
});
