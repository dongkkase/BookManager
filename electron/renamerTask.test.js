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
import {
    listZipEntriesFromFile,
    readZipEntryFromFile,
    replaceZipEntry,
} from './core/zipArchive.js';

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

function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
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

function createJpegWithExif(cjpegExe) {
    const ppm = Buffer.concat([
        Buffer.from('P6\n1 1\n255\n', 'ascii'),
        Buffer.from([255, 0, 0]),
    ]);
    const encoded = spawnSync(cjpegExe, ['-quality', '90'], {
        input: ppm,
        encoding: null,
    });
    assert.equal(encoded.status, 0, encoded.stderr?.toString() || 'cjpeg failed');
    const jpeg = encoded.stdout;
    assert.equal(jpeg[0], 0xff);
    assert.equal(jpeg[1], 0xd8);
    return addExifSegment(jpeg);
}

function addExifSegment(jpeg) {
    const exifPayload = Buffer.concat([
        Buffer.from('Exif\0\0', 'binary'),
        Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00]),
    ]);
    const app1Header = Buffer.alloc(4);
    app1Header[0] = 0xff;
    app1Header[1] = 0xe1;
    app1Header.writeUInt16BE(exifPayload.length + 2, 2);
    return Buffer.concat([jpeg.subarray(0, 2), app1Header, exifPayload, jpeg.subarray(2)]);
}

function createGradientJpeg(cjpegExe, quality = 100) {
    const width = 96;
    const height = 96;
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            pixels[offset] = (x * 3 + y * 5) % 256;
            pixels[offset + 1] = (x * 7 + y * 11) % 256;
            pixels[offset + 2] = (x * y + x + y) % 256;
        }
    }
    const ppm = Buffer.concat([
        Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'),
        pixels,
    ]);
    const encoded = spawnSync(cjpegExe, ['-quality', String(quality), '-optimize'], {
        input: ppm,
        encoding: null,
    });
    assert.equal(encoded.status, 0, encoded.stderr?.toString() || 'cjpeg failed');
    return encoded.stdout;
}

async function readArchiveEntry(filePath, entryName) {
    const entries = await listZipEntriesFromFile(filePath);
    const entry = entries.find(item => item.name === entryName);
    assert.ok(entry, entries.map(item => item.name).join('\n'));
    const buffer = await readZipEntryFromFile(filePath, entry);
    assert.ok(buffer);
    return buffer;
}

