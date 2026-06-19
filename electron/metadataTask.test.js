import test from 'node:test';
import assert from 'node:assert/strict';
import { createComicInfoXml, parseComicInfo } from './tasks/metadataTask.js';

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
