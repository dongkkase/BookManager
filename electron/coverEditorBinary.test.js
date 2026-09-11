import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveCoverEditorSevenZPath } from './coverEditorBinary.js';

async function binaryFixtures(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-cover-binary-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const standalone = path.join(directory, '7za');
    const full = path.join(directory, '7z');
    await fs.writeFile(standalone, '#!/bin/sh\nprintf "  C  7z  7z\\n"\n', { mode: 0o755 });
    await fs.writeFile(full, '#!/bin/sh\nprintf "     Rar  rar r00\\n     Rar5  rar r00\\n"\n', { mode: 0o755 });
    return { standalone, full, missing: path.join(directory, 'missing') };
}

test('RAR를 지원하지 않는 bundled 7za 대신 RAR 지원 7z를 선택한다', { skip: process.platform === 'win32' }, async t => {
    const binaries = await binaryFixtures(t);
    assert.equal(await resolveCoverEditorSevenZPath(binaries.standalone, {
        candidatePaths: [binaries.missing, binaries.standalone, binaries.full],
    }), binaries.full);
});

test('기존 바이너리가 RAR를 지원하면 선택을 유지한다', { skip: process.platform === 'win32' }, async t => {
    const binaries = await binaryFixtures(t);
    assert.equal(await resolveCoverEditorSevenZPath(binaries.full, {
        candidatePaths: [binaries.standalone],
    }), binaries.full);
});

test('RAR 지원 도구가 없어도 기존 ZIP과 7z 도구를 사용할 수 있다', { skip: process.platform === 'win32' }, async t => {
    const binaries = await binaryFixtures(t);
    assert.equal(await resolveCoverEditorSevenZPath(binaries.standalone, {
        candidatePaths: [binaries.missing],
    }), binaries.standalone);
    assert.equal(await resolveCoverEditorSevenZPath(null, { candidatePaths: [binaries.missing] }), null);
});
