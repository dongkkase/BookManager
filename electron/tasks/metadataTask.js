import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { missingBinaryMessage } from '../binaryPolicy.js';
import {
  listZipEntries,
  listZipEntriesFromFile,
  readZipEntry,
  readZipEntryFromFile,
  replaceZipEntry,
  replaceZipEntryAppendOnly,
} from '../core/zipArchive.js';
import { translate } from '../../src/utils/i18n.js';
import { BOOK_EXTENSIONS, resolveBookType } from '../../src/metadata/metadataTypes.js';
import {
  analyzePdfDocument,
  extractPdfCoverImage,
  writePdfMetadata,
} from '../pdfMetadata.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const DOCUMENT_EXTS = BOOK_EXTENSIONS;
const METADATA_EXTS = new Set([...ARCHIVE_EXTS, ...DOCUMENT_EXTS]);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const EPUB_EXT = '.epub';
const PDF_EXT = '.pdf';
const EPUB_PACKAGE_MIME = 'application/oebps-package+xml';
const XML_FIELDS = [
  'Series', 'SeriesGroup', 'Title', 'Number', 'Count', 'Volume',
  'Summary', 'Notes', 'Web',
  'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
  'Publisher', 'Imprint', 'Genre', 'Tags', 'Characters',
  'PageCount', 'LanguageISO', 'Format', 'BlackAndWhite', 'Manga',
  'AgeRating', 'CommunityRating', 'Year', 'Month', 'Day',
  'ComicZipAddedDate', 'ComicZipModifiedDate',
];

function taskText(lang, key, values) {
  return translate(key, lang || 'ko', values);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isMetadataFile(filePath) {
  return METADATA_EXTS.has(path.extname(filePath).toLowerCase());
}

function isDocument(filePath) {
  return DOCUMENT_EXTS.has(path.extname(filePath).toLowerCase());
}

function isEpub(filePath) {
  return path.extname(filePath).toLowerCase() === EPUB_EXT;
}

function isPdf(filePath) {
  return path.extname(filePath).toLowerCase() === PDF_EXT;
}

function isImage(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isZipArchive(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.zip' || ext === '.cbz';
}

async function expandInputPaths(paths) {
  const archives = [];

  async function walk(currentPath) {
    let stat;
    try {
      stat = await fsp.stat(currentPath);
    } catch {
      return;
    }

    if (stat.isFile() && isMetadataFile(currentPath)) {
      archives.push(currentPath);
      return;
    }

    if (!stat.isDirectory()) return;
    if (currentPath.split(path.sep).includes('bak')) return;
    const entries = await fsp.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      await walk(path.join(currentPath, entry.name));
    }
  }

  for (const inputPath of paths || []) {
    if (inputPath) await walk(inputPath);
  }
  return [...new Set(archives)].sort(naturalCompare);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      chunks.push(Buffer.from(data));
      stdout += data.toString();
    });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 || code === 1) resolve({ code, stdout, stderr, buffer: Buffer.concat(chunks) });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

async function listWith7z(filePath, sevenZExe) {
  if (!sevenZExe) throw new Error(missingBinaryMessage('7z'));
  const { stdout } = await runProcess(sevenZExe, ['l', '-slt', filePath]);
  const entries = [];
  let current = null;

  for (const line of stdout.split(/\r?\n/)) {
    const idx = line.indexOf(' = ');
    if (idx < 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 3);
    if (key === 'Path') {
      if (current?.name) entries.push(current);
      current = { name: value.normalize('NFC'), isDir: false, size: 0 };
    } else if (current && key === 'Attributes') {
      current.isDir = value.includes('D');
    } else if (current && key === 'Size') {
      current.size = Number(value) || 0;
    }
  }
  if (current?.name) entries.push(current);
  const archivePath = path.resolve(filePath).replace(/\\/g, '/').normalize('NFC').toLowerCase();
  const archiveName = path.basename(filePath).normalize('NFC').toLowerCase();
  return entries.filter(entry => {
    const entryName = String(entry.name).replace(/\\/g, '/').normalize('NFC').toLowerCase();
    return entryName !== archivePath && entryName !== archiveName;
  });
}

async function extractArchiveFile(filePath, innerPath, sevenZExe, options = {}) {
  if (isZipArchive(filePath)) {
    const entry = (await listZipEntriesFromFile(filePath)).find(item => item.name === innerPath);
    if (!entry) throw new Error(`${innerPath} not found`);
    const extracted = await readZipEntryFromFile(filePath, entry, options);
    if (!extracted) throw new Error(`${innerPath} extraction failed`);
    return extracted;
  }
  const result = await runProcess(sevenZExe, ['e', '-so', filePath, innerPath]);
  if (options.maxBytes && result.buffer.length > options.maxBytes) throw new Error(`${innerPath} extraction failed`);
  return result.buffer;
}

