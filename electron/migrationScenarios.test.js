import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    analyzeMetadataInputs,
    saveMetadataItems,
} from './tasks/metadataTask.js';
import {
    analyzeOrganizerInputs,
    executeOrganizer,
} from './tasks/organizerTask.js';
import {
    analyzeRenamerInputs,
    executeRenamer,
} from './tasks/renamerTask.js';

const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=',
    'base64',
);

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

function createArchive(sevenZExe, root, name, files, options = {}) {
    const input = path.join(root, `${name.replace(/[^\p{L}\p{N}]+/gu, '_')}-input`);
    fs.mkdirSync(input, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(input, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    const extension = options.extension || '.zip';
    const archive = path.join(root, `${name}${extension}`);
    const result = spawnSync(
        sevenZExe,
        ['a', options.type || '-tzip', archive, '*', ...(options.extraArgs || [])],
        { cwd: input, stdio: 'ignore' },
    );
    assert.equal(result.status, 0, `${archive} 생성 실패`);
    return archive;
}

function imageFiles(count, directory = '') {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [
        path.posix.join(directory, `${String(index + 1).padStart(3, '0')}.png`),
        PNG_1X1,
    ]));
}

test('15.1 최소 아카이브 corpus를 실제 분석기로 검증한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-minimum-corpus-'));
    try {
        const zip = createArchive(sevenZExe, root, 'normal', imageFiles(1));
        const cbz = createArchive(sevenZExe, root, 'normal-cbz', imageFiles(1), { extension: '.cbz' });
        const cbr = createArchive(sevenZExe, root, 'container-cbr', imageFiles(1), { extension: '.cbr' });
        const seven = createArchive(sevenZExe, root, 'normal-7z', imageFiles(1), {
            extension: '.7z',
            type: '-t7z',
        });
        const multiFolder = createArchive(sevenZExe, root, 'multi-folder', {
            ...imageFiles(1, 'Series 1권'),
            ...imageFiles(1, 'Series 2권'),
        });
        const comicInfo = createArchive(sevenZExe, root, 'with-comicinfo', {
            ...imageFiles(1),
            'ComicInfo.xml': '<ComicInfo><Series>Corpus Series</Series></ComicInfo>',
        }, { extension: '.cbz' });
        const coverless = createArchive(sevenZExe, root, 'coverless', {
            'ComicInfo.xml': '<ComicInfo><Series>No Cover</Series></ComicInfo>',
        }, { extension: '.cbz' });
        const multilingual = [
            createArchive(sevenZExe, root, '한글 작품', imageFiles(1), { extension: '.cbz' }),
            createArchive(sevenZExe, root, 'English Book', imageFiles(1), { extension: '.cbz' }),
            createArchive(sevenZExe, root, '日本語 作品', imageFiles(1), { extension: '.cbz' }),
        ];
        const duplicateA = createArchive(sevenZExe, path.join(root, 'A'), 'Same Name', imageFiles(1), { extension: '.cbz' });
        const duplicateB = createArchive(sevenZExe, path.join(root, 'B'), 'Same Name', imageFiles(1), { extension: '.cbz' });
        const pageCounts = [1, 9, 10, 99, 100];
        const pageArchives = pageCounts.map(count => (
            createArchive(sevenZExe, root, `pages-${count}`, imageFiles(count), { extension: '.cbz' })
        ));
        const inner = createArchive(sevenZExe, root, 'inner', imageFiles(1));
        const nested = createArchive(sevenZExe, root, 'nested', {
            ...imageFiles(1),
            'inner.zip': fs.readFileSync(inner),
        });
        const encrypted = createArchive(sevenZExe, root, 'encrypted', imageFiles(1), {
            extraArgs: ['-psecret'],
        });
        const damaged = path.join(root, 'damaged.zip');
        fs.writeFileSync(damaged, 'not an archive');

        const readable = await analyzeRenamerInputs(
            [zip, cbz, cbr, seven, multiFolder, ...multilingual, duplicateA, duplicateB],
            { sevenZExe },
        );
        assert.equal(readable.items.length, 10, readable.skippedFiles.join('\n'));
        assert.equal(new Set(readable.items.map(item => item.filepath)).size, 10);
        assert.equal(readable.items.filter(item => item.name === 'Same Name.cbz').length, 2);

        const organizer = await analyzeOrganizerInputs([multiFolder], { sevenZExe, lang: 'ko' });
        assert.equal(organizer.items[0].volumes.length, 2);

        const metadata = await analyzeMetadataInputs(
            [comicInfo, coverless, ...pageArchives],
            { sevenZExe },
        );
        assert.equal(metadata.items.find(item => item.filepath === comicInfo)?.hasComicInfo, true);
        assert.equal(metadata.items.find(item => item.filepath === coverless)?.coverDataUrl, '');
        assert.deepEqual(
            pageArchives.map(filePath => metadata.items.find(item => item.filepath === filePath)?.pageCount),
            pageCounts,
        );

        const rejected = await analyzeRenamerInputs([nested, encrypted, damaged], { sevenZExe });
        assert.equal(rejected.items.length, 0);
        assert.match(rejected.skippedFiles.join('\n'), /nested archive/);
        assert.match(rejected.skippedFiles.join('\n'), /encrypted archive/);
        assert.match(rejected.skippedFiles.join('\n'), /archive|open|supported images/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Organizer 결과를 Renamer와 Metadata 저장까지 연속 전달한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-regression-flow-'));
    try {
        const source = createArchive(sevenZExe, root, 'Regression Series', {
            ...imageFiles(2, 'Regression Series 1권'),
            ...imageFiles(2, 'Regression Series 2권'),
        });
        const organizerItems = await analyzeOrganizerInputs([source], { sevenZExe, lang: 'ko' });
        organizerItems.items[0].out_path = path.join(root, 'organized');
        const organized = await executeOrganizer(organizerItems.items, {
            sevenZExe,
            target_format: 'cbz',
            deleteOriginal: false,
            shouldCancel: () => false,
            lang: 'ko',
        });
        assert.equal(organized.cancelled, false);
        assert.equal(organized.createdFiles.length, 2);

        const renamerItems = await analyzeRenamerInputs(organized.createdFiles, { sevenZExe });
        assert.equal(renamerItems.items.length, 2, renamerItems.skippedFiles.join('\n'));
        for (const item of renamerItems.items) {
            item.entries = item.entries.map((entry, index) => ({
                ...entry,
                newName: `${String(index + 1).padStart(3, '0')}.png`,
            }));
        }
        const renamed = await executeRenamer(renamerItems.items, {
            sevenZExe,
            flattenFolders: true,
            shouldCancel: () => false,
        });
        assert.equal(renamed.cancelled, false);
        assert.equal(renamed.outputFiles.length, 2);

        const metadataItems = await analyzeMetadataInputs(renamed.outputFiles, { sevenZExe });
        assert.equal(metadataItems.items.length, 2, metadataItems.skippedFiles.join('\n'));
        for (const item of metadataItems.items) {
            item.metadata.Series = 'Regression Verified';
        }
        const saved = await saveMetadataItems(metadataItems.items, {
            sevenZExe,
            shouldCancel: () => false,
        });
        assert.equal(saved.cancelled, false);
        assert.equal(saved.stats.success.length, 2, saved.stats.error.join('\n'));

        for (const filePath of renamed.outputFiles) {
            const xml = spawnSync(sevenZExe, ['x', '-so', filePath, 'ComicInfo.xml']).stdout.toString('utf8');
            assert.match(xml, /<Series>Regression Verified<\/Series>/);
            const listing = spawnSync(sevenZExe, ['l', '-ba', filePath], { encoding: 'utf8' }).stdout;
            assert.match(listing, /001\.png/);
            assert.match(listing, /002\.png/);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
