import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry, listZipEntriesFromFile, readZipEntryFromFile } from './core/zipArchive.js';
import { getOperationErrors } from './operationDiagnostics.js';
import { observeOperation } from './observabilityOperations.js';
import { createTelemetry } from './telemetry.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

function setup(t, extension = '.7z', script = '') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-diagnostics-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filepath = path.join(root, `Secret Book${extension}`);
    fs.writeFileSync(filepath, 'private source contents');
    const sevenZExe = path.join(root, 'fake-7z');
    if (script) fs.writeFileSync(sevenZExe, `#!/usr/bin/env node\n${script}`, { mode: 0o755 });
    return {
        root,
        item: { filepath, name: path.basename(filepath), metadata: { Title: 'Private Title', Writer: 'Private Writer' } },
        options: { sevenZExe, lang: 'en' },
    };
}

async function zipFixture(t) {
    const fixture = setup(t, '.zip');
    fs.writeFileSync(fixture.item.filepath, Buffer.alloc(0));
    await replaceZipEntry(fixture.item.filepath, '001.jpg', 'private page contents');
    return fixture;
}

function textDatabase(failure) {
    return {
        normalizeFilePath: value => value,
        getTextMetadata: async () => null,
        getTextMetadataPaths: async () => [],
        saveTextMetadataRecord: async () => { if (failure) throw failure; },
    };
}

function waveFixture() {
    const buffer = Buffer.alloc(44 + 1600);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24);
    buffer.writeUInt32LE(16000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(buffer.length - 44, 40);
    return buffer;
}