async function listArchiveEntries(filePath, sevenZExe) {
  if (isZipArchive(filePath)) {
    return (await listZipEntriesFromFile(filePath)).map(entry => ({
      name: entry.name,
      isDir: entry.isDirectory,
      size: entry.uncompressedSize,
    }));
  }
  return listWith7z(filePath, sevenZExe);
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeArchivePath(value = '') {
  return path.posix.normalize(String(value || '').replace(/\\/g, '/').replace(/^\/+/, ''));
}

function decodeUriPath(value = '') {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeXmlText(value = '') {
  return decodeXml(String(value || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMetadataText(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseXmlAttributes(tag = '') {
  const attrs = {};
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrPattern)) {
    attrs[match[1].toLowerCase()] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function xmlNamePattern(tagName = '', options = {}) {
  const escaped = escapeRegExp(tagName);
  if (options.allowPrefix && !String(tagName).includes(':')) {
    return `(?:[\\w.-]+:)?${escaped}`;
  }
  return escaped;
}

function xmlElementPrefix(tagName = '') {
  const match = String(tagName || '').match(/^([\w.-]+):/);
  return match ? `${match[1]}:` : '';
}

function attrByLocalName(attrs = {}, localName = '') {
  const normalizedLocalName = String(localName || '').toLowerCase();
  for (const [key, value] of Object.entries(attrs || {})) {
    const normalizedKey = String(key || '').toLowerCase();
    if (normalizedKey === normalizedLocalName || normalizedKey.endsWith(`:${normalizedLocalName}`)) {
      return value;
    }
  }
  return '';
}

function xmlElementMatches(xml = '', tagName = '', options = {}) {
  const namePattern = xmlNamePattern(tagName, options);
  const pattern = new RegExp(`<(${namePattern})\\b([^>]*?)(?<!\\/)>([\\s\\S]*?)<\\/\\1>`, 'gi');
  return [...String(xml || '').matchAll(pattern)].map(match => ({
    tag: match[0],
    tagName: match[1],
    openTag: `<${match[1]}${match[2]}>`,
    closeTag: `</${match[1]}>`,
    attrs: parseXmlAttributes(`<${match[1]}${match[2]}>`),
    rawValue: match[3],
    value: normalizeXmlText(match[3]),
  }));
}

function xmlSelfClosingElements(xml = '', tagName = '', options = {}) {
  const namePattern = xmlNamePattern(tagName, options);
  const pattern = new RegExp(`<(${namePattern})\\b([^>]*)\\/\\s*>`, 'gi');
  return [...String(xml || '').matchAll(pattern)].map(match => ({
    tag: match[0],
    tagName: match[1],
    attrs: parseXmlAttributes(match[0]),
    rawValue: '',
    value: '',
  }));
}

function xmlStartTags(xml = '', tagName = '', options = {}) {
  const namePattern = xmlNamePattern(tagName, options);
  const pattern = new RegExp(`<(${namePattern})\\b[^>]*\\/?>`, 'gi');
  return [...String(xml || '').matchAll(pattern)].map(match => ({
    tag: match[0],
    tagName: match[1],
    attrs: parseXmlAttributes(match[0]),
  }));
}

function findArchiveEntry(entries = [], entryPath = '') {
  const normalized = normalizeArchivePath(entryPath).toLowerCase();
  return entries.find(entry => normalizeArchivePath(entry.name).toLowerCase() === normalized) || null;
}

function resolveEpubHref(opfPath = '', href = '') {
  const cleanHref = decodeUriPath(decodeXml(String(href || '').split('#')[0]));
  if (!cleanHref) return '';
  return normalizeArchivePath(path.posix.join(path.posix.dirname(normalizeArchivePath(opfPath)), cleanHref));
}

function xmlElements(xml = '', tagName = '') {
  return xmlElementMatches(xml, tagName, { global: true });
}

const EPUB_METADATA_CHILD_TAGS = [
  'dc:identifier',
  'identifier',
  'dc:title',
  'title',
  'dc:language',
  'language',
  'dc:creator',
  'creator',
  'dc:contributor',
  'contributor',
  'dc:publisher',
  'publisher',
  'dc:description',
  'description',
  'dc:subject',
  'subject',
  'dc:date',
  'date',
];

function malformedXmlElementValue(xml = '', tagName = '') {
  const escaped = escapeRegExp(tagName);
  const boundary = [
    ...EPUB_METADATA_CHILD_TAGS.map(escapeRegExp),
    `${xmlNamePattern('meta', { allowPrefix: true })}\\b`,
    `\\/${xmlNamePattern('metadata', { allowPrefix: true })}\\b`,
  ].join('|');
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)(?=\\s*<(?:${boundary}))`, 'i');
  const match = String(xml || '').match(pattern);
  return match ? normalizeXmlText(match[1]) : '';
}

function firstXmlValue(xml = '', tagNames = []) {
  for (const tagName of tagNames) {
    const value = xmlElements(xml, tagName)[0]?.value || '';
    if (value) return value;
    const fallbackValue = malformedXmlElementValue(xml, tagName);
    if (fallbackValue) return fallbackValue;
  }
  return '';
}

function allXmlValues(xml = '', tagNames = []) {
  return tagNames.flatMap(tagName => xmlElements(xml, tagName).map(element => element.value)).filter(Boolean);
}

function metadataInnerXml(opfXml = '') {
  return xmlElementMatches(opfXml, 'metadata', { allowPrefix: true })[0]?.rawValue || '';
}

function packageAttributes(opfXml = '') {
  const tag = xmlStartTags(opfXml, 'package', { allowPrefix: true })[0]?.tag || '';
  return parseXmlAttributes(tag);
}

function splitMetadataList(value = '') {
  return String(value || '')
    .split(/[;,]/)
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

function epubMetaElements(metadataXml = '') {
  const paired = xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, global: true }).map(element => ({
    ...element,
    key: String(element.attrs.name || element.attrs.property || '').toLowerCase(),
    value: normalizeMetadataText(element.attrs.content || element.value || ''),
  }));
  const selfClosing = xmlSelfClosingElements(metadataXml, 'meta', { allowPrefix: true }).map(element => {
    const attrs = element.attrs;
    return {
      tag: element.tag,
      tagName: element.tagName,
      attrs,
      rawValue: '',
      key: String(attrs.name || attrs.property || '').toLowerCase(),
      value: normalizeMetadataText(attrs.content || ''),
    };
  });
  return [...paired, ...selfClosing];
}

function epubMetaValue(metadataXml = '', keys = []) {
  const normalizedKeys = new Set(keys.map(key => String(key || '').toLowerCase()));
  return epubMetaElements(metadataXml).find(element => normalizedKeys.has(element.key))?.value || '';
}

function normalizeEpubSeriesNumber(value = '') {
  const text = normalizeMetadataText(value);
  if (!text) return '';
  const match = text.match(/^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/);
  if (!match) return text;
  const sign = match[1] === '-' ? '-' : '';
  const integer = String(Number.parseInt(match[2] || '0', 10));
  const decimal = String(match[3] || match[4] || '').replace(/0+$/, '');
  return `${sign}${integer}${decimal ? `.${decimal}` : ''}`;
}

function normalizeLanguageIso(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return 'ko';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('ko')) return 'ko';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('zh-cn')) return 'zh-CN';
  if (lower.startsWith('zh-tw')) return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh';
  return normalized;
}

function parseEpubDate(value = '') {
  const match = String(value || '').match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (!match) return {};
  return {
    Year: match[1] || '',
    Month: match[2] || '',
    Day: match[3] || '',
  };
}

function buildEpubDate(metadata = {}) {
  const year = String(metadata.Year || '').trim();
  if (!/^\d{1,4}$/.test(year)) return '';
  const parts = [year.padStart(4, '0')];
  const month = String(metadata.Month || '').trim();
  if (/^\d{1,2}$/.test(month)) {
    const numericMonth = Number(month);
    if (numericMonth >= 1 && numericMonth <= 12) parts.push(String(numericMonth).padStart(2, '0'));
  }
  const day = String(metadata.Day || '').trim();
  if (parts.length > 1 && /^\d{1,2}$/.test(day)) {
    const numericDay = Number(day);
    if (numericDay >= 1 && numericDay <= 31) parts.push(String(numericDay).padStart(2, '0'));
  }
  return parts.join('-');
}

function normalizeIsbn(value = '') {
  return String(value || '').replace(/^urn:isbn:/i, '').replace(/^isbn:/i, '').trim();
}

function looksLikeIsbn(value = '') {
  const normalized = normalizeIsbn(value).replace(/[-\s]/g, '');
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(normalized);
}

function identifierForMetadata(metadata = {}, existingIdentifier = '') {
  const isbn = normalizeMetadataText(metadata.ISBN);
  if (isbn) return isbn;
  const existing = normalizeMetadataText(existingIdentifier);
  return existing || `urn:uuid:${randomUUID()}`;
}

function epubIdentifierMetadata(metadataXml = '', uniqueIdentifierId = '') {
  const identifiers = [
    ...xmlElements(metadataXml, 'dc:identifier'),
    ...xmlElements(metadataXml, 'identifier'),
  ];
  const preferred = identifiers.find(element => element.attrs.id === uniqueIdentifierId)
    || identifiers[0]
    || null;
  const isbnElement = identifiers.find(element => {
    const scheme = String(element.attrs['opf:scheme'] || element.attrs.scheme || '').toLowerCase();
    return scheme === 'isbn' || looksLikeIsbn(element.value);
  }) || preferred;
  return {
    identifier: preferred?.value || '',
    isbn: isbnElement ? normalizeIsbn(isbnElement.value) : '',
    preferredId: preferred?.attrs.id || uniqueIdentifierId || identifiers.find(element => element.attrs.id)?.attrs.id || 'bookmanager-id',
  };
}

function elementRole(element = {}, roleMap = new Map()) {
  const id = element.attrs?.id || '';
  return normalizeMetadataText(
    attrByLocalName(element.attrs, 'role')
      || (id ? roleMap.get(id) : '')
      || '',
  ).toLowerCase();
}

function epubRoleMap(metadataXml = '') {
  const roles = new Map();
  for (const element of xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, global: true })) {
    const property = String(element.attrs.property || '').toLowerCase();
    const refines = String(element.attrs.refines || '').replace(/^#/, '');
    if (property === 'role' && refines && element.value) {
      roles.set(refines, element.value);
    }
  }
  return roles;
}

function epubSeriesMetadata(metadataXml = '') {
  const metaElements = xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, global: true });
  const collections = metaElements
    .filter(element => String(element.attrs.property || '').toLowerCase() === 'belongs-to-collection');
  const refinements = metaElements
    .filter(element => element.attrs.refines)
    .map(element => ({
      id: String(element.attrs.refines || '').replace(/^#/, ''),
      property: String(element.attrs.property || '').toLowerCase(),
      value: element.value,
    }));

  const collection = collections.find(element => {
    const id = element.attrs.id || '';
    return refinements.some(refinement => refinement.id === id && refinement.property === 'collection-type' && refinement.value === 'series');
  }) || collections[0];
  if (!collection) return {};

  const id = collection.attrs.id || '';
  const groupPosition = refinements.find(refinement => refinement.id === id && refinement.property === 'group-position')?.value || '';
  return {
    Series: collection.value || '',
    Volume: normalizeEpubSeriesNumber(groupPosition),
  };
}

function parseEpubMetadata(opfXml = '') {
  const metadataXml = metadataInnerXml(opfXml);
  if (!metadataXml) return {};

  const packageAttrs = packageAttributes(opfXml);
  const identifier = epubIdentifierMetadata(metadataXml, packageAttrs['unique-identifier'] || '');
  const roleMap = epubRoleMap(metadataXml);
  const creatorElements = [
    ...xmlElements(metadataXml, 'dc:creator'),
    ...xmlElements(metadataXml, 'creator'),
  ];
  const contributorElements = [
    ...xmlElements(metadataXml, 'dc:contributor'),
    ...xmlElements(metadataXml, 'contributor'),
  ];
  const writers = creatorElements
    .filter(element => !['trl', 'translator'].includes(elementRole(element, roleMap)))
    .map(element => element.value);
  const translators = [...creatorElements, ...contributorElements]
    .filter(element => ['trl', 'translator'].includes(elementRole(element, roleMap)))
    .map(element => element.value);
  const subjects = uniqueValues(allXmlValues(metadataXml, ['dc:subject', 'subject']));
  const publishDate = parseEpubDate(firstXmlValue(metadataXml, ['dc:date', 'date']));
  const seriesMetadata = epubSeriesMetadata(metadataXml);
  const fallbackSeries = epubMetaValue(metadataXml, ['calibre:series', 'series']);
  const fallbackSeriesNumber = epubMetaValue(metadataXml, ['calibre:series_index', 'series_index', 'series-index', 'group-position']);
  const metadata = {
    Series: seriesMetadata.Series || fallbackSeries,
    Volume: normalizeEpubSeriesNumber(seriesMetadata.Volume || fallbackSeriesNumber),
    Title: firstXmlValue(metadataXml, ['dc:title', 'title']),
    Writer: uniqueValues(writers).join(', '),
    Translator: uniqueValues(translators).join(', '),
    Publisher: firstXmlValue(metadataXml, ['dc:publisher', 'publisher']),
    Summary: firstXmlValue(metadataXml, ['dc:description', 'description']),
    Genre: subjects[0] || '',
    Tags: subjects.slice(1).join(', '),
    ISBN: identifier.isbn,
    LanguageISO: firstXmlValue(metadataXml, ['dc:language', 'language']),
    CommunityRating: epubMetaValue(metadataXml, ['schema:ratingValue', 'calibre:rating', 'rating', 'communityrating', 'community-rating']),
    ComicZipModifiedDate: epubMetaValue(metadataXml, ['dcterms:modified']),
    Format: 'Novel',
    Manga: '',
    ...publishDate,
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => String(value || '').trim() !== ''),
  );
}

function findEpubCoverEntry(entries = [], opfPath = '', opfXml = '') {
  const manifestItems = xmlStartTags(opfXml, 'item', { allowPrefix: true }).map(element => element.attrs);
  const coverMeta = xmlStartTags(opfXml, 'meta', { allowPrefix: true })
    .map(element => element.attrs)
    .find(attrs => String(attrs.name || '').toLowerCase() === 'cover' && attrs.content);
  const coverId = coverMeta?.content || '';
  const coverItem = manifestItems.find(item => coverId && item.id === coverId)
    || manifestItems.find(item => String(item.properties || '').split(/\s+/).includes('cover-image'))
    || manifestItems.find(item => /^cover(?:[-_]?image)?$/i.test(item.id || ''))
    || manifestItems.find(item => /(^|[/_-])cover[^/]*\.(jpe?g|png|webp|gif|bmp)$/i.test(item.href || ''));

  if (coverItem?.href) {
    const coverPath = resolveEpubHref(opfPath, coverItem.href);
    const coverEntry = findArchiveEntry(entries, coverPath);
    if (coverEntry && isImage(coverEntry.name) && !coverEntry.isDirectory) return coverEntry;
  }

  return entries
    .filter(entry => isImage(entry.name) && !entry.isDirectory)
    .sort((a, b) => {
      const aCover = /(^|[/_-])cover[^/]*\./i.test(a.name) ? 0 : 1;
      const bCover = /(^|[/_-])cover[^/]*\./i.test(b.name) ? 0 : 1;
      return aCover - bCover || naturalCompare(a.name, b.name);
    })[0] || null;
}

function imageMimeType(innerPath = '') {
  const ext = path.extname(innerPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function isEpubCoverCompatibleMediaType(mediaType = '') {
  const cleanType = String(mediaType || '').split(';')[0].trim().toLowerCase();
  return cleanType === 'image/jpeg' || cleanType === 'image/png';
}

function findCompatibleEpubCoverAlternate(entries = [], coverEntry = null) {
  const coverName = normalizeArchivePath(coverEntry?.name || '');
  if (!coverName) return null;

  const coverDir = path.posix.dirname(coverName).toLowerCase();
  const coverStem = path.posix.basename(coverName, path.posix.extname(coverName)).toLowerCase();
  return entries.find(entry => {
    if (!entry || entry.isDirectory || !isImage(entry.name)) return false;
    if (!isEpubCoverCompatibleMediaType(imageMimeType(entry.name))) return false;
    const entryName = normalizeArchivePath(entry.name);
    return path.posix.dirname(entryName).toLowerCase() === coverDir
      && path.posix.basename(entryName, path.posix.extname(entryName)).toLowerCase() === coverStem;
  }) || null;
}

async function resolveEpubCompatibleCoverAsset(epubPackage = {}, opfXml = '', options = {}) {
  const coverEntry = findEpubCoverEntry(epubPackage.entries, epubPackage.opfPath, opfXml);
  if (!coverEntry) return null;

  const mediaType = imageMimeType(coverEntry.name);
  if (isEpubCoverCompatibleMediaType(mediaType)) return null;

  if (typeof options.normalizeEpubCoverImage === 'function') {
    const sourceBuffer = await readZipEntryFromFile(epubPackage.filePath, coverEntry, { maxBytes: 16 * 1024 * 1024 });
    const normalized = sourceBuffer
      ? await options.normalizeEpubCoverImage(sourceBuffer, coverEntry.name, mediaType)
      : null;
    if (normalized?.buffer && isEpubCoverCompatibleMediaType(normalized.mediaType)) {
      const sourceName = `cover${normalized.extension || imageExtensionFromMimeType(normalized.mediaType)}`;
      return {
        entryName: defaultEpubCoverEntryName(epubPackage, sourceName),
        mediaType: normalized.mediaType,
        buffer: normalized.buffer,
      };
    }
  }

  const alternate = findCompatibleEpubCoverAlternate(epubPackage.entries, coverEntry);
  return alternate
    ? {
        entryName: alternate.name,
        mediaType: imageMimeType(alternate.name),
        buffer: null,
      }
    : null;
}

function epubHrefFromEntry(opfPath = '', entryName = '') {
  const opfDir = path.posix.dirname(normalizeArchivePath(opfPath));
  const relative = path.posix.relative(opfDir, normalizeArchivePath(entryName));
  return relative || path.posix.basename(entryName);
}

function manifestItemMatchesEntry(item = {}, opfPath = '', entryName = '') {
  if (!item.href) return false;
  return normalizeArchivePath(resolveEpubHref(opfPath, item.href)).toLowerCase()
    === normalizeArchivePath(entryName).toLowerCase();
}

function existingManifestIds(opfXml = '') {
  return new Set(xmlStartTags(opfXml, 'item', { allowPrefix: true })
    .map(element => attrByLocalName(element.attrs, 'id'))
    .filter(Boolean));
}

function uniqueManifestId(opfXml = '', preferred = 'bookmanager-cover') {
  const ids = existingManifestIds(opfXml);
  if (!ids.has(preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${preferred}-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}

function removeCoverImageProperty(tag = '') {
  return String(tag || '').replace(/\sproperties\s*=\s*(?:"([^"]*)"|'([^']*)')/i, (match, doubleValue, singleValue) => {
    const quote = doubleValue !== undefined ? '"' : "'";
    const value = doubleValue ?? singleValue ?? '';
    const nextTokens = String(value).split(/\s+/).filter(token => token && token !== 'cover-image');
    return nextTokens.length ? ` properties=${quote}${nextTokens.join(' ')}${quote}` : '';
  });
}

function tagAttributeValue(tag = '', attrName = '') {
  return attrByLocalName(parseXmlAttributes(tag), attrName);
}

function upsertTagAttribute(tag = '', attrName = '', value = '') {
  const escapedName = escapeRegExp(attrName);
  const attrPattern = new RegExp(`\\s${escapedName}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'i');
  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, ` ${attrName}="${encodeXml(value)}"`);
  }
  return tag.replace(/\s*\/?>$/, match => ` ${attrName}="${encodeXml(value)}"${match.trimStart()}`);
}

function addCoverImageProperty(tag = '') {
  const current = tagAttributeValue(tag, 'properties');
  const tokens = new Set(String(current || '').split(/\s+/).filter(Boolean));
  tokens.add('cover-image');
  return upsertTagAttribute(tag, 'properties', [...tokens].join(' '));
}

function updateMatchingManifestItem(opfXml = '', opfPath = '', entryName = '', targetId = '', mediaType = '') {
  const itemName = xmlNamePattern('item', { allowPrefix: true });
  let updated = false;
  const nextXml = String(opfXml || '').replace(new RegExp(`<(${itemName})\\b[^>]*\\/?>`, 'gi'), tag => {
    let nextTag = removeCoverImageProperty(tag);
    const attrs = parseXmlAttributes(tag);
    if (manifestItemMatchesEntry(attrs, opfPath, entryName)) {
      nextTag = upsertTagAttribute(nextTag, 'id', targetId);
      nextTag = upsertTagAttribute(nextTag, 'media-type', mediaType);
      nextTag = addCoverImageProperty(nextTag);
      updated = true;
    }
    return nextTag;
  });
  return { opfXml: nextXml, updated };
}

function removeManagedCoverMeta(opfXml = '') {
  const metaName = xmlNamePattern('meta', { allowPrefix: true });
  return String(opfXml || '')
    .replace(new RegExp(`\\s*<${metaName}\\b(?=[^>]*\\bname\\s*=\\s*(?:"cover"|'cover'))[^>]*\\/\\s*>\\s*`, 'gi'), '\n')
    .replace(new RegExp(`\\s*<(${metaName})\\b(?=[^>]*\\bname\\s*=\\s*(?:"cover"|'cover'))[^>]*>[\\s\\S]*?<\\/\\1>\\s*`, 'gi'), '\n');
}

function insertCoverMeta(opfXml = '', coverId = '') {
  const metadataMatch = xmlElementMatches(opfXml, 'metadata', { allowPrefix: true })[0] || null;
  const prefix = xmlElementPrefix(metadataMatch?.tagName || '');
  const metaLine = `        <${prefix}meta name="cover" content="${encodeXml(coverId)}" />`;
  if (!metadataMatch) return opfXml;
  return opfXml.replace(metadataMatch.closeTag, `${metaLine}\n    ${metadataMatch.closeTag}`);
}

function insertManifestItem(opfXml = '', opfPath = '', entryName = '', targetId = '', mediaType = '') {
  const manifestMatch = xmlElementMatches(opfXml, 'manifest', { allowPrefix: true })[0] || null;
  const packagePrefix = xmlElementPrefix(xmlStartTags(opfXml, 'package', { allowPrefix: true })[0]?.tagName || '');
  const manifestPrefix = xmlElementPrefix(manifestMatch?.tagName || '') || packagePrefix;
  const href = epubHrefFromEntry(opfPath, entryName);
  const itemLine = `        <${manifestPrefix}item id="${encodeXml(targetId)}" href="${encodeXml(href)}" media-type="${encodeXml(mediaType)}" properties="cover-image" />`;
  if (manifestMatch) {
    return opfXml.replace(manifestMatch.closeTag, `${itemLine}\n    ${manifestMatch.closeTag}`);
  }
  const manifestName = xmlNamePattern('manifest', { allowPrefix: true });
  const selfClosingManifestPattern = new RegExp(`<(${manifestName})\\b([^>]*)\\/\\s*>`, 'i');
  if (selfClosingManifestPattern.test(opfXml)) {
    return opfXml.replace(selfClosingManifestPattern, `<$1$2>\n${itemLine}\n    </$1>`);
  }
  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return opfXml.replace(new RegExp(`</(${packageName})>`, 'i'), `    <${manifestPrefix}manifest>\n${itemLine}\n    </${manifestPrefix}manifest>\n</$1>`);
}

function updateEpubCoverReferences(opfXml = '', opfPath = '', entryName = '', mediaType = '') {
  const manifestItems = xmlStartTags(opfXml, 'item', { allowPrefix: true }).map(element => element.attrs);
  const existingItem = manifestItems.find(item => manifestItemMatchesEntry(item, opfPath, entryName));
  const targetId = attrByLocalName(existingItem, 'id') || uniqueManifestId(opfXml, 'cover-image');
  const updatedManifest = updateMatchingManifestItem(opfXml, opfPath, entryName, targetId, mediaType);
  const withManifestItem = updatedManifest.updated
    ? updatedManifest.opfXml
    : insertManifestItem(updatedManifest.opfXml, opfPath, entryName, targetId, mediaType);
  return insertCoverMeta(removeManagedCoverMeta(withManifestItem), targetId);
}

function isEpubHtmlEntry(entryName = '') {
  return /\.(?:xhtml|html|htm)$/i.test(normalizeArchivePath(entryName));
}

function manifestEntryName(item = {}, opfPath = '') {
  return item.href ? resolveEpubHref(opfPath, item.href) : '';
}

function isCoverPageManifestItem(item = {}, opfPath = '') {
  const id = attrByLocalName(item, 'id');
  const entryName = manifestEntryName(item, opfPath);
  return isEpubHtmlEntry(entryName) && (
    /(?:^|[-_])cover(?:[-_]|$)/i.test(id)
    || /(?:^|\/)(?:cover|frontcover|front-cover|bookmanager-cover)(?:[-_]?page)?\.(?:xhtml|html|htm)$/i.test(entryName)
  );
}

function findEpubCoverPageEntryName(opfXml = '', opfPath = '') {
  const manifestItems = xmlStartTags(opfXml, 'item', { allowPrefix: true }).map(element => element.attrs);
  const manifestById = new Map(manifestItems
    .map(item => [attrByLocalName(item, 'id'), item])
    .filter(([id]) => id));
  const guideCover = xmlStartTags(opfXml, 'reference', { allowPrefix: true })
    .map(element => element.attrs)
    .find(attrs => String(attrByLocalName(attrs, 'type') || '').toLowerCase() === 'cover' && attrs.href);
  const guideEntryName = guideCover ? resolveEpubHref(opfPath, guideCover.href) : '';
  if (isEpubHtmlEntry(guideEntryName)) return guideEntryName;

  const coverPageItem = manifestItems.find(item => isCoverPageManifestItem(item, opfPath));
  if (coverPageItem) return manifestEntryName(coverPageItem, opfPath);

  const spineIdrefs = xmlStartTags(opfXml, 'itemref', { allowPrefix: true })
    .map(element => attrByLocalName(element.attrs, 'idref'))
    .filter(Boolean);
  for (const idref of spineIdrefs) {
    const item = manifestById.get(idref);
    if (item && isCoverPageManifestItem(item, opfPath)) return manifestEntryName(item, opfPath);
  }

  return '';
}

function defaultEpubCoverPageEntryName(epubPackage = {}, opfXml = '') {
  const existingPage = findEpubCoverPageEntryName(opfXml || epubPackage.opfXml, epubPackage.opfPath);
  if (existingPage) return existingPage;

  const opfDir = path.posix.dirname(normalizeArchivePath(epubPackage.opfPath));
  const preferred = normalizeArchivePath(path.posix.join(opfDir, 'bookmanager-cover.xhtml'));
  if (!findArchiveEntry(epubPackage.entries, preferred)) return preferred;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = normalizeArchivePath(path.posix.join(opfDir, `bookmanager-cover-${index}.xhtml`));
    if (!findArchiveEntry(epubPackage.entries, candidate)) return candidate;
  }

  return normalizeArchivePath(path.posix.join(opfDir, `bookmanager-cover-${Date.now()}.xhtml`));
}

function insertCoverPageManifestItem(opfXml = '', opfPath = '', entryName = '', targetId = '') {
  const manifestMatch = xmlElementMatches(opfXml, 'manifest', { allowPrefix: true })[0] || null;
  const packagePrefix = xmlElementPrefix(xmlStartTags(opfXml, 'package', { allowPrefix: true })[0]?.tagName || '');
  const manifestPrefix = xmlElementPrefix(manifestMatch?.tagName || '') || packagePrefix;
  const href = epubHrefFromEntry(opfPath, entryName);
  const itemLine = `        <${manifestPrefix}item id="${encodeXml(targetId)}" href="${encodeXml(href)}" media-type="application/xhtml+xml" />`;
  if (manifestMatch) {
    return opfXml.replace(manifestMatch.closeTag, `${itemLine}\n    ${manifestMatch.closeTag}`);
  }
  const manifestName = xmlNamePattern('manifest', { allowPrefix: true });
  const selfClosingManifestPattern = new RegExp(`<(${manifestName})\\b([^>]*)\\/\\s*>`, 'i');
  if (selfClosingManifestPattern.test(opfXml)) {
    return opfXml.replace(selfClosingManifestPattern, `<$1$2>\n${itemLine}\n    </$1>`);
  }
  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return opfXml.replace(new RegExp(`</(${packageName})>`, 'i'), `    <${manifestPrefix}manifest>\n${itemLine}\n    </${manifestPrefix}manifest>\n</$1>`);
}

function upsertCoverPageManifestItem(opfXml = '', opfPath = '', entryName = '', targetId = '') {
  const itemName = xmlNamePattern('item', { allowPrefix: true });
  let updated = false;
  const nextXml = String(opfXml || '').replace(new RegExp(`<(${itemName})\\b[^>]*\\/?>`, 'gi'), tag => {
    const attrs = parseXmlAttributes(tag);
    if (!manifestItemMatchesEntry(attrs, opfPath, entryName)) return tag;
    updated = true;
    let nextTag = upsertTagAttribute(tag, 'id', targetId);
    nextTag = upsertTagAttribute(nextTag, 'media-type', 'application/xhtml+xml');
    return nextTag;
  });
  return updated ? nextXml : insertCoverPageManifestItem(nextXml, opfPath, entryName, targetId);
}

function removeSpineItemRef(opfXml = '', idref = '') {
  const itemRefName = xmlNamePattern('itemref', { allowPrefix: true });
  const escapedIdref = escapeRegExp(idref);
  return String(opfXml || '')
    .replace(new RegExp(`\\s*<${itemRefName}\\b(?=[^>]*\\bidref\\s*=\\s*(?:"${escapedIdref}"|'${escapedIdref}'))[^>]*\\/\\s*>\\s*`, 'gi'), '\n')
    .replace(new RegExp(`\\s*<(${itemRefName})\\b(?=[^>]*\\bidref\\s*=\\s*(?:"${escapedIdref}"|'${escapedIdref}'))[^>]*>[\\s\\S]*?<\\/\\1>\\s*`, 'gi'), '\n');
}

function ensureCoverPageSpineItem(opfXml = '', coverPageId = '') {
  const withoutExisting = removeSpineItemRef(opfXml, coverPageId);
  const spineMatch = xmlElementMatches(withoutExisting, 'spine', { allowPrefix: true })[0] || null;
  const packagePrefix = xmlElementPrefix(xmlStartTags(withoutExisting, 'package', { allowPrefix: true })[0]?.tagName || '');
  const spinePrefix = xmlElementPrefix(spineMatch?.tagName || '') || packagePrefix;
  const itemRefLine = `        <${spinePrefix}itemref idref="${encodeXml(coverPageId)}" linear="yes" />`;

  if (spineMatch) {
    return withoutExisting.replace(spineMatch.openTag, `${spineMatch.openTag}\n${itemRefLine}`);
  }

  const spineName = xmlNamePattern('spine', { allowPrefix: true });
  const selfClosingSpinePattern = new RegExp(`<(${spineName})\\b([^>]*)\\/\\s*>`, 'i');
  if (selfClosingSpinePattern.test(withoutExisting)) {
    return withoutExisting.replace(selfClosingSpinePattern, `<$1$2>\n${itemRefLine}\n    </$1>`);
  }

  const manifestMatch = xmlElementMatches(withoutExisting, 'manifest', { allowPrefix: true })[0] || null;
  if (manifestMatch) {
    return withoutExisting.replace(manifestMatch.closeTag, `${manifestMatch.closeTag}\n    <${spinePrefix}spine>\n${itemRefLine}\n    </${spinePrefix}spine>`);
  }

  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return withoutExisting.replace(new RegExp(`</(${packageName})>`, 'i'), `    <${spinePrefix}spine>\n${itemRefLine}\n    </${spinePrefix}spine>\n</$1>`);
}

function removeGuideCoverReferences(opfXml = '') {
  const referenceName = xmlNamePattern('reference', { allowPrefix: true });
  return String(opfXml || '')
    .replace(new RegExp(`\\s*<${referenceName}\\b(?=[^>]*\\btype\\s*=\\s*(?:"cover"|'cover'))[^>]*\\/\\s*>\\s*`, 'gi'), '\n')
    .replace(new RegExp(`\\s*<(${referenceName})\\b(?=[^>]*\\btype\\s*=\\s*(?:"cover"|'cover'))[^>]*>[\\s\\S]*?<\\/\\1>\\s*`, 'gi'), '\n');
}

function ensureCoverPageGuideReference(opfXml = '', opfPath = '', coverPageEntryName = '') {
  const withoutExisting = removeGuideCoverReferences(opfXml);
  const guideMatch = xmlElementMatches(withoutExisting, 'guide', { allowPrefix: true })[0] || null;
  const packagePrefix = xmlElementPrefix(xmlStartTags(withoutExisting, 'package', { allowPrefix: true })[0]?.tagName || '');
  const guidePrefix = xmlElementPrefix(guideMatch?.tagName || '') || packagePrefix;
  const href = epubHrefFromEntry(opfPath, coverPageEntryName);
  const referenceLine = `        <${guidePrefix}reference type="cover" title="Cover" href="${encodeXml(href)}" />`;

  if (guideMatch) {
    return withoutExisting.replace(guideMatch.openTag, `${guideMatch.openTag}\n${referenceLine}`);
  }

  const guideName = xmlNamePattern('guide', { allowPrefix: true });
  const selfClosingGuidePattern = new RegExp(`<(${guideName})\\b([^>]*)\\/\\s*>`, 'i');
  if (selfClosingGuidePattern.test(withoutExisting)) {
    return withoutExisting.replace(selfClosingGuidePattern, `<$1$2>\n${referenceLine}\n    </$1>`);
  }

  const spineMatch = xmlElementMatches(withoutExisting, 'spine', { allowPrefix: true })[0] || null;
  if (spineMatch) {
    return withoutExisting.replace(spineMatch.closeTag, `${spineMatch.closeTag}\n    <${guidePrefix}guide>\n${referenceLine}\n    </${guidePrefix}guide>`);
  }

  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return withoutExisting.replace(new RegExp(`</(${packageName})>`, 'i'), `    <${guidePrefix}guide>\n${referenceLine}\n    </${guidePrefix}guide>\n</$1>`);
}

function updateEpubCoverPageReferences(opfXml = '', opfPath = '', coverPageEntryName = '') {
  const manifestItems = xmlStartTags(opfXml, 'item', { allowPrefix: true }).map(element => element.attrs);
  const existingItem = manifestItems.find(item => manifestItemMatchesEntry(item, opfPath, coverPageEntryName));
  const coverPageId = attrByLocalName(existingItem, 'id') || uniqueManifestId(opfXml, 'bookmanager-cover-page');
  let nextXml = upsertCoverPageManifestItem(opfXml, opfPath, coverPageEntryName, coverPageId);
  nextXml = ensureCoverPageSpineItem(nextXml, coverPageId);
  nextXml = ensureCoverPageGuideReference(nextXml, opfPath, coverPageEntryName);
  return { opfXml: nextXml, coverPageId };
}

function buildEpubCoverPageXml(coverPageEntryName = '', coverImageEntryName = '') {
  const href = path.posix.relative(
    path.posix.dirname(normalizeArchivePath(coverPageEntryName)),
    normalizeArchivePath(coverImageEntryName),
  ) || path.posix.basename(coverImageEntryName);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    '<head>',
    '    <title>Cover</title>',
    '    <style type="text/css">',
    '        html, body { margin: 0; padding: 0; }',
    '        body { text-align: center; }',
    '        img { max-width: 100%; height: auto; }',
    '    </style>',
    '</head>',
    '<body>',
    `    <img src="${encodeXml(href)}" alt="Cover" />`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function defaultEpubCoverEntryName(epubPackage, sourceName = '') {
  const ext = path.extname(sourceName).toLowerCase() || '.jpg';
  const coverEntry = findEpubCoverEntry(epubPackage.entries, epubPackage.opfPath, epubPackage.opfXml);
  if (coverEntry && path.extname(coverEntry.name).toLowerCase() === ext) return coverEntry.name;
  const opfDir = path.posix.dirname(normalizeArchivePath(epubPackage.opfPath));
  const conventionalName = normalizeArchivePath(path.posix.join(opfDir, 'images', `cover${ext}`));
  if (!findArchiveEntry(epubPackage.entries, conventionalName)) return conventionalName;
  return normalizeArchivePath(path.posix.join(opfDir, 'images', `bookmanager-cover${ext}`));
}

async function readEpubPackage(filePath) {
  const entries = await listZipEntriesFromFile(filePath);
  if (!entries.length) return null;

  const containerEntry = findArchiveEntry(entries, 'META-INF/container.xml');
  let opfPath = '';
  if (containerEntry) {
    const containerBuffer = await readZipEntryFromFile(filePath, containerEntry, { maxBytes: 1024 * 1024 });
    const containerXml = containerBuffer ? containerBuffer.toString('utf8') : '';
    const rootfiles = [...String(containerXml || '').matchAll(/<rootfile\b[^>]*>/gi)]
      .map(match => parseXmlAttributes(match[0]))
      .filter(attrs => attrs['full-path']);
    const rootfile = rootfiles.find(attrs => String(attrs['media-type'] || '').toLowerCase() === EPUB_PACKAGE_MIME)
      || rootfiles[0];
    opfPath = normalizeArchivePath(rootfile?.['full-path'] || '');
  }

  const opfEntry = (opfPath ? findArchiveEntry(entries, opfPath) : null)
    || entries.find(entry => !entry.isDirectory && path.extname(entry.name).toLowerCase() === '.opf')
    || null;
  if (!opfEntry) return null;

  const opfBuffer = await readZipEntryFromFile(filePath, opfEntry, { maxBytes: 8 * 1024 * 1024 });
  if (!opfBuffer) return null;
  return {
    filePath,
    entries,
    opfEntry,
    opfPath: opfEntry.name,
    opfXml: opfBuffer.toString('utf8'),
  };
}

async function analyzeEpubFile(filePath, options = {}) {
  const epubPackage = await readEpubPackage(filePath);
  if (!epubPackage) return { metadata: {}, coverDataUrl: '', hasMetadata: false };

  const metadata = parseEpubMetadata(epubPackage.opfXml);
  let coverDataUrl = '';
  if (options.includeCover !== false) {
    const coverEntry = findEpubCoverEntry(epubPackage.entries, epubPackage.opfPath, epubPackage.opfXml);
    const coverBuffer = coverEntry
      ? await readZipEntryFromFile(epubPackage.filePath, coverEntry, { maxBytes: 16 * 1024 * 1024 })
      : null;
    if (coverBuffer) coverDataUrl = imageDataUrl(coverBuffer, coverEntry.name);
  }
  return {
    metadata,
    coverDataUrl,
    hasMetadata: Boolean(metadataInnerXml(epubPackage.opfXml)),
  };
}

export async function listMetadataEpubImages(filePath) {
  const epubPackage = await readEpubPackage(filePath);
  if (!epubPackage) return { images: [], coverEntryName: '' };
  const coverEntry = findEpubCoverEntry(epubPackage.entries, epubPackage.opfPath, epubPackage.opfXml);
  const images = epubPackage.entries
    .filter(entry => !entry.isDirectory && isImage(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
    .map(entry => ({
      name: entry.name,
      label: path.posix.basename(entry.name),
      size: entry.uncompressedSize || entry.size || 0,
      isCover: coverEntry?.name === entry.name,
    }));
  return {
    images,
    coverEntryName: coverEntry?.name || '',
  };
}

export async function loadMetadataEpubImage(filePath, entryName) {
  const epubPackage = await readEpubPackage(filePath);
  if (!epubPackage || !entryName) return '';
  const entry = findArchiveEntry(epubPackage.entries, entryName);
  if (!entry || entry.isDirectory || !isImage(entry.name)) return '';
  const buffer = await readZipEntryFromFile(filePath, entry, { maxBytes: 16 * 1024 * 1024 });
  return buffer ? imageDataUrl(buffer, entry.name) : '';
}

export async function loadMetadataImageFile(filePath) {
  if (!filePath || !isImage(filePath)) return '';
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return '';
  return imageDataUrl(await fsp.readFile(filePath), filePath);
}

export async function loadMetadataCover(filePath, options = {}) {
  if (!filePath || (isDocument(filePath) && !isEpub(filePath) && !isPdf(filePath))) return '';
  const sevenZExe = options.sevenZExe;
  if (isEpub(filePath)) {
    const epubPackage = await readEpubPackage(filePath);
    if (!epubPackage) return '';
    const coverEntry = findEpubCoverEntry(epubPackage.entries, epubPackage.opfPath, epubPackage.opfXml);
    if (!coverEntry) return '';
    const coverBuffer = await readZipEntryFromFile(epubPackage.filePath, coverEntry, { maxBytes: 16 * 1024 * 1024 });
    return coverBuffer ? imageDataUrl(coverBuffer, coverEntry.name) : '';
  }
  if (isPdf(filePath)) {
    const cover = await extractPdfCoverImage(filePath).catch(() => null);
    return cover?.buffer ? imageDataUrl(cover.buffer, cover.imageName) : '';
  }

  const entries = await listArchiveEntries(filePath, sevenZExe);
  const imageEntry = entries
    .filter(entry => !entry.isDir && isImage(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name))[0];
  if (!imageEntry) return '';
  try {
    const buffer = await extractArchiveFile(filePath, imageEntry.name, sevenZExe, { maxBytes: 16 * 1024 * 1024 });
    return buffer ? imageDataUrl(buffer, imageEntry.name) : '';
  } catch {
    return '';
  }
}

export function parseComicInfo(xmlText) {
  const metadata = {};
  for (const field of XML_FIELDS) {
    const match = String(xmlText || '').match(new RegExp(`<${field}[^>]*>([\\s\\S]*?)<\\/${field}>`, 'i'));
    if (match) metadata[field] = decodeXml(match[1]).trim();
  }
  return metadata;
}

export function createComicInfoXml(metadata = {}) {
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  const data = { ...metadata };
  const addedDate = data.ComicZipAddedDate || now;
  data.ComicZipAddedDate = addedDate;
  data.ComicZipModifiedDate = now;

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n';
  for (const field of XML_FIELDS) {
    const value = data[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      xml += `  <${field}>${encodeXml(value)}</${field}>\n`;
    }
  }
  xml += '</ComicInfo>\n';
  return xml;
}

function imageDataUrl(buffer, innerPath) {
  const ext = path.extname(innerPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
        : 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function inferMetadataFromFilename(filePath, pageCount, options = {}) {
  const filename = path.basename(filePath, path.extname(filePath));
  const volumeMatch = filename.match(/(?:v|vol\.?|volume|\s)(\d+(?:\.\d+)?)(?:권)?/i);
  const title = filename.replace(/\.(zip|cbz|cbr|rar|7z)$/i, '').trim();
  const bookType = options.bookType || resolveBookType({ path: filePath });
  const languageISO = normalizeLanguageIso(options.languageISO || options.defaultLanguageISO || options.lang || 'ko');
  if (bookType === 'book' || bookType === 'pdf') {
    return {
      Series: title.replace(/\s*(?:v|vol\.?|volume)?\s*\d+(?:\.\d+)?권?\s*$/i, '').trim() || title,
      Title: title,
      Volume: normalizeEpubSeriesNumber(volumeMatch?.[1] || ''),
      PageCount: pageCount ? String(pageCount) : '',
      Manga: '',
      Format: bookType === 'pdf' ? 'PDF' : 'Novel',
      LanguageISO: languageISO,
    };
  }
  return {
    Series: title.replace(/\s*(?:v|vol\.?|volume)?\s*\d+(?:\.\d+)?권?\s*$/i, '').trim() || title,
    Title: title,
    Volume: volumeMatch?.[1] || '',
    PageCount: pageCount ? String(pageCount) : '',
    Manga: 'YesAndRightToLeft',
    Format: 'Manga',
    LanguageISO: 'ko',
  };
}

function metadataPublishDate(metadata = {}) {
  return [
    metadata.Year,
    metadata.Month ? String(metadata.Month).padStart(2, '0') : '',
    metadata.Day ? String(metadata.Day).padStart(2, '0') : '',
  ].filter(Boolean).join('-');
}

function metadataFromLibraryRecord(record = {}) {
  if (!record) return {};
  const metadata = {
    Title: record.title || '',
    Series: record.series || '',
    SeriesGroup: record.series_group || '',
    Volume: record.volume || '',
    Number: record.number || '',
    Writer: record.writer || record.creators || '',
    Publisher: record.publisher || '',
    Imprint: record.imprint || '',
    Genre: record.genre || '',
    Tags: record.tags || '',
    Summary: record.summary || '',
    Notes: record.notes || '',
    Rights: record.notes || '',
    Web: record.web || '',
    ISBN: record.isbn || '',
    PageCount: record.page_count || '',
    Count: record.volume_count || '',
    LanguageISO: record.language || '',
    Format: record.format || '',
    Manga: record.manga || '',
    AgeRating: record.age_rating || '',
    CommunityRating: record.rating || '',
    Creator: record.creators || '',
    Producer: record.creators || '',
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => String(value || '').trim() !== ''),
  );
}

function metadataToLibraryRecord(item = {}) {
  const metadata = item.metadata || {};
  const filePath = item.filepath || item.path || '';
  return {
    path: filePath,
    ext: path.extname(filePath).toLowerCase(),
    title: metadata.Title || '',
    series: metadata.Series || '',
    series_group: metadata.SeriesGroup || '',
    volume: metadata.Volume || '',
    number: metadata.Number || '',
    writer: metadata.Writer || '',
    creators: [metadata.Creator, metadata.Producer, metadata.Writer, metadata.Editor].filter(Boolean).join(', '),
    publisher: metadata.Publisher || '',
    imprint: metadata.Imprint || '',
    genre: metadata.Genre || '',
    volume_count: metadata.Count || '',
    page_count: metadata.PageCount || '',
    format: metadata.Format || '',
    manga: metadata.Manga || '',
    language: metadata.LanguageISO || '',
    rating: metadata.CommunityRating || '',
    age_rating: metadata.AgeRating || '',
    publish_date: metadataPublishDate(metadata),
    summary: metadata.Summary || '',
    characters: metadata.Characters || '',
    teams: '',
    locations: '',
    story_arc: metadata.StoryArc || '',
    tags: metadata.Tags || '',
    notes: metadata.Rights || metadata.Notes || '',
    web: metadata.Web || '',
    isbn: metadata.ISBN || '',
    book_type: resolveBookType({ path: filePath }),
  };
}

async function createLibraryDbHandle(options = {}) {
  if (options.libraryDb) return { libraryDb: options.libraryDb, shouldClose: false };
  if (!options.dbPath) return { libraryDb: null, shouldClose: false };
  const { LibraryDB } = await import('../database/library_db.js');
  return { libraryDb: new LibraryDB({ dbPath: options.dbPath }), shouldClose: true };
}

async function persistDocumentMetadata(item, options = {}) {
  const { libraryDb, shouldClose } = await createLibraryDbHandle(options);
  if (!libraryDb) throw new Error(taskText(options.lang, 'metadata_document_write_unsupported'));
  try {
    const filePath = item.filepath || item.path || '';
    const stat = await fsp.stat(filePath);
    const existing = await libraryDb.getFileInfo(filePath).catch(() => null);
    const invalidateThumbnail = isEpub(filePath) && Boolean(item.epubCoverChange);
    await libraryDb.upsertFileInfo({
      ...(existing || {}),
      ...metadataToLibraryRecord(item),
      ...(invalidateThumbnail ? { thumb_path: '' } : {}),
      mtime: stat.mtimeMs / 1000,
      size: stat.size,
    });
    return true;
  } finally {
    if (shouldClose) await libraryDb.close();
  }
}

async function persistDocumentMetadataIfPossible(item, options = {}) {
  if (!options.libraryDb && !options.dbPath) return false;
  await persistDocumentMetadata(item, options);
  return true;
}

async function refreshChangedEpubCoverThumbnail(item, filePath, options = {}) {
  if (!isEpub(filePath) || !item.epubCoverChange || typeof options.refreshFilePreview !== 'function') return;
  try {
    await options.refreshFilePreview(filePath);
  } catch (error) {
    console.warn(`[Metadata] EPUB cover thumbnail refresh failed: ${filePath}`, error.message);
  }
}

async function collectPublisherOptions(libraryDb) {
  if (!libraryDb || typeof libraryDb.getDistinctPublishers !== 'function') return [];
  const rows = await libraryDb.getDistinctPublishers(1000).catch(() => []);
  const publishers = rows.map(row => typeof row === 'string' ? row : row?.publisher);
  return uniqueValues(publishers);
}

export async function analyzeMetadataInputs(paths, options = {}, onProgress) {
  const sevenZExe = options.sevenZExe;
  const defaultLanguageISO = normalizeLanguageIso(options.languageISO || options.defaultLanguageISO || options.lang || 'ko');
  const includeCovers = options.includeCovers !== false;

  const archives = await expandInputPaths(paths);
  const items = [];
  const skippedFiles = [];
  const { libraryDb, shouldClose } = await createLibraryDbHandle(options);
  const publisherOptions = await collectPublisherOptions(libraryDb);

  try {
    for (let index = 0; index < archives.length; index += 1) {
      const filePath = archives[index];
      const filename = path.basename(filePath);
      onProgress?.({
        progress: Math.round((index / Math.max(archives.length, 1)) * 100),
        message: taskText(options.lang, 'task_metadata_analyzing', { index: index + 1, total: archives.length, name: filename }),
      });

      try {
        const bookType = resolveBookType({ path: filePath });
        const epubAnalysis = isEpub(filePath) ? await analyzeEpubFile(filePath, { includeCover: includeCovers }) : null;
        const pdfAnalysis = isPdf(filePath) ? await analyzePdfDocument(filePath, { includeCover: includeCovers }) : null;
        const entries = isDocument(filePath) ? [] : await listArchiveEntries(filePath, sevenZExe);
        const imageEntries = entries
          .filter(entry => !entry.isDir && isImage(entry.name))
          .sort((a, b) => naturalCompare(a.name, b.name));
        const comicInfoEntry = entries.find(entry => !entry.isDir && path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
        const pageCount = pdfAnalysis?.pageCount || imageEntries.length;
        let metadata = inferMetadataFromFilename(filePath, pageCount, { bookType, languageISO: defaultLanguageISO });

        if (libraryDb) {
          const cached = await libraryDb.getFileInfo(filePath).catch(() => null);
          metadata = { ...metadata, ...metadataFromLibraryRecord(cached) };
        }

        if (epubAnalysis?.metadata) {
          metadata = { ...metadata, ...epubAnalysis.metadata };
        }

        if (pdfAnalysis?.metadata) {
          metadata = { ...metadata, ...pdfAnalysis.metadata };
        }

        if (comicInfoEntry) {
          const xmlBuffer = await extractArchiveFile(filePath, comicInfoEntry.name, sevenZExe, { maxBytes: 8 * 1024 * 1024 });
          metadata = { ...metadata, ...parseComicInfo(xmlBuffer.toString('utf8')) };
        }

        let coverDataUrl = epubAnalysis?.coverDataUrl || '';
        if (!coverDataUrl && pdfAnalysis?.cover?.buffer) {
          coverDataUrl = imageDataUrl(pdfAnalysis.cover.buffer, pdfAnalysis.cover.imageName);
        }
        if (includeCovers && imageEntries[0]) {
          try {
            const coverBuffer = await extractArchiveFile(filePath, imageEntries[0].name, sevenZExe, { maxBytes: 16 * 1024 * 1024 });
            coverDataUrl = coverBuffer ? imageDataUrl(coverBuffer, imageEntries[0].name) : '';
          } catch {
            coverDataUrl = '';
          }
        }

        const stat = await fsp.stat(filePath);
        items.push({
          id: filePath,
          filepath: filePath,
          name: filename,
          group: path.basename(path.dirname(filePath)),
          checked: true,
          bookType,
          hasComicInfo: Boolean(comicInfoEntry),
          hasEpubMetadata: Boolean(epubAnalysis?.hasMetadata),
          hasPdfMetadata: Boolean(pdfAnalysis?.hasMetadata),
          pageCount,
          sizeMb: stat.size / (1024 * 1024),
          coverDataUrl,
          metadata,
          originalMetadata: { ...metadata },
        });
      } catch (error) {
        skippedFiles.push(`${filename} (${error.message})`);
      }
    }
  } finally {
    if (shouldClose) await libraryDb.close();
  }

  onProgress?.({ progress: 100, message: taskText(options.lang, 'task_analysis_done') });
  return { items, skippedFiles, publisherOptions };
}

export function metadataWriteSupport(filePath, lang = 'ko') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === EPUB_EXT || ext === PDF_EXT) {
    return { supported: true, message: '' };
  }
  if (DOCUMENT_EXTS.has(ext)) {
    return {
      supported: false,
      message: taskText(lang, 'metadata_document_write_unsupported'),
    };
  }
  if (ext === '.rar' || ext === '.cbr') {
    return {
      supported: false,
      message: taskText(lang, 'metadata_rar_write_unsupported'),
    };
  }
  return { supported: true, message: '' };
}

function xmlAttributeString(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => ` ${key}="${encodeXml(value)}"`)
    .join('');
}

function epubMetadataElement(tagName, value, attrs = {}) {
  return `        <${tagName}${xmlAttributeString(attrs)}>${encodeXml(value)}</${tagName}>`;
}

function removeXmlElementsByName(xml = '', tagNames = []) {
  let nextXml = String(xml || '');
  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    nextXml = nextXml.replace(new RegExp(`\\s*<(${escaped})\\b[^>]*>[\\s\\S]*?<\\/\\1>\\s*`, 'gi'), '\n');
    const boundary = [
      ...EPUB_METADATA_CHILD_TAGS.map(escapeRegExp),
      `${xmlNamePattern('meta', { allowPrefix: true })}\\b`,
      `\\/${xmlNamePattern('metadata', { allowPrefix: true })}\\b`,
    ].join('|');
    nextXml = nextXml.replace(new RegExp(`\\s*<${escaped}\\b[^>]*>[\\s\\S]*?(?=\\s*<(?:${boundary}))`, 'gi'), '\n');
  }
  return nextXml;
}

function removeMetaByAttribute(xml = '', attrName = '', attrValues = []) {
  let nextXml = String(xml || '');
  const metaName = xmlNamePattern('meta', { allowPrefix: true });
  const escapedAttrName = escapeRegExp(attrName);
  for (const attrValue of attrValues) {
    const escapedValue = escapeRegExp(attrValue);
    nextXml = nextXml
      .replace(new RegExp(`\\s*<(${metaName})\\b(?=[^>]*\\b${escapedAttrName}\\s*=\\s*(?:"${escapedValue}"|'${escapedValue}'))[^>]*?(?<!\\/)>[\\s\\S]*?<\\/\\1>\\s*`, 'gi'), '\n')
      .replace(new RegExp(`\\s*<${metaName}\\b(?=[^>]*\\b${escapedAttrName}\\s*=\\s*(?:"${escapedValue}"|'${escapedValue}'))[^>]*\\/\\s*>\\s*`, 'gi'), '\n');
  }
  return nextXml;
}

function removeMetaProperties(xml = '', propertyNames = []) {
  return removeMetaByAttribute(xml, 'property', propertyNames);
}

function removeMetaNames(xml = '', names = []) {
  return removeMetaByAttribute(xml, 'name', names);
}

function removeManagedEpubMetadata(metadataXml = '') {
  const withoutManagedElements = removeXmlElementsByName(metadataXml, [
    'dc:identifier',
    'identifier',
    'dc:title',
    'title',
    'dc:language',
    'language',
    'dc:creator',
    'creator',
    'dc:contributor',
    'contributor',
    'dc:publisher',
    'publisher',
    'dc:description',
    'description',
    'dc:subject',
    'subject',
    'dc:date',
    'date',
  ]);
  const withoutManagedProperties = removeMetaProperties(withoutManagedElements, [
    'dcterms:modified',
    'belongs-to-collection',
    'collection-type',
    'group-position',
    'role',
    'schema:ratingValue',
    'calibre:rating',
    'rating',
    'communityrating',
    'community-rating',
  ]);
  return removeMetaNames(withoutManagedProperties, [
    'schema:ratingValue',
    'calibre:rating',
    'rating',
    'communityrating',
    'community-rating',
  ]);
}

function formatPreservedMetadata(metadataXml = '') {
  const trimmed = String(metadataXml || '').trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\r?\n/)
    .map(line => line.trim() ? `        ${line.trim()}` : '')
    .join('\n');
}

function buildManagedEpubMetadata(metadata = {}, existing = {}, options = {}) {
  const title = normalizeMetadataText(metadata.Title || metadata.Series || 'Untitled');
  const language = normalizeMetadataText(metadata.LanguageISO || 'ko');
  const identifierId = normalizeMetadataText(existing.preferredId || 'bookmanager-id');
  const identifierValue = identifierForMetadata(metadata, existing.identifier || '');
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const opfPrefix = options.opfPrefix || '';
  const opfMetaTag = `${opfPrefix}meta`;
  const writers = uniqueValues(splitMetadataList(metadata.Writer));
  const translators = uniqueValues(splitMetadataList(metadata.Translator));
  const subjects = uniqueValues([
    ...splitMetadataList(metadata.Genre),
    ...splitMetadataList(metadata.Tags),
  ]);
  const lines = [
    epubMetadataElement('dc:identifier', identifierValue, { id: identifierId }),
    epubMetadataElement('dc:title', title),
    epubMetadataElement('dc:language', language),
    epubMetadataElement(opfMetaTag, modified, { property: 'dcterms:modified' }),
  ];

  for (const writer of writers) {
    lines.push(epubMetadataElement('dc:creator', writer));
  }

  translators.forEach((translator, index) => {
    const contributorId = `bookmanager-translator-${index + 1}`;
    lines.push(epubMetadataElement('dc:contributor', translator, { id: contributorId }));
    lines.push(epubMetadataElement(opfMetaTag, 'trl', {
      refines: `#${contributorId}`,
      property: 'role',
      scheme: 'marc:relators',
    }));
  });

  const publisher = normalizeMetadataText(metadata.Publisher || '');
  if (publisher) lines.push(epubMetadataElement('dc:publisher', publisher));

  const summary = normalizeMetadataText(metadata.Summary || '');
  if (summary) lines.push(epubMetadataElement('dc:description', summary));

  for (const subject of subjects) {
    lines.push(epubMetadataElement('dc:subject', subject));
  }

  const publishDate = buildEpubDate(metadata);
  if (publishDate) lines.push(epubMetadataElement('dc:date', publishDate));

  const rating = normalizeMetadataText(metadata.CommunityRating || '');
  if (rating) {
    lines.push(epubMetadataElement(opfMetaTag, rating, { property: 'schema:ratingValue' }));
  }

  const series = normalizeMetadataText(metadata.Series || '');
  if (series) {
    const seriesId = 'bookmanager-series';
    lines.push(epubMetadataElement(opfMetaTag, series, {
      property: 'belongs-to-collection',
      id: seriesId,
    }));
    lines.push(epubMetadataElement(opfMetaTag, 'series', {
      refines: `#${seriesId}`,
      property: 'collection-type',
    }));

    const volume = normalizeEpubSeriesNumber(metadata.Volume || '');
    if (volume) {
      lines.push(epubMetadataElement(opfMetaTag, volume, {
        refines: `#${seriesId}`,
        property: 'group-position',
      }));
    }
  }

  return lines.join('\n');
}

function upsertXmlAttribute(tag = '', attrName = '', value = '') {
  const escapedName = escapeRegExp(attrName);
  const attrPattern = new RegExp(`\\s${escapedName}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'i');
  if (attrPattern.test(tag)) {
    return tag.replace(attrPattern, ` ${attrName}="${encodeXml(value)}"`);
  }
  return tag.replace(/>$/, ` ${attrName}="${encodeXml(value)}">`);
}

function ensurePackageAttributes(opfXml = '', uniqueIdentifierId = '') {
  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return String(opfXml || '').replace(new RegExp(`<${packageName}\\b[^>]*>`, 'i'), tag => {
    let nextTag = upsertXmlAttribute(tag, 'unique-identifier', uniqueIdentifierId);
    if (!/\sxmlns:dc\s*=/.test(nextTag)) {
      nextTag = upsertXmlAttribute(nextTag, 'xmlns:dc', 'http://purl.org/dc/elements/1.1/');
    }
    return nextTag;
  });
}

function updateEpubPackageXml(opfXml = '', metadata = {}) {
  const metadataMatch = xmlElementMatches(opfXml, 'metadata', { allowPrefix: true })[0] || null;
  const existingMetadataXml = metadataMatch?.rawValue || '';
  const existingIdentifier = epubIdentifierMetadata(
    existingMetadataXml,
    packageAttributes(opfXml)['unique-identifier'] || '',
  );
  const uniqueIdentifierId = existingIdentifier.preferredId || 'bookmanager-id';
  const packageTagName = xmlStartTags(opfXml, 'package', { allowPrefix: true })[0]?.tagName || 'package';
  const opfPrefix = xmlElementPrefix(metadataMatch?.tagName || packageTagName);
  const managed = buildManagedEpubMetadata(metadata, existingIdentifier, { opfPrefix });
  const preserved = formatPreservedMetadata(removeManagedEpubMetadata(existingMetadataXml));
  const metadataOpenTag = metadataMatch?.openTag || `<${opfPrefix}metadata>`;
  const metadataCloseTag = metadataMatch?.closeTag || `</${opfPrefix}metadata>`;
  const metadataBody = [managed, preserved].filter(Boolean).join('\n');
  const metadataSection = `${metadataOpenTag}\n${metadataBody}\n    ${metadataCloseTag}`;
  const updatedPackageXml = ensurePackageAttributes(opfXml, uniqueIdentifierId);

  if (metadataMatch) {
    const metadataName = xmlNamePattern('metadata', { allowPrefix: true });
    return updatedPackageXml.replace(new RegExp(`<(${metadataName})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'i'), metadataSection);
  }
  const packageName = xmlNamePattern('package', { allowPrefix: true });
  return updatedPackageXml.replace(new RegExp(`<${packageName}\\b[^>]*>`, 'i'), match => `${match}\n${metadataSection}`);
}

