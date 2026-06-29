import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';

const PDF_INFO_FIELDS = [
    'Title',
    'Author',
    'Subject',
    'Keywords',
    'Creator',
    'Producer',
    'CreationDate',
    'ModDate',
    'Trapped',
];

const PDF_NAME_ESCAPE = /#([0-9a-fA-F]{2})/g;
const STREAM_SCAN_LIMIT = 220 * 1024 * 1024;

function normalizeMetadataText(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeXmlEntities(value = '') {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function encodeXml(value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decodePdfName(value = '') {
    return String(value || '').replace(PDF_NAME_ESCAPE, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function isWhitespace(char = '') {
    return /\s/.test(char);
}

function skipWhitespace(text = '', index = 0) {
    let nextIndex = index;
    while (nextIndex < text.length && isWhitespace(text[nextIndex])) nextIndex += 1;
    return nextIndex;
}

function decodeUtf16Be(buffer) {
    let result = '';
    for (let index = 0; index + 1 < buffer.length; index += 2) {
        result += String.fromCharCode(buffer.readUInt16BE(index));
    }
    return result;
}

function decodePdfHexString(raw = '') {
    const clean = String(raw || '').replace(/[^0-9a-fA-F]/g, '');
    const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
    const buffer = Buffer.from(padded, 'hex');
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        return decodeUtf16Be(buffer.subarray(2));
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString('utf16le');
    }
    return buffer.toString('utf8').replace(/\0/g, '').trim();
}

function parsePdfLiteralString(text = '', startIndex = 0) {
    let depth = 1;
    let index = startIndex + 1;
    let value = '';

    while (index < text.length && depth > 0) {
        const char = text[index];
        if (char === '\\') {
            const next = text[index + 1] || '';
            if (next === '\r' && text[index + 2] === '\n') {
                index += 3;
                continue;
            }
            if (next === '\n' || next === '\r') {
                index += 2;
                continue;
            }
            const mapped = {
                n: '\n',
                r: '\r',
                t: '\t',
                b: '\b',
                f: '\f',
                '(': '(',
                ')': ')',
                '\\': '\\',
            }[next];
            if (mapped !== undefined) {
                value += mapped;
                index += 2;
                continue;
            }
            const octal = text.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] || '';
            if (octal) {
                value += String.fromCharCode(Number.parseInt(octal, 8));
                index += 1 + octal.length;
                continue;
            }
            value += next;
            index += 2;
            continue;
        }
        if (char === '(') {
            depth += 1;
            value += char;
            index += 1;
            continue;
        }
        if (char === ')') {
            depth -= 1;
            if (depth > 0) value += char;
            index += 1;
            continue;
        }
        value += char;
        index += 1;
    }

    const rawBuffer = Buffer.from(value, 'binary');
    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xfe && rawBuffer[1] === 0xff) {
        return { value: decodeUtf16Be(rawBuffer.subarray(2)), endIndex: index };
    }
    if (rawBuffer.length >= 2 && rawBuffer[0] === 0xff && rawBuffer[1] === 0xfe) {
        return { value: rawBuffer.subarray(2).toString('utf16le'), endIndex: index };
    }
    return { value, endIndex: index };
}

function pdfValueAfterKey(dict = '', key = '') {
    const keyMatch = new RegExp(`/${key}\\b`).exec(dict);
    if (!keyMatch) return '';
    let index = skipWhitespace(dict, keyMatch.index + keyMatch[0].length);
    const char = dict[index];
    if (char === '(') return parsePdfLiteralString(dict, index).value;
    if (char === '<' && dict[index + 1] !== '<') {
        const endIndex = dict.indexOf('>', index + 1);
        if (endIndex < 0) return '';
        return decodePdfHexString(dict.slice(index + 1, endIndex));
    }
    if (char === '/') {
        const match = dict.slice(index + 1).match(/^[^\s<>\[\]\(\)\/%]+/);
        return decodePdfName(match?.[0] || '');
    }
    const token = dict.slice(index).match(/^[^\s<>\[\]\(\)\/%]+/)?.[0] || '';
    return token;
}

function findMatchingDictionaryEnd(text = '', startIndex = 0) {
    let depth = 0;
    let index = startIndex;
    while (index < text.length - 1) {
        if (text[index] === '(') {
            index = parsePdfLiteralString(text, index).endIndex;
            continue;
        }
        if (text[index] === '<' && text[index + 1] === '<') {
            depth += 1;
            index += 2;
            continue;
        }
        if (text[index] === '>' && text[index + 1] === '>') {
            depth -= 1;
            index += 2;
            if (depth === 0) return index;
            continue;
        }
        index += 1;
    }
    return -1;
}

function findObjectDictionary(text = '', objectNumber = 0, generation = 0) {
    if (!objectNumber) return '';
    const objectPattern = new RegExp(`\\b${objectNumber}\\s+${generation}\\s+obj\\b`, 'g');
    const objectMatch = objectPattern.exec(text);
    if (!objectMatch) return '';
    const dictStart = text.indexOf('<<', objectMatch.index);
    const objectEnd = text.indexOf('endobj', objectMatch.index);
    if (dictStart < 0 || objectEnd < dictStart) return '';
    const dictEnd = findMatchingDictionaryEnd(text, dictStart);
    if (dictEnd < 0 || dictEnd > objectEnd) return '';
    return text.slice(dictStart, dictEnd);
}

function parseTrailer(buffer) {
    const text = buffer.toString('latin1');
    const startXrefMatches = [...text.matchAll(/startxref\s+(\d+)/g)];
    const startXref = Number(startXrefMatches.at(-1)?.[1]) || 0;
    const trailerIndex = startXrefMatches.length > 0
        ? text.lastIndexOf('trailer', startXrefMatches.at(-1).index)
        : text.lastIndexOf('trailer');
    const dictStart = trailerIndex >= 0 ? text.indexOf('<<', trailerIndex) : -1;
    const dictEnd = dictStart >= 0 ? findMatchingDictionaryEnd(text, dictStart) : -1;
    const dict = dictStart >= 0 && dictEnd > dictStart ? text.slice(dictStart, dictEnd) : text.slice(Math.max(0, text.length - 16384));
    const root = dict.match(/\/Root\s+(\d+)\s+(\d+)\s+R/) || [...text.matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R/g)].at(-1);
    const info = dict.match(/\/Info\s+(\d+)\s+(\d+)\s+R/) || [...text.matchAll(/\/Info\s+(\d+)\s+(\d+)\s+R/g)].at(-1);
    const size = Number((dict.match(/\/Size\s+(\d+)/) || [...text.matchAll(/\/Size\s+(\d+)/g)].at(-1))?.[1]) || 0;
    const idRaw = dict.match(/\/ID\s*\[[\s\S]*?\]/)?.[0] || '';

    return {
        dict,
        encrypted: /\/Encrypt\b/.test(dict),
        idRaw,
        info: info ? { objectNumber: Number(info[1]), generation: Number(info[2]) || 0 } : null,
        root: root ? { objectNumber: Number(root[1]), generation: Number(root[2]) || 0 } : null,
        size,
        startXref,
        text,
    };
}

function parseInfoMetadata(buffer) {
    const trailer = parseTrailer(buffer);
    const dict = trailer.info
        ? findObjectDictionary(trailer.text, trailer.info.objectNumber, trailer.info.generation)
        : '';
    const info = {};
    for (const field of PDF_INFO_FIELDS) {
        const value = pdfValueAfterKey(dict, field);
        if (value) info[field] = value;
    }
    return info;
}

function parseNamesForKey(dict = '', key = '') {
    const keyMatch = new RegExp(`/${key}\\b`).exec(dict);
    if (!keyMatch) return [];
    let index = skipWhitespace(dict, keyMatch.index + keyMatch[0].length);
    if (dict[index] === '/') {
        const name = dict.slice(index + 1).match(/^[^\s<>\[\]\(\)\/%]+/)?.[0] || '';
        return name ? [decodePdfName(name)] : [];
    }
    if (dict[index] !== '[') return [];
    const endIndex = dict.indexOf(']', index + 1);
    if (endIndex < 0) return [];
    return [...dict.slice(index + 1, endIndex).matchAll(/\/([^\s<>\[\]\(\)\/%]+)/g)]
        .map(match => decodePdfName(match[1]));
}

function parseNumberForKey(dict = '', key = '') {
    const keyMatch = new RegExp(`/${key}\\b`).exec(dict);
    if (!keyMatch) return 0;
    const value = dict.slice(keyMatch.index + keyMatch[0].length).match(/^\s+(-?\d+(?:\.\d+)?)/)?.[1] || '';
    return Number(value) || 0;
}

function parseColorSpace(dict = '') {
    const direct = dict.match(/\/ColorSpace\s+\/([^\s<>\[\]\(\)\/%]+)/)?.[1] || '';
    if (direct) return decodePdfName(direct);
    const array = dict.match(/\/ColorSpace\s+\[\s*\/([^\s<>\[\]\(\)\/%]+)/)?.[1] || '';
    return array ? decodePdfName(array) : '';
}

function streamDataStart(text = '', streamIndex = 0) {
    let index = streamIndex + 'stream'.length;
    if (text[index] === '\r' && text[index + 1] === '\n') return index + 2;
    if (text[index] === '\n' || text[index] === '\r') return index + 1;
    return index;
}

function findDictionaryStartBefore(text = '', dictEnd = 0) {
    let depth = 0;
    for (let index = dictEnd - 2; index >= 0; index -= 1) {
        if (text[index] === '>' && text[index + 1] === '>') {
            depth += 1;
            index -= 1;
            continue;
        }
        if (text[index] === '<' && text[index + 1] === '<') {
            if (depth === 0) return index;
            depth -= 1;
            index -= 1;
        }
    }
    return -1;
}

function findPdfStreams(buffer) {
    if (!buffer?.length || buffer.length > STREAM_SCAN_LIMIT) return [];
    const text = buffer.toString('latin1');
    const streams = [];
    let searchIndex = 0;

    while (searchIndex < text.length) {
        const streamIndex = text.indexOf('stream', searchIndex);
        if (streamIndex < 0) break;
        const dictEnd = text.lastIndexOf('>>', streamIndex);
        const dictStart = dictEnd >= 0 ? findDictionaryStartBefore(text, dictEnd) : -1;
        const dataStart = streamDataStart(text, streamIndex);
        const endStreamIndex = text.indexOf('endstream', dataStart);
        if (dictStart >= 0 && dictEnd > dictStart && endStreamIndex > dataStart) {
            streams.push({
                dict: text.slice(dictStart, dictEnd + 2),
                data: buffer.subarray(dataStart, endStreamIndex),
            });
            searchIndex = endStreamIndex + 'endstream'.length;
        } else {
            searchIndex = streamIndex + 'stream'.length;
        }
    }

    return streams;
}

function inflatePdfStream(data) {
    try {
        return zlib.inflateSync(data);
    } catch {
        return zlib.inflateRawSync(data);
    }
}

function decodePdfStreamData(data, filters = []) {
    if (filters.length === 0) return data;
    if (filters.length === 1 && filters[0] === 'FlateDecode') return inflatePdfStream(data);
    if (filters.length === 1 && filters[0] === 'DCTDecode') return data;
    return null;
}

function xmpTextContent(xml = '', tagName = '') {
    const escapedName = String(tagName || '')
        .split(':')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join(':');
    const local = escapedName.split(':').pop();
    const namePattern = String(tagName || '').includes(':') ? escapedName : `(?:[\\w.-]+:)?${local}`;
    const pattern = new RegExp(`<${namePattern}\\b[^>]*>([\\s\\S]*?)<\\/${namePattern}>`, 'i');
    const raw = String(xml || '').match(pattern)?.[1] || '';
    if (!raw) return '';
    const liValues = [...raw.matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/gi)]
        .map(match => normalizeMetadataText(decodeXmlEntities(match[1].replace(/<[^>]+>/g, ''))))
        .filter(Boolean);
    if (liValues.length > 0) return liValues.join(', ');
    return normalizeMetadataText(decodeXmlEntities(raw.replace(/<[^>]+>/g, '')));
}

function xmpValues(xml = '', tagName = '') {
    const text = xmpTextContent(xml, tagName);
    return text
        .split(',')
        .map(value => normalizeMetadataText(value))
        .filter(Boolean);
}

function parsePdfDate(value = '') {
    const text = normalizeMetadataText(value);
    const match = text.match(/^D:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|[+-]\d{2}'?\d{2}'?)?/);
    if (!match) return text;
    const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', zone = ''] = match;
    const cleanZone = zone
        ? zone.toUpperCase() === 'Z'
            ? 'Z'
            : zone.replace(/'/g, '').replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
        : '';
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${cleanZone}`;
}

function splitMetadataList(value = '') {
    return String(value || '')
        .split(/[,;]/)
        .map(part => normalizeMetadataText(part))
        .filter(Boolean);
}

function uniqueValues(values = []) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = normalizeMetadataText(value);
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
    }
    return result;
}

function splitDateParts(value = '') {
    const match = String(value || '').match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
    return {
        Year: match?.[1] || '',
        Month: match?.[2] || '',
        Day: match?.[3] || '',
    };
}

function normalizeIsbn(value = '') {
    return String(value || '').replace(/^urn:isbn:/i, '').replace(/^isbn:/i, '').trim();
}

function looksLikeIsbn(value = '') {
    const normalized = normalizeIsbn(value).replace(/[-\s]/g, '');
    return /^(?:\d{9}[\dXx]|\d{13})$/.test(normalized);
}

function parsePdfXmpMetadata(buffer) {
    const streams = findPdfStreams(buffer).reverse();
    for (const stream of streams) {
        const isMetadata = /\/Type\s*\/Metadata\b/i.test(stream.dict) || /\/Subtype\s*\/XML\b/i.test(stream.dict);
        if (!isMetadata) continue;
        const filters = parseNamesForKey(stream.dict, 'Filter');
        const decoded = decodePdfStreamData(stream.data, filters);
        if (!decoded) continue;
        const xml = decoded.toString('utf8');
        if (!/(xmpmeta|rdf:RDF|<rdf:Description)/i.test(xml)) continue;
        const subjects = uniqueValues([
            ...xmpValues(xml, 'dc:subject'),
            ...splitMetadataList(xmpTextContent(xml, 'pdf:Keywords')),
        ]);
        const identifierValues = xmpValues(xml, 'dc:identifier');
        const date = xmpTextContent(xml, 'dc:date');
        const metadata = {
            Title: xmpTextContent(xml, 'dc:title'),
            Writer: xmpTextContent(xml, 'dc:creator'),
            Publisher: xmpTextContent(xml, 'dc:publisher'),
            Summary: xmpTextContent(xml, 'dc:description'),
            Genre: subjects[0] || '',
            Tags: subjects.slice(1).join(', '),
            ISBN: normalizeIsbn(identifierValues.find(looksLikeIsbn) || identifierValues[0] || ''),
            LanguageISO: xmpValues(xml, 'dc:language')[0] || '',
            Rights: xmpTextContent(xml, 'dc:rights') || xmpTextContent(xml, 'xmpRights:UsageTerms'),
            Web: xmpTextContent(xml, 'xmpRights:WebStatement'),
            Creator: xmpTextContent(xml, 'xmp:CreatorTool'),
            Producer: xmpTextContent(xml, 'pdf:Producer'),
            Trapped: xmpTextContent(xml, 'pdf:Trapped'),
            PdfCreateDate: xmpTextContent(xml, 'xmp:CreateDate'),
            PdfModifyDate: xmpTextContent(xml, 'xmp:ModifyDate'),
            PdfMetadataDate: xmpTextContent(xml, 'xmp:MetadataDate'),
            CommunityRating: xmpTextContent(xml, 'xmp:Rating'),
            ...splitDateParts(date),
        };
        return Object.fromEntries(Object.entries(metadata).filter(([, value]) => normalizeMetadataText(value)));
    }
    return {};
}

function metadataFromPdfInfo(info = {}) {
    const keywords = uniqueValues(splitMetadataList(info.Keywords || ''));
    return Object.fromEntries(Object.entries({
        Title: info.Title || '',
        Writer: info.Author || '',
        Summary: info.Subject || '',
        Genre: keywords[0] || '',
        Tags: keywords.slice(1).join(', '),
        Creator: info.Creator || '',
        Producer: info.Producer || '',
        Trapped: info.Trapped || '',
        PdfCreateDate: parsePdfDate(info.CreationDate || ''),
        PdfModifyDate: parsePdfDate(info.ModDate || ''),
    }).filter(([, value]) => normalizeMetadataText(value)));
}

export async function readPdfMetadata(filePath) {
    const buffer = await fs.readFile(filePath);
    const infoMetadata = metadataFromPdfInfo(parseInfoMetadata(buffer));
    const xmpMetadata = parsePdfXmpMetadata(buffer);
    const headerVersion = buffer.toString('latin1', 0, Math.min(buffer.length, 32)).match(/%PDF-(\d+\.\d+)/)?.[1] || '';
    return {
        ...infoMetadata,
        ...xmpMetadata,
        Format: 'PDF',
        PdfVersion: headerVersion,
    };
}

function reversePngFilter(filterType, row, previousRow, bytesPerPixel) {
    const output = Buffer.from(row);
    for (let index = 0; index < output.length; index += 1) {
        const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
        const up = previousRow?.[index] || 0;
        const upLeft = index >= bytesPerPixel ? previousRow?.[index - bytesPerPixel] || 0 : 0;
        if (filterType === 1) {
            output[index] = (output[index] + left) & 0xff;
        } else if (filterType === 2) {
            output[index] = (output[index] + up) & 0xff;
        } else if (filterType === 3) {
            output[index] = (output[index] + Math.floor((left + up) / 2)) & 0xff;
        } else if (filterType === 4) {
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
            output[index] = (output[index] + predictor) & 0xff;
        }
    }
    return output;
}

function applyPngPredictor(data, width, colors, bitsPerComponent, predictor = 1) {
    if (predictor <= 1) return data;
    if (bitsPerComponent !== 8) return null;
    const bytesPerPixel = colors;
    const rowLength = Math.ceil((width * colors * bitsPerComponent) / 8);
    const rows = [];
    let offset = 0;
    let previousRow = null;
    while (offset < data.length) {
        const filter = data[offset];
        const row = data.subarray(offset + 1, offset + 1 + rowLength);
        if (row.length < rowLength) return null;
        const decoded = reversePngFilter(filter, row, previousRow, bytesPerPixel);
        rows.push(decoded);
        previousRow = decoded;
        offset += rowLength + 1;
    }
    return Buffer.concat(rows);
}

let crcTable = null;

function crc32(buffer) {
    if (!crcTable) {
        crcTable = Array.from({ length: 256 }, (_, index) => {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
            }
            return value >>> 0;
        });
    }
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function buildPngFromRawPixels(data, width, height, colorSpace) {
    const colorType = colorSpace === 'DeviceGray' ? 0 : 2;
    const channels = colorType === 0 ? 1 : 3;
    const rowLength = width * channels;
    if (data.length < rowLength * height) return null;
    const rows = [];
    for (let row = 0; row < height; row += 1) {
        rows.push(Buffer.from([0]));
        rows.push(data.subarray(row * rowLength, row * rowLength + rowLength));
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = colorType;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function imageCandidateFromStream(stream) {
    if (!/\/Subtype\s*\/Image\b/i.test(stream.dict)) return null;
    const width = parseNumberForKey(stream.dict, 'Width');
    const height = parseNumberForKey(stream.dict, 'Height');
    const bitsPerComponent = parseNumberForKey(stream.dict, 'BitsPerComponent') || 8;
    const filters = parseNamesForKey(stream.dict, 'Filter');
    const colorSpace = parseColorSpace(stream.dict) || 'DeviceRGB';
    if (width < 32 || height < 32) return null;

    if (filters.length === 1 && filters[0] === 'DCTDecode') {
        return {
            buffer: stream.data,
            imageName: 'pdf-cover.jpg',
            width,
            height,
        };
    }

    if (filters.length === 1 && filters[0] === 'FlateDecode' && bitsPerComponent === 8 && ['DeviceRGB', 'DeviceGray'].includes(colorSpace)) {
        let raw = inflatePdfStream(stream.data);
        const colors = colorSpace === 'DeviceGray' ? 1 : 3;
        const decodeParms = stream.dict.match(/\/DecodeParms\s*<<([\s\S]*?)>>/)?.[1] || '';
        const predictor = parseNumberForKey(decodeParms, 'Predictor') || 1;
        if (predictor > 1) {
            raw = applyPngPredictor(raw, parseNumberForKey(decodeParms, 'Columns') || width, parseNumberForKey(decodeParms, 'Colors') || colors, bitsPerComponent, predictor);
        }
        if (!raw) return null;
        const png = buildPngFromRawPixels(raw, width, height, colorSpace);
        if (!png) return null;
        return {
            buffer: png,
            imageName: 'pdf-cover.png',
            width,
            height,
        };
    }

    return null;
}

export async function extractPdfCoverImage(filePath) {
    const buffer = await fs.readFile(filePath);
    const candidates = findPdfStreams(buffer)
        .map(imageCandidateFromStream)
        .filter(Boolean)
        .sort((left, right) => {
            const leftScore = left.width * left.height * (left.height >= left.width ? 1.15 : 1);
            const rightScore = right.width * right.height * (right.height >= right.width ? 1.15 : 1);
            return rightScore - leftScore;
        });
    return candidates[0] || null;
}

export async function analyzePdfDocument(filePath, options = {}) {
    const buffer = await fs.readFile(filePath);
    const metadata = {
        ...metadataFromPdfInfo(parseInfoMetadata(buffer)),
        ...parsePdfXmpMetadata(buffer),
    };
    const headerVersion = buffer.toString('latin1', 0, Math.min(buffer.length, 32)).match(/%PDF-(\d+\.\d+)/)?.[1] || '';
    if (headerVersion) metadata.PdfVersion = headerVersion;
    metadata.Format = 'PDF';
    const pageCount = (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    const cover = options.includeCover === false ? null : findPdfStreams(buffer)
        .map(imageCandidateFromStream)
        .filter(Boolean)
        .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0] || null;
    return {
        metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => normalizeMetadataText(value))),
        cover,
        hasMetadata: Object.keys(metadata).some(key => key !== 'Format' && key !== 'PdfVersion' && normalizeMetadataText(metadata[key])),
        pageCount,
    };
}

function pdfHexString(value = '') {
    const text = String(value ?? '');
    const buffer = Buffer.alloc(2 + text.length * 2);
    buffer[0] = 0xfe;
    buffer[1] = 0xff;
    for (let index = 0; index < text.length; index += 1) {
        buffer.writeUInt16BE(text.charCodeAt(index), 2 + index * 2);
    }
    return `<${buffer.toString('hex').toUpperCase()}>`;
}

function pdfDateString(date = new Date()) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
    const offsetRemainder = String(absoluteOffset % 60).padStart(2, '0');
    const parts = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0'),
    ];
    return `D:${parts.join('')}${sign}${offsetHours}'${offsetRemainder}'`;
}

function pdfDateFromMetadataValue(value = '') {
    const text = normalizeMetadataText(value);
    if (!text || /^D:/i.test(text)) return text;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : pdfDateString(date);
}

function publishDateFromMetadata(metadata = {}) {
    const year = normalizeMetadataText(metadata.Year || '');
    if (!year) return '';
    const parts = [year.padStart(4, '0')];
    const month = normalizeMetadataText(metadata.Month || '');
    const day = normalizeMetadataText(metadata.Day || '');
    if (month) parts.push(month.padStart(2, '0'));
    if (day) parts.push(day.padStart(2, '0'));
    return parts.join('-');
}

function keywordsFromMetadata(metadata = {}) {
    return uniqueValues([
        ...splitMetadataList(metadata.Genre),
        ...splitMetadataList(metadata.Tags),
    ]);
}

function trappedValue(value = '') {
    const normalized = normalizeMetadataText(value);
    if (/^true$/i.test(normalized)) return 'True';
    if (/^false$/i.test(normalized)) return 'False';
    if (/^unknown$/i.test(normalized)) return 'Unknown';
    return '';
}

function buildPdfInfoDictionary(metadata = {}, now = new Date()) {
    const entries = [];
    const addText = (key, value) => {
        const text = normalizeMetadataText(value);
        if (text) entries.push(`/${key} ${pdfHexString(text)}`);
    };
    addText('Title', metadata.Title || metadata.Series);
    addText('Author', metadata.Writer);
    addText('Subject', metadata.Summary);
    addText('Keywords', keywordsFromMetadata(metadata).join(', '));
    addText('Creator', metadata.Creator);
    addText('Producer', metadata.Producer);
    addText('CreationDate', pdfDateFromMetadataValue(metadata.PdfCreateDate || metadata.CreationDate));
    addText('ModDate', pdfDateString(now));
    const trapped = trappedValue(metadata.Trapped);
    if (trapped) entries.push(`/Trapped /${trapped}`);
    return `<<\n${entries.map(entry => `  ${entry}`).join('\n')}\n>>`;
}

function rdfBag(tagName, values = []) {
    const items = uniqueValues(values);
    if (items.length === 0) return '';
    return [
        `      <${tagName}>`,
        '        <rdf:Bag>',
        ...items.map(value => `          <rdf:li>${encodeXml(value)}</rdf:li>`),
        '        </rdf:Bag>',
        `      </${tagName}>`,
    ].join('\n');
}

function rdfSeq(tagName, values = []) {
    const items = uniqueValues(values);
    if (items.length === 0) return '';
    return [
        `      <${tagName}>`,
        '        <rdf:Seq>',
        ...items.map(value => `          <rdf:li>${encodeXml(value)}</rdf:li>`),
        '        </rdf:Seq>',
        `      </${tagName}>`,
    ].join('\n');
}

function rdfAlt(tagName, value = '') {
    const text = normalizeMetadataText(value);
    if (!text) return '';
    return [
        `      <${tagName}>`,
        '        <rdf:Alt>',
        `          <rdf:li xml:lang="x-default">${encodeXml(text)}</rdf:li>`,
        '        </rdf:Alt>',
        `      </${tagName}>`,
    ].join('\n');
}

function simpleXmlElement(tagName, value = '') {
    const text = normalizeMetadataText(value);
    return text ? `      <${tagName}>${encodeXml(text)}</${tagName}>` : '';
}

function buildPdfXmpPacket(metadata = {}, now = new Date()) {
    const title = metadata.Title || metadata.Series || '';
    const keywords = keywordsFromMetadata(metadata);
    const publishDate = publishDateFromMetadata(metadata);
    const modifyDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lines = [
        '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
        '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '    <rdf:Description rdf:about=""',
        '      xmlns:dc="http://purl.org/dc/elements/1.1/"',
        '      xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
        '      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
        '      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">',
        rdfAlt('dc:title', title),
        rdfSeq('dc:creator', splitMetadataList(metadata.Writer)),
        rdfAlt('dc:description', metadata.Summary),
        rdfBag('dc:subject', keywords),
        rdfBag('dc:publisher', splitMetadataList(metadata.Publisher)),
        simpleXmlElement('dc:identifier', metadata.ISBN),
        rdfBag('dc:language', splitMetadataList(metadata.LanguageISO)),
        rdfSeq('dc:date', publishDate ? [publishDate] : []),
        rdfAlt('dc:rights', metadata.Rights),
        simpleXmlElement('xmp:CreatorTool', metadata.Creator),
        simpleXmlElement('xmp:CreateDate', metadata.PdfCreateDate),
        simpleXmlElement('xmp:ModifyDate', modifyDate),
        simpleXmlElement('xmp:MetadataDate', modifyDate),
        simpleXmlElement('xmp:Rating', metadata.CommunityRating),
        simpleXmlElement('pdf:Keywords', keywords.join(', ')),
        simpleXmlElement('pdf:Producer', metadata.Producer),
        simpleXmlElement('pdf:Trapped', trappedValue(metadata.Trapped)),
        simpleXmlElement('xmpRights:UsageTerms', metadata.Rights),
        simpleXmlElement('xmpRights:WebStatement', metadata.Web),
        '    </rdf:Description>',
        '  </rdf:RDF>',
        '</x:xmpmeta>',
        '<?xpacket end="w"?>',
    ].filter(Boolean);
    return `${lines.join('\n')}\n`;
}

function findMaxObjectNumber(text = '') {
    let max = 0;
    for (const match of text.matchAll(/\b(\d+)\s+\d+\s+obj\b/g)) {
        max = Math.max(max, Number(match[1]) || 0);
    }
    return max;
}

function padXrefOffset(offset) {
    return String(offset).padStart(10, '0');
}

function padGeneration(generation) {
    return String(generation || 0).padStart(5, '0');
}

function removeCatalogMetadataReference(rootDict = '') {
    return String(rootDict || '').replace(/\s*\/Metadata\s+\d+\s+\d+\s+R\b/g, '');
}

function catalogWithMetadata(rootDict = '', metadataObjectNumber = 0) {
    const clean = removeCatalogMetadataReference(rootDict).replace(/\s*>>\s*$/, '');
    return `${clean}\n  /Metadata ${metadataObjectNumber} 0 R\n>>`;
}

function bufferByteLength(chunks = []) {
    return chunks.reduce((total, chunk) => total + chunk.length, 0);
}

export async function writePdfMetadata(filePath, metadata = {}) {
    const original = await fs.readFile(filePath);
    const trailer = parseTrailer(original);
    if (trailer.encrypted) throw new Error('Encrypted PDF metadata editing is not supported.');
    if (/\/ByteRange\s*\[/i.test(trailer.text)) throw new Error('Signed PDF metadata editing is not supported.');
    if (!trailer.root) throw new Error('PDF catalog was not found.');

    const now = new Date();
    const maxObjectNumber = Math.max(findMaxObjectNumber(trailer.text), trailer.size - 1);
    const infoObjectNumber = maxObjectNumber + 1;
    const metadataObjectNumber = infoObjectNumber + 1;
    const rootDict = findObjectDictionary(trailer.text, trailer.root.objectNumber, trailer.root.generation);
    const canUpdateCatalog = Boolean(rootDict);
    const newSize = Math.max(metadataObjectNumber, trailer.root.objectNumber) + 1;
    const chunks = [];
    if (original.length > 0 && original[original.length - 1] !== 0x0a) chunks.push(Buffer.from('\n', 'latin1'));

    const offsets = [];
    const addObject = (objectNumber, generation, content) => {
        const offset = original.length + bufferByteLength(chunks);
        offsets.push({ objectNumber, generation, offset });
        chunks.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
    };

    const infoObject = `${infoObjectNumber} 0 obj\n${buildPdfInfoDictionary(metadata, now)}\nendobj\n`;
    addObject(infoObjectNumber, 0, infoObject);

    const xmpBuffer = Buffer.from(buildPdfXmpPacket(metadata, now), 'utf8');
    addObject(metadataObjectNumber, 0, Buffer.concat([
        Buffer.from(`${metadataObjectNumber} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${xmpBuffer.length} >>\nstream\n`, 'utf8'),
        xmpBuffer,
        Buffer.from('endstream\nendobj\n', 'utf8'),
    ]));

    if (canUpdateCatalog) {
        const updatedRoot = `${trailer.root.objectNumber} ${trailer.root.generation} obj\n${catalogWithMetadata(rootDict, metadataObjectNumber)}\nendobj\n`;
        addObject(trailer.root.objectNumber, trailer.root.generation, updatedRoot);
    }

    const xrefOffset = original.length + bufferByteLength(chunks);
    const sortedOffsets = [...offsets].sort((left, right) => left.objectNumber - right.objectNumber);
    const xrefLines = ['xref'];
    let section = [];
    const flushSection = () => {
        if (section.length === 0) return;
        xrefLines.push(`${section[0].objectNumber} ${section.length}`);
        for (const entry of section) {
            xrefLines.push(`${padXrefOffset(entry.offset)} ${padGeneration(entry.generation)} n `);
        }
        section = [];
    };
    for (const entry of sortedOffsets) {
        if (section.length > 0 && entry.objectNumber !== section.at(-1).objectNumber + 1) flushSection();
        section.push(entry);
    }
    flushSection();

    const trailerLines = [
        'trailer',
        `<< /Size ${newSize}`,
        `   /Root ${trailer.root.objectNumber} ${trailer.root.generation} R`,
        `   /Info ${infoObjectNumber} 0 R`,
    ];
    if (trailer.idRaw) trailerLines.push(`   ${trailer.idRaw}`);
    if (trailer.startXref) trailerLines.push(`   /Prev ${trailer.startXref}`);
    trailerLines.push('>>');
    trailerLines.push('startxref');
    trailerLines.push(String(xrefOffset));
    trailerLines.push('%%EOF');

    chunks.push(Buffer.from(`${xrefLines.join('\n')}\n${trailerLines.join('\n')}\n`, 'utf8'));
    await fs.writeFile(filePath, Buffer.concat([original, ...chunks]));
    return true;
}

export function pdfMetadataToArchiveMetadata(metadata = {}) {
    const date = publishDateFromMetadata(metadata);
    return {
        book_type: 'pdf',
        title: metadata.Title || '',
        series: metadata.Series || metadata.Title || '',
        writer: metadata.Writer || '',
        publisher: metadata.Publisher || '',
        language: metadata.LanguageISO || '',
        description: metadata.Summary || '',
        genre: metadata.Genre || '',
        tags: metadata.Tags || '',
        isbn: metadata.ISBN || '',
        rating: metadata.CommunityRating || '',
        link: metadata.Web || '',
        notes: metadata.Rights || '',
        creator: metadata.Creator || '',
        producer: metadata.Producer || '',
        trapped: metadata.Trapped || '',
        creation_date: metadata.PdfCreateDate || '',
        modified_date: metadata.PdfModifyDate || '',
        metadata_date: metadata.PdfMetadataDate || '',
        pdf_version: metadata.PdfVersion || '',
        date,
        format: 'PDF',
    };
}

export function pdfImageNameExtension(imageName = '') {
    const ext = path.extname(imageName).toLowerCase();
    return ext || '.jpg';
}
