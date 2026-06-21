import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
    analyzeMetadataInputs,
    createComicInfoXml,
    metadataWriteSupport,
    parseComicInfo,
    saveMetadataItems,
} from './tasks/metadataTask.js';
import {
    listZipEntries,
    readZipEntry,
    replaceZipEntry,
} from './core/zipArchive.js';

function find7z() {
    for (const candidate of ['/usr/local/bin/7z', '/opt/homebrew/bin/7z', '7z', '7za']) {
        const result = spawnSync(candidate, ['i'], { stdio: 'ignore' });
        if (!result.error) return candidate;
    }
    return '';
}

test('ComicInfo XML preserves supported fields and escapes text', () => {
    const xml = createComicInfoXml({
        Series: 'A & B',
        AlternateSeries: '다른 시리즈',
        Translator: '번역자',
        BlackAndWhite: 'Yes',
        CommunityRating: '4.5',
    });

    assert.match(xml, /xmlns:xsi=/);
    assert.match(xml, /<Series>A &amp; B<\/Series>/);
    assert.match(xml, /<AlternateSeries>다른 시리즈<\/AlternateSeries>/);
    assert.match(xml, /<Translator>번역자<\/Translator>/);
    assert.match(xml, /<BlackAndWhite>Yes<\/BlackAndWhite>/);
    assert.match(xml, /<ComicZipAddedDate>/);
    assert.match(xml, /<ComicZipModifiedDate>/);
});

test('ComicInfo XML parsing is case insensitive and preserves added date', () => {
    const parsed = parseComicInfo(`
        <ComicInfo>
            <series>작품</series>
            <Translator>번역자</Translator>
            <ComicZipAddedDate>2024-01-02 03:04:05</ComicZipAddedDate>
        </ComicInfo>
    `);

    assert.equal(parsed.Series, '작품');
    assert.equal(parsed.Translator, '번역자');
    assert.equal(parsed.ComicZipAddedDate, '2024-01-02 03:04:05');
});

test('RAR과 CBR 메타데이터 쓰기 제한을 명확히 안내한다', () => {
    assert.equal(metadataWriteSupport('book.rar').supported, false);
    assert.equal(metadataWriteSupport('BOOK.CBR').supported, false);
    assert.match(metadataWriteSupport('book.rar').message, /CBZ|ZIP/);
    assert.equal(metadataWriteSupport('book.cbz').supported, true);
});

test('CBZ 메타데이터 분석과 저장은 외부 7z 없이 처리한다', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-native-'));
    try {
        const source = path.join(root, '작품명 02권.cbz');
        fs.writeFileSync(source, Buffer.alloc(0));
        await replaceZipEntry(source, '001.jpg', Buffer.from('cover'));
        await replaceZipEntry(source, 'ComicInfo.xml', createComicInfoXml({
            Series: '기존 작품',
            Title: '기존 제목',
        }));

        const analyzed = await analyzeMetadataInputs([source], {});
        assert.equal(analyzed.items.length, 1);
        assert.equal(analyzed.items[0].metadata.Series, '기존 작품');
        assert.equal(analyzed.items[0].hasComicInfo, true);
        assert.equal(analyzed.items[0].pageCount, 1);

        analyzed.items[0].metadata.Series = '변경된 작품';
        const saved = await saveMetadataItems(analyzed.items, {
            backup_on: false,
            shouldCancel: () => false,
        });
        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));

        const buffer = fs.readFileSync(source);
        const comicInfoEntry = listZipEntries(buffer).find(entry => entry.name === 'ComicInfo.xml');
        assert.ok(comicInfoEntry);
        const xml = readZipEntry(buffer, comicInfoEntry).toString('utf8');
        assert.match(xml, /<Series>변경된 작품<\/Series>/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('메타데이터 저장은 백업 후 원본 경로를 원자적으로 교체한다', async t => {
    const sevenZExe = find7z();
    if (!sevenZExe) {
        t.skip('7z executable is not available');
        return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-metadata-'));
    try {
        const input = path.join(root, 'input');
        fs.mkdirSync(input);
        fs.writeFileSync(path.join(input, '001.jpg'), Buffer.from('page'));
        const source = path.join(root, '작품명 01권.CBZ');
        assert.equal(spawnSync(sevenZExe, ['a', '-tzip', source, '*'], {
            cwd: input,
            stdio: 'ignore',
        }).status, 0);
        const original = fs.readFileSync(source);

        const analyzed = await analyzeMetadataInputs([source], { sevenZExe });
        assert.equal(analyzed.items.length, 1);
        analyzed.items[0].metadata.Series = '변경된 작품명';
        const saved = await saveMetadataItems(analyzed.items, {
            sevenZExe,
            backup_on: true,
            shouldCancel: () => false,
        });

        assert.equal(saved.stats.success.length, 1, saved.stats.error.join('\n'));
        assert.deepEqual(fs.readFileSync(path.join(root, 'bak', path.basename(source))), original);
        const xml = spawnSync(sevenZExe, ['x', '-so', source, 'ComicInfo.xml']).stdout.toString('utf8');
        assert.match(xml, /<Series>변경된 작품명<\/Series>/);
        assert.deepEqual(
            fs.readdirSync(root).filter(name => name.includes('bookmanager_metadata') || name.endsWith('.bookmanager.metadata.old')),
            [],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
