import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { LibraryDB } from './database/library_db.js';
import { scanFolder } from './tasks/folderScanTask.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

test('saving partial ComicInfo metadata caches the complete saved XML including preserved fields and rounded rating', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-comicinfo-cache-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const libraryDir = path.join(directory, 'library');
    await fs.mkdir(libraryDir);
    const filePath = path.join(libraryDir, 'book.cbz');
    const dbPath = path.join(directory, 'library.db');
    await fs.writeFile(filePath, Buffer.alloc(0));
    await replaceZipEntry(filePath, '001.jpg', 'page');
    const scan = () => scanFolder(libraryDir, { dbPath, skipCoverExtraction: true });
    const [empty] = await scan();
    assert.equal(empty.has_metadata, false);
    const seeded = await saveMetadataItems([{ filepath: filePath, metadata: {
        Title: 'Old', Writer: 'Writer', Teams: 'Team', Locations: 'City', GTIN: '9781234567890', CommunityRating: '9',
    } }], { dbPath });
    assert.deepEqual(seeded.stats.error, []);
    const [withMetadata] = await scan();
    assert.equal(withMetadata.has_metadata, true);
    const result = await saveMetadataItems([{ filepath: filePath, metadata: { Title: 'New', GTIN: '9781234567897', Teams: 'New Team', CommunityRating: '8.75' } }], { dbPath });
    assert.deepEqual(result.stats.error, []);
    const library = new LibraryDB({ dbPath });
    try {
        const stored = await library.getFileInfo(filePath);
        assert.equal(stored.writer, 'Writer');
        assert.equal(stored.teams, 'New Team');
        assert.equal(stored.locations, 'City');
        assert.equal(stored.isbn, '9781234567897');
        assert.equal(stored.rating, '8.8');
    } finally {
        await library.close();
    }
    const [file] = await scan();
    assert.equal(file.title, 'New');
    assert.equal(file.writer, 'Writer');
    assert.equal(file.teams, 'New Team');
    assert.equal(file.locations, 'City');
    assert.equal(file.isbn, '9781234567897');
    assert.equal(file.rating, '8.8');
    const cleared = await saveMetadataItems([{ filepath: filePath, metadata: { GTIN: '', Teams: '', Locations: '' } }], { dbPath });
    assert.deepEqual(cleared.stats.error, []);
    const [afterClear] = await scan();
    assert.equal(afterClear.isbn, '');
    assert.equal(afterClear.teams, '');
    assert.equal(afterClear.locations, '');
    assert.equal(afterClear.writer, 'Writer');
});