test('내부 파일 리스트는 기존 Python natural_keys 순서로 로드한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-order-'));
    try {
        const source = path.join(root, 'Natural Order.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, 'chapter/10.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter 10/1.jpg', PNG_1X1);
        await replaceZipEntry(source, 'Cover.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter/2.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter/３.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter 2/1.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter/1.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter/１１.jpg', PNG_1X1);
        await replaceZipEntry(source, 'chapter/3.txt', Buffer.from('not-image'));

        const analyzed = await analyzeRenamerInputs([source], { sevenZExe: '' });

        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        assert.deepEqual(
            analyzed.items[0].entries.map(entry => entry.originalPath),
            [
                'Cover.jpg',
                'chapter/1.jpg',
                'chapter/2.jpg',
                'chapter/３.jpg',
                'chapter/10.jpg',
                'chapter/１１.jpg',
                'chapter 2/1.jpg',
                'chapter 10/1.jpg',
            ],
        );

        const preview = await extractRenamerImage(source, analyzed.items[0].entries[0].originalPath, '');
        assert.equal(preview.success, true);
        assert.match(preview.dataUrl, /^data:image\/jpeg;base64,/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

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

test('이미지 처리 없는 ZIP 내부 이름 변경은 압축 해제 없이 7z rn을 사용한다', async t => {
    if (process.platform === 'win32') {
        t.skip('shell wrapper is not available on Windows');
        return;
    }

    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-rn-fast-'));
    try {
        const source = path.join(root, 'Rename Only.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', PNG_1X1);
        const analyzed = await analyzeRenamerInputs([source], { sevenZExe: '' });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        analyzed.items[0].capOpt = false;
        analyzed.items[0].exifOpt = false;
        analyzed.items[0].entries[0].newName = 'renamed.jpg';

        const logPath = path.join(root, 'commands.log');
        const wrapperPath = path.join(root, 'rn-only-7z.sh');
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

        const result = await executeRenamer(analyzed.items, {
            sevenZExe: wrapperPath,
            deleteOriginal: false,
            flattenFolders: false,
            shouldCancel: () => false,
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(fs.readFileSync(logPath, 'utf8').trim(), 'rn');
        const outputEntries = await listZipEntriesFromFile(result.outputFiles[0]);
        assert.deepEqual(outputEntries.map(entry => entry.name), ['renamed.jpg']);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('내부 파일명 변경 재압축 강도 설정은 7z 압축 레벨에 반영된다', async t => {
    if (process.platform === 'win32') {
        t.skip('shell wrapper is not available on Windows');
        return;
    }

    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    async function runWithMode(mode) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `bookmanager-renamer-compression-${mode}-`));
        try {
            const source = createArchive(sevenZExe, root, `Compression ${mode}`, {
                'images/1.png': PNG_1X1,
            });
            const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
            assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
            analyzed.items[0].capOpt = false;
            analyzed.items[0].exifOpt = false;

            const logPath = path.join(root, 'commands.log');
            const wrapperPath = path.join(root, 'record-7z.sh');
            fs.writeFileSync(
                wrapperPath,
                [
                    '#!/bin/sh',
                    `printf '%s\\n' "$*" >> ${shellQuote(logPath)}`,
                    `exec ${shellQuote(sevenZExe)} "$@"`,
                    '',
                ].join('\n'),
            );
            fs.chmodSync(wrapperPath, 0o755);

            const result = await executeRenamer(analyzed.items, {
                sevenZExe: wrapperPath,
                deleteOriginal: false,
                flattenFolders: true,
                renamer_archive_compression: mode,
                shouldCancel: () => false,
            });

            assert.equal(result.cancelled, false);
            assert.deepEqual(result.stats.error, []);
            const commands = fs.readFileSync(logPath, 'utf8').trim().split('\n');
            return commands.filter(line => line.startsWith('a '));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }

    const fastAddCommands = await runWithMode('fast');
    assert.equal(fastAddCommands.length, 1);
    assert.match(fastAddCommands[0], /-mx=0/);
    assert.doesNotMatch(fastAddCommands[0], /-mx=9/);

    const maximumAddCommands = await runWithMode('maximum');
    assert.equal(maximumAddCommands.length, 1);
    assert.match(maximumAddCommands[0], /-mx=9/);
    assert.doesNotMatch(maximumAddCommands[0], /-mx=0/);
});

test('EXIF 제거 체크된 내부 파일명 변경 결과는 JPEG EXIF 세그먼트를 제거한다', async t => {
    const sevenZExe = find7z();
    const jpegtranExe = findTool(['/usr/local/bin/jpegtran', '/opt/homebrew/bin/jpegtran', 'jpegtran']);
    const cjpegExe = findTool(['/usr/local/bin/cjpeg', '/opt/homebrew/bin/cjpeg', 'cjpeg']);
    if (!sevenZExe || !jpegtranExe || !cjpegExe) {
        t.skip('7z, jpegtran, or cjpeg executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-exif-'));
    try {
        const source = path.join(root, 'Exif Source.zip');
        const jpegWithExif = createJpegWithExif(cjpegExe);
        assert.notEqual(jpegWithExif.indexOf(Buffer.from('Exif\0\0', 'binary')), -1);
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', jpegWithExif);

        const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        analyzed.items[0].exifOpt = true;
        analyzed.items[0].capOpt = false;
        analyzed.items[0].entries[0].newName = 'renamed.jpg';

        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            jpegtranExe,
            deleteOriginal: false,
            flattenFolders: true,
            shouldCancel: () => false,
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.outputFiles.length, 1);

        const outputBuffer = await readArchiveEntry(result.outputFiles[0], 'renamed.jpg');
        assert.equal(outputBuffer.indexOf(Buffer.from('Exif\0\0', 'binary')), -1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('이미지 압축은 환경설정 img_quality 값을 JPEG 재인코딩 품질로 사용한다', async t => {
    const sevenZExe = find7z();
    const cjpegExe = findTool(['/usr/local/bin/cjpeg', '/opt/homebrew/bin/cjpeg', 'cjpeg']);
    const djpegExe = findTool(['/usr/local/bin/djpeg', '/opt/homebrew/bin/djpeg', 'djpeg']);
    const jpegtranExe = findTool(['/usr/local/bin/jpegtran', '/opt/homebrew/bin/jpegtran', 'jpegtran']);
    if (!sevenZExe || !cjpegExe || !djpegExe) {
        t.skip('7z, cjpeg, or djpeg executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-quality-'));
    try {
        const source = path.join(root, 'Quality Source.zip');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', createGradientJpeg(cjpegExe, 100));

        async function runWithQuality(quality) {
            const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
            assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
            analyzed.items[0].capOpt = true;
            analyzed.items[0].exifOpt = false;
            analyzed.items[0].entries[0].newName = `quality-${quality}.jpg`;

            const result = await executeRenamer(analyzed.items, {
                sevenZExe,
                cjpegExe,
                djpegExe,
                jpegtranExe,
                img_quality: quality,
                deleteOriginal: false,
                flattenFolders: true,
                shouldCancel: () => false,
            });

            assert.equal(result.cancelled, false);
            assert.deepEqual(result.stats.error, []);
            assert.equal(result.outputFiles.length, 1);
            return (await readArchiveEntry(result.outputFiles[0], `quality-${quality}.jpg`)).length;
        }

        const highQualitySize = await runWithQuality(90);
        const lowQualitySize = await runWithQuality(35);

        assert.ok(
            lowQualitySize < highQualitySize,
            `expected lower quality output to be smaller: q35=${lowQualitySize}, q90=${highQualitySize}`,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('이미지 압축은 EXIF 제거가 켜져도 JPEG 용량이 커지는 결과를 채택하지 않는다', async t => {
    const sevenZExe = find7z();
    const cjpegExe = findTool(['/usr/local/bin/cjpeg', '/opt/homebrew/bin/cjpeg', 'cjpeg']);
    const djpegExe = findTool(['/usr/local/bin/djpeg', '/opt/homebrew/bin/djpeg', 'djpeg']);
    const jpegtranExe = findTool(['/usr/local/bin/jpegtran', '/opt/homebrew/bin/jpegtran', 'jpegtran']);
    if (!sevenZExe || !cjpegExe || !djpegExe || !jpegtranExe) {
        t.skip('7z, cjpeg, djpeg, or jpegtran executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-no-growth-'));
    try {
        const source = path.join(root, 'No Growth Source.zip');
        const originalJpeg = addExifSegment(createGradientJpeg(cjpegExe, 35));
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', originalJpeg);

        const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        analyzed.items[0].capOpt = true;
        analyzed.items[0].exifOpt = true;
        analyzed.items[0].entries[0].newName = 'no-growth.jpg';

        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            cjpegExe,
            djpegExe,
            jpegtranExe,
            img_quality: 95,
            deleteOriginal: false,
            flattenFolders: true,
            shouldCancel: () => false,
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.outputFiles.length, 1);

        const outputBuffer = await readArchiveEntry(result.outputFiles[0], 'no-growth.jpg');
        assert.ok(
            outputBuffer.length <= originalJpeg.length,
            `expected optimized image not to grow: original=${originalJpeg.length}, output=${outputBuffer.length}`,
        );
        assert.equal(outputBuffer.indexOf(Buffer.from('Exif\0\0', 'binary')), -1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('이미지 압축 결과 아카이브는 원본보다 커지지 않도록 재압축한다', async t => {
    const sevenZExe = find7z();
    const cjpegExe = findTool(['/usr/local/bin/cjpeg', '/opt/homebrew/bin/cjpeg', 'cjpeg']);
    const djpegExe = findTool(['/usr/local/bin/djpeg', '/opt/homebrew/bin/djpeg', 'djpeg']);
    const jpegtranExe = findTool(['/usr/local/bin/jpegtran', '/opt/homebrew/bin/jpegtran', 'jpegtran']);
    if (!sevenZExe || !cjpegExe || !djpegExe || !jpegtranExe) {
        t.skip('7z, cjpeg, djpeg, or jpegtran executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-archive-size-'));
    try {
        const originalJpeg = addExifSegment(createGradientJpeg(cjpegExe, 35));
        const source = createArchive(sevenZExe, root, 'Archive Size Source', {
            '001.jpg': originalJpeg,
        });
        const originalArchiveSize = fs.statSync(source).size;

        const analyzed = await analyzeRenamerInputs([source], { sevenZExe });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        analyzed.items[0].capOpt = true;
        analyzed.items[0].exifOpt = true;
        analyzed.items[0].entries[0].newName = '001.jpg';

        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            cjpegExe,
            djpegExe,
            jpegtranExe,
            img_quality: 95,
            deleteOriginal: false,
            flattenFolders: true,
            shouldCancel: () => false,
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.outputFiles.length, 1);
        assert.ok(
            fs.statSync(result.outputFiles[0]).size <= originalArchiveSize,
            `expected archive not to grow: original=${originalArchiveSize}, output=${fs.statSync(result.outputFiles[0]).size}`,
        );
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

test('WebP 변환 결과가 원본보다 크면 원본 포맷을 유지한다', async t => {
    if (process.platform === 'win32') {
        t.skip('shell wrapper is not available on Windows');
        return;
    }

    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-renamer-webp-growth-'));
    try {
        const source = createArchive(sevenZExe, root, 'Webp Growth', {
            '1.png': PNG_1X1,
        });
        const wrapperPath = path.join(root, 'larger-cwebp.sh');
        fs.writeFileSync(
            wrapperPath,
            [
                '#!/bin/sh',
                'out=""',
                'while [ "$#" -gt 0 ]; do',
                '  if [ "$1" = "-o" ]; then',
                '    shift',
                '    out="$1"',
                '  fi',
                '  shift',
                'done',
                'dd if=/dev/zero of="$out" bs=1024 count=1 >/dev/null 2>&1',
                '',
            ].join('\n'),
        );
        fs.chmodSync(wrapperPath, 0o755);

        const analyzed = await analyzeRenamerInputs([source], {
            sevenZExe,
            webpConversion: true,
        });
        assert.equal(analyzed.items.length, 1, analyzed.skippedFiles.join('\n'));
        analyzed.items[0].capOpt = false;
        analyzed.items[0].exifOpt = false;

        const result = await executeRenamer(analyzed.items, {
            sevenZExe,
            cwebpExe: wrapperPath,
            webp_conversion: true,
            img_quality: 80,
            deleteOriginal: false,
            shouldCancel: () => false,
        });

        assert.equal(result.cancelled, false);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.outputFiles.length, 1);
        const listing = spawnSync(sevenZExe, ['l', '-ba', result.outputFiles[0]], { encoding: 'utf8' }).stdout;
        assert.match(listing, /00\.png/);
        assert.doesNotMatch(listing, /\.webp/);
        assert.deepEqual(await readArchiveEntry(result.outputFiles[0], '00.png'), PNG_1X1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
