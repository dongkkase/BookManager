import { XMLSerializer } from '@xmldom/xmldom';
import { parseComicInfoXml, parseComicXmlDocument } from './comicInfoXml.js';
import { COMICINFO_FIELDS, normalizeComicInfoAgeRating } from '../src/metadata/comicInfoPolicy.js';

const formats = [
    { format: 'comicinfo', fileName: 'ComicInfo.xml', rootName: 'ComicInfo' },
    { format: 'comicbook', fileName: 'ComicBook.xml', rootName: 'ComicBook' },
    { format: 'comet', fileName: 'CoMet.xml', rootName: 'comet' },
];
const serializer = new XMLSerializer();
const comicInfoNames = new Map(COMICINFO_FIELDS.map(name => [name.toLowerCase(), name]));
const cometFields = {
    title: 'Title', series: 'Series', issue: 'Number', volume: 'Volume',
    description: 'Summary', publisher: 'Publisher', pages: 'PageCount',
    format: 'Format', language: 'LanguageISO', rating: 'AgeRating',
    genre: 'Genre', character: 'Characters', writer: 'Writer', penciller: 'Penciller',
    inker: 'Inker', colorist: 'Colorist', letterer: 'Letterer',
    coverdesigner: 'CoverArtist', editor: 'Editor',
};
const cometRepeatedFields = new Set([
    'genre', 'character', 'writer', 'penciller', 'inker', 'colorist', 'letterer', 'coverdesigner', 'editor',
]);

function invalid(fileName, message) {
    return Object.assign(new Error(`${fileName}: ${message}`), { code: 'INVALID_COMIC_METADATA' });
}

function normalizeEntryName(entry) {
    return String(entry.name || '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

function selectEntry(entries) {
    for (const format of formats) {
        const basename = format.fileName.toLowerCase();
        const candidates = entries.filter(entry => !entry.isDir && !entry.isDirectory
            && normalizeEntryName(entry).split('/').pop().toLowerCase() === basename);
        const entry = candidates.find(candidate => normalizeEntryName(candidate).toLowerCase() === basename)
            || candidates[0];
        if (entry) return { entry, ...format };
    }
    return null;
}

function childFields(root, names, repeated, fileName) {
    const fields = new Map();
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType !== 1 || node.namespaceURI) continue;
        const name = node.localName.toLowerCase();
        if (!names.has(name)) continue;
        if (fields.has(name) && !repeated.has(name)) throw invalid(fileName, `Duplicate ${node.localName} elements.`);
        if (!fields.has(name)) fields.set(name, []);
        fields.get(name).push(node);
    }
    return fields;
}

function textValue(fields, name) {
    return fields.get(name)?.[0].textContent.trim();
}

function buildComicInfo(values, pages, sourceRoot) {
    const document = parseComicXmlDocument('<ComicInfo/>');
    const root = document.documentElement;
    for (const attribute of Array.from(sourceRoot.attributes)) {
        if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/' && attribute.name !== 'xmlns') {
            root.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        }
    }
    for (const name of COMICINFO_FIELDS) {
        if (name === 'Pages') {
            if (pages) root.appendChild(document.importNode(pages, true));
            continue;
        }
        if (!Object.hasOwn(values, name)) continue;
        const element = document.createElement(name);
        const value = name === 'AgeRating' ? normalizeComicInfoAgeRating(values[name]) ?? values[name] : values[name];
        element.appendChild(document.createTextNode(value));
        root.appendChild(element);
    }
    return `<?xml version="1.0" encoding="utf-8"?>\n${serializer.serializeToString(document)}\n`;
}

function convertComicBook(root) {
    // ComicRack CE ComicBook inherits ComicInfo; Rating and reading state are separate library data.
    const fields = childFields(root, new Set([...comicInfoNames.keys(), 'isbn']), new Set(), 'ComicBook.xml');
    const values = {};
    for (const [name, canonical] of comicInfoNames) {
        if (canonical !== 'Pages' && fields.has(name)) values[canonical] = textValue(fields, name);
    }
    if (!values.GTIN && fields.has('isbn')) values.GTIN = textValue(fields, 'isbn');
    if (values.CommunityRating) {
        const value = values.CommunityRating;
        const rating = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
        if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
            throw invalid('ComicBook.xml', 'CommunityRating requires a value from 0 to 5.');
        }
        values.CommunityRating = String(rating);
    }
    return buildComicInfo(values, fields.get('pages')?.[0], root);
}

function convertCoMet(root) {
    // CoMet rating is an age classification, not a numerical community or personal rating.
    const names = new Set([...Object.keys(cometFields), 'date', 'readingdirection', 'identifier']);
    const fields = childFields(root, names, cometRepeatedFields, 'CoMet.xml');
    const values = {};
    for (const [source, target] of Object.entries(cometFields)) {
        if (!fields.has(source)) continue;
        values[target] = cometRepeatedFields.has(source)
            ? fields.get(source).map(node => node.textContent.trim()).filter(Boolean).join(', ')
            : textValue(fields, source);
    }
    const date = textValue(fields, 'date');
    if (date) {
        const parts = date.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
        if (!parts || (parts[2] && (Number(parts[2]) < 1 || Number(parts[2]) > 12))
            || (parts[3] && (Number(parts[3]) < 1 || Number(parts[3]) > 31))) {
            throw invalid('CoMet.xml', 'Unsupported publication date.');
        }
        for (const [index, name] of ['Year', 'Month', 'Day'].entries()) {
            if (parts[index + 1]) values[name] = String(Number(parts[index + 1]));
        }
    }
    if (textValue(fields, 'readingdirection')?.toLowerCase() === 'rtl') values.Manga = 'YesAndRightToLeft';
    const gtin = productIdentifier(textValue(fields, 'identifier'));
    if (gtin) values.GTIN = gtin;
    return buildComicInfo(values, null, root);
}

function productIdentifier(value = '') {
    const identifier = value.replace(/^(?:urn:isbn:|(?:ISBN(?:-10|-13)?|GTIN(?:-8|-12|-13|-14)?|UPC(?:-A)?)\s*:?\s*)/i, '')
        .replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{9}[\dX]$/.test(identifier)) {
        const sum = [...identifier].reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
        return sum % 11 === 0 ? identifier : '';
    }
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(identifier)) return '';
    const sum = [...identifier].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? identifier : '';
}

export async function readComicMetadata(entries, readEntry) {
    const selected = selectEntry(entries);
    if (!selected) return null;
    const content = await readEntry(selected.entry);
    if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
        throw invalid(selected.fileName, 'Metadata could not be read.');
    }
    const xml = Buffer.isBuffer(content) ? content.toString('utf8') : content;
    if (!xml.trim()) throw invalid(selected.fileName, 'Metadata is empty.');
    let comicInfoXml = xml;
    if (selected.format !== 'comicinfo') {
        const document = parseComicXmlDocument(xml, { rootName: selected.rootName, fileName: selected.fileName });
        comicInfoXml = selected.format === 'comicbook'
            ? convertComicBook(document.documentElement) : convertCoMet(document.documentElement);
    }
    return {
        format: selected.format,
        entryName: selected.entry.name,
        xml,
        metadata: parseComicInfoXml(comicInfoXml),
        comicInfoXml,
    };
}
