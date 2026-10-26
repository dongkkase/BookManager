import assert from 'node:assert/strict';
import test from 'node:test';
import { createComicInfoXml, parseComicInfoXml, parseComicXmlDocument } from './comicInfoXml.js';
import { readComicMetadata } from './comicMetadataXml.js';

async function read(files) {
    return readComicMetadata(Object.keys(files).map(name => ({ name })), entry => files[entry.name]);
}

test('ComicInfo wins over both legacy formats without reading or merging their fields', async () => {
    const xml = '<?xml version="1.0"?><ComicInfo><Title/><CommunityRating>4</CommunityRating></ComicInfo>';
    const calls = [];
    const result = await readComicMetadata([
        { name: 'ComicBook.xml' }, { name: 'CoMet.xml' }, { name: 'nested\\COMICINFO.XML' },
    ], entry => {
        calls.push(entry.name);
        if (entry.name !== 'nested\\COMICINFO.XML') throw new Error('Legacy XML must not be read.');
        return Buffer.from(xml);
    });
    assert.deepEqual(calls, ['nested\\COMICINFO.XML']);
    assert.equal(result.format, 'comicinfo');
    assert.equal(result.entryName, 'nested\\COMICINFO.XML');
    assert.equal(result.xml, xml);
    assert.equal(result.comicInfoXml, xml);
    assert.deepEqual(result.metadata, { Title: '', CommunityRating: '8' });
});

for (const [fileName, rootName, format] of [
    ['ComicInfo.xml', 'ComicInfo', 'comicinfo'],
    ['ComicBook.xml', 'ComicBook', 'comicbook'],
    ['CoMet.xml', 'comet', 'comet'],
]) {
    test(`${fileName} prefers its root entry over a nested entry and ignores directory entries`, async () => {
        const result = await readComicMetadata([
            { name: fileName, isDir: true },
            { name: `folder/${fileName}` },
            { name: fileName.toUpperCase() },
        ], entry => {
            assert.equal(entry.name, fileName.toUpperCase());
            return `<${rootName}/>`;
        });
        assert.equal(result.format, format);
        assert.equal(result.entryName, fileName.toUpperCase());
    });

    test(`${fileName} accepts a nested backslash path when no root entry exists`, async () => {
        const result = await read({ [`nested\\${fileName.toLowerCase()}`]: `<${rootName}/>` });
        assert.equal(result.format, format);
    });

    test(`${fileName} treats leading dot segments as the root while retaining the archive entry name`, async () => {
        const entryName = `.\\./${fileName.toUpperCase()}`;
        const result = await readComicMetadata([
            { name: `nested/${fileName}` }, { name: entryName },
        ], entry => {
            assert.equal(entry.name, entryName);
            return `<${rootName}/>`;
        });
        assert.equal(result.entryName, entryName);
    });

    for (const [reason, xml] of [
        ['malformed XML', `<${rootName}><Title>broken</${rootName}>`],
        ['wrong root', '<Wrong/>'],
        ['DTD', `<!DOCTYPE ${rootName} [<!ENTITY external SYSTEM "file:///private/source">]><${rootName}/>`],
        ['unsupported encoding', `<?xml version="1.0" encoding="utf-16"?><${rootName}/>`],
        ['empty metadata', '   '],
    ]) {
        test(`${fileName} rejects ${reason} instead of trying a lower-priority file`, async () => {
            let reads = 0;
            await assert.rejects(readComicMetadata([
                { name: fileName }, { name: 'lower/CoMet.xml' },
            ], () => {
                reads += 1;
                return xml;
            }));
            assert.equal(reads, 1);
        });
    }
}

