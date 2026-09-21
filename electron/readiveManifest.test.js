import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { scanReadivePaths, selectSnapshotEntries, summarizeEntries, openFrozenAsset } from './readive/manifest.js';
import { READIVE_LIMITS } from './readive/policy.js';

async function fixture(t) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'readive-manifest-'));
    const root = await fs.realpath(temporary);
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return root;
}

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Readive reuses unchanged file hashes but rechecks changed and replaced sources', async t => {
    const root = await fixture(t);
    const filePath = path.join(root, 'book.cbz');
    await fs.writeFile(filePath, 'first');
    const hashCache = new Map();
    const originalOpen = fs.open;
    let reads = 0;
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args);
        const createReadStream = handle.createReadStream.bind(handle);
        handle.createReadStream = options => { reads += 1; return createReadStream(options); };
        return handle;
    });
    const scanHash = async () => (await scanReadivePaths([filePath], { hashCache })).entries[0].contentHash;
    assert.equal(await scanHash(), hash('first'));
    assert.equal(await scanHash(), hash('first'));
    assert.equal(reads, 1, 'Repeated preparation must not read unchanged file contents again');

    const stat = await fs.stat(filePath);
    await fs.writeFile(filePath, 'other');
    await fs.utimes(filePath, stat.atime, stat.mtime);
    assert.equal(await scanHash(), hash('other'), 'ctime detects same-size changes even if mtime is restored');
    await fs.rename(filePath, path.join(root, 'old.cbz'));
    await fs.writeFile(filePath, 'newer');
    assert.equal(await scanHash(), hash('newer'));
    assert.equal(reads, 3);
    await fs.rm(filePath);
    await fs.symlink(path.join(root, 'old.cbz'), filePath);
    await assert.rejects(scanHash(), /symlink_not_allowed/);
    await assert.rejects(scanReadivePaths([path.join(root, 'old.cbz')], { hashCache, signal: AbortSignal.abort() }), /scan_cancelled/);
});

test('Readive preparation reads large files in bounded batches without changing the digest', async t => {
    const root = await fixture(t);
    const filePath = path.join(root, 'large.cbz');
    const bytes = Buffer.alloc(4 * 1024 ** 2, 37);
    await fs.writeFile(filePath, bytes);
    const originalOpen = fs.open;
    let chunks = 0;
    t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args);
        const createReadStream = handle.createReadStream.bind(handle);
        handle.createReadStream = options => {
            const stream = createReadStream(options);
            stream.on('data', () => { chunks += 1; });
            return stream;
        };
        return handle;
    });
    const snapshot = await scanReadivePaths([filePath]);
    assert.equal(snapshot.entries[0].contentHash, hash(bytes));
    assert.equal(snapshot.summary.bytes, bytes.length);
    assert.ok(chunks <= 4, `Expected at most four reads for 4 MiB, received ${chunks}`);
});

test('Readive manifests preserve nesting and empty directories with TXT raw metadata and cover budgets', async t => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'Books', 'Empty'), { recursive: true });
    const filePath = path.join(root, 'Books', 'book.txt');
    await fs.writeFile(filePath, 'original');
    const coverPath = path.join(root, 'cover.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(coverPath, png);
    const metadata = { Title: 'Custom title', Number: '1-551', CustomField: 'preserved', Summary: '' };
    const libraryDb = {
        getTextMetadata: async contentHash => ({ contentHash, metadata, record: {}, coverPath }),
        linkTextMetadataRecord: async () => {}, getTextMetadataPaths: async () => [],
    };
    const scan = await scanReadivePaths([path.join(root, 'Books')], { libraryDb });
    assert.equal(scan.blocked, false);
    assert.equal(scan.summary.folders, 2);
    const file = scan.entries.find(entry => entry.name === 'book.txt');
    assert.equal(file.relativePath, 'Books/book.txt');
    assert.equal(file.contentHash, hash('original'));
    assert.equal(file.coverBytes, png.length);
    assert.equal(scan.summary.bytes, Buffer.byteLength('original') + Buffer.byteLength(JSON.stringify(metadata)) + png.length);
    assert.deepEqual(JSON.parse(Buffer.from(scan.assets[file.metadataAssetId].base64, 'base64')), metadata);
    assert.deepEqual(selectSnapshotEntries(scan, [scan.entries[0].id]), []);
    assert.equal(summarizeEntries(selectSnapshotEntries(scan, [file.id])).folders, 2);
});

test('Readive scan refuses changed sources and does not follow symlink children', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    await fs.symlink(path.join(root, 'one.txt'), path.join(root, 'link.txt'));
    const scan = await scanReadivePaths([root]);
    assert.equal(scan.summary.files, 1);
    assert.equal(scan.summary.skipped, 1);
    const entry = scan.entries.find(item => item.name === 'one.txt');
    await fs.writeFile(path.join(root, 'one.txt'), 'changed');
    await assert.rejects(openFrozenAsset(scan.assets[entry.assetId]), /source_changed/);
    await assert.rejects(scanReadivePaths([path.join(root, 'link.txt')]), /symlink_not_allowed/);
});

test('Readive bounded scan marks truncated snapshots unapprovable', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'one.txt'), 'one');
    await fs.writeFile(path.join(root, 'two.txt'), 'two');
    const scan = await scanReadivePaths([root], { limits: { ...READIVE_LIMITS, hardFiles: 1 } });
    assert.equal(scan.blocked, true);
    assert.ok(scan.warnings.includes('transfer_hard_limit'));
});

test('Readive scan keeps overlapping roots once and rejects conflicting root names', async t => {
    const root = await fixture(t);
    await fs.mkdir(path.join(root, 'A', 'Same'), { recursive: true });
    await fs.mkdir(path.join(root, 'B', 'Same'), { recursive: true });
    await fs.writeFile(path.join(root, 'A', 'Same', 'one.txt'), 'one');
    const scan = await scanReadivePaths([path.join(root, 'A'), path.join(root, 'A', 'Same')]);
    assert.equal(scan.roots.length, 1);
    await assert.rejects(scanReadivePaths([path.join(root, 'A', 'Same'), path.join(root, 'B', 'Same')]), /duplicate_root_name/);
});


test('Readive standalone images remain separate books inside the selected collection tree', async t => {
    const root = await fixture(t);
    await fs.writeFile(path.join(root, 'page.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const scan = await scanReadivePaths([root]);
    assert.equal(scan.summary.files, 1);
    assert.equal(scan.entries.find(entry => entry.kind === 'file').format, 'image');
});


test('Readive transfer excludes unsupported audio containers and retains supported mobile formats', async t => {
    const root = await fixture(t);
    const unsupported = ['sample.aif', 'sample.aiff', 'sample.wma', 'sample.exe'];
    const supported = ['sample.3gp', 'sample.amr', 'sample.oga', 'sample.wave', 'sample.webm', 'sample.tar', 'sample.cbt', 'sample.heic', 'sample.avif', 'sample.svg'];
    for (const name of [...unsupported, ...supported]) await fs.writeFile(path.join(root, name), 'fixture');
    const scan = await scanReadivePaths([root]);
    assert.equal(scan.summary.files, supported.length);
    assert.equal(scan.summary.skipped, unsupported.length);
    assert.deepEqual(scan.entries.filter(entry => entry.skippedReason === 'unsupported_format').map(entry => entry.name).sort(), [...unsupported].sort());
    for (const name of ['sample.heic', 'sample.avif', 'sample.svg']) assert.equal(scan.entries.find(entry => entry.name === name).format, 'image');
});
