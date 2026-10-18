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

for (const [lang, diagnostic, guidance] of [
    ['ko', 'ERROR: Data Error : private page.jpg', /원본 파일은 유지되었습니다.*정상 파일을 다시 받아/],
    ['en', 'ERROR: CRC Failed : private page.jpg', /original file was preserved.*obtain a valid copy/],
    ['ja', 'ERRORS:\nHeaders Error', /元のファイルは保持されています.*正常なファイルを再取得/],
]) {
    test(`organizer preserves corrupt input and removes partial extraction with recovery guidance (${lang})`, requiresExecutableScript, async t => {
        const { root, item, options } = setup(t, `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'commands.txt'), args[0] + '\\n');
if (args[0] === 'x') {
    const directory = args.find(arg => arg.startsWith('-o')).slice(2);
    fs.writeFileSync(path.join(__dirname, 'extract-dir.txt'), directory);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '001.jpg'), 'partial page');
    process.stderr.write(${JSON.stringify(diagnostic)} + '\\n', () => { process.exitCode = 2; });
}
`);
        const original = fs.readFileSync(item.filepath);
        const requests = [];
        const telemetry = createTelemetry({
            env: {},
            platform: 'win32',
            fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
        });
        telemetry.configureTelemetry({
            config: { telemetry_error_reports: true },
            storageDir: root,
            appVersion: '3.14.0',
            isPackaged: true,
            serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
        });
        t.after(() => telemetry.updateTelemetryConsent({}));
        const result = await observeOperation('archive-organizer', () => executeOrganizer([item], {
            ...options, deleteOriginal: true, backup_on: true, lang,
        }), {
            report: telemetry.reportTelemetryError,
            isSessionCurrent: () => true,
            track: () => false,
        });

        assert.deepEqual(fs.readFileSync(item.filepath), original);
        assert.equal(fs.readFileSync(path.join(root, 'commands.txt'), 'utf8'), 'x\n');
        const extractDir = fs.readFileSync(path.join(root, 'extract-dir.txt'), 'utf8');
        assert.equal(fs.existsSync(extractDir), false);
        assert.equal(fs.existsSync(path.join(root, 'bak')), false);
        assert.deepEqual(result.createdFiles, []);
        assert.deepEqual(result.stats.success, []);
        assert.equal(result.stats.error.length, 1);
        assert.match(result.stats.error[0], guidance);
        assert.ok(result.stats.error[0].includes(diagnostic));
        const [error] = getOperationErrors(result);
        assert.equal(error.message, `${diagnostic}\n`);
        assert.equal(error.code, 'PROCESS_FAILED');
        assert.equal(error.telemetryReason, 'corrupt-data');
        assert.equal(error.telemetryStage, 'extract');
        assert.equal(error.telemetryTool, '7z');
        assert.equal(error.exitCode, 2);

        await telemetry.flushTelemetry();
        assert.equal(requests.length, 1);
        const event = JSON.parse(requests[0].body.split('\n')[2]);
        assert.equal(event.tags.error_reason, 'corrupt-data');
        assert.equal(event.tags.error_stage, 'extract');
        assert.equal(event.tags.exit_code, 2);
        assert.equal(event.exception.values[0].value, 'Error (PROCESS_FAILED): Archive data is damaged');
        assert.ok(event.exception.values[0].stacktrace.frames.some(frame => frame.filename === 'app:///electron/tasks/organizerTask.js'));
        assert.equal(requests[0].body.includes(root), false);
        assert.doesNotMatch(requests[0].body, /Secret Book|private page|partial page|CRC Failed|Data Error|Headers Error/);
    });
}

test('organizer distinguishes an archive with no images after extraction succeeds', requiresExecutableScript, async t => {
    const { item, options } = setup(t, 'process.exit(0);');
    const result = await executeOrganizer([item], options);
    const [error] = getOperationErrors(result);
    assert.equal(error.code, 'ARCHIVE_NO_IMAGES');
    assert.equal(error.telemetryStage, 'inspect');
    assert.equal(error.telemetryTool, undefined);
});

