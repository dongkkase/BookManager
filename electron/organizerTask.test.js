import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { listZipEntriesFromFile, replaceZipEntry } from './core/zipArchive.js';
import { analyzeOrganizerInputs, executeOrganizer } from './tasks/organizerTask.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

test('Organizer는 ZIP 구조 분석을 외부 7z 없이 수행한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-native-'));
    try {
        const source = path.join(root, 'HERO - 아카기의 유지를 잇는 남자 1-13 .zip\u200b');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'HERO 01/001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(source, 'HERO 02/001.jfif', Buffer.from('page-2'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 2);
        assert.equal(analyzed.items[0].page_count, 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 단일 폴더 ZIP 정리를 압축 해제 없이 7z rn으로 처리한다', async t => {
    if (process.platform === 'win32') {
        t.skip('shell wrapper is not available on Windows');
        return;
    }

    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-rn-fast-'));
    try {
        const source = path.join(root, 'Fast Source.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'Fast Source 01/001.jpg', Buffer.from('page-1'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items[0].volumes.length, 1);
        assert.equal(analyzed.items[0].volumes[0].type, 'folder');
        analyzed.items[0].out_path = path.join(root, 'output');
        analyzed.items[0].volumes[0].new_name = 'Fast Output';

        const logPath = path.join(root, 'commands.log');
        const wrapperPath = path.join(root, 'organizer-rn-only-7z.sh');
        fs.writeFileSync(
            wrapperPath,
            [
                '#!/bin/sh',
                `printf '%s\\n' "$1" >> ${shellQuote(logPath)}`,
                'if [ "$1" != "rn" ]; then exit 91; fi',
                `exec ${shellQuote(sevenZExe)} "$@"`,
                '',
            ].join('\n'),
        );
        fs.chmodSync(wrapperPath, 0o755);

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe: wrapperPath,
            target_format: 'cbz',
            deleteOriginal: false,
            flatten_folders: false,
            webp_conversion: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(fs.readFileSync(logPath, 'utf8').trim(), 'rn');
        assert.equal(result.createdFiles.length, 1);
        assert.equal(path.basename(result.createdFiles[0]), 'Fast Output.cbz');
        assert.equal(fs.existsSync(source), true);

        const outputEntries = await listZipEntriesFromFile(result.createdFiles[0]);
        assert.deepEqual(outputEntries.map(entry => entry.name), ['001.jpg']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 ZIP 안의 내부 ZIP 묶음을 권별 항목으로 분석한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-nested-zips-'));
    try {
        const source = path.join(root, '황천의 츠가이 1~10.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        for (let index = 1; index <= 10; index += 1) {
            await replaceZipEntry(
                source,
                `황천의 츠가이 ${String(index).padStart(2, '0')}.zip`,
                Buffer.from(`nested-${index}`),
            );
        }

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 10);
        assert.equal(analyzed.items[0].volumes.every(volume => volume.type === 'archive'), true);
        assert.equal(analyzed.items[0].volumes[0].inner_path.endsWith('.zip'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 내부 ZIP의 실제 이미지 수를 2뎁스 페이지 수로 표시한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-nested-page-count-'));
    try {
        const inner = path.join(root, 'Series 01.zip');
        fs.writeFileSync(inner, Buffer.alloc(0));
        await replaceZipEntry(inner, '001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(inner, 'sub/002.png', Buffer.from('page-2'));
        await replaceZipEntry(inner, 'readme.txt', Buffer.from('not-image'));

        const source = path.join(root, 'Series Pack.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'Series 01.zip', fs.readFileSync(inner));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 1);
        assert.equal(analyzed.items[0].volumes[0].image_count, 2);
        assert.equal(analyzed.items[0].page_count, 2);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 CP949 이름의 내부 ZIP으로만 구성된 실제 첨부 ZIP을 분석한다', async t => {
    const fixture = path.resolve('test/황천의 츠가이 1~10.zip'.normalize('NFD'));
    if (!fs.existsSync(fixture)) {
        t.skip('local fixture is not available');
        return;
    }

    const analyzed = await analyzeOrganizerInputs([fixture], {
        sevenZExe: '',
        lang: 'ko',
    });

    assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
    assert.equal(analyzed.items.length, 1);
    assert.equal(analyzed.items[0].clean_title, '황천의 츠가이');
    assert.equal(analyzed.items[0].core_title, '황천의 츠가이');
    assert.equal(analyzed.items[0].volumes.length, 10);
    assert.equal(analyzed.items[0].volumes[0].inner_path, '황천의 츠가이 01.zip');
    assert.equal(analyzed.items[0].volumes[9].new_name, '황천의 츠가이 10권');
});

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
