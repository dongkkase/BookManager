import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createComicInfoXml, parseComicInfoXml, updateComicInfoRating } from './comicInfoXml.js';

const schema = new DOMParser().parseFromString(
    fs.readFileSync(new URL('./fixtures/comicinfo-v2.1/ComicInfo.xsd', import.meta.url), 'utf8'),
    'application/xml',
);
const schemaTypes = [...schema.getElementsByTagName('xs:complexType')];
const schemaFields = [...schemaTypes.find(node => node.getAttribute('name') === 'ComicInfo')
    .getElementsByTagName('xs:element')];

function root(xml) {
    return new DOMParser().parseFromString(xml, 'application/xml').documentElement;
}

function elementXml(xml, name) {
    return new XMLSerializer().serializeToString(root(xml).getElementsByTagName(name)[0]);
}

test('all ComicInfo 2.1 fields follow the upstream schema order and scalar types', () => {
    const metadata = Object.fromEntries(schemaFields.filter(node => node.getAttribute('name') !== 'Pages')
        .map(node => {
            const name = node.getAttribute('name');
            const type = node.getAttribute('type');
            const value = type === 'xs:int' ? '2' : ({ Manga: 'Unknown', YesNo: 'No', AgeRating: 'Teen', Rating: '9' }[type] || `${name} & 한글`);
            return [name, value];
        }));
    metadata.Number = '1AU';
    const xml = createComicInfoXml(metadata, '<ComicInfo><Pages><Page Image="0" Type="FrontCover" Bookmark="Cover"/></Pages></ComicInfo>');
    const children = [...root(xml).childNodes].filter(node => node.nodeType === 1);
    assert.deepEqual(children.map(node => node.nodeName), schemaFields.map(node => node.getAttribute('name')));
    assert.equal(children.length, 44);
    assert.deepEqual(parseComicInfoXml(xml), metadata);
    assert.equal(root(xml).getElementsByTagName('CommunityRating')[0].textContent, '4.5');
    assert.equal(createComicInfoXml(parseComicInfoXml(xml), xml), xml);
    assert.doesNotMatch(xml, /ComicZipAddedDate|ComicZipModifiedDate|schemaLocation/);
});

test('all upstream AgeRating enum values round trip and old labels become canonical', () => {
    const ageType = [...schema.getElementsByTagName('xs:simpleType')].find(node => node.getAttribute('name') === 'AgeRating');
    for (const node of ageType.getElementsByTagName('xs:enumeration')) {
        const rating = node.getAttribute('value');
        assert.equal(parseComicInfoXml(createComicInfoXml({ AgeRating: rating })).AgeRating, rating);
    }
    for (const [input, expected] of [['All Ages', 'Everyone'], ['Young Adult / Teen', 'Teen'], ['Older Teen / Mature', 'Mature 17+'], ['19세 이용가', 'Adults Only 18+']]) {
        assert.equal(parseComicInfoXml(createComicInfoXml({ AgeRating: input })).AgeRating, expected);
    }
    assert.equal(parseComicInfoXml(createComicInfoXml({ AgeRating: 'Unrecognized' })).AgeRating, 'Unrecognized');
});

test('Manga preserves standard values and accepts the BookManager Webtoon extension independently of Format', () => {
    for (const manga of ['Unknown', 'No', 'Yes', 'YesAndRightToLeft', 'Webtoon']) {
        const xml = createComicInfoXml({ Manga: ` ${manga.toLowerCase()} `, Format: 'GraphicNovel' });
        assert.deepEqual(parseComicInfoXml(xml), { Format: 'GraphicNovel', Manga: manga });
        assert.equal(createComicInfoXml(parseComicInfoXml(xml), xml), xml);
    }
    const original = '<ComicInfo><Format>Digital</Format><Manga>wEbToOn</Manga></ComicInfo>';
    const updated = createComicInfoXml({ Title: 'Updated' }, original);
    assert.deepEqual(parseComicInfoXml(updated), { Title: 'Updated', Format: 'Digital', Manga: 'Webtoon' });
    assert.deepEqual(parseComicInfoXml(createComicInfoXml({ Format: 'Webtoon', Manga: 'No' })), {
        Format: 'Webtoon', Manga: 'No',
    });
    assert.equal(parseComicInfoXml(createComicInfoXml({ Manga: '' }, updated)).Manga, undefined);
    assert.throws(() => createComicInfoXml({ Manga: 'Webtoon Special' }), /Unsupported Manga/);
    assert.throws(() => createComicInfoXml({ BlackAndWhite: 'Webtoon' }), /Unsupported BlackAndWhite/);
});

