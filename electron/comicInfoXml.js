import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
    COMICINFO_FIELDS,
    appRatingToComicInfo,
    comicInfoRatingToApp,
    normalizeComicInfoAgeRating,
} from '../src/metadata/comicInfoPolicy.js';

const fieldNames = new Map(COMICINFO_FIELDS.map(field => [field.toLowerCase(), field]));
const legacyDates = new Set(['ComicZipAddedDate', 'ComicZipModifiedDate']);
const integerFields = new Set(['Count', 'Volume', 'AlternateCount', 'Year', 'Month', 'Day', 'PageCount']);
const serializer = new XMLSerializer();
export const COMICINFO_CACHE_VERSION = 2;

function invalid(message, fileName = 'ComicInfo.xml') {
    return Object.assign(new Error(`${fileName}: ${message}`), { code: 'INVALID_COMICINFO' });
}

export function parseComicXmlDocument(xml, { rootName = 'ComicInfo', fileName = 'ComicInfo.xml' } = {}) {
    const invalidXml = message => invalid(message, fileName);
    const source = String(xml || '').replace(/^\uFEFF/, '');
    const markup = source.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
    if (/<!DOCTYPE|<!ENTITY/i.test(markup)) throw invalidXml('DTD and entity declarations are unsupported.');
    const declaration = source.match(/^<\?xml\s[\s\S]*?\?>/i)?.[0] || '';
    if (/encoding\s*=\s*["'](?!utf-?8["'])/i.test(declaration)) throw invalidXml('UTF-8 encoding is required.');
    const document = new DOMParser({ onError: (_level, message) => { throw invalidXml(message); } })
        .parseFromString(source, 'application/xml');
    const root = document.documentElement;
    if (!root || root.localName.toLowerCase() !== rootName.toLowerCase() || root.namespaceURI) {
        throw invalidXml(`An unqualified ${rootName} root is required.`);
    }
    if (Array.from(document.childNodes).some(node => node.nodeType === 3 && node.nodeValue.trim())) {
        throw invalidXml('Unexpected text outside the root.');
    }
    return document;
}

function knownFields(root) {
    const fields = new Map();
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType !== 1 || node.namespaceURI) continue;
        const name = fieldNames.get(node.localName.toLowerCase());
        if (!name) continue;
        if (fields.has(name)) throw invalid(`Duplicate ${name} elements.`);
        fields.set(name, node);
    }
    return fields;
}

export function parseComicInfoXml(xml) {
    if (!String(xml || '').trim()) return {};
    const root = parseComicXmlDocument(xml).documentElement;
    const metadata = {};
    for (const [field, node] of knownFields(root)) {
        if (field === 'Pages') continue;
        const value = node.textContent.trim();
        metadata[field] = field === 'CommunityRating' ? comicInfoRatingToApp(value)
            : field === 'AgeRating' ? normalizeComicInfoAgeRating(value) ?? value : value;
    }
    for (const node of Array.from(root.childNodes)) {
        if (node.nodeType === 1 && !node.namespaceURI && legacyDates.has(node.nodeName)) {
            metadata[node.nodeName] = node.textContent.trim();
        }
    }
    return metadata;
}

function fieldValue(field, input) {
    const value = String(input ?? '').trim();
    if (!value) return '';
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value)) {
        throw invalid(`${field} contains invalid XML characters.`);
    }
    if (field === 'CommunityRating') return appRatingToComicInfo(value);
    if (field === 'AgeRating') {
        return normalizeComicInfoAgeRating(value) ?? value;
    }
    if (integerFields.has(field)) {
        const number = Number(value);
        if (!/^[+-]?\d+$/.test(value) || !Number.isInteger(number) || number < -2147483648 || number > 2147483647) {
            throw invalid(`${field} requires an integer.`);
        }
        return String(number);
    }
    if (field === 'BlackAndWhite' || field === 'Manga') {
        // Webtoon is BookManager's reading-mode extension to the standard Manga values.
        const options = field === 'Manga' ? ['Unknown', 'No', 'Yes', 'YesAndRightToLeft', 'Webtoon'] : ['Unknown', 'No', 'Yes'];
        const normalized = options.find(option => option.toLowerCase() === value.toLowerCase());
        if (!normalized) throw invalid(`Unsupported ${field}: ${value}`);
        return normalized;
    }
    return value;
}

function canonicalElement(document, node, name) {
    if (node.nodeName === name) return node;
    const replacement = document.createElement(name);
    for (const attribute of Array.from(node.attributes)) {
        replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
    while (node.firstChild) replacement.appendChild(node.firstChild);
    node.parentNode.replaceChild(replacement, node);
    return replacement;
}

function setField(document, fields, field, value) {
    let node = fields.get(field);
    if (value === '') {
        if (node) node.parentNode.removeChild(node);
        fields.delete(field);
        return;
    }
    if (!node) {
        node = document.createElement(field);
        document.documentElement.appendChild(node);
    } else {
        node = canonicalElement(document, node, field);
    }
    if (node.textContent !== value) {
        while (node.firstChild) node.removeChild(node.firstChild);
        node.appendChild(document.createTextNode(value));
    }
    fields.set(field, node);
}

function serialize(document, fields) {
    const root = canonicalElement(document, document.documentElement, 'ComicInfo');
    const existing = Array.from(root.childNodes);
    const standardNodes = new Set(fields.values());
    const extensions = existing.filter(node => !standardNodes.has(node)
        && !(node.nodeType === 3 && !node.nodeValue.trim()));
    for (const node of existing) root.removeChild(node);
    for (const node of [...COMICINFO_FIELDS.map(field => fields.get(field)).filter(Boolean), ...extensions]) {
        root.appendChild(document.createTextNode('\n    '));
        root.appendChild(node);
    }
    root.appendChild(document.createTextNode('\n'));
    for (const node of Array.from(document.childNodes)) {
        if (node.nodeType === 7 && node.target.toLowerCase() === 'xml') document.removeChild(node);
        else if (node.nodeType === 3 && !node.nodeValue.trim()) document.removeChild(node);
    }
    return `<?xml version="1.0" encoding="utf-8"?>\n${serializer.serializeToString(document)}\n`;
}

export function createComicInfoXml(metadata = {}, existingXml = '') {
    const document = parseComicXmlDocument(existingXml || '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"/>');
    const fields = knownFields(document.documentElement);
    for (const field of COMICINFO_FIELDS) {
        if (field === 'Pages') continue;
        if (Object.hasOwn(metadata, field) && metadata[field] !== undefined) {
            setField(document, fields, field, fieldValue(field, metadata[field]));
        } else if (fields.has(field)) {
            const stored = fields.get(field).textContent.trim();
            const input = field === 'CommunityRating' ? comicInfoRatingToApp(stored) : stored;
            setField(document, fields, field, fieldValue(field, input));
        }
    }
    return serialize(document, fields);
}

export function updateComicInfoRating(existingXml, appRating) {
    const document = parseComicXmlDocument(existingXml || '<ComicInfo/>');
    const fields = knownFields(document.documentElement);
    setField(document, fields, 'CommunityRating', appRatingToComicInfo(appRating));
    return serialize(document, fields);
}
