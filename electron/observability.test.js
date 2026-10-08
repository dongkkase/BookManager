import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readTelemetryAppVersion, readTelemetryServiceConfig, telemetryServiceConfigFromEnv } from './observabilityConfig.js';
import { isTelemetrySenderAllowed } from './observabilityIpc.js';
import { observeOperation, operationOutcome, reportOperationError } from './observabilityOperations.js';
import { saveConfigWithTelemetryConsent } from './observabilityConsent.js';
import { attachOperationErrors, getOperationErrors } from './operationDiagnostics.js';

test('only the app main frame can report telemetry; embedded books and foreign URLs cannot', () => {
    const distIndexPath = path.join(os.tmpdir(), 'Book Manager', 'dist', 'index.html');
    const options = { distIndexPath, devServerUrl: 'http://127.0.0.1:5173/' };
    const allowed = url => {
        const frame = { url };
        return isTelemetrySenderAllowed({ senderFrame: frame, sender: { mainFrame: frame } }, options);
    };
    assert.equal(allowed(`${pathToFileURL(distIndexPath).href}?viewer=1`), true);
    assert.equal(allowed('http://127.0.0.1:5173/?viewer=1'), true);
    assert.equal(allowed('https://attacker.example/index.html'), false);
    assert.equal(allowed('http://127.0.0.1:5173/book.html'), false);
    assert.equal(allowed('bookmanager-document://session/private-book'), false);
    assert.equal(allowed(pathToFileURL(path.join(os.tmpdir(), 'private.html')).href), false);
    const frame = { url: pathToFileURL(distIndexPath).href };
    assert.equal(isTelemetrySenderAllowed({ senderFrame: frame, sender: { mainFrame: { ...frame } } }, options), false);
    assert.equal(isTelemetrySenderAllowed({}, options), false);
});

test('build configuration includes only public ingestion credentials and missing metadata disables reporting', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-observability-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(readTelemetryServiceConfig(root, {}), { sentryDsn: '', posthogToken: '', posthogHost: '' });
    const env = { BOOKMANAGER_SENTRY_DSN: ' public-dsn ', BOOKMANAGER_POSTHOG_TOKEN: 'public-token', BOOKMANAGER_POSTHOG_HOST: 'https://eu.i.posthog.com', SENTRY_AUTH_TOKEN: 'private', GOOGLE_API_KEY: 'private' };
    const config = telemetryServiceConfigFromEnv(env);
    assert.equal(JSON.stringify(config).includes('private'), false);
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'telemetry-config.json'), JSON.stringify({ ...config, authToken: 'private' }));
    assert.deepEqual(readTelemetryServiceConfig(root, {}), config);
    assert.equal(readTelemetryServiceConfig(root, { BOOKMANAGER_POSTHOG_HOST: 'https://us.i.posthog.com' }).posthogHost, 'https://us.i.posthog.com');
    assert.equal(readTelemetryAppVersion(root, '3.0.0'), '3.0.0');
    fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ latest_version: '3.11.1' }));
    assert.equal(readTelemetryAppVersion(root, '3.0.0'), '3.11.1');
});

test('task outcomes distinguish handled failures and cancellations from successful results', () => {
    assert.equal(operationOutcome({ ok: true }), 'feature_completed');
    assert.equal(operationOutcome({ stats: { error: [] } }), 'feature_completed');
    assert.equal(operationOutcome({ stats: { error: ['private path'] } }), 'feature_failed');
    assert.equal(operationOutcome({ ok: false, error: { code: 'FILE_FAILED' } }), 'feature_failed');
    for (const result of [{ cancelled: true }, { canceled: true }, { ok: false, error: { code: 'TASK_CANCELLED' } }, { name: 'AbortError' }]) {
        assert.equal(operationOutcome(result), 'feature_cancelled');
    }
});

function operationHarness() {
    const events = [];
    const errors = [];
    return {
        events,
        errors,
        options: {
            track: event => { events.push(event); return true; },
            report: (error, context) => errors.push({ error, context }),
            isSessionCurrent: () => true,
        },
    };
}

test('operations preserve their return value without sending the result data to analytics', async () => {
    const { events, errors, options } = operationHarness();
    const result = { ok: true, title: 'private title', path: '/private/book.epub' };
    assert.equal(await observeOperation('epub-save', async () => result, options), result);
    assert.deepEqual(events.map(event => event.event), ['feature_started', 'feature_completed']);
    assert.equal(JSON.stringify(events).includes('private'), false);
    assert.deepEqual(errors, []);
});

test('operation failures propagate unchanged and expected file validation does not become a Sentry issue', async () => {
    const { events, errors, options } = operationHarness();
    const failure = new TypeError('private details');
    await assert.rejects(observeOperation('epub-export', async () => { throw failure; }, options), error => error === failure);
    assert.equal(events[1].event, 'feature_failed');
    assert.equal(errors[0].error, failure);
    const reports = [];
    for (const code of ['SOURCE_CHANGED', 'FILE_TOO_LARGE', 'OUTPUT_TOO_LARGE', 'SYMLINK_UNSUPPORTED', 'NOT_A_FILE', 'INVALID_PATH', 'INVALID_CONTENT', 'UNSUPPORTED_FILE', 'TASK_CANCELLED', 'EPUB_INVALID', 'EPUB_TOO_LARGE', 'EPUB_ENCRYPTED', 'EPUB_RESOURCE_MISSING', 'EPUB_UNSUPPORTED_DOCUMENT']) {
        reportOperationError({ code }, 'text-cleaner', error => reports.push(error));
    }
    assert.deepEqual(reports, []);
    const handled = operationHarness();
    await observeOperation('text-cleaner', async () => ({ ok: false, error: { code: 'SOURCE_CHANGED' } }), handled.options);
    assert.equal(handled.events[1].event, 'feature_failed');
    assert.deepEqual(handled.errors, []);
});