test('nested extraction reports the failed entry locally and only its reason to Sentry', requiresExecutableScript, async t => {
    const { root, item, options } = setup(t, [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const args = process.argv.slice(2);',
        "const directory = args.find(arg => arg.startsWith('-o')).slice(2);",
        "if (path.basename(args[1]) === 'Secret Book.zip') {",
        "    fs.mkdirSync(path.join(directory, 'private chapters'), { recursive: true });",
        "    fs.writeFileSync(path.join(directory, 'private chapters', 'Secret Volume.zip'), 'invalid archive');",
        '} else {',
        "    process.stderr.write('ERROR: Wrong password : private page.jpg\\n', () => { process.exitCode = 2; });",
        '}',
    ].join('\n'));
    const requests = [];
    const telemetry = createTelemetry({
        env: {},
        fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
    });
    telemetry.configureTelemetry({
        config: { telemetry_error_reports: true },
        storageDir: root,
        appVersion: '3.13.0',
        isPackaged: true,
        serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
    });
    t.after(() => telemetry.updateTelemetryConsent({}));

    const result = await observeOperation('archive-organizer', () => executeOrganizer([item], {
        ...options,
        deleteOriginal: true,
        lang: 'ko',
    }), {
        report: telemetry.reportTelemetryError,
        isSessionCurrent: () => true,
        track: () => false,
    });
    const [error] = getOperationErrors(result);
    assert.equal(error.code, 'PROCESS_FAILED');
    assert.equal(error.telemetryStage, 'extract-nested');
    assert.equal(error.telemetryReason, 'password-required');
    assert.equal(error.exitCode, 2);
    assert.match(result.stats.error[0], /Secret Volume\.zip/);
    assert.match(result.stats.error[0], /원본 파일은 유지됩니다/);
    assert.match(result.stats.error[0], /Wrong password/);
    assert.equal(fs.readFileSync(item.filepath, 'utf8'), 'private source');
    assert.deepEqual(result.createdFiles, []);
    assert.deepEqual(result.stats.success, []);

    await telemetry.flushTelemetry();
    assert.equal(requests.length, 1);
    const event = JSON.parse(requests[0].body.split('\n')[2]);
    assert.equal(event.tags.error_reason, 'password-required');
    assert.equal(event.tags.error_stage, 'extract-nested');
    assert.equal(event.tags.exit_code, 2);
    assert.doesNotMatch(requests[0].body, /Secret Book|Secret Volume|private page|private chapters|Wrong password/);
    assert.equal(requests[0].body.includes(root), false);
});

test('organizer bounds quiet tool output while retaining the final failure diagnostic', requiresExecutableScript, async t => {
    const { item, options } = setup(t, [
        "process.stdout.write('private progress '.repeat(20000));",
        "process.stderr.write('private output '.repeat(20000));",
        "process.stderr.write('\\nERROR: Unsupported Method : private page.jpg\\n', () => { process.exitCode = 2; });",
    ].join('\n'));
    const result = await executeOrganizer([item], options);
    const [error] = getOperationErrors(result);
    assert.equal(error.telemetryReason, 'unsupported-method');
    assert.ok(error.message.length <= 16 * 1024);
    assert.match(error.message, /Unsupported Method/);
    assert.equal(fs.readFileSync(item.filepath, 'utf8'), 'private source');
});

test('organizer decodes split UTF-8 output and preserves unknown failure diagnostics', requiresExecutableScript, async t => {
    const { item, options } = setup(t, [
        "const bytes = Buffer.from('알 수 없는 오류: 내부 파일.zip');",
        'process.stderr.write(bytes.subarray(0, 1));',
        'setTimeout(() => {',
        '    process.stderr.write(bytes.subarray(1), () => { process.exitCode = 2; });',
        '}, 10);',
    ].join('\n'));
    const result = await executeOrganizer([item], options);
    const [error] = getOperationErrors(result);
    assert.equal(error.message, '알 수 없는 오류: 내부 파일.zip');
    assert.equal(error.telemetryReason, undefined);
    assert.equal(error.code, 'PROCESS_FAILED');
});