test('ComicBook precedes CoMet and converts inherited fields while retaining original personal data', async () => {
    // ComicRack CE: ComicBook : ComicInfo, with a separate personal Rating property.
    // https://github.com/maforget/ComicRackCE/blob/master/ComicRack.Engine/ComicBook.cs
    const xml = `<ComicBook xmlns:custom="urn:test">
        <Title>A &#38; B</Title><Series>Series</Series><Number>001AU</Number><Volume>2</Volume>
        <Summary><![CDATA[A <B> & C]]></Summary><Writer>Writer</Writer><Translator>Translator</Translator>
        <AgeRating>All Ages</AgeRating><CommunityRating>4.5</CommunityRating><ISBN>9780306406157</ISBN>
        <Pages><Page Image="0" Type="FrontCover" Bookmark="Start" custom:flag="keep" Rotation="Rotate90"/></Pages>
        <Rating>1</Rating><CurrentPage>12</CurrentPage><CustomValuesStore>private=value</CustomValuesStore>
    </ComicBook>`;
    const result = await read({ 'CoMet.xml': '<broken', 'legacy/ComicBook.xml': xml });
    assert.equal(result.format, 'comicbook');
    assert.equal(result.xml, xml);
    assert.deepEqual(result.metadata, {
        Title: 'A & B', Series: 'Series', Number: '001AU', Volume: '2', Summary: 'A <B> & C',
        Writer: 'Writer', Translator: 'Translator', AgeRating: 'Everyone', CommunityRating: '9', GTIN: '9780306406157',
    });
    const saved = createComicInfoXml({ ...result.metadata, Title: 'Changed' }, result.comicInfoXml);
    assert.match(saved, /<CommunityRating>4\.5<\/CommunityRating>/);
    assert.match(saved, /Bookmark="Start"/);
    assert.match(saved, /custom:flag="keep"/);
    assert.match(saved, /Rotation="Rotate90"/);
    assert.doesNotMatch(saved, /<Rating>|CurrentPage|CustomValuesStore|private=value/);
    const root = parseComicXmlDocument(saved).documentElement;
    const page = root.getElementsByTagName('Page')[0];
    assert.equal(page.getAttributeNS('urn:test', 'flag'), 'keep');
    assert.equal(result.xml, xml);
});

test('ComicBook preserves GTIN ahead of ISBN and does not use a personal Rating as CommunityRating', async () => {
    const result = await read({
        'ComicBook.xml': '<ComicBook><GTIN>existing</GTIN><ISBN>9780306406157</ISBN><Rating>5</Rating></ComicBook>',
    });
    assert.deepEqual(result.metadata, { GTIN: 'existing' });
    for (const [rating, expected] of [['0', '0'], ['2', '4'], ['5', '10']]) {
        const converted = await read({ 'ComicBook.xml': `<ComicBook><CommunityRating>${rating}</CommunityRating></ComicBook>` });
        assert.equal(converted.metadata.CommunityRating, expected);
    }
    for (const rating of ['-1', '5.1', '8', 'NaN']) {
        await assert.rejects(read({ 'ComicBook.xml': `<ComicBook><CommunityRating>${rating}</CommunityRating></ComicBook>` }), /0 to 5/);
    }
});

test('CoMet maps repeated credits, publication date and age rating without inventing a community rating', async () => {
    // https://github.com/comictagger/comictagger/blob/1.5.5/comicapi/comet.py
    const xml = `<comet xmlns:comet="http://www.denvog.com/comet/">
        <title>Title &amp; Subtitle</title><series>Series</series><issue>012AU</issue><volume>3</volume>
        <description><![CDATA[Description <inside>]]></description><publisher>Publisher</publisher><pages>24</pages>
        <format>Digital</format><language>en</language><rating>Teen</rating><date>2025-02-03</date>
        <writer>First Writer</writer><writer>Second Writer</writer><penciller>Artist</penciller>
        <inker>Inker</inker><colorist>Colorist</colorist><letterer>Letterer</letterer>
        <coverDesigner>Cover Artist</coverDesigner><editor>Editor</editor>
        <genre>Fantasy</genre><genre>Adventure</genre><character>One</character><character>Two</character>
        <readingDirection>rtl</readingDirection><identifier>ISBN: 978-0-306-40615-7</identifier>
        <price>4.99</price><rights>Copyright</rights><lastMark>12</lastMark><coverImage>cover.jpg</coverImage>
    </comet>`;
    const result = await read({ 'CoMet.xml': Buffer.from(xml) });
    assert.equal(result.xml, xml);
    assert.deepEqual(result.metadata, {
        Title: 'Title & Subtitle', Series: 'Series', Number: '012AU', Volume: '3',
        Summary: 'Description <inside>', Year: '2025', Month: '2', Day: '3', Writer: 'First Writer, Second Writer',
        Penciller: 'Artist', Inker: 'Inker', Colorist: 'Colorist', Letterer: 'Letterer',
        CoverArtist: 'Cover Artist', Editor: 'Editor', Publisher: 'Publisher', Genre: 'Fantasy, Adventure',
        PageCount: '24', LanguageISO: 'en', Format: 'Digital', Manga: 'YesAndRightToLeft',
        Characters: 'One, Two', AgeRating: 'Teen', GTIN: '9780306406157',
    });
    const saved = createComicInfoXml(result.metadata, result.comicInfoXml);
    assert.deepEqual(parseComicInfoXml(saved), result.metadata);
    assert.doesNotMatch(saved, /CommunityRating|lastMark|price|rights|coverImage/);
});