test('batch failures retain original diagnostics without extending the serialized task result', async () => {
    const { errors, options } = operationHarness();
    const failure = Object.assign(new Error('private book path'), {
        code: 'PROCESS_FAILED', telemetryStage: 'extract', telemetryTool: '7z', exitCode: 2,
    });
    const result = { stats: { error: ['local result message'] }, cancelled: false };
    const before = JSON.stringify(result);
    assert.equal(attachOperationErrors(result, [failure]), result);
    assert.deepEqual(getOperationErrors(result), [failure]);
    assert.equal(await observeOperation('archive-organizer', async () => result, options), result);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].error, failure);
    assert.equal(errors[0].context.feature, 'archive-organizer');
    assert.equal(JSON.stringify(result), before);
    assert.deepEqual(getOperationErrors(JSON.parse(before)), []);
});

test('batch reporting skips expected failures, deduplicates causes and caps reports per operation', async () => {
    const { errors, options } = operationHarness();
    const failure = (code, message, telemetryStage = 'extract') => Object.assign(new Error(message), {
        code, telemetryStage, stack: `Error: ${message}\n    at processItem (app:///electron/tasks/organizerTask.js:100:5)`,
    });
    const failures = [
        failure('EACCES', 'private file one'),
        failure('TASK_CANCELLED', 'cancelled'),
        failure('PROCESS_FAILED', 'private file two'),
        failure('PROCESS_FAILED', 'private file three'),
        failure('ARCHIVE_NO_IMAGES', 'private file four', 'inspect'),
        failure('TOOL_MISSING', 'private file five', 'prepare'),
        failure('EIO', 'private file six', 'write-output'),
    ];
    await observeOperation('archive-organizer', async () => attachOperationErrors({ stats: { error: ['failed'] } }, failures), options);
    assert.deepEqual(errors.map(({ error }) => error), [failures[2], failures[4], failures[5]]);
    const expected = operationHarness();
    await observeOperation('archive-organizer', async () => attachOperationErrors({ stats: { error: ['failed'] } }, [failures[0]]), expected.options);
    assert.deepEqual(expected.errors, []);
});

test('missing executable errors are reported while ordinary missing files remain expected', () => {
    const reports = [];
    reportOperationError({ code: 'ENOENT' }, 'archive-organizer', error => reports.push(error));
    const missingTool = { code: 'ENOENT', telemetryTool: '7z', telemetryStage: 'extract' };
    reportOperationError(missingTool, 'archive-organizer', error => reports.push(error));
    assert.deepEqual(reports, [missingTool]);
});

test('retained diagnostics respect cancellation and consent changes with a safe legacy fallback', async () => {
    const { errors, options } = operationHarness();
    const failure = new Error('private details');
    const result = attachOperationErrors({ stats: { error: ['failed'] }, cancelled: true }, [failure]);
    await observeOperation('archive-organizer', async () => result, options);
    assert.deepEqual(errors, []);
    result.cancelled = false;
    await observeOperation('archive-organizer', async () => result, { ...options, isSessionCurrent: () => false });
    assert.deepEqual(errors, []);
    await observeOperation('archive-organizer', async () => ({ stats: { error: ['private text'] } }), options);
    assert.deepEqual(errors[0].error, { name: 'Error', code: 'TASK_FAILED' });
});

test('completion does not cross a consent change or create an orphan result after the start was dropped', async () => {
    const { events, errors, options } = operationHarness();
    let active = true;
    options.isSessionCurrent = () => active;
    await observeOperation('metadata-save', async () => {
        active = false;
        return { ok: false, error: { code: 'FILE_FAILED' } };
    }, options);
    assert.deepEqual(events.map(event => event.event), ['feature_started']);
    assert.deepEqual(errors, []);
    let calls = 0;
    await observeOperation('metadata-save', async () => ({ ok: true }), { ...options, isSessionCurrent: () => true, track: () => { calls += 1; return false; } });
    assert.equal(calls, 1);
});

test('failed settings persistence still revokes consent and never grants a new opt-in', () => {
    const config = { telemetry_error_reports: true, telemetry_usage_stats: true, language: 'ko' };
    const applied = [];
    const manager = { getConfig: () => config, saveConfig: () => false };
    assert.throws(() => saveConfigWithTelemetryConsent(manager, { ...config, telemetry_usage_stats: false }, value => applied.push({ ...value })), { code: 'CONFIG_SAVE_FAILED' });
    assert.equal(applied[0].telemetry_usage_stats, false);
    assert.equal(config.telemetry_usage_stats, false);
    assert.equal(config.telemetry_error_reports, true);
    assert.equal(config.language, 'ko');
    applied.length = 0;
    assert.throws(() => saveConfigWithTelemetryConsent(manager, { ...config, telemetry_usage_stats: true }, value => applied.push({ ...value })), { code: 'CONFIG_SAVE_FAILED' });
    assert.equal(applied[0].telemetry_usage_stats, false);
    assert.equal(config.telemetry_usage_stats, false);
});

test('new consent is enabled only after a successful settings save', () => {
    let config = { telemetry_error_reports: false, telemetry_usage_stats: false };
    const sequence = [];
    const manager = {
        getConfig: () => config,
        saveConfig: next => { sequence.push('saved'); config = next; return true; },
    };
    const saved = saveConfigWithTelemetryConsent(manager, { ...config, telemetry_error_reports: true }, value => sequence.push(value.telemetry_error_reports));
    assert.deepEqual(sequence, [false, 'saved', true]);
    assert.equal(saved.telemetry_error_reports, true);
});