async function observeResult(t, fixture, overrides = {}, items = [fixture.item]) {
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

    const result = await observeOperation('metadata-save', () => saveMetadataItems(items, {
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
    assert.doesNotMatch(body, /Secret Book|Private Title|Private Writer|private source|private page|private process|telemetryStage|stderr|stdout|command/);
    assert.deepEqual(Object.keys(result).sort(), ['cancelled', 'stats', 'textMetadataUpdates']);
    assert.deepEqual(Object.keys(result.stats).sort(), ['error', 'skip', 'success', 'successPaths']);
    assert.deepEqual(getOperationErrors(structuredClone(result)), []);
    return {
        result,
        errors: getOperationErrors(result),
        events: requests.map(request => JSON.parse(request.body.split('\n')[2])),
        body,
    };
}

const requiresExecutableScript = { skip: process.platform === 'win32' };
const SUCCESS_TOOL = "if (process.argv[2] !== 'a') process.exit(2);";

test('metadata missing-tool errors reach the final Sentry envelope with stages, safe frames and unchanged result fields', async t => {
    const fixture = setup(t);
    const original = fs.readFileSync(fixture.item.filepath);
    const { result, errors, events, body } = await observeResult(t, fixture, { sevenZExe: '' });
    assert.equal(result.stats.error.length, 1);
    assert.equal(errors[0].code, 'TOOL_MISSING');
    assert.deepEqual(events[0].tags, {
        feature: 'metadata-save', source: 'ipc', os: process.platform,
        error_code: 'TOOL_MISSING', error_stage: 'write-metadata', error_tool: '7z',
    });
    assert.ok(events[0].exception.values[0].stacktrace.frames.some(frame => frame.filename === 'app:///electron/tasks/metadataTask.js'));
    assert.equal(body.includes(errors[0].message), false);
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
    assert.deepEqual(fs.readdirSync(fixture.root), [fixture.item.name]);
});

test('metadata inspection preserves original file errors while expected missing inputs remain excluded from Sentry', async t => {
    const fixture = setup(t, '.zip');
    const failure = Object.assign(new Error('private source unavailable'), { code: 'ENOENT' });
    const stack = failure.stack;
    const open = fsp.open;
    t.mock.method(fsp, 'open', async (filePath, ...args) => {
        if (filePath === fixture.item.filepath) throw failure;
        return open(filePath, ...args);
    });
    const { result, errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0], failure);
    assert.equal(errors[0].stack, stack);
    assert.equal(errors[0].telemetryStage, 'inspect');
    assert.equal(result.stats.error.length, 1);
    assert.deepEqual(events, []);
});

test('metadata save recovers from a temporary ZIP open lock without duplicate backups or error reports', async t => {
    const fixture = await zipFixture(t);
    const original = fs.readFileSync(fixture.item.filepath);
    const open = fsp.open;
    let attempts = 0;
    t.mock.method(fsp, 'open', async (filePath, flags, ...args) => {
        if (filePath === fixture.item.filepath && flags === 'r+' && ++attempts <= 2) {
            throw Object.assign(new Error('private file is locked'), { code: 'EBUSY', syscall: 'open' });
        }
        return open(filePath, flags, ...args);
    });
    const { result, errors, events } = await observeResult(t, fixture, { backup_on: true });
    assert.equal(attempts, 3);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, []);
    const entries = await listZipEntriesFromFile(fixture.item.filepath);
    assert.equal(entries.filter(entry => entry.name === 'ComicInfo.xml').length, 1);
    assert.equal((await readZipEntryFromFile(fixture.item.filepath, entries.find(entry => entry.name === '001.jpg'))).toString(), 'private page contents');
    assert.match((await readZipEntryFromFile(fixture.item.filepath, entries.find(entry => entry.name === 'ComicInfo.xml'))).toString(), /Private Title/);
    const backupDir = path.join(fixture.root, 'bak');
    assert.deepEqual(fs.readdirSync(backupDir), [fixture.item.name]);
    assert.deepEqual(fs.readFileSync(path.join(backupDir, fixture.item.name)), original);
});

test('persistent metadata ZIP open locks retain the original error and source while displaying recovery guidance', async t => {
    const fixture = await zipFixture(t);
    const original = fs.readFileSync(fixture.item.filepath);
    const failure = Object.assign(new Error('private file is locked'), { code: 'EBUSY', syscall: 'open' });
    const stack = failure.stack;
    const open = fsp.open;
    let attempts = 0;
    t.mock.method(fsp, 'open', async (filePath, flags, ...args) => {
        if (filePath === fixture.item.filepath && flags === 'r+') {
            attempts += 1;
            throw failure;
        }
        return open(filePath, flags, ...args);
    });
    const { result, errors, events } = await observeResult(t, fixture, { backup_on: true, lang: 'ko' });
    assert.equal(attempts, 5);
    assert.equal(result.stats.success.length, 0);
    assert.equal(result.stats.error.length, 1);
    assert.match(result.stats.error[0], /파일이 사용 중이어서.*프로그램을 닫거나/);
    assert.equal(errors[0], failure);
    assert.equal(errors[0].stack, stack);
    assert.equal(errors[0].message, 'private file is locked');
    assert.equal(events.length, 1);
    assert.equal(events[0].tags.error_code, 'EBUSY');
    assert.equal(events[0].tags.error_stage, 'write-metadata');
    assert.equal(events[0].tags.syscall, 'open');
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
    assert.equal(fs.existsSync(path.join(fixture.root, 'bak')), false);
});

test('cancelling a busy metadata ZIP save prevents another open, backup, write and error report', async t => {
    const fixture = await zipFixture(t);
    const original = fs.readFileSync(fixture.item.filepath);
    const open = fsp.open;
    let attempts = 0;
    let cancelled = false;
    t.mock.method(fsp, 'open', async (filePath, flags, ...args) => {
        if (filePath === fixture.item.filepath && flags === 'r+') {
            attempts += 1;
            setImmediate(() => { cancelled = true; });
            throw Object.assign(new Error('private file is locked'), { code: 'EBUSY', syscall: 'open' });
        }
        return open(filePath, flags, ...args);
    });
    const { result, errors, events } = await observeResult(t, fixture, { backup_on: true, shouldCancel: () => cancelled });
    assert.equal(attempts, 1);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(result.stats.success, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, []);
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
    assert.equal(fs.existsSync(path.join(fixture.root, 'bak')), false);
});

test('metadata 7z save failures retain process exit details and exclude captured process output from Sentry', requiresExecutableScript, async t => {
    const fixture = setup(t, '.7z', "process.stdout.write('private process stdout'); process.stderr.write('private process stderr'); process.exit(2);");
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0].code, 'PROCESS_FAILED');
    assert.match(errors[0].message, /private process stderr/);
    assert.equal(errors[0].telemetryStage, 'write-metadata');
    assert.equal(errors[0].telemetryTool, '7z');
    assert.equal(errors[0].exitCode, 2);
    assert.equal(events[0].tags.error_code, 'PROCESS_FAILED');
    assert.equal(events[0].tags.error_stage, 'write-metadata');
    assert.equal(events[0].tags.error_tool, '7z');
    assert.equal(events[0].tags.exit_code, 2);
});

