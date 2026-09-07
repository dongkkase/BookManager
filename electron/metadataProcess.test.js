import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMetadataProcess } from './metadataProcess.js';

test('외부 메타데이터 추출은 이진 stdout을 문자열로 중복 보관하지 않는다', async () => {
    const result = await runMetadataProcess(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0, 255, 254, 1, 128]));'], { binary: true, maxBytes: 5 });
    assert.deepEqual(result.buffer, Buffer.from([0, 255, 254, 1, 128]));
    assert.equal(Object.hasOwn(result, 'stdout'), false);
});

test('텍스트 stdout은 UTF-8 분할 청크와 7z warning 성공 코드를 유지한다', async () => {
    const result = await runMetadataProcess(process.execPath, ['-e', "const b = Buffer.from('한글'); process.stdout.write(b.subarray(0, 2)); setTimeout(() => { process.stdout.write(b.subarray(2)); process.exitCode = 1; }, 20);"]);
    assert.equal(result.stdout, '한글');
    assert.equal(result.code, 1);
    assert.equal(Object.hasOwn(result, 'buffer'), false);
});

test('외부 추출은 출력 제한을 넘으면 완료를 기다리지 않고 프로세스를 종료한다', { timeout: 5000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-process-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const pidPath = path.join(directory, 'pid');
    const script = `require('fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => process.stdout.write(Buffer.alloc(8192)), 5);`;
    await assert.rejects(runMetadataProcess(process.execPath, ['-e', script, pidPath], { binary: true, maxBytes: 1024 }), { code: 'PROCESS_OUTPUT_TOO_LARGE' });
    const pid = Number(fs.readFileSync(pidPath));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('외부 프로세스의 진단 출력은 마지막 64KiB로 제한한다', async () => {
    const result = await runMetadataProcess(process.execPath, ['-e', "process.stderr.write('x'.repeat(200000) + 'last diagnostic'); process.stdout.write('okay');"]);
    assert.equal(result.stdout, 'okay');
    assert.ok(Buffer.byteLength(result.stderr) <= 64 * 1024);
    assert.ok(result.stderr.endsWith('last diagnostic'));
});

test('외부 메타데이터 작업 취소는 실행 중인 프로세스도 종료한다', { timeout: 5000 }, async () => {
    let cancel = false;
    const timer = setTimeout(() => { cancel = true; }, 100);
    try {
        await assert.rejects(runMetadataProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { shouldCancel: () => cancel }), { code: 'TASK_CANCELLED' });
    } finally {
        clearTimeout(timer);
    }
});
