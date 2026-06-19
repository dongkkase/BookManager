import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { analyzeOrganizerInputs, executeOrganizer } from './tasks/organizerTask.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

test('Organizer는 다중 leaf를 개별 아카이브로 만들고 백업한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(path.join(input, 'Series 1권'), { recursive: true });
        fs.mkdirSync(path.join(input, 'Series 2권'), { recursive: true });
        fs.writeFileSync(path.join(input, 'Series 1권', '001.png'), Buffer.from('page-1'));
        fs.writeFileSync(path.join(input, 'Series 2권', '001.png'), Buffer.from('page-2'));
        const source = path.join(root, 'Series.zip');
        const packed = spawnSync(sevenZExe, ['a', '-tzip', source, '*'], {
            cwd: input,
            stdio: 'ignore',
        });
        assert.equal(packed.status, 0);

        const analyzed = await analyzeOrganizerInputs([source], { sevenZExe, lang: 'ko' });
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 2);

        const output = path.join(root, 'output');
        analyzed.items[0].out_path = output;
        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            backup_on: true,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.cancelled, false);
        assert.equal(result.stats.success.length, 1);
        assert.equal(result.createdFiles.length, 2);
        assert.equal(result.createdFiles.every(filePath => filePath.endsWith('.cbz') && fs.existsSync(filePath)), true);
        assert.equal(fs.existsSync(source), false);
        assert.equal(fs.existsSync(path.join(root, 'bak', 'Series.zip')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer 취소는 원본을 보존하고 결과를 만들지 않는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-cancel-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input, { recursive: true });
        fs.writeFileSync(path.join(input, '001.png'), Buffer.from('page'));
        const source = path.join(root, 'Cancel.zip');
        spawnSync(sevenZExe, ['a', '-tzip', source, '*'], { cwd: input, stdio: 'ignore' });
        const original = fs.readFileSync(source);
        const analyzed = await analyzeOrganizerInputs([source], { sevenZExe, lang: 'ko' });

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            shouldCancel: () => true,
            lang: 'ko',
        });

        assert.equal(result.cancelled, true);
        assert.deepEqual(result.createdFiles, []);
        assert.equal(fs.existsSync(source), true);
        assert.deepEqual(fs.readFileSync(source), original);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