function imageExtensionFromMimeType(mimeType = '') {
  const cleanType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanType === 'image/png') return '.png';
  if (cleanType === 'image/webp') return '.webp';
  if (cleanType === 'image/gif') return '.gif';
  if (cleanType === 'image/bmp') return '.bmp';
  return '.jpg';
}

async function resolveEpubCoverChange(epubPackage, coverChange = {}, options = {}) {
  const type = coverChange?.type || coverChange?.source || '';
  if (!type) return null;

  if (type === 'entry') {
    const entry = findArchiveEntry(epubPackage.entries, coverChange.entryName || coverChange.name || '');
    if (!entry || entry.isDirectory || !isImage(entry.name)) return null;
    let mediaType = imageMimeType(entry.name);
    if (typeof options.normalizeEpubCoverImage === 'function' && !['image/jpeg', 'image/png'].includes(mediaType)) {
      const sourceBuffer = await readZipEntryFromFile(epubPackage.filePath, entry, { maxBytes: 16 * 1024 * 1024 });
      const normalized = sourceBuffer
        ? await options.normalizeEpubCoverImage(sourceBuffer, entry.name, mediaType)
        : null;
      if (normalized?.buffer && normalized?.mediaType) {
        mediaType = normalized.mediaType;
        const sourceName = `cover${normalized.extension || imageExtensionFromMimeType(mediaType)}`;
        return {
          entryName: defaultEpubCoverEntryName(epubPackage, sourceName),
          mediaType,
          buffer: normalized.buffer,
        };
      }
    }
    return {
      entryName: entry.name,
      mediaType,
      buffer: null,
    };
  }

  if (type === 'file') {
    const filePath = coverChange.filePath || coverChange.path || '';
    if (!filePath || !isImage(filePath)) return null;
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) return null;
    let buffer = await fsp.readFile(filePath);
    let mediaType = imageMimeType(filePath);
    let sourceName = filePath;
    if (typeof options.normalizeEpubCoverImage === 'function' && !['image/jpeg', 'image/png'].includes(mediaType)) {
      const normalized = await options.normalizeEpubCoverImage(buffer, filePath, mediaType);
      if (normalized?.buffer && normalized?.mediaType) {
        buffer = normalized.buffer;
        mediaType = normalized.mediaType;
        sourceName = `cover${normalized.extension || imageExtensionFromMimeType(mediaType)}`;
      }
    }
    const entryName = defaultEpubCoverEntryName(epubPackage, sourceName);
    return {
      entryName,
      mediaType,
      buffer,
    };
  }

  return null;
}

