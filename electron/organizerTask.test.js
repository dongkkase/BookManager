import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { listZipEntriesFromFile, replaceZipEntry } from './core/zipArchive.js';
import { analyzeOrganizerInputs, executeOrganizer } from './tasks/organizerTask.js';

function find7z() {
    for (const candidate of [
        path.resolve('bin/win/7za.exe'),
        '/usr/local/bin/7z',
        '/opt/homebrew/bin/7z',
        '7z',
        '7za',
    ]) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

function findBundled7z() {
    const platformDir = process.platform === 'darwin'
        ? 'mac'
        : process.platform === 'win32'
            ? 'win'
            : process.platform;
    const executable = process.platform === 'win32' ? '7za.exe' : '7za';
    const candidate = path.resolve('node_modules/7zip-bin', platformDir, process.arch, executable);
    const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
    return result.error ? '' : candidate;
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function makeZipBuffer(root, filename, entries) {
    const filePath = path.join(root, filename);
    fs.writeFileSync(filePath, Buffer.alloc(0));
    for (const [entryName, content] of entries) {
        await replaceZipEntry(filePath, entryName, content);
    }
    return fs.readFileSync(filePath);
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

test('Organizer는 압축 파일명과 같은 최상위 래퍼 폴더를 권 그룹으로 오인하지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-wrapper-folder-'));
    try {
        const archiveName = '그린월드 Z 번역본 1-112화 [완결] 720px.zip';
        const source = path.join(root, archiveName);
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 1화/001.jpg`, Buffer.from('page-1'));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 2화/001.jpg`, Buffer.from('page-2'));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 3화/001.jpg`, Buffer.from('page-3'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 3);
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.original_path),
            ['GREEN WORLDZ 1화', 'GREEN WORLDZ 2화', 'GREEN WORLDZ 3화'],
        );
        assert.equal(analyzed.items[0].volumes.every(volume => volume.type === 'folder'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 압축 파일명 래퍼 폴더 아래 권/화 폴더를 각각 별도 CBZ로 만든다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-wrapper-execute-'));
    try {
        const archiveName = '그린월드 Z 번역본 1-112화 [완결] 720px.zip';
        const source = path.join(root, archiveName);
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 1화/001.jpg`, Buffer.from('page-1'));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 2화/001.jpg`, Buffer.from('page-2'));
        await replaceZipEntry(source, `${archiveName}/GREEN WORLDZ 3화/001.jpg`, Buffer.from('page-3'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });
        analyzed.items[0].out_path = path.join(root, 'output');

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            deleteOriginal: false,
            flatten_folders: false,
            webp_conversion: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.createdFiles.length, 3);
        assert.equal(result.createdFiles.every(filePath => filePath.endsWith('.cbz') && fs.existsSync(filePath)), true);
        for (const filePath of result.createdFiles) {
            const entries = await listZipEntriesFromFile(filePath);
            assert.equal(entries.filter(entry => entry.name.endsWith('.jpg')).length, 1);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 번들 7z로 한글과 별표가 포함된 ZIP 파일명을 처리한다', async t => {
    if (process.platform !== 'darwin') {
        t.skip('macOS bundled 7z regression test');
        return;
    }

    const sevenZExe = findBundled7z();
    if (!sevenZExe) {
        t.skip('bundled 7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-unicode-path-'));
    try {
        const source = path.join(root, '이세계*착각*헌터_1-100화 (토끼버전).zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '이세계 착각 헌터 01/001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(source, '이세계 착각 헌터 02/001.jpg', Buffer.from('page-2'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });
        analyzed.items[0].out_path = path.join(root, 'output');

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            deleteOriginal: false,
            flatten_folders: false,
            webp_conversion: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.createdFiles.length, 2);
        assert.equal(result.createdFiles.every(filePath => fs.existsSync(filePath)), true);
        assert.equal(fs.existsSync(source), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 압축 파일명과 같은 내부 ZIP 래퍼를 펼쳐 권/화 ZIP을 각각 분석한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-wrapper-zip-analyze-'));
    try {
        const archiveName = '그린월드 Z 번역본 1-112화 [완결] 720px.zip';
        const leaf1 = await makeZipBuffer(root, 'leaf-1.zip', [['001.jpg', Buffer.from('page-1')]]);
        const leaf2 = await makeZipBuffer(root, 'leaf-2.zip', [['001.jpg', Buffer.from('page-2')]]);
        const leaf3 = await makeZipBuffer(root, 'leaf-3.zip', [['001.jpg', Buffer.from('page-3')]]);
        const wrapper = await makeZipBuffer(root, 'wrapper.zip', [
            ['GREEN WORLDZ 1화.zip', leaf1],
            ['GREEN WORLDZ 2화.zip', leaf2],
            ['GREEN WORLDZ 3화.zip', leaf3],
        ]);

        const source = path.join(root, archiveName);
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, archiveName, wrapper);

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 3);
        assert.equal(analyzed.items[0].page_count, 3);
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.original_path),
            ['GREEN WORLDZ 1화', 'GREEN WORLDZ 2화', 'GREEN WORLDZ 3화'],
        );
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.new_name),
            ['GREEN WORLDZ 01화', 'GREEN WORLDZ 02화', 'GREEN WORLDZ 03화'],
        );
        assert.equal(analyzed.items[0].volumes.every(volume => volume.type === 'archive'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 압축 파일명과 같은 내부 ZIP 래퍼의 권/화 ZIP을 각각 별도 CBZ로 만든다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-wrapper-zip-execute-'));
    try {
        const archiveName = '그린월드 Z 번역본 1-112화 [완결] 720px.zip';
        const leaf1 = await makeZipBuffer(root, 'leaf-1.zip', [['001.jpg', Buffer.from('page-1')]]);
        const leaf2 = await makeZipBuffer(root, 'leaf-2.zip', [['001.jpg', Buffer.from('page-2')]]);
        const leaf3 = await makeZipBuffer(root, 'leaf-3.zip', [['001.jpg', Buffer.from('page-3')]]);
        const wrapper = await makeZipBuffer(root, 'wrapper.zip', [
            ['GREEN WORLDZ 1화.zip', leaf1],
            ['GREEN WORLDZ 2화.zip', leaf2],
            ['GREEN WORLDZ 3화.zip', leaf3],
        ]);

        const source = path.join(root, archiveName);
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, archiveName, wrapper);

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });
        analyzed.items[0].out_path = path.join(root, 'output');

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            deleteOriginal: false,
            flatten_folders: false,
            webp_conversion: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.createdFiles.length, 3);
        assert.equal(result.createdFiles.every(filePath => filePath.endsWith('.cbz') && fs.existsSync(filePath)), true);
        for (const filePath of result.createdFiles) {
            const entries = await listZipEntriesFromFile(filePath);
            assert.equal(entries.filter(entry => entry.name.endsWith('.jpg')).length, 1);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 단일 Root_Files 압축 파일의 권 이름을 원본 파일명에서 추론한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-root-files-title-'));
    try {
        const source = path.join(root, '「어서 와, 아빠」 01권.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'v0000.jpg', Buffer.from('page-1'));
        await replaceZipEntry(source, '0001.jpg', Buffer.from('page-2'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].clean_title, '「어서 와 아빠」');
        assert.equal(analyzed.items[0].volumes.length, 1);
        assert.equal(analyzed.items[0].volumes[0].original_path, 'Root_Files');
        assert.equal(analyzed.items[0].volumes[0].new_name, '「어서 와 아빠」 01권');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 다른 디바이스 경로로 완료 아카이브를 복사 fallback으로 이동한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-exdev-'));
    try {
        const source = path.join(root, 'Cross Device 01.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'Cross Device 01/001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(source, 'Cross Device 02/001.jpg', Buffer.from('page-2'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });
        analyzed.items[0].out_path = path.join(root, 'network-share');

        let exdevFallbackUsed = false;
        const renameFile = async (src, dest) => {
            if (path.basename(src).startsWith('BookManager_Done_')) {
                exdevFallbackUsed = true;
                const error = new Error('cross-device link not permitted');
                error.code = 'EXDEV';
                throw error;
            }
            await fsp.rename(src, dest);
        };

        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            deleteOriginal: false,
            shouldCancel: () => false,
            renameFile,
            lang: 'ko',
        });

        assert.equal(exdevFallbackUsed, true);
        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.createdFiles.length, 2);
        assert.equal(fs.existsSync(source), true);
        for (const filePath of result.createdFiles) {
            assert.equal(fs.existsSync(filePath), true);
            const entries = await listZipEntriesFromFile(filePath);
            assert.equal(entries.some(entry => entry.name === '001.jpg'), true);
        }
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

test('Organizer는 macOS 압축 메타데이터 엔트리를 구조 분석에서 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-macosx-'));
    try {
        const inner = path.join(root, '사이코 메트러 2부 01권.cbz');
        fs.writeFileSync(inner, Buffer.alloc(0));
        await replaceZipEntry(inner, '001.jpg', Buffer.from('page-1'));

        const source = path.join(root, '사이코 메트러 2부 01권.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '__MACOSX/._사이코 메트러 2부 01권.cbz', fs.readFileSync(inner));
        await replaceZipEntry(source, '사이코 메트러 2부 01권.cbz', fs.readFileSync(inner));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].volumes.length, 1);
        assert.equal(analyzed.items[0].volumes[0].original_path, '사이코 메트러 2부 01권');
        assert.equal(analyzed.items[0].volumes[0].new_name, '사이코 메트러 2부 01권');
        assert.equal(analyzed.items[0].page_count, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 제목의 부대, 부, 장 숫자를 권수로 오인하지 않는다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-title-parts-'));
    try {
        const cases = [
            {
                filename: '에녹 제2부대의 배고픈 원정 밥.zip',
                innerName: '에녹 제2부대의 배고픈 원정 밥.cbz',
                cleanTitle: '에녹 제2부대의 배고픈 원정 밥',
                newName: '에녹 제2부대의 배고픈 원정 밥',
            },
            {
                filename: '사이코 메트러 2부 01권.zip',
                innerName: '사이코 메트러 2부 01권.cbz',
                cleanTitle: '사이코 메트러 2부',
                newName: '사이코 메트러 2부 01권',
            },
            {
                filename: 'Re 제로부터 시작하는 이세계 생활 제5장.zip',
                innerName: 'Re 제로부터 시작하는 이세계 생활 제5장.cbz',
                cleanTitle: 'Re 제로부터 시작하는 이세계 생활 제5장',
                newName: 'Re 제로부터 시작하는 이세계 생활 제5장',
            },
        ];

        for (const item of cases) {
            const inner = path.join(root, item.innerName);
            fs.writeFileSync(inner, Buffer.alloc(0));
            await replaceZipEntry(inner, '001.jpg', Buffer.from('page-1'));

            const source = path.join(root, item.filename);
            fs.writeFileSync(source, Buffer.alloc(0));
            await replaceZipEntry(source, item.innerName, fs.readFileSync(inner));

            const analyzed = await analyzeOrganizerInputs([source], {
                sevenZExe: '',
                lang: 'ko',
            });

            assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
            assert.equal(analyzed.items.length, 1);
            assert.equal(analyzed.items[0].clean_title, item.cleanTitle);
            assert.equal(analyzed.items[0].core_title, item.cleanTitle);
            assert.equal(analyzed.items[0].volumes.length, 1);
            assert.equal(analyzed.items[0].volumes[0].new_name, item.newName);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 압축 파일명의 복사본/완료 표기를 책 제목에서 제외한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-copy-marker-'));
    try {
        const source = path.join(root, '[황성] 혈로행 1-2부 完 (UP) (1080px) - 복사본.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '혈로행 1부 01-23권 完/혈로행 1부 01권/001.jpg', Buffer.from('page-1'));
        await replaceZipEntry(source, '혈로행 2부 01-14권 完/혈로행 2부 01권/001.jpg', Buffer.from('page-2'));

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].clean_title, '혈로행');
        assert.equal(analyzed.items[0].core_title, '혈로행');
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.original_path),
            ['혈로행 1부 01-23권 完/혈로행 1부 01권', '혈로행 2부 01-14권 完/혈로행 2부 01권'],
        );
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.new_name),
            ['혈로행 1부 01권', '혈로행 2부 01권'],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer는 이미지 보정 suffix 숫자 대신 앞쪽 권수를 사용한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-image-suffix-'));
    try {
        const source = path.join(root, '프랑켄 프랑 번역본.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        const cases = [
            ['프랑켄프랑 01_waifu2x_noise2.cbz', '프랑켄 프랑 번역본 01권'],
            ['프랑켄프랑 05_waifu2x_noise2_scale_x0_8.cbz', '프랑켄 프랑 번역본 05권'],
            ['프랑켄프랑 08_waifu2x_noise2_scale_x1_4.cbz', '프랑켄 프랑 번역본 08권'],
        ];

        for (const [innerName] of cases) {
            const inner = path.join(root, innerName);
            fs.writeFileSync(inner, Buffer.alloc(0));
            await replaceZipEntry(inner, '001.jpg', Buffer.from('page-1'));
            await replaceZipEntry(source, innerName, fs.readFileSync(inner));
        }

        const analyzed = await analyzeOrganizerInputs([source], {
            sevenZExe: '',
            lang: 'ko',
        });

        assert.equal(analyzed.skippedFiles.length, 0, analyzed.skippedFiles.join('\n'));
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].clean_title, '프랑켄 프랑 번역본');
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.new_name),
            cases.map(([, expectedName]) => expectedName),
        );
        assert.deepEqual(
            analyzed.items[0].volumes.map(volume => volume.extracted_name),
            cases.map(([, expectedName]) => expectedName),
        );
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

test('Organizer 평탄화는 이미지 파일명을 유지한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-flat-names-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(path.join(input, 'Pages'), { recursive: true });
        fs.writeFileSync(path.join(input, 'Pages', 'Cover Image.JPG'), Buffer.from('cover'));
        fs.writeFileSync(path.join(input, 'Pages', 'page_01.png'), Buffer.from('page'));
        const source = path.join(root, 'Book.zip');
        const packed = spawnSync(sevenZExe, ['a', '-tzip', source, '*'], {
            cwd: input,
            stdio: 'ignore',
        });
        assert.equal(packed.status, 0);

        const analyzed = await analyzeOrganizerInputs([source], { sevenZExe, lang: 'ko' });
        const output = path.join(root, 'output');
        analyzed.items[0].out_path = output;
        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            flatten_folders: true,
            deleteOriginal: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.stats.error.length, 0, result.stats.error.join('\n'));
        const entries = await listZipEntriesFromFile(result.createdFiles[0]);
        assert.deepEqual(
            entries.filter(entry => !entry.isDir).map(entry => entry.name).sort(),
            ['Cover Image.JPG', 'page_01.png'],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer 평탄화는 루트 이미지를 임시 폴더에서 다시 복사하지 않는다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-organizer-flat-root-images-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input, { recursive: true });
        fs.writeFileSync(path.join(input, '001.jpg'), Buffer.from('page-1'));
        fs.writeFileSync(path.join(input, '002.jpg'), Buffer.from('page-2'));
        const source = path.join(root, 'Root Images.zip');
        const packed = spawnSync(sevenZExe, ['a', '-tzip', source, '*'], {
            cwd: input,
            stdio: 'ignore',
        });
        assert.equal(packed.status, 0);

        const analyzed = await analyzeOrganizerInputs([source], { sevenZExe, lang: 'ko' });
        analyzed.items[0].out_path = path.join(root, 'output');
        const result = await executeOrganizer(analyzed.items, {
            sevenZExe,
            target_format: 'cbz',
            flatten_folders: true,
            deleteOriginal: false,
            shouldCancel: () => false,
            lang: 'ko',
        });

        assert.equal(result.stats.error.length, 0, result.stats.error.join('\n'));
        const entries = await listZipEntriesFromFile(result.createdFiles[0]);
        assert.deepEqual(
            entries.filter(entry => !entry.isDir).map(entry => entry.name).sort(),
            ['001.jpg', '002.jpg'],
        );
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
