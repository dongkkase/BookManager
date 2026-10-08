import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getOperationErrors } from './operationDiagnostics.js';
import { observeOperation } from './observabilityOperations.js';
import { createTelemetry } from './telemetry.js';
import { executeOrganizer } from './tasks/organizerTask.js';

function setup(t, script = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-diagnostics-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filepath = path.join(root, 'Secret Book.zip');
    fs.writeFileSync(filepath, 'private source');
    const sevenZExe = path.join(root, 'fake-7z');
    if (script) fs.writeFileSync(sevenZExe, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
    return {
        root,
        item: { filepath, name: 'Secret Book.zip', clean_title: 'Output', volumes: [] },
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

test('organizer missing-tool diagnostics reach the sanitized Sentry envelope with application frames', async t => {
    const { root, item } = setup(t);
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        storageDir: root,
        appVersion: '3.11.1',
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    t.after(() => telemetry.updateTelemetryConsent({}));

    const result = await observeOperation('archive-organizer', () => executeOrganizer([item], { sevenZExe: '' }), {
        report: telemetry.reportTelemetryError,
        isSessionCurrent: () => true,
        track: () => false,
    });
    const [error] = getOperationErrors(result);
    assert.equal(error.code, 'TOOL_MISSING');
    assert.equal(error.telemetryStage, 'prepare');
    assert.equal(error.telemetryTool, '7z');
    assert.deepEqual(Object.keys(result).sort(), ['cancelled', 'createdFiles', 'stats']);
    assert.deepEqual(getOperationErrors(structuredClone(result)), []);
    assert.equal(result.stats.error.length, 1);

    await telemetry.flushTelemetry();
    assert.equal(requests.length, 1);
    const event = JSON.parse(requests[0].body.split('\n')[2]);
    assert.equal(event.tags.error_code, 'TOOL_MISSING');
    assert.equal(event.tags.error_stage, 'prepare');
    assert.equal(event.tags.error_tool, '7z');
    assert.ok(event.exception.values[0].stacktrace.frames.some(frame => frame.filename === 'app:///electron/tasks/organizerTask.js'));
    assert.equal(requests[0].body.includes(error.message), false);
    assert.equal(requests[0].body.includes(root), false);
    assert.doesNotMatch(requests[0].body, /Secret Book|private source|telemetryStage/);
});

test('organizer retains the original spawn error code and identifies the missing executable', async t => {
    const { item, options } = setup(t);
    const result = await executeOrganizer([item], options);
    const [error] = getOperationErrors(result);
    assert.equal(error.code, 'ENOENT');
    assert.equal(error.telemetryStage, 'extract');
    assert.equal(error.telemetryTool, '7z');
    assert.match(error.stack, /ENOENT/);
    assert.equal(error.exitCode, undefined);
});

test('organizer records subprocess exit status and signal at the extraction stage', requiresExecutableScript, async t => {
    for (const [script, exitCode, signal] of [
        ['process.exit(2);', 2, undefined],
        ["process.kill(process.pid, 'SIGTERM');", undefined, 'SIGTERM'],
    ]) {
        const { item, options } = setup(t, script);
        const result = await executeOrganizer([item], options);
        const [error] = getOperationErrors(result);
        assert.equal(error.code, 'PROCESS_FAILED');
        assert.equal(error.telemetryStage, 'extract');
        assert.equal(error.telemetryTool, '7z');
        assert.equal(error.exitCode, exitCode);
        assert.equal(error.signal, signal);
        assert.match(error.stack, /organizerTask\.js/);
    }
});

test('organizer distinguishes an archive with no images after extraction succeeds', requiresExecutableScript, async t => {
    const { item, options } = setup(t, 'process.exit(0);');
    const result = await executeOrganizer([item], options);
    const [error] = getOperationErrors(result);
    assert.equal(error.code, 'ARCHIVE_NO_IMAGES');
    assert.equal(error.telemetryStage, 'inspect');
    assert.equal(error.telemetryTool, undefined);
});

test('organizer preserves original error identity, code and stack when output writing and cleanup both fail', requiresExecutableScript, async t => {
    const { item, options } = setup(t, SUCCESS_TOOL);
    const original = Object.assign(new Error('private output failure'), { code: 'EIO' });
    const originalStack = original.stack;
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, settings) => {
        await remove(target, settings);
        if (path.basename(target).startsWith('BookManager_Organizer_')) {
            throw Object.assign(new Error('cleanup failure'), { code: 'EBUSY' });
        }
    });
    const result = await executeOrganizer([item], {
        ...options,
        renameFile: async () => { throw original; },
    });
    const [error] = getOperationErrors(result);
    assert.equal(error, original);
    assert.equal(error.code, 'EIO');
    assert.equal(error.stack, originalStack);
    assert.equal(error.telemetryStage, 'write-output');
    assert.equal(error.telemetryTool, undefined);
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(result.createdFiles, []);
    assert.doesNotMatch(JSON.stringify(result), /telemetryStage|stack|EIO/);
});

test('organizer identifies cleanup failures without replacing a prior stage', requiresExecutableScript, async t => {
    const { item, options } = setup(t, SUCCESS_TOOL);
    const original = Object.assign(new Error('cleanup failure'), { code: 'EBUSY', telemetryStage: 'cleanup' });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, settings) => {
        await remove(target, settings);
        if (path.basename(target).startsWith('BookManager_Organizer_')) throw original;
    });
    const result = await executeOrganizer([item], options);
    assert.equal(getOperationErrors(result)[0], original);
    assert.equal(getOperationErrors(result)[0].telemetryStage, 'cleanup');
});

test('organizer does not retain a direct-copy error recovered by the extraction fallback', requiresExecutableScript, async t => {
    const { item, options } = setup(t, SUCCESS_TOOL);
    item.volumes = [{ new_name: 'Output' }];
    let renameCalls = 0;
    const result = await executeOrganizer([item], {
        ...options,
        deleteOriginal: true,
        renameFile: async (source, target) => {
            renameCalls += 1;
            if (renameCalls === 1) throw Object.assign(new Error('recovered'), { code: 'EIO' });
            await fsp.rename(source, target);
        },
    });
    assert.equal(renameCalls, 2);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(getOperationErrors(result), []);
});