function comparableComicInfoValue(value) {
  return String(value ?? '').trim();
}

function comicInfoMetadataMatches(existing = {}, metadata = {}) {
  if (!comparableComicInfoValue(existing.ComicZipModifiedDate)) return false;

  for (const field of XML_FIELDS) {
    if (field === 'ComicZipModifiedDate') continue;
    if (field === 'ComicZipAddedDate' && !comparableComicInfoValue(metadata[field])) return false;
    if (comparableComicInfoValue(existing[field]) !== comparableComicInfoValue(metadata[field])) {
      return false;
    }
  }
  return true;
}

async function readExistingComicInfoMetadata(filePath, sevenZExe) {
  if (isZipArchive(filePath)) {
    const entries = await listZipEntriesFromFile(filePath);
    const comicInfoEntry = entries.find(entry => !entry.isDirectory && entry.name.replace(/\\/g, '/').toLowerCase() === 'comicinfo.xml');
    if (!comicInfoEntry) return null;
    const xmlBuffer = await readZipEntryFromFile(filePath, comicInfoEntry, { maxBytes: 8 * 1024 * 1024 });
    return xmlBuffer ? parseComicInfo(xmlBuffer.toString('utf8')) : null;
  }

  if (!sevenZExe) return null;
  try {
    const result = await runProcess(sevenZExe, ['e', '-so', '-ssc-', '-r', filePath, 'ComicInfo.xml']);
    return result.buffer.length ? parseComicInfo(result.buffer.toString('utf8')) : null;
  } catch {
    return null;
  }
}