test('XML five-point ratings convert once, including decimal lexical forms and legacy values', () => {
    for (const [stored, app, written] of [
        ['0', '0', '0'], ['.5', '1', '0.5'], ['+4.5', '9', '4.5'], ['5.', '10', '5'],
        ['-0', '0', '0'], ['2.5', '5', '2.5'], ['8', '8', '4'], ['10', '10', '5'],
    ]) {
        const original = `<ComicInfo><CommunityRating>${stored}</CommunityRating></ComicInfo>`;
        const metadata = parseComicInfoXml(original);
        assert.equal(metadata.CommunityRating, app);
        const xml = createComicInfoXml(metadata, original);
        assert.equal(root(xml).getElementsByTagName('CommunityRating')[0].textContent, written);
        assert.equal(createComicInfoXml(parseComicInfoXml(xml), xml), xml);
    }
    assert.match(createComicInfoXml({ CommunityRating: '8.75' }), /<CommunityRating>4.4<\/CommunityRating>/);
    for (const value of ['-1', '11', 'NaN', '1e1', '4 stars']) {
        assert.throws(() => createComicInfoXml({ CommunityRating: value }), /CommunityRating/);
    }
});

test('partial edits preserve Pages, extensions, namespaces, attributes, CDATA and old timestamps', () => {
    const original = `<ComicInfo xmlns:ce="urn:ce" ce:version="1">
        <Title ce:source="tagger">Old</Title>
        <Summary><![CDATA[encoding="latin1" and <!DOCTYPE example> are prose]]></Summary>
        <Pages><Page Image="0" Type="FrontCover" DoublePage="true" ImageSize="1234" ImageWidth="800" ImageHeight="1200" Key="cover" Bookmark="Start" ce:flag="keep"/></Pages>
        <ce:Title>Extension title</ce:Title>
        <Extra encoding="base64"><Nested a="b">abc</Nested></Extra>
        <!-- retained comment -->
        <ComicZipAddedDate>2020-01-01</ComicZipAddedDate>
        <ComicZipModifiedDate>2020-01-02</ComicZipModifiedDate>
    </ComicInfo>`;
    const xml = createComicInfoXml({ Title: 'New & 한글' }, original);
    for (const name of ['Pages', 'Summary', 'ce:Title', 'Extra', 'ComicZipAddedDate', 'ComicZipModifiedDate']) {
        assert.equal(elementXml(xml, name), elementXml(original, name));
    }
    assert.match(xml, /ce:version="1"/);
    assert.match(xml, /<Title ce:source="tagger">New &amp; 한글<\/Title>/);
    assert.match(xml, /<!-- retained comment -->/);
    assert.equal(parseComicInfoXml(xml).Title, 'New & 한글');
    assert.equal(createComicInfoXml({}, xml), xml);
    const cleared = createComicInfoXml({ Title: '', Summary: null }, xml);
    assert.equal(parseComicInfoXml(cleared).Title, undefined);
    assert.equal(parseComicInfoXml(cleared).Summary, undefined);
    assert.match(cleared, /<ce:Title>Extension title<\/ce:Title>/);
});

test('XML entities and supplementary Unicode are decoded without mistaking nested custom fields for standard fields', () => {
    const xml = '<ComicInfo><Title>A &#38; B &#xD55C; &#x1F4DA;</Title><Custom><Writer>Hidden</Writer></Custom></ComicInfo>';
    assert.deepEqual(parseComicInfoXml(xml), { Title: 'A & B 한 📚' });
    assert.equal(parseComicInfoXml(createComicInfoXml(parseComicInfoXml(xml), xml)).Title, 'A & B 한 📚');
});

test('invalid or ambiguous XML is rejected before it can be rewritten', () => {
    for (const xml of [
        '<ComicInfo><Title>Missing close</ComicInfo>',
        '<ComicInfo/><ComicInfo/>',
        '<ComicInfo><Title>A</Title><title>B</title></ComicInfo>',
        '<ComicInfo xmlns="urn:unsupported"/>',
        '<!DOCTYPE ComicInfo SYSTEM "file:///etc/passwd"><ComicInfo/>',
        '<!DOCTYPE ComicInfo [<!ENTITY test "value">]><ComicInfo><Title>&test;</Title></ComicInfo>',
        '<?xml version="1.0" encoding="utf-16"?><ComicInfo/>',
    ]) {
        assert.throws(() => createComicInfoXml({ Title: 'New' }, xml));
    }
    for (const value of ['1.5', '2147483648', '1e2']) {
        assert.throws(() => createComicInfoXml({ Volume: value }), /integer/);
    }
    assert.throws(() => createComicInfoXml({ Title: 'Invalid\u0001' }), /XML characters/);
    assert.throws(() => createComicInfoXml({ Title: '\ud800' }), /XML characters/);
});

test('rating-only updates preserve unrelated legacy scalar values and extensions', () => {
    const xml = updateComicInfoRating('<ComicInfo><Volume>1.5</Volume><AgeRating>Unrecognized</AgeRating><Extra>keep</Extra></ComicInfo>', '7');
    assert.match(xml, /<CommunityRating>3.5<\/CommunityRating>/);
    assert.match(xml, /<Volume>1.5<\/Volume>/);
    assert.match(xml, /<AgeRating>Unrecognized<\/AgeRating>/);
    assert.match(xml, /<Extra>keep<\/Extra>/);
});
