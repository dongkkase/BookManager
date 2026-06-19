import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import {
    analyzeRenamerInputs,
    executeRenamer,
    extractRenamerImage,
} from './tasks/renamerTask.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

function findTool(candidates) {
    for (const candidate of candidates) {
        const result = spawnSync(candidate, ['-version'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

function createArchive(sevenZExe, root, name, files) {
    const input = path.join(root, `${name}-input`);
    fs.mkdirSync(input, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(input, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    const archive = path.join(root, `${name}.zip`);
    const result = spawnSync(sevenZExe, ['a', '-tzip', archive, '*'], { cwd: input, stdio: 'ignore' });
    assert.equal(result.status, 0);
    return archive;
}

test('Renamer 분석, 이미지 미리보기, 실행 및 백업이 동작한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-'));
    try {
        const source = createArchive(sevenZExe, root, 'Book', {
            'images/10.png': PNG_1X1,
            'images/2.png': PNG_1X1,
        });
        const analyzed = await analyzeRenamerInputs([source], { sevenZExe, startNum: 1 });
        assert.equal(analyzed.items.length, 1);
        assert.deepEqual(analyzed.items[0].entries.map(entry => entry.oldName), ['2.png', '10.png']);

        const preview = await extractRenamerImage(source, analyzed.items[0].entries[0].originalPath, sevenZExe);
        assert.equal(preview.success, true);
        assert.match(preview.dataUrl, /^data:image\/png;base64,/);

        analyzed.items[0].entries[0].newName = '001.png';
        analyzed.items[0].entries[1].newName = '002.png';
        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            backup_on: true,
            flattenFolders: true,
            shouldCancel: () => false,
        });
        assert.equal(result.stats.success.length, 1);
        assert.equal(fs.existsSync(source), true);
        assert.equal(fs.existsSync(path.join(root, 'bak', 'Book.zip')), true);

        const listing = spawnSync(sevenZExe, ['l', '-ba', source], { encoding: 'utf8' }).stdout;
        assert.match(listing, /001\.png/);
        assert.match(listing, /002\.png/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('중첩 압축은 분석 목록에서 분리해 스킵한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-nested-'));
    try {
        const inner = createArchive(sevenZExe, root, 'Inner', { '1.png': PNG_1X1 });
        const outer = createArchive(sevenZExe, root, 'Outer', {
            '1.png': PNG_1X1,
            'Inner.zip': fs.readFileSync(inner),
        });
        const analyzed = await analyzeRenamerInputs([outer], { sevenZExe });
        assert.equal(analyzed.items.length, 0);
        assert.match(analyzed.skippedFiles[0], /nested archive/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('실행 전 취소 요청은 원본을 보존한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-cancel-'));
    try {
        const source = createArchive(sevenZExe, root, 'Cancel', { '1.png': PNG_1X1 });
        const original = fs.readFileSync(source);
        const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            shouldCancel: () => true,
        });
        assert.equal(result.cancelled, true);
        assert.equal(fs.existsSync(source), true);
        assert.deepEqual(fs.readFileSync(source), original);
        assert.deepEqual(result.outputFiles, []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('WebP 변환 설정은 실제 이미지 포맷과 이름에 반영된다', async t => {
    const sevenZExe = find7z();
    const cwebpExe = findTool(['/usr/local/bin/cwebp', '/opt/homebrew/bin/cwebp', 'cwebp']);
    if (!sevenZExe || !cwebpExe) {
        t.skip('7z or cwebp executable is not available');
        return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-webp-'));
    try {
        const source = createArchive(sevenZExe, root, 'Webp', {
            '1.png': fs.readFileSync(path.join(process.cwd(), 'src', 'images', 'app.png')),
        });
        const analyzed = await analyzeRenamerInputs([source], {
            sevenZExe,
            webpConversion: true,
        });
        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            cwebpExe,
            webp_conversion: true,
            img_quality: 80,
            shouldCancel: () => false,
        });
        assert.equal(result.stats.success.length, 1, result.stats.error.join('\n'));
        const listing = spawnSync(sevenZExe, ['l', '-ba', source], { encoding: 'utf8' }).stdout;
        assert.match(listing, /\.webp/);
        const extracted = spawnSync(sevenZExe, ['x', '-so', source, '00.webp']).stdout;
        assert.equal(extracted.subarray(0, 4).toString('ascii'), 'RIFF');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
