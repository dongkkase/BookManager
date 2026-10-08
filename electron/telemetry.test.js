import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTelemetry } from './telemetry.js';

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
        distinct_id: first.properties.distinct_id, app_version: '3.2.1', os: process.platform,
        $process_person_profile: false, $geoip_disable: true, $ip: null,
    });
    assert.match(first.properties.distinct_id, /^[0-9a-f-]{36}$/);
    assert.equal(requests[0].url, 'https://analytics.example.test/capture/');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[0].credentials, 'omit');
    assert.doesNotMatch(requests.map(item => item.body).join(''), /private|Secret Book|Private Search|user@example/);
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
                                    error_code: 'private-code', error_stage: '/private/stage', error_tool: 'C:\\private\\7z.exe',
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
    assert.doesNotMatch(requests[0].body, /private|secret|Secret Book|stderr|extra|error_stage|exit_code|signal|syscall/);
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