async function hasComicInfoMetadataChanges(filePath, metadata, sevenZExe) {
  const existing = await readExistingComicInfoMetadata(filePath, sevenZExe);
  return !existing || !comicInfoMetadataMatches(existing, metadata);
}

async function createMetadataBackup(filePath, extension, token) {
  const backupDir = path.join(path.dirname(filePath), 'bak');
  await fsp.mkdir(backupDir, { recursive: true });
  let backupPath = path.join(backupDir, path.basename(filePath));
  if (fs.existsSync(backupPath)) {
    backupPath = path.join(
      backupDir,
      `${path.basename(filePath, extension)}_${token}${extension}`,
    );
  }
  await fsp.copyFile(filePath, backupPath);
}

async function injectEpubMetadata(filePath, metadata, lang = 'ko', coverChange = null, options = {}) {
  const epubPackage = await readEpubPackage(filePath);
  if (!epubPackage) throw new Error(taskText(lang, 'metadata_epub_package_not_found'));
  let opfXml = updateEpubPackageXml(epubPackage.opfXml, metadata);
  const requestedCoverChange = Boolean(coverChange?.type || coverChange?.source);
  const changedCoverAsset = await resolveEpubCoverChange(epubPackage, coverChange, options);
  if (requestedCoverChange && !changedCoverAsset) {
    throw new Error(taskText(lang, 'metadata_epub_cover_not_found'));
  }
  const coverAsset = changedCoverAsset || await resolveEpubCompatibleCoverAsset(epubPackage, opfXml, options);
  if (coverAsset) {
    if (coverAsset.buffer) {
      await replaceZipEntry(filePath, coverAsset.entryName, coverAsset.buffer);
    }
    opfXml = updateEpubCoverReferences(opfXml, epubPackage.opfPath, coverAsset.entryName, coverAsset.mediaType);
    const coverPageEntryName = defaultEpubCoverPageEntryName(epubPackage, opfXml);
    const coverPage = updateEpubCoverPageReferences(opfXml, epubPackage.opfPath, coverPageEntryName);
    opfXml = coverPage.opfXml;
    await replaceZipEntry(filePath, coverPageEntryName, buildEpubCoverPageXml(coverPageEntryName, coverAsset.entryName));
  }
  await replaceZipEntry(filePath, epubPackage.opfPath, opfXml);
  return true;
}

