import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import test from 'node:test';
import { analyzeRenamerInputs, executeRenamer } from './tasks/renamerTask.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

function pack(sevenZExe, sourceDir, archivePath, type = '-tzip', extraArgs = []) {
    const result = spawnSync(sevenZExe, ['a', type, archivePath, '*', ...extraArgs], {
        cwd: sourceDir,
        stdio: 'ignore',
    });
    assert.equal(result.status, 0);
}

test('ZIP, CBZ, 7z, 대문자 확장자와 실제 포맷 불일치를 읽는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-formats-'));
    try {
        const input = path.join(root, '한글 日本語 input');
        fs.mkdirSync(input);
        fs.writeFileSync(path.join(input, '표지 日本語 01.PNG'), Buffer.from('page'));
        const zip = path.join(root, 'book.ZIP');
        const cbz = path.join(root, 'book.CBZ');
        const seven = path.join(root, 'book.7Z');
        const mismatched = path.join(root, 'seven-as-zip.ZIP');
        pack(sevenZExe, input, zip);
        pack(sevenZExe, input, cbz);
        pack(sevenZExe, input, seven, '-t7z');
        fs.copyFileSync(seven, mismatched);

        const analyzed = await analyzeRenamerInputs([zip, cbz, seven, mismatched], { sevenZExe });
        assert.equal(analyzed.items.length, 4, analyzed.skippedFiles.join('\n'));
        assert.equal(
            analyzed.items.every(item => item.entries[0].oldName === '표지 日本語 01.PNG'),
            true,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('암호화, 손상, 빈 압축은 실행 목록에서 제외하고 오류 이유를 남긴다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-invalid-archives-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input);
        fs.writeFileSync(path.join(input, '001.jpg'), Buffer.from('page'));
        const encrypted = path.join(root, 'encrypted.zip');
        pack(sevenZExe, input, encrypted, '-tzip', ['-psecret']);
        const damaged = path.join(root, 'damaged.cbz');
        fs.writeFileSync(damaged, Buffer.from('not an archive'));
        const empty = path.join(root, 'empty.zip');
        fs.writeFileSync(empty, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'));

        const analyzed = await analyzeRenamerInputs([encrypted, damaged, empty], { sevenZExe });
        assert.equal(analyzed.items.length, 0);
        assert.equal(analyzed.skippedFiles.length, 3);
        assert.match(analyzed.skippedFiles.join('\n'), /encrypted archive/);
        assert.match(analyzed.skippedFiles.join('\n'), /no supported images|archive|Can not open/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('ZIP 입력을 7z 출력으로 쓰고 다시 읽는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-write-7z-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input);
        fs.writeFileSync(path.join(input, '001.jpg'), Buffer.from('page'));
        const source = path.join(root, 'book.zip');
        pack(sevenZExe, input, source);
        const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            target_format: '7z',
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(result.stats.success.length, 1, result.stats.error.join('\n'));
        assert.equal(result.outputFiles[0].endsWith('.7z'), true);
        const reread = await analyzeRenamerInputs(result.outputFiles, { sevenZExe });
        assert.equal(reread.items.length, 1, reread.skippedFiles.join('\n'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
