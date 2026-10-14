import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getOperationErrors } from './operationDiagnostics.js';
import { observeOperation } from './observabilityOperations.js';
import { createTelemetry } from './telemetry.js';
import { executeRenamer } from './tasks/renamerTask.js';

function setup(t, script = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-diagnostics-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filepath = path.join(root, 'Secret Book.zip');
    fs.writeFileSync(filepath, 'private source archive');
    const sevenZExe = path.join(root, 'fake-7z');
    if (script) fs.writeFileSync(sevenZExe, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
    return {
        root,
        item: {
            filepath,
            name: 'Secret Book.zip',
            entries: [{ originalPath: '001.jpg', newName: '002.jpg' }],
        },
        options: { sevenZExe, deleteOriginal: false, lang: 'en' },
    };
}

const SUCCESS_TOOL = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'x') {
    const directory = args.find(arg => arg.startsWith('-o')).slice(2);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '001.jpg'), 'private page');
} else if (args[0] === 'a') {
    fs.writeFileSync(args[2], 'archive');
}
`;
const requiresExecutableScript = { skip: process.platform === 'win32' };

async function observeResult(t, fixture, overrides = {}) {
    const requests = [];
    const clients = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
        loadSentry: async () => {
            const sdk = await import('@sentry/node');
            return {
                ...sdk,
                NodeClient: class extends sdk.NodeClient {
                    constructor(options) {
                        super(options);
                        clients.push(this);
                    }
                },
            };
        },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        storageDir: fixture.root,
        appVersion: '3.12.0',
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    t.after(async () => {
        telemetry.updateTelemetryConsent({});
        await Promise.all(clients.map(client => client.close()));
    });

    const result = await observeOperation('archive-renamer', () => executeRenamer([fixture.item], {
        ...fixture.options,
        ...overrides,
    }), {
        report: telemetry.reportTelemetryError,
        isSessionCurrent: () => true,
        track: () => false,
    });
    await telemetry.flushTelemetry();
    const body = requests.map(request => request.body).join('\n');
    assert.equal(body.includes(fixture.root), false);
    assert.doesNotMatch(body, /Secret Book|private source|private page|private process output|telemetryStage|stderr|stdout|command/);
    assert.deepEqual(Object.keys(result).sort(), ['cancelled', 'outputFiles', 'pathMap', 'stats']);
    assert.deepEqual(getOperationErrors(structuredClone(result)), []);
    return {
        result,
        errors: getOperationErrors(result),
        events: requests.map(request => JSON.parse(request.body.split('\n')[2])),
        body,
    };
}

test('renamer missing-tool diagnostics reach Sentry with safe application frames and unchanged IPC result fields', async t => {
    const fixture = setup(t);
    const { result, errors, events, body } = await observeResult(t, fixture, { sevenZExe: '' });
    assert.equal(result.stats.error.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'TOOL_MISSING');
    assert.equal(errors[0].telemetryStage, 'prepare');
    assert.equal(errors[0].telemetryTool, '7z');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].tags, {
        feature: 'archive-renamer', source: 'ipc', os: process.platform,
        error_code: 'TOOL_MISSING', error_stage: 'prepare', error_tool: '7z',
    });
    assert.ok(events[0].exception.values[0].stacktrace.frames.some(frame => frame.filename === 'app:///electron/tasks/renamerTask.js'));
    assert.equal(body.includes(errors[0].message), false);
});

test('renamer identifies deleting all remaining entries before starting an external tool', async t => {
    const fixture = setup(t);
    fixture.item.entries[0].deleteChecked = true;
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0].code, 'ARCHIVE_NO_ENTRIES');
    assert.equal(errors[0].telemetryStage, 'prepare');
    assert.equal(events[0].tags.error_code, 'ARCHIVE_NO_ENTRIES');
    assert.equal(events[0].tags.error_stage, 'prepare');
    assert.equal(events[0].tags.error_tool, undefined);
});

test('renamer distinguishes direct rename, extraction and packing process failures in the final Sentry envelope', requiresExecutableScript, async t => {
    for (const [command, stage, overrides] of [
        ['rn', 'direct-rename', {}],
        ['x', 'extract', { target_format: 'cbz' }],
        ['a', 'pack', { target_format: 'cbz' }],
    ]) {
        const fixture = setup(t, `