test('metadata preserves the first write failure when its temporary-directory cleanup also fails', requiresExecutableScript, async t => {
    const fixture = setup(t, '.7z', SUCCESS_TOOL);
    const failure = Object.assign(new Error('private metadata write failure'), { code: 'EIO' });
    const stack = failure.stack;
    const write = fsp.writeFile;
    t.mock.method(fsp, 'writeFile', async (target, ...args) => {
        if (path.basename(target) === 'ComicInfo.xml') throw failure;
        return write(target, ...args);
    });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, options) => {
        await remove(target, options);
        if (path.basename(target).startsWith('BookManager_Metadata_')) {
            throw Object.assign(new Error('cleanup failed'), { code: 'EBUSY' });
        }
    });
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0], failure);
    assert.equal(errors[0].stack, stack);
    assert.equal(events[0].tags.error_code, 'EIO');
    assert.equal(events[0].tags.error_stage, 'write-metadata');
});

test('metadata reports final temporary-directory cleanup failures at the cleanup stage', requiresExecutableScript, async t => {
    const fixture = setup(t, '.7z', SUCCESS_TOOL);
    const failure = Object.assign(new Error('private cleanup failure'), { code: 'EIO' });
    const remove = fsp.rm;
    t.mock.method(fsp, 'rm', async (target, options) => {
        await remove(target, options);
        if (path.basename(target).startsWith('BookManager_Metadata_')) throw failure;
    });
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0], failure);
    assert.equal(events[0].tags.error_stage, 'cleanup');
});

test('metadata ZIP backup failures identify the backup stage and leave the source unchanged', async t => {
    const fixture = await zipFixture(t);
    const original = fs.readFileSync(fixture.item.filepath);
    const failure = Object.assign(new Error('private backup failure'), { code: 'EIO' });
    const copy = fsp.copyFile;
    t.mock.method(fsp, 'copyFile', async (source, destination, ...args) => {
        if (path.basename(path.dirname(destination)) === 'bak') throw failure;
        return copy(source, destination, ...args);
    });
    const { errors, events } = await observeResult(t, fixture, { backup_on: true });
    assert.equal(errors[0], failure);
    assert.equal(events[0].tags.error_stage, 'backup');
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
});

test('metadata output replacement failures preserve the original error and restore the source', requiresExecutableScript, async t => {
    const fixture = setup(t, '.7z', SUCCESS_TOOL);
    const original = fs.readFileSync(fixture.item.filepath);
    const failure = Object.assign(new Error('private replacement failure'), { code: 'EIO' });
    const rename = fsp.rename;
    t.mock.method(fsp, 'rename', async (source, destination) => {
        if (path.basename(source).includes('.bookmanager_metadata_')) throw failure;
        return rename(source, destination);
    });
    const { errors, events } = await observeResult(t, fixture);
    assert.equal(errors[0], failure);
    assert.equal(events[0].tags.error_stage, 'write-output');
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
});