for (const [reason, diagnostic] of [
    ['access-denied', '액세스가 거부되었습니다.'],
    ['file-in-use', 'The process cannot access the file because it is being used by another process.'],
    ['file-open-failed', 'cannot open file'],
]) {
    test(`organizer reports ${reason} after pack output truncation and preserves the original`, requiresExecutableScript, async t => {
        const { root, item, options } = setup(t, `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, 'commands.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'x') {
    const directory = args.find(arg => arg.startsWith('-o')).slice(2);
    fs.writeFileSync(path.join(__dirname, 'extract-dir.txt'), directory);
    for (const volume of ['01', '02']) {
        fs.mkdirSync(path.join(directory, volume), { recursive: true });
        fs.writeFileSync(path.join(directory, volume, '001.jpg'), 'private page');
    }
} else if (args[0] === 'a') {
    fs.writeFileSync(args[2], 'partial archive');
    if (path.basename(process.cwd()) === '02') {
        process.stderr.write('Error:\\ncannot open file\\nC:\\\\private\\\\Secret Book.zip\\n');
        process.stderr.write(${JSON.stringify(diagnostic)} + '\\n');
        process.stderr.write('private diagnostic detail\\n'.repeat(2000), () => { process.exitCode = 2; });
    }
}
`);
        item.out_path = path.join(root, 'output');
        const requests = [];
        const telemetry = createTelemetry({
            env: {},
            platform: 'win32',
            fetch: async (_url, init) => { requests.push(init); return { ok: true }; },
        });
        telemetry.configureTelemetry({
            config: { telemetry_error_reports: true },
            storageDir: root,
            appVersion: '3.14.1',
            isPackaged: true,
            serviceConfig: { sentryDsn: 'https://publickey@errors.example.test/42' },
        });
        t.after(() => telemetry.updateTelemetryConsent({}));
        const result = await observeOperation('archive-organizer', () => executeOrganizer([item], {
            ...options, deleteOriginal: true, backup_on: true,
        }), {
            report: telemetry.reportTelemetryError,
            isSessionCurrent: () => true,
            track: () => false,
        });

        const [error] = getOperationErrors(result);
        assert.equal(error.code, 'PROCESS_FAILED');
        assert.equal(error.telemetryStage, 'pack');
        assert.equal(error.telemetryTool, '7z');
        assert.equal(error.exitCode, 2);
        assert.equal(error.telemetryReason, reason);
        assert.ok(error.message.length <= 16 * 1024);
        assert.equal(error.message.includes(diagnostic), false);
        assert.equal(fs.readFileSync(item.filepath, 'utf8'), 'private source');
        assert.deepEqual(result.createdFiles, []);
        assert.deepEqual(result.stats.success, []);
        assert.deepEqual(fs.readdirSync(item.out_path), []);
        assert.equal(fs.existsSync(path.join(root, 'bak')), false);
        assert.equal(fs.existsSync(fs.readFileSync(path.join(root, 'extract-dir.txt'), 'utf8')), false);
        const commands = fs.readFileSync(path.join(root, 'commands.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(commands.map(args => args[0]), ['x', 'a', 'a']);
        assert.ok(commands.every(args => args.includes('-sccUTF-8')));

        await telemetry.flushTelemetry();
        assert.equal(requests.length, 1);
        const event = JSON.parse(requests[0].body.split('\n')[2]);
        assert.equal(event.tags.error_reason, reason);
        assert.equal(event.tags.error_stage, 'pack');
        assert.equal(event.tags.exit_code, 2);
        assert.ok(event.fingerprint.includes(`error_reason:${reason}`));
        assert.doesNotMatch(requests[0].body, /Secret Book|private|액세스|cannot open file/);
        assert.equal(requests[0].body.includes(root), false);
    });
}

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
