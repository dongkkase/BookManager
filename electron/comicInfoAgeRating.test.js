import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { metadataFromApiResult } from '../src/metadataApiPolicy.js';
import { normalizeComicInfoAgeRating } from '../src/metadata/comicInfoPolicy.js';
import { createComicInfoXml, parseComicInfoXml } from './comicInfoXml.js';
import { listZipEntries, readZipEntry, replaceZipEntry } from './core/zipArchive.js';
import { getOperationErrors } from './operationDiagnostics.js';
import { saveMetadataItems } from './tasks/metadataTask.js';

const pageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 128, 254, 0xff, 0xd9]);
const customAgeRatings = [16, '20+', 'FSK 16', 'PG-13', 'Custom 13+', 'Local & <restricted>'];

function assertApiRating(input, expected) {
    const result = { metadata: { Title: 'Updated', AgeRating: input } };
    const metadata = metadataFromApiResult(result, { bookType: 'comic' });
    assert.equal(parseComicInfoXml(createComicInfoXml(metadata)).AgeRating, expected, String(input));
    assert.equal(result.metadata.AgeRating, input);
}

test('known numeric provider age limits save through API metadata conversion as ComicInfo ratings', () => {
    for (const [age, expected] of [
        [0, 'Everyone'], [10, 'Everyone 10+'], [12, 'Teen'], [15, 'MA15+'],
        [17, 'Mature 17+'], [18, 'Adults Only 18+'], [19, 'Adults Only 18+'],
    ]) {
        for (const input of [age, String(age), `${age}+`]) {
            assert.equal(normalizeComicInfoAgeRating(input), expected, String(input));
            assertApiRating(input, expected);
        }
    }
});

test('known Korean age labels accept compact and spaced suffixes without inventing new classifications', () => {
    for (const [input, expected] of [
        ['12세', 'Teen'], ['12 이상', 'Teen'], ['15세이용가', 'MA15+'],
        ['17세 이상', 'Mature 17+'], ['18세이상이용가', 'Adults Only 18+'],
        ['19 이용가', 'Adults Only 18+'], [' 19 세 이상 이용가 ', 'Adults Only 18+'],
        ['전체이용가', 'Everyone'], [' 전체 이용가 ', 'Everyone'],
        ['전체연령가', 'Everyone'], ['전체\t연령가', 'Everyone'],
        ['청소년이용불가', 'Adults Only 18+'], [' 청소년 이용 불가 ', 'Adults Only 18+'],
    ]) {
        assert.equal(normalizeComicInfoAgeRating(input), expected, input);
        assertApiRating(input, expected);
    }
});

test('canonical regional and publisher ComicInfo ratings retain their specific classification', () => {
    for (const rating of [
        'Unknown', 'Adults Only 18+', 'Early Childhood', 'Everyone', 'Everyone 10+',
        'G', 'Kids to Adults', 'M', 'MA15+', 'Mature 17+', 'PG', 'R18+',
        'Rating Pending', 'Teen', 'X18+',
    ]) {
        assert.equal(normalizeComicInfoAgeRating(rating), rating);
        assertApiRating(rating, rating);
    }
});

test('unmapped ages and regional labels retain their original value through API and XML conversion', () => {
    for (const input of [7, 13, 20, '16', '13세 이상', '19.0', '19세+', 'Unrecognized', ...customAgeRatings]) {
        assert.equal(normalizeComicInfoAgeRating(input), null, String(input));
        assertApiRating(input, String(input));
    }
    const xml = createComicInfoXml({ AgeRating: 'Local & <restricted>' });
    assert.match(xml, /<AgeRating>Local &amp; &lt;restricted&gt;<\/AgeRating>/);
});

test('custom age labels still reject invalid XML characters', () => {
    for (const input of ['Local\u0000rating', 'Local\u0001rating', 'Local\uFFFE', 'Local\uD800']) {
        assert.throws(() => createComicInfoXml({ AgeRating: input }), { code: 'INVALID_COMICINFO' });
    }
});

async function archiveFixture(t, extension, ageRating) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-age-rating-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, `book${extension}`);
    await fs.writeFile(filePath, Buffer.alloc(0));
    await replaceZipEntry(filePath, 'pages/001.jpg', pageBytes);
    if (ageRating !== undefined) {
        const escapedAgeRating = String(ageRating).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        await replaceZipEntry(filePath, 'ComicInfo.xml', `<ComicInfo><Title>Original</Title><AgeRating>${escapedAgeRating}</AgeRating></ComicInfo>`);
    }
    return filePath;
}