test('metadata TXT failures preserve original exceptions and successful TXT saves keep update and success-path fields', async t => {
    const fixture = setup(t, '.txt');
    const failure = Object.assign(new Error('private text database failure'), { code: 'SQLITE_BUSY' });
    const stack = failure.stack;
    const failed = await observeResult(t, fixture, { libraryDb: textDatabase(failure) });
    assert.equal(failed.errors[0], failure);
    assert.equal(failed.errors[0].stack, stack);
    assert.equal(failed.events[0].tags.error_code, 'SQLITE_BUSY');
    assert.equal(failed.events[0].tags.error_stage, 'write-metadata');
    assert.deepEqual(failed.result.textMetadataUpdates, []);

    const saved = await observeResult(t, fixture, { libraryDb: textDatabase() });
    assert.deepEqual(saved.errors, []);
    assert.deepEqual(saved.events, []);
    assert.equal(saved.result.textMetadataUpdates[0].filepath, fixture.item.filepath);
    assert.match(saved.result.textMetadataUpdates[0].textContentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(saved.result.stats.successPaths, [path.resolve(fixture.item.filepath).replace(/\\/g, '/').normalize('NFC')]);
    assert.equal(fs.readFileSync(fixture.item.filepath, 'utf8'), 'private source contents');
});

test('metadata audio database failures retain their stage and restore the original audio bytes', async t => {
    const fixture = setup(t, '.wav');
    const original = waveFixture();
    fs.writeFileSync(fixture.item.filepath, original);
    const failure = Object.assign(new Error('private audio database failure'), { code: 'SQLITE_BUSY' });
    const { errors, events } = await observeResult(t, fixture, {
        libraryDb: { getFileInfo: async () => null, upsertFileInfo: async () => { throw failure; } },
    });
    assert.equal(errors[0], failure);
    assert.equal(events[0].tags.error_code, 'SQLITE_BUSY');
    assert.equal(events[0].tags.error_stage, 'write-database');
    assert.deepEqual(fs.readFileSync(fixture.item.filepath), original);
});

test('metadata recovered ZIP append and database cache failures do not become Sentry errors', async t => {
    const fixture = await zipFixture(t);
    const open = fsp.open;
    let appendAttempts = 0;
    t.mock.method(fsp, 'open', async (filePath, mode, ...args) => {
        if (mode === 'r+') {
            appendAttempts += 1;
            throw Object.assign(new Error('append fallback'), { code: 'ZIP_APPEND_UNSUPPORTED' });
        }
        return open(filePath, mode, ...args);
    });
    const { result, errors, events } = await observeResult(t, fixture, {
        libraryDb: { getFileInfo: async () => null, upsertFileInfo: async () => { throw new Error('optional cache failure'); } },
    });
    assert.equal(appendAttempts, 1);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, []);
    assert.ok((await listZipEntriesFromFile(fixture.item.filepath)).some(entry => entry.name === 'ComicInfo.xml'));
});

test('metadata missing ComicInfo inspection and removal remain recoverable when writing succeeds', requiresExecutableScript, async t => {
    const fixture = setup(t, '.7z', SUCCESS_TOOL);
    const { result, errors, events } = await observeResult(t, fixture);
    assert.equal(result.stats.success.length, 1);
    assert.deepEqual(result.stats.error, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, []);
});

test('metadata cancellation and unsupported formats preserve existing non-error outcomes', async t => {
    const fixture = setup(t, '.rar');
    const skipped = await observeResult(t, fixture);
    assert.equal(skipped.result.stats.skip.length, 1);
    assert.deepEqual(skipped.errors, []);
    assert.deepEqual(skipped.events, []);
    const cancelled = await observeResult(t, fixture, { shouldCancel: () => true });
    assert.equal(cancelled.result.cancelled, true);
    assert.deepEqual(cancelled.result.stats.error, []);
    assert.deepEqual(cancelled.errors, []);
    assert.deepEqual(cancelled.events, []);

    const interruptedFixture = setup(t);
    t.mock.method(fsp, 'copyFile', async () => {
        throw Object.assign(new Error('cancelled during preparation'), { code: 'TASK_CANCELLED' });
    });
    const interrupted = await observeResult(t, interruptedFixture, { sevenZExe: '' });
    assert.equal(interrupted.result.cancelled, true);
    assert.deepEqual(interrupted.result.stats.error, []);
    assert.deepEqual(interrupted.errors, []);
    assert.deepEqual(interrupted.events, []);
});