if (process.argv[2] === ${JSON.stringify(command)}) {
    process.stderr.write('private process output');
    process.exit(2);
}
${SUCCESS_TOOL}`);
        const { result, errors, events } = await observeResult(t, fixture, overrides);
        assert.equal(result.stats.error.length, 1);
        assert.equal(events.length, 1);
        assert.equal(errors[0].code, 'PROCESS_FAILED');
        assert.equal(errors[0].telemetryStage, stage);
        assert.equal(errors[0].telemetryTool, '7z');
        assert.equal(errors[0].exitCode, 2);
        assert.equal(events[0].tags.error_code, 'PROCESS_FAILED');
        assert.equal(events[0].tags.error_stage, stage);
        assert.equal(events[0].tags.error_tool, '7z');
        assert.equal(events[0].tags.exit_code, 2);
        assert.ok(events[0].exception.values[0].stacktrace.frames.some(frame => frame.filename === 'app:///electron/tasks/renamerTask.js'));
    }
});

test('renamer retains spawn failure identity information without mistaking it for a missing input file', async t => {
    const fixture = setup(t);
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0].code, 'ENOENT');
    assert.equal(errors[0].telemetryStage, 'direct-rename');
    assert.equal(errors[0].telemetryTool, '7z');
    assert.equal(errors[0].exitCode, undefined);
    assert.match(errors[0].stack, /ENOENT/);
    assert.equal(events.length, 1);
    assert.equal(events[0].tags.error_code, 'ENOENT');
    assert.equal(events[0].tags.error_tool, '7z');
});

test('renamer records unexpected process termination signals without inventing an exit code', requiresExecutableScript, async t => {
    const fixture = setup(t, "process.kill(process.pid, 'SIGTERM');");
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0].code, 'PROCESS_FAILED');
    assert.equal(errors[0].signal, 'SIGTERM');
    assert.equal(errors[0].exitCode, undefined);
    assert.equal(events[0].tags.signal, 'SIGTERM');
    assert.equal(events[0].tags.exit_code, undefined);
});

test('renamer retains ordinary missing-input errors locally while existing expected-error filtering prevents Sentry reporting', async t => {
    const fixture = setup(t);
    const original = Object.assign(new Error('private source disappeared'), { code: 'ENOENT' });
    const originalStack = original.stack;
    t.mock.method(fsp, 'copyFile', async () => { throw original; });
    const { result, errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0], original);
    assert.equal(errors[0].stack, originalStack);
    assert.equal(errors[0].telemetryStage, 'direct-copy');
    assert.equal(errors[0].telemetryTool, undefined);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(events, []);
});

test('renamer preserves the original rename error and stack when final cleanup also fails', requiresExecutableScript, async t => {
    const fixture = setup(t, SUCCESS_TOOL);
    const original = Object.assign(new Error('private source rename failed'), { code: 'EIO' });
    const originalStack = original.stack;
    t.mock.method(fsp, 'rename', async () => { throw original; });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, settings) => {
        await remove(target, settings);
        if (path.basename(target).startsWith('BookManager_Renamer_')) {
            throw Object.assign(new Error('cleanup failed'), { code: 'EBUSY' });
        }
    });
    const { errors, events } = await observeResult(t, fixture, { target_format: 'cbz' });
    assert.equal(errors[0], original);
    assert.equal(errors[0].stack, originalStack);
    assert.equal(errors[0].telemetryStage, 'rename-entries');
    assert.equal(errors[0].telemetryTool, undefined);
    assert.equal(events[0].tags.error_code, 'EIO');
    assert.equal(events[0].tags.error_stage, 'rename-entries');
});

test('renamer reports a final cleanup failure at the cleanup stage when the preceding work succeeded', requiresExecutableScript, async t => {
    const fixture = setup(t, SUCCESS_TOOL);
    const original = Object.assign(new Error('private cleanup failure'), { code: 'EIO' });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, settings) => {
        await remove(target, settings);
        if (path.basename(target).startsWith('BookManager_Renamer_')) throw original;
    });
    const { errors, events } = await observeResult(t, fixture, { target_format: 'cbz' });
    assert.equal(errors[0], original);
    assert.equal(errors[0].telemetryStage, 'cleanup');
    assert.equal(events[0].tags.error_stage, 'cleanup');
});

test('renamer keeps a published output and reports source cleanup separately without leaking paths', requiresExecutableScript, async t => {
    const fixture = setup(t, SUCCESS_TOOL);
    const original = Object.assign(new Error('private source removal failed'), { code: 'EIO', syscall: 'unlink' });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, settings) => {
        if (target === fixture.item.filepath) throw original;
        return remove(target, settings);
    });
    const { result, errors, events } = await observeResult(t, fixture, { target_format: 'cbz', deleteOriginal: true });
    assert.equal(errors[0], original);
    assert.equal(result.stats.error.length, 1);
    assert.equal(result.stats.success.length, 0);
    assert.equal(fs.existsSync(fixture.item.filepath), true);
    assert.equal(fs.existsSync(result.outputFiles[0]), true);
    assert.equal(result.pathMap[fixture.item.filepath], result.outputFiles[0]);
    assert.equal(events[0].tags.error_stage, 'remove-source');
    assert.equal(events[0].tags.syscall, 'unlink');
});

test('renamer cancellation during an external process remains a cancellation without error reports', requiresExecutableScript, async t => {
    const fixture = setup(t, 'setInterval(() => {}, 1000);');
    let cancelled = false;
    const timer = setTimeout(() => { cancelled = true; }, 50);
    t.after(() => clearTimeout(timer));
    const { result, errors, events } = await observeResult(t, fixture, { shouldCancel: () => cancelled });
    assert.equal(result.cancelled, true);
    assert.equal(result.stats.skip.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, []);
    assert.equal(fs.readFileSync(fixture.item.filepath, 'utf8'), 'private source archive');
});

test('renamer identifies a missing WebP tool but does not report a recovered WebP conversion failure', requiresExecutableScript, async t => {
    const fixture = setup(t, SUCCESS_TOOL);
    const missing = await observeResult(t, fixture, { webp_conversion: true });
    assert.equal(missing.errors[0].code, 'TOOL_MISSING');
    assert.equal(missing.events[0].tags.error_stage, 'convert-images');
    assert.equal(missing.events[0].tags.error_tool, 'cwebp');

    const cwebpExe = path.join(fixture.root, 'fake-cwebp');
    fs.writeFileSync(cwebpExe, '#!/usr/bin/env node\nprocess.exit(2);', { mode: 0o755 });
    const recovered = await observeResult(t, fixture, { webp_conversion: true, cwebpExe });
    assert.equal(recovered.result.stats.success.length, 1);
    assert.deepEqual(recovered.result.stats.error, []);
    assert.deepEqual(recovered.errors, []);
    assert.deepEqual(recovered.events, []);
});

test('renamer labels a file rename failure after WebP fallback as an entry rename failure', requiresExecutableScript, async t => {
    const fixture = setup(t, SUCCESS_TOOL);
    const cwebpExe = path.join(fixture.root, 'fake-cwebp');
    fs.writeFileSync(cwebpExe, '#!/usr/bin/env node\nprocess.exit(2);', { mode: 0o755 });
    const original = Object.assign(new Error('private fallback rename failed'), { code: 'EIO' });
    t.mock.method(fsp, 'rename', async () => { throw original; });
    const { errors, events } = await observeResult(t, fixture, { webp_conversion: true, cwebpExe });
    assert.equal(errors[0], original);
    assert.equal(events[0].tags.error_stage, 'rename-entries');
    assert.equal(events[0].tags.error_tool, undefined);
});