async function injectPdfMetadata(filePath, metadata) {
  await writePdfMetadata(filePath, metadata);
  return true;
}

async function injectComicInfoFastZip(filePath, metadata, options = {}) {
  const support = metadataWriteSupport(filePath, options.lang);
  if (!support.supported) throw new Error(support.message);
  await replaceZipEntryAppendOnly(filePath, 'ComicInfo.xml', createComicInfoXml(metadata), {
    removeMatchingBasename: true,
    beforeWrite: options.beforeWrite,
  });
  return true;
}

async function injectComicInfo(filePath, metadata, sevenZExe, lang = 'ko') {
  const support = metadataWriteSupport(filePath, lang);
  if (!support.supported) throw new Error(support.message);

  if (isZipArchive(filePath)) {
    await replaceZipEntry(filePath, 'ComicInfo.xml', createComicInfoXml(metadata), {
      removeMatchingBasename: true,
    });
    return true;
  }

  if (!sevenZExe) throw new Error(missingBinaryMessage('7z'));

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'BookManager_Metadata_'));
  try {
    const xmlPath = path.join(tempDir, 'ComicInfo.xml');
    await fsp.writeFile(xmlPath, createComicInfoXml(metadata), 'utf8');
    try {
      await runProcess(sevenZExe, ['d', filePath, 'ComicInfo.xml', '-y']);
    } catch {
      // ComicInfo.xml이 없으면 삭제 단계는 실패할 수 있으므로 무시합니다.
    }
    await runProcess(sevenZExe, ['a', filePath, 'ComicInfo.xml', '-mx=0', '-mmt=on'], { cwd: tempDir });
    return true;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export async function saveMetadataItems(items, options = {}, onProgress) {
  const sevenZExe = options.sevenZExe;

  const targets = (items || []).filter(item => item.checked !== false);
  const stats = { success: [], skip: [], error: [] };
  let cancelled = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const item = targets[index];
    onProgress?.({
      progress: Math.round((index / Math.max(targets.length, 1)) * 100),
      message: taskText(options.lang, 'task_metadata_saving', { index: index + 1, total: targets.length, name: item.name }),
    });

    const filePath = item.filepath || item.path || '';
    const extension = path.extname(filePath);
    const token = `${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const tempArchive = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath, extension)}.bookmanager_metadata_${token}${extension}`,
    );
    const sourceHoldingPath = `${filePath}.bookmanager.metadata.old`;
    try {
      if (isDocument(filePath) && !isEpub(filePath) && !isPdf(filePath)) {
        await persistDocumentMetadata(item, options);
        stats.success.push(item.name || path.basename(filePath));
        continue;
      }

      const support = metadataWriteSupport(filePath, options.lang);
      if (!support.supported) {
        stats.skip.push(`${item.name || filePath} - ${support.message}`);
        continue;
      }

      if (!isEpub(filePath) && !isPdf(filePath) && !(await hasComicInfoMetadataChanges(filePath, item.metadata || {}, sevenZExe))) {
        stats.success.push(item.name || path.basename(filePath));
        continue;
      }

      if (isZipArchive(filePath)) {
        let backupCreated = false;
        try {
          await injectComicInfoFastZip(filePath, item.metadata || {}, {
            lang: options.lang,
            beforeWrite: async () => {
              if (options.backup_on && !backupCreated) {
                await createMetadataBackup(filePath, extension, token);
                backupCreated = true;
              }
            },
          });
          await persistDocumentMetadataIfPossible(item, options).catch(() => {});
          stats.success.push(item.name || path.basename(filePath));
          continue;
        } catch (error) {
          if (error.code !== 'ZIP_APPEND_UNSUPPORTED') throw error;
        }
      }

      await fsp.copyFile(filePath, tempArchive);
      if (isEpub(filePath)) {
        await injectEpubMetadata(tempArchive, item.metadata || {}, options.lang, item.epubCoverChange || null, options);
      } else if (isPdf(filePath)) {
        await injectPdfMetadata(tempArchive, item.metadata || {}, options.lang);
      } else {
        await injectComicInfo(tempArchive, item.metadata || {}, sevenZExe, options.lang);
      }
      if (options.shouldCancel?.()) {
        cancelled = true;
        break;
      }

      if (options.backup_on) {
        await createMetadataBackup(filePath, extension, token);
      }

      await fsp.rm(sourceHoldingPath, { force: true }).catch(() => {});
      await fsp.rename(filePath, sourceHoldingPath);
      try {
        await fsp.rename(tempArchive, filePath);
      } catch (error) {
        await fsp.rm(filePath, { force: true }).catch(() => {});
        if (fs.existsSync(sourceHoldingPath)) {
          await fsp.rename(sourceHoldingPath, filePath);
        }
        throw error;
      }
      await fsp.rm(sourceHoldingPath, { force: true }).catch(error => {
        console.warn(`[Metadata] Previous source cleanup failed: ${sourceHoldingPath}`, error.message);
      });
      await persistDocumentMetadataIfPossible(item, options).catch(() => {});
      await refreshChangedEpubCoverThumbnail(item, filePath, options);
      stats.success.push(item.name || path.basename(filePath));
    } catch (error) {
      stats.error.push(`${item.name || filePath} - ${error.message}`);
    } finally {
      await fsp.rm(tempArchive, { force: true }).catch(() => {});
      if (fs.existsSync(sourceHoldingPath) && !fs.existsSync(filePath)) {
        await fsp.rename(sourceHoldingPath, filePath).catch(() => {});
      }
    }
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
  }

  if (!cancelled) {
    onProgress?.({ progress: 100, message: taskText(options.lang, 'task_done') });
  }
  return { stats, cancelled };
}