for (const extension of ['.zip', '.cbz']) {
    test(`direct metadata save accepts AgeRating 19 without API conversion (${extension})`, async t => {
        const filePath = await archiveFixture(t, extension);
        const result = await saveMetadataItems([{ filepath: filePath, metadata: { AgeRating: '19' } }]);
        assert.deepEqual(result.stats.error, []);
        assert.equal(result.stats.success.length, 1);
        const buffer = await fs.readFile(filePath);
        const entries = listZipEntries(buffer);
        assert.deepEqual(readZipEntry(buffer, entries.find(entry => entry.name === 'pages/001.jpg')), pageBytes);
        const xml = readZipEntry(buffer, entries.find(entry => entry.name === 'ComicInfo.xml')).toString('utf8');
        assert.equal(parseComicInfoXml(xml).AgeRating, 'Adults Only 18+');
    });

    for (const existingXml of [false, true]) {
        test(`metadata save accepts ${existingXml ? 'existing XML' : 'API'} AgeRating 19 and preserves page bytes (${extension})`, async t => {
            const filePath = await archiveFixture(t, extension, existingXml ? '19' : undefined);
            const metadata = existingXml ? { Title: 'Updated' }
                : metadataFromApiResult({ metadata: { Title: 'Updated', AgeRating: '19' } }, { bookType: 'comic' });
            const result = await saveMetadataItems([{ filepath: filePath, metadata }]);
            assert.deepEqual(result.stats.error, []);
            assert.equal(result.stats.success.length, 1);
            assert.deepEqual(getOperationErrors(result), []);
            const buffer = await fs.readFile(filePath);
            const entries = listZipEntries(buffer);
            assert.deepEqual(readZipEntry(buffer, entries.find(entry => entry.name === 'pages/001.jpg')), pageBytes);
            const xml = readZipEntry(buffer, entries.find(entry => entry.name === 'ComicInfo.xml')).toString('utf8');
            assert.equal(parseComicInfoXml(xml).Title, 'Updated');
            assert.equal(parseComicInfoXml(xml).AgeRating, 'Adults Only 18+');
            assert.match(xml, /<AgeRating>Adults Only 18\+<\/AgeRating>/);
        });
    }

    for (const source of ['direct', 'API', 'existing XML']) {
        test(`unmapped ${source} age ratings survive repeated saves without changing page bytes (${extension})`, async t => {
            for (const ageRating of customAgeRatings) {
                const filePath = await archiveFixture(t, extension, source === 'existing XML' ? ageRating : undefined);
                let metadata = source === 'existing XML' ? { Title: 'Updated' } : { Title: 'Updated', AgeRating: ageRating };
                if (source === 'API') metadata = metadataFromApiResult({ metadata }, { bookType: 'comic' });
                const item = { filepath: filePath, metadata };
                const result = await saveMetadataItems([item]);
                assert.deepEqual(result.stats.error, []);
                assert.equal(result.stats.success.length, 1);
                assert.deepEqual(getOperationErrors(result), []);
                const buffer = await fs.readFile(filePath);
                const entries = listZipEntries(buffer);
                assert.deepEqual(readZipEntry(buffer, entries.find(entry => entry.name === 'pages/001.jpg')), pageBytes);
                const xml = readZipEntry(buffer, entries.find(entry => entry.name === 'ComicInfo.xml')).toString('utf8');
                assert.equal(parseComicInfoXml(xml).Title, 'Updated');
                assert.equal(parseComicInfoXml(xml).AgeRating, String(ageRating));
                const repeated = await saveMetadataItems([item]);
                assert.deepEqual(repeated.stats.error, []);
                assert.deepEqual(await fs.readFile(filePath), buffer);
            }
        });
    }

    test(`invalid XML characters in age ratings leave source archive bytes intact (${extension})`, async t => {
        for (const ageRating of ['Local\u0000rating', 'Local\u0001rating', 'Local\uFFFE', 'Local\uD800']) {
            const filePath = await archiveFixture(t, extension, 'FSK 16');
            const original = await fs.readFile(filePath);
            const result = await saveMetadataItems([{ filepath: filePath, metadata: { AgeRating: ageRating } }]);
            assert.equal(result.stats.error.length, 1);
            assert.equal(result.stats.success.length, 0);
            assert.equal(getOperationErrors(result)[0].code, 'INVALID_COMICINFO');
            assert.deepEqual(await fs.readFile(filePath), original);
        }
    });
}