test('CoMet identifiers require a valid ISBN or GTIN checksum', async () => {
    for (const [identifier, expected] of [
        ['urn:isbn:9780306406157', '9780306406157'],
        ['ISBN-10: 0-306-40615-2', '0306406152'],
        ['UPC: 012345678905', '012345678905'],
        ['9780306406158', undefined], ['external:123', undefined], ['https://example.com/book', undefined],
    ]) {
        const result = await read({ 'CoMet.xml': `<comet><identifier>${identifier}</identifier></comet>` });
        assert.equal(result.metadata.GTIN, expected);
    }
});

test('CoMet XML 1.1 with schema declarations converts to a ComicInfo XML 1.0 document', async () => {
    const xml = '<?xml version="1.1" encoding="UTF-8"?>\n'
        + '<comet xmlns:comet="http://www.denvog.com/comet/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.denvog.com http://www.denvog.com/comet/comet.xsd">'
        + '<title>Schema example</title></comet>';
    const result = await read({ 'CoMet.xml': xml });
    assert.equal(result.xml, xml);
    assert.equal(result.metadata.Title, 'Schema example');
    assert.match(result.comicInfoXml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
    const saved = createComicInfoXml(result.metadata, result.comicInfoXml);
    assert.match(saved, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.doesNotMatch(saved, /schemaLocation/);
    assert.equal(parseComicInfoXml(saved).Title, 'Schema example');
});

test('CoMet accepts year or year-month and leaves unspecified reading direction unset', async () => {
    for (const [date, expected] of [['2024', { Year: '2024' }], ['2024-09', { Year: '2024', Month: '9' }]]) {
        const result = await read({ 'CoMet.xml': `<comet><date>${date}</date></comet>` });
        assert.deepEqual(result.metadata, expected);
    }
    await assert.rejects(read({ 'CoMet.xml': '<comet><date>2024-13-02</date></comet>' }), /publication date/);
});

test('CoMet explicit reading direction survives conversion and repeated ComicInfo saves', async () => {
    for (const [direction, expected] of [
        ['ltr', 'No'], [' LTR ', 'No'], ['rtl', 'YesAndRightToLeft'], ['', undefined], ['unknown', undefined],
    ]) {
        const result = await read({ 'CoMet.xml': `<comet><readingDirection>${direction}</readingDirection></comet>` });
        assert.equal(result.metadata.Manga, expected, direction);
        const saved = createComicInfoXml(result.metadata, result.comicInfoXml);
        assert.equal(parseComicInfoXml(saved).Manga, expected, direction);
        assert.equal(createComicInfoXml(parseComicInfoXml(saved), saved), saved);
    }
});

test('unknown legacy age labels survive conversion and subsequent ComicInfo saves', async () => {
    for (const [fileName, xml] of [
        ['ComicBook.xml', '<ComicBook><AgeRating>Custom 13+</AgeRating></ComicBook>'],
        ['CoMet.xml', '<comet><rating>Custom 13+</rating></comet>'],
    ]) {
        const result = await read({ [fileName]: xml });
        assert.equal(result.metadata.AgeRating, 'Custom 13+');
        const saved = createComicInfoXml(result.metadata, result.comicInfoXml);
        assert.equal(parseComicInfoXml(saved).AgeRating, 'Custom 13+');
        const edited = createComicInfoXml({ Title: 'Updated' }, saved);
        assert.deepEqual(parseComicInfoXml(edited), { Title: 'Updated', AgeRating: 'Custom 13+' });
        assert.equal(createComicInfoXml(parseComicInfoXml(edited), edited), edited);
    }
});

test('duplicate scalar fields are rejected but harmless declaration-like text remains readable', async () => {
    await assert.rejects(read({ 'ComicBook.xml': '<ComicBook><Title>One</Title><title>Two</title></ComicBook>' }), /Duplicate/);
    await assert.rejects(read({ 'CoMet.xml': '<comet><title>One</title><title>Two</title></comet>' }), /Duplicate/);
    const result = await read({ 'CoMet.xml': '<comet><description><![CDATA[<!DOCTYPE example>]]></description></comet>' });
    assert.equal(result.metadata.Summary, '<!DOCTYPE example>');
});

test('unrelated XML and directory-only names are ignored, while failed selected reads are surfaced', async () => {
    assert.equal(await read({ 'metadata.xml': '<comet/>', 'Book.cbz.xml': '<ComicBook/>' }), null);
    assert.equal(await readComicMetadata([{ name: 'ComicInfo.xml', isDirectory: true }], () => { throw new Error('Not a file'); }), null);
    await assert.rejects(readComicMetadata([{ name: 'ComicBook.xml' }], () => null), /could not be read/);
    await assert.rejects(readComicMetadata([{ name: 'CoMet.xml' }], () => { throw new Error('Archive read failed'); }), /Archive read failed/);
});
