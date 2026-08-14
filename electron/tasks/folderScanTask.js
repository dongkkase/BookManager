import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LibraryDB } from '../database/library_db.js';
import { shouldSkipScanDirectoryEntry } from '../scanExclusions.js';
import { SCAN_TARGET_EXTENSIONS } from '../scanTargets.js';
import {
  listZipEntriesFromFile,
  readZipEntryFromFile,
} from '../core/zipArchive.js';
import { translate } from '../../src/utils/i18n.js';
import { normalizeMetadataFormat } from '../metadataFormat.js';
import { resolveBookType } from '../../src/metadata/metadataTypes.js';
import { isBrokenPipeError } from '../utils/consolePipeGuard.js';
import {
  analyzePdfDocument,
  pdfMetadataToArchiveMetadata,
} from '../pdfMetadata.js';

const DEFAULT_TARGET_EXTS = SCAN_TARGET_EXTENSIONS;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
const MAX_INLINE_COVER_BYTES = 12 * 1024 * 1024;
const PDF_THUMBNAIL_CACHE_PREFIX = 'pdf-first-page-v2-';
const KO_NUMERIC_COLLATOR = new Intl.Collator('ko', { numeric: true });
const execFileAsync = promisify(execFile);
let folderScanStdoutBroken = false;
let folderUtilsPromise = null;

function safeFolderScanLog(message) {
  if (folderScanStdoutBroken) return;
  try {
    console.log(message);
  } catch (error) {
    if (!isBrokenPipeError(error)) throw error;
    folderScanStdoutBroken = true;
  }
}

function taskText(lang, key, values) {
  return translate(key, lang || 'ko', values);
}

function createTaskCancelledError(lang) {
  const error = new Error(taskText(lang, 'msg_cancelled'));
  error.code = 'TASK_CANCELLED';
  return error;
}

function throwIfTaskCancelled(options) {
  if (typeof options?.shouldCancel === 'function' && options.shouldCancel()) {
    throw createTaskCancelledError(options.lang);
  }
}

async function getFolderUtils() {
  if (!folderUtilsPromise) {
    const folderUtilsUrl = new URL('../../src/utils/folderUtils.js', import.meta.url);
    folderUtilsPromise = import(folderUtilsUrl);
  }
  return folderUtilsPromise;
}

async function extractFilenameMetadata(name) {
  try {
    const { extractCoreTitle, extractVolNumbers } = await getFolderUtils();
    const normalizedName = String(name || '').normalize('NFC');
    const stem = path.parse(normalizedName).name;
    const series = extractCoreTitle(stem);
    const vols = extractVolNumbers(stem, series);
    const volume = vols.length > 0 ? (vols.length === 1 ? String(vols[0]) : `${vols[0]}~${vols[vols.length - 1]}`) : '';
    return { series, volume, sorted_volume: vols[0] || null, nums: vols };
  } catch (err) {
    console.warn('Failed to extract filename metadata:', err);
    return { series: path.parse(name).name, volume: '', sorted_volume: null, nums: [] };
  }
}

function decodeXmlEntities(value = '') {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeXmlText(value = '') {
  return decodeXmlEntities(String(value || ''))
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

function parseXmlAttributes(tag = '') {
  const attrs = {};
  const attrPattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrPattern)) {
    attrs[match[1].toLowerCase()] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function xmlNamePattern(tagName = '', options = {}) {
  if (options.allowNamespaceAlias) {
    const localName = String(tagName || '').split(':').pop();
    return `(?:[\\w.-]+:)?${escapeRegExp(localName)}`;
  }
  const escaped = escapeRegExp(tagName);
  if (options.allowPrefix && !String(tagName).includes(':')) {
    return `(?:[\\w.-]+:)?${escaped}`;
  }
  return escaped;
}

function xmlElementMatches(xml = '', tagName = '', options = {}) {
  const namePattern = xmlNamePattern(tagName, options);
  const pattern = new RegExp(`<(${namePattern})\\b([^>]*?)(?<!\\/)>([\\s\\S]*?)<\\/\\1>`, 'gi');
  return [...String(xml || '').matchAll(pattern)].map(match => ({
    tag: match[0],
    tagName: match[1],
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

function xmlElements(xml = '', tagName = '') {
  return xmlElementMatches(xml, tagName, {
    allowPrefix: true,
    allowNamespaceAlias: true,
  });
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

function firstXmlValue(xml = '', tagNames = []) {
  for (const tagName of tagNames) {
    const value = xmlElements(xml, tagName)[0]?.value || '';
    if (value) return value;
  }
  return '';
}

function allXmlValues(xml = '', tagNames = []) {
  return tagNames.flatMap(tagName => xmlElements(xml, tagName).map(element => element.value)).filter(Boolean);
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

function findArchiveEntry(entries = [], entryPath = '') {
  const normalized = normalizeArchivePath(entryPath).toLowerCase();
  return entries.find(entry => normalizeArchivePath(entry.name).toLowerCase() === normalized) || null;
}

function resolveEpubHref(opfPath = '', href = '') {
  const cleanHref = decodeUriPath(decodeXmlEntities(String(href || '').split('#')[0]));
  if (!cleanHref) return '';
  return normalizeArchivePath(path.posix.join(path.posix.dirname(normalizeArchivePath(opfPath)), cleanHref));
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
    if (coverEntry && IMAGE_EXTS.includes(path.extname(coverEntry.name).toLowerCase())) return coverEntry;
  }

  return entries
    .filter(entry => IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !entry.isDirectory)
    .sort((a, b) => {
      const aCover = /(^|[/_-])cover[^/]*\./i.test(a.name) ? 0 : 1;
      const bCover = /(^|[/_-])cover[^/]*\./i.test(b.name) ? 0 : 1;
      return aCover - bCover || a.name.localeCompare(b.name, 'ko', { numeric: true });
    })[0] || null;
}

function readXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? normalizeXmlText(match[1]) : '';
}

function metadataInnerXml(opfXml = '') {
  return xmlElementMatches(opfXml, 'metadata', { allowPrefix: true })[0]?.rawValue || '';
}

function packageAttributes(opfXml = '') {
  const tag = xmlStartTags(opfXml, 'package', { allowPrefix: true })[0]?.tag || '';
  return parseXmlAttributes(tag);
}

function epubMetaElements(metadataXml = '') {
  const paired = xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, allowNamespaceAlias: true }).map(element => ({
    ...element,
    key: String(element.attrs.name || element.attrs.property || '').toLowerCase(),
    value: normalizeMetadataText(element.attrs.content || element.value || ''),
  }));
  const selfClosing = xmlSelfClosingElements(metadataXml, 'meta', { allowPrefix: true, allowNamespaceAlias: true }).map(element => {
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

function parseEpubDate(value = '') {
  const match = String(value || '').match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
  if (!match) return {};
  return {
    Year: match[1] || '',
    Month: match[2] || '',
    Day: match[3] || '',
  };
}

function buildEpubPublishDate(metadata = {}) {
  const year = String(metadata.Year || '').trim();
  if (!year) return '';
  const parts = [year.padStart(4, '0')];
  const month = String(metadata.Month || '').trim();
  if (month) parts.push(month.padStart(2, '0'));
  const day = String(metadata.Day || '').trim();
  if (day) parts.push(day.padStart(2, '0'));
  return parts.join('-');
}

function normalizeIsbn(value = '') {
  return String(value || '').replace(/^urn:isbn:/i, '').replace(/^isbn:/i, '').trim();
}

function looksLikeIsbn(value = '') {
  const normalized = normalizeIsbn(value).replace(/[-\s]/g, '');
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(normalized);
}

function epubIdentifierMetadata(metadataXml = '', uniqueIdentifierId = '') {
  const identifiers = xmlElements(metadataXml, 'identifier');
  const preferred = identifiers.find(element => element.attrs.id === uniqueIdentifierId)
    || identifiers[0]
    || null;
  const isbnElement = identifiers.find(element => {
    const scheme = String(attrByLocalName(element.attrs, 'scheme') || '').toLowerCase();
    return scheme === 'isbn' || looksLikeIsbn(element.value);
  }) || preferred;
  return {
    identifier: preferred?.value || '',
    isbn: isbnElement ? normalizeIsbn(isbnElement.value) : '',
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
  for (const element of xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, allowNamespaceAlias: true })) {
    const property = String(element.attrs.property || '').toLowerCase();
    const refines = String(element.attrs.refines || '').replace(/^#/, '');
    if (property === 'role' && refines && element.value) {
      roles.set(refines, element.value);
    }
  }
  return roles;
}

function epubSeriesMetadata(metadataXml = '') {
  const metaElements = xmlElementMatches(metadataXml, 'meta', { allowPrefix: true, allowNamespaceAlias: true });
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

function parseEpubOpfMetadata(opfXml = '') {
  const metadataXml = metadataInnerXml(opfXml);
  if (!metadataXml) return {};

  const packageAttrs = packageAttributes(opfXml);
  const identifier = epubIdentifierMetadata(metadataXml, packageAttrs['unique-identifier'] || '');
  const roleMap = epubRoleMap(metadataXml);
  const creatorElements = xmlElements(metadataXml, 'creator');
  const writers = creatorElements
    .filter(element => !['trl', 'translator'].includes(elementRole(element, roleMap)))
    .map(element => element.value);
  const subjects = uniqueValues(allXmlValues(metadataXml, ['subject']));
  const publishDate = parseEpubDate(firstXmlValue(metadataXml, ['date']));
  const seriesMetadata = epubSeriesMetadata(metadataXml);
  const fallbackSeries = epubMetaValue(metadataXml, ['calibre:series', 'series']);
  const fallbackSeriesNumber = epubMetaValue(metadataXml, ['calibre:series_index', 'series_index', 'series-index', 'group-position']);

  const metadata = {
    Series: seriesMetadata.Series || fallbackSeries,
    Volume: normalizeEpubSeriesNumber(seriesMetadata.Volume || fallbackSeriesNumber),
    Title: firstXmlValue(metadataXml, ['title']),
    Writer: uniqueValues(writers).join(', '),
    Publisher: firstXmlValue(metadataXml, ['publisher']),
    Summary: firstXmlValue(metadataXml, ['description']),
    Genre: subjects[0] || '',
    Tags: subjects.slice(1).join(', '),
    ISBN: identifier.isbn,
    LanguageISO: firstXmlValue(metadataXml, ['language']),
    CommunityRating: epubMetaValue(metadataXml, ['schema:ratingValue', 'calibre:rating', 'rating', 'communityrating', 'community-rating']),
    Format: 'Novel',
    ...publishDate,
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => String(value || '').trim() !== ''),
  );
}

function parseComicInfo(xml) {
  if (!xml) return {};
  return {
    title: readXmlTag(xml, 'Title'),
    series: readXmlTag(xml, 'Series'),
    volume: readXmlTag(xml, 'Volume'),
    chapter: readXmlTag(xml, 'Number'),
    writer: readXmlTag(xml, 'Writer'),
    penciller: readXmlTag(xml, 'Penciller'),
    inker: readXmlTag(xml, 'Inker'),
    colorist: readXmlTag(xml, 'Colorist'),
    letterer: readXmlTag(xml, 'Letterer'),
    cover_artist: readXmlTag(xml, 'CoverArtist'),
    publisher: readXmlTag(xml, 'Publisher'),
    imprint: readXmlTag(xml, 'Imprint'),
    genre: readXmlTag(xml, 'Genre'),
    page_count: readXmlTag(xml, 'PageCount'),
    total_volume: readXmlTag(xml, 'Count'),
    format: readXmlTag(xml, 'Format'),
    description: readXmlTag(xml, 'Summary'),
    series_group: readXmlTag(xml, 'SeriesGroup'),
    tags: readXmlTag(xml, 'Tags'),
    characters: readXmlTag(xml, 'Characters'),
    story_arc: readXmlTag(xml, 'StoryArc'),
    notes: readXmlTag(xml, 'Notes'),
    link: readXmlTag(xml, 'Web'),
    language: readXmlTag(xml, 'LanguageISO'),
    manga: readXmlTag(xml, 'Manga'),
    age_rating: readXmlTag(xml, 'AgeRating'),
    rating: readXmlTag(xml, 'CommunityRating'),
    date: [
      readXmlTag(xml, 'Year'),
      readXmlTag(xml, 'Month'),
      readXmlTag(xml, 'Day'),
    ].filter(Boolean).join('-'),
  };
}

function getImageResolution(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  try {
    if (ext === '.png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
    }
    if ((ext === '.jpg' || ext === '.jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return `${buffer.readUInt16BE(offset + 7)}x${buffer.readUInt16BE(offset + 5)}`;
        }
        offset += 2 + length;
      }
    }
    if (ext === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      const chunk = buffer.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return `${width}x${height}`;
      }
    }
  } catch {
    return '';
  }
  return '';
}

async function saveThumbnail(imageBuffer, imageName, filePath, mtime, thumbnailDir, thumbnailEncoder, imageTransform = null) {
  if (!imageBuffer || !thumbnailDir) return '';
  const cachePrefix = path.extname(filePath).toLowerCase() === '.pdf' ? PDF_THUMBNAIL_CACHE_PREFIX : '';
  const encoded = typeof thumbnailEncoder === 'function'
    ? await thumbnailEncoder(imageBuffer, { imageName, filePath, mtime, thumbnailDir, imageTransform })
    : null;
  const outputBuffer = encoded?.buffer || imageBuffer;
  const hash = crypto.createHash('md5')
    .update(`${path.normalize(filePath)}_${mtime}`)
    .digest('hex');
  const extension = encoded?.extension || (IMAGE_EXTS.includes(path.extname(imageName).toLowerCase())
    ? path.extname(imageName).toLowerCase()
    : '.jpg');
  const thumbnailPath = path.join(thumbnailDir, `${cachePrefix}${hash}${extension}`);
  await fs.promises.mkdir(thumbnailDir, { recursive: true });
  await fs.promises.writeFile(thumbnailPath, outputBuffer);
  return thumbnailPath;
}

async function extractWith7Zip(filePath, sevenZExe, options = {}) {
  if (!sevenZExe) return {};
  if (options.skipCoverExtraction) {
    try {
      const extracted = await execFileAsync(sevenZExe, ['e', '-so', '-ssc-', '-r', filePath, 'ComicInfo.xml'], {
        encoding: 'buffer',
        maxBuffer: MAX_INLINE_COVER_BYTES,
        windowsHide: true,
      });
      if (!extracted.stdout?.length) return {};
      return {
        has_metadata: true,
        ...parseComicInfo(extracted.stdout.toString('utf8')),
      };
    } catch {
      return {};
    }
  }

  const { stdout } = await execFileAsync(sevenZExe, ['l', '-slt', filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  const entries = String(stdout || '')
    .split(/\r?\n/)
    .filter(line => line.startsWith('Path = '))
    .map(line => line.slice(7).trim())
    .filter(Boolean);
  const comicInfoName = entries.find(name => path.basename(name).toLowerCase() === 'comicinfo.xml');
  const imageName = entries
    .filter(name => IMAGE_EXTS.includes(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))[0];
  const result = {};

  if (comicInfoName) {
    result.has_metadata = true;
    const extracted = await execFileAsync(sevenZExe, ['e', '-so', filePath, comicInfoName], {
      encoding: 'buffer',
      maxBuffer: MAX_INLINE_COVER_BYTES,
      windowsHide: true,
    });
    Object.assign(result, parseComicInfo(extracted.stdout.toString('utf8')));
  }
  if (!options.skipCoverExtraction && imageName) {
    const extracted = await execFileAsync(sevenZExe, ['e', '-so', filePath, imageName], {
      encoding: 'buffer',
      maxBuffer: MAX_INLINE_COVER_BYTES,
      windowsHide: true,
    });
    result.imageBuffer = extracted.stdout;
    result.imageName = imageName;
    result.resolution = getImageResolution(extracted.stdout, imageName);
  }
  return result;
}

async function extractEpubMetadata(filePath, options = {}) {
  const entries = await listZipEntriesFromFile(filePath);
  const containerEntry = findArchiveEntry(entries, 'META-INF/container.xml');
  const result = {};
  let opfPath = '';
  let opfXml = '';

  if (containerEntry) {
    const containerBuffer = await readZipEntryFromFile(filePath, containerEntry, {
      maxBytes: MAX_INLINE_COVER_BYTES,
      maxCompressedBytes: MAX_INLINE_COVER_BYTES,
    });
    const containerXml = containerBuffer ? containerBuffer.toString('utf8') : '';
    const rootfileTag = String(containerXml || '').match(/<rootfile\b[^>]*>/i)?.[0] || '';
    const rootfileAttrs = parseXmlAttributes(rootfileTag);
    opfPath = normalizeArchivePath(rootfileAttrs['full-path'] || '');
  }

  const opfEntry = opfPath ? findArchiveEntry(entries, opfPath) : null;
  if (opfEntry) {
    const opfBuffer = await readZipEntryFromFile(filePath, opfEntry, {
      maxBytes: MAX_INLINE_COVER_BYTES,
      maxCompressedBytes: MAX_INLINE_COVER_BYTES,
    });
    opfXml = opfBuffer ? opfBuffer.toString('utf8') : '';
    const metadata = parseEpubOpfMetadata(opfXml);
    result.has_metadata = true;
    result.book_type = 'book';
    result.title = metadata.Title || readXmlTag(opfXml, 'dc:title') || readXmlTag(opfXml, 'title');
    result.series = metadata.Series || '';
    result.volume = metadata.Volume || '';
    result.writer = metadata.Writer || readXmlTag(opfXml, 'dc:creator') || readXmlTag(opfXml, 'creator');
    result.publisher = metadata.Publisher || readXmlTag(opfXml, 'dc:publisher') || readXmlTag(opfXml, 'publisher');
    result.language = metadata.LanguageISO || readXmlTag(opfXml, 'dc:language') || readXmlTag(opfXml, 'language');
    result.description = metadata.Summary || readXmlTag(opfXml, 'dc:description') || readXmlTag(opfXml, 'description');
    result.genre = metadata.Genre || '';
    result.tags = metadata.Tags || '';
    result.isbn = metadata.ISBN || '';
    result.rating = metadata.CommunityRating || '';
    result.date = buildEpubPublishDate(metadata);
    result.format = metadata.Format || 'Novel';
  }

  const coverEntry = options.skipCoverExtraction ? null : findEpubCoverEntry(entries, opfPath, opfXml);
  if (coverEntry) {
    const imageBuffer = await readZipEntryFromFile(filePath, coverEntry, {
      maxBytes: MAX_INLINE_COVER_BYTES,
      maxCompressedBytes: MAX_INLINE_COVER_BYTES,
    });
    if (imageBuffer) {
      result.imageBuffer = imageBuffer;
      result.imageName = coverEntry.name;
      result.resolution = getImageResolution(imageBuffer, coverEntry.name);
    }
  }

  return result;
}

async function extractArchiveMetadata(filePath, ext, options = {}) {
  try {
    let result = {};
    if (ext === '.zip' || ext === '.cbz') {
      const entries = await listZipEntriesFromFile(filePath);
      const comicInfoEntry = entries.find(entry => path.basename(entry.name).toLowerCase() === 'comicinfo.xml');

      if (comicInfoEntry) {
        result.has_metadata = true;
        const xmlBuffer = await readZipEntryFromFile(filePath, comicInfoEntry, {
          maxBytes: MAX_INLINE_COVER_BYTES,
          maxCompressedBytes: MAX_INLINE_COVER_BYTES,
        });
        if (xmlBuffer) Object.assign(result, parseComicInfo(xmlBuffer.toString('utf8')));
      }
      if (!options.skipCoverExtraction) {
        const imageEntry = entries
          .filter(entry => IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !entry.isDirectory)
          .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))[0];
        if (!imageEntry) return result;
        const imageBuffer = await readZipEntryFromFile(filePath, imageEntry, {
          maxBytes: MAX_INLINE_COVER_BYTES,
          maxCompressedBytes: MAX_INLINE_COVER_BYTES,
        });
        if (imageBuffer) {
          result.imageBuffer = imageBuffer;
          result.imageName = imageEntry.name;
          result.resolution = getImageResolution(imageBuffer, imageEntry.name);
        }
      }
    } else if (['.rar', '.cbr', '.7z', '.cb7'].includes(ext)) {
      result = await extractWith7Zip(filePath, options.sevenZExe, options);
    } else if (ext === '.epub') {
      result = await extractEpubMetadata(filePath, options);
    } else if (ext === '.pdf') {
      const pdfAnalysis = await analyzePdfDocument(filePath, { includeCover: options.skipCoverExtraction !== true });
      result = {
        ...pdfMetadataToArchiveMetadata(pdfAnalysis.metadata || {}),
        has_metadata: pdfAnalysis.hasMetadata,
        page_count: pdfAnalysis.pageCount ? String(pdfAnalysis.pageCount) : '',
      };
      if (pdfAnalysis.cover?.buffer) {
        result.imageBuffer = pdfAnalysis.cover.buffer;
        result.imageName = pdfAnalysis.cover.imageName;
        result.imageTransform = pdfAnalysis.cover.imageTransform || null;
        result.resolution = `${pdfAnalysis.cover.width}x${pdfAnalysis.cover.height}`;
      }
    }

    if (result.imageBuffer) {
      result.thumb_path = await saveThumbnail(
        result.imageBuffer,
        result.imageName,
        filePath,
        options.mtime,
        options.thumbnailDir,
        options.thumbnailEncoder,
        result.imageTransform,
      );
    }
    delete result.imageBuffer;
    delete result.imageName;
    delete result.imageTransform;
    return result;
  } catch (error) {
    console.warn(`Failed to extract archive metadata: ${filePath}`, error.message);
    return {};
  }
}

function metadataFromCache(cached = {}) {
  const hasMetadata = [
    cached.title,
    cached.series,
    cached.series_group,
    cached.volume,
    cached.number,
    cached.writer,
    cached.publisher,
    cached.summary,
  ].some(Boolean);
  return {
    title: cached.title || '',
    series: cached.series || '',
    volume: cached.volume || '',
    chapter: cached.number || '',
    writer: cached.writer || '',
    publisher: cached.publisher || '',
    imprint: cached.imprint || '',
    genre: cached.genre || '',
    page_count: cached.page_count || '',
    total_volume: cached.volume_count || '',
    description: cached.summary || '',
    series_group: cached.series_group || '',
    tags: cached.tags || '',
    characters: cached.characters || '',
    teams: cached.teams || '',
    locations: cached.locations || '',
    story_arc: cached.story_arc || '',
    notes: cached.notes || '',
    link: cached.web || '',
    language: cached.language || '',
    manga: cached.manga || '',
    age_rating: cached.age_rating || '',
    rating: cached.rating || '',
    date: cached.publish_date || '',
    format: normalizeMetadataFormat(cached.format),
    isbn: cached.isbn || '',
    book_type: resolveBookType({ path: cached.path, ext: cached.ext, book_type: cached.book_type }),
    resolution: cached.resolution || '',
    producer: cached.creators || '',
    creator: '',
    trapped: '',
    creation_date: '',
    modified_date: '',
    metadata_date: '',
    pdf_version: '',
    has_metadata: hasMetadata,
    thumb_path: cached.thumb_path || '',
  };
}

function thumbnailUrlForPath(thumbnailPath) {
  if (!thumbnailPath || !fs.existsSync(thumbnailPath)) return '';
  let version = '';
  try {
    version = `?v=${Math.round(fs.statSync(thumbnailPath).mtimeMs)}`;
  } catch {
    version = '';
  }
  return `bookmanager-thumbnail://cache/${encodeURIComponent(path.basename(thumbnailPath))}${version}`;
}

function isValidCache(cached, stats) {
  return Boolean(
    cached
    && Math.abs(Number(cached.mtime) - stats.mtimeMs / 1000) < 2
    && Number(cached.size) === stats.size,
  );
}

function isSameFileSnapshot(previousStats, currentStats) {
    if (!previousStats || !currentStats) return false;
    for (const key of ['size', 'mtimeMs', 'ctimeMs']) {
        const previousValue = Number(previousStats[key]);
        const currentValue = Number(currentStats[key]);
        if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue) || previousValue !== currentValue) {
            return false;
        }
    }
    for (const key of ['dev', 'ino']) {
        const previousValue = Number(previousStats[key]);
        const currentValue = Number(currentStats[key]);
        if (
            Number.isFinite(previousValue)
            && previousValue > 0
            && Number.isFinite(currentValue)
            && currentValue > 0
            && previousValue !== currentValue
        ) {
            return false;
        }
    }
    return true;
}

async function discardGeneratedThumbnail(thumbnailPath, thumbnailDir) {
    if (!thumbnailPath || !thumbnailDir) return;
    const resolvedDirectory = path.resolve(thumbnailDir);
    const resolvedThumbnail = path.resolve(thumbnailPath);
    const relativePath = path.relative(resolvedDirectory, resolvedThumbnail);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return;
    await fs.promises.rm(resolvedThumbnail, { force: true }).catch(() => {});
}

function hasCurrentCachedThumbnail(cached, ext) {
  if (!cached?.thumb_path || !fs.existsSync(cached.thumb_path) || fs.statSync(cached.thumb_path).size <= 0) {
    return false;
  }
  if (ext !== '.pdf') return true;
  return path.basename(cached.thumb_path).startsWith(PDF_THUMBNAIL_CACHE_PREFIX);
}

function createQuickFileData(fullPath) {
  const name = path.basename(fullPath);
  const folderPath = path.dirname(fullPath);
  const ext = path.extname(name).toLowerCase();
  const title = path.parse(name).name;
  const bookType = resolveBookType({ path: fullPath, ext });

  return {
    name,
    path: fullPath,
    folder_path: folderPath,
    full_path: fullPath,
    ext,
    book_type: bookType,
    bookType,
    format: '',
    size: 0,
    mtime: 0,
    ctime: 0,
    created: '',
    modified: '',
    is_folder: false,
    series: '',
    title,
    volume: '',
    sorted_volume: null,
    compare_nums: [],
    chapter: '',
    author: '',
    writer: '',
    penciller: '',
    inker: '',
    colorist: '',
    letterer: '',
    cover_artist: '',
    producer: '',
    publisher: '',
    imprint: '',
    genre: '',
    total_volume: '',
    page_count: '',
    description: '',
    series_group: '',
    tags: '',
    characters: '',
    teams: '',
    locations: '',
    story_arc: '',
    notes: '',
    link: '',
    isbn: '',
    language: '',
    manga: '',
    age_rating: '',
    rating: '',
    date: '',
    has_metadata: false,
    resolution: '',
    thumb_path: '',
    cover: '',
    cache_source: 'quick',
    duplicate_matches: [],
    dup_count: 0,
    max_ratio: 0,
  };
}

function sortEntriesForPriority(entries = []) {
  return [...entries].sort((left, right) => {
    if (left.isFile() !== right.isFile()) return left.isFile() ? -1 : 1;
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return KO_NUMERIC_COLLATOR.compare(left.name, right.name);
  });
}

function normalizeForCompare(text = '') {
  const synonyms = {
    '블랙': '검은', black: '검은', '화이트': '흰', white: '흰',
    '레드': '빨간', red: '빨간', '블루': '파란', blue: '파란',
    '그린': '녹색', green: '녹색', love: '사랑', hell: '지옥',
    hero: '영웅', heroes: '영웅', king: '왕', god: '신',
    dark: '어둠', '다크': '어둠', new: '새로운', super: '슈퍼',
    dragon: '드래곤', hunter: '헌터', master: '마스터',
    legend: '전설', world: '세계', sword: '검',
  };
  const stopwords = ['만화책', '만화', '코믹스', 'e북', 'ebook', '완결', '합본', '웹툰', '단행본', '시리즈', '총집편', '풀컬러', 'in', 'the', 'of', 'a', 'an', '미완'];
  let value = String(text || '').normalize('NFC').toLowerCase();
  for (const word of stopwords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/^[a-z]+$/.test(word)) {
      value = value.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
    } else {
      value = value.replace(new RegExp(`(?<![가-힣a-z])${escaped}(?![가-힣a-z])`, 'gi'), '');
    }
  }
  for (const [from, to] of Object.entries(synonyms)) value = value.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  return value.replace(/[^가-힣a-z0-9]/g, '');
}

function normalizeFilenameForCompare(name = '') {
  const normalizedName = String(name || '').normalize('NFC');
  return normalizeForCompare(path.parse(normalizedName).name);
}

function filenameNumberTokens(name = '') {
  const stem = path.parse(String(name || '').normalize('NFC')).name;
  return (stem.match(/\d+(?:\.\d+)?/g) || []).map(value => {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : value;
  });
}

function duplicateCandidateNumberKey(name = '') {
  return JSON.stringify(filenameNumberTokens(name));
}

function sameFilenameNumbers(aName = '', bName = '') {
  const aNums = filenameNumberTokens(aName);
  const bNums = filenameNumberTokens(bName);
  if (aNums.length !== bNums.length) return false;
  return aNums.every((value, index) => value === bNums[index]);
}

function bigrams(text) {
  if (!text) return new Set();
  const values = new Set();
  for (let i = 0; i < text.length - 1; i += 1) values.add(text.slice(i, i + 2));
  return values;
}

function longestSequenceMatch(a, b, aStart, aEnd, bStart, bEnd) {
  let previous = new Array(bEnd - bStart + 1).fill(0);
  let best = { a: aStart, b: bStart, size: 0 };
  for (let aIndex = aStart; aIndex < aEnd; aIndex += 1) {
    const current = new Array(bEnd - bStart + 1).fill(0);
    for (let bIndex = bStart; bIndex < bEnd; bIndex += 1) {
      if (a[aIndex] !== b[bIndex]) continue;
      const relative = bIndex - bStart;
      current[relative + 1] = previous[relative] + 1;
      if (current[relative + 1] > best.size) {
        best = {
          a: aIndex - current[relative + 1] + 1,
          b: bIndex - current[relative + 1] + 1,
          size: current[relative + 1],
        };
      }
    }
    previous = current;
  }
  return best;
}

function* sequenceMatcherBlocks(a, b) {
  function* blocks(aStart, aEnd, bStart, bEnd) {
    const match = longestSequenceMatch(a, b, aStart, aEnd, bStart, bEnd);
    if (match.size === 0) return;
    yield* blocks(aStart, match.a, bStart, match.b);
    yield match;
    yield* blocks(match.a + match.size, aEnd, match.b + match.size, bEnd);
  }

  yield* blocks(0, a.length, 0, b.length);
}

function sequenceMatcherRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const matches = [...sequenceMatcherBlocks(a, b)].reduce((total, block) => total + block.size, 0);
  return (2 * matches) / (a.length + b.length);
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (aBigrams.size > 0 && bBigrams.size > 0 && [...aBigrams].every(value => !bBigrams.has(value))) {
    return 0;
  }

  const standardRatio = sequenceMatcherRatio(a, b);
  const matchLength = [...sequenceMatcherBlocks(a, b)].reduce((total, block) => total + block.size, 0);
  const minLength = Math.min(a.length, b.length);
  const containedRatio = minLength > 0 ? matchLength / minLength : 0;
  let score = (standardRatio + containedRatio) / 2;

  if (containedRatio >= 0.9) {
    score = Math.max(score, 0.75);
    if (minLength <= 3 && standardRatio < 0.4) {
      score *= 0.8;
    }
  }

  return score;
}

async function buildDupCache(dupFolders, targetExts, event, lang = 'ko', options = {}) {
  const cache = [];
  const seen = new Set();
  const targetExtSet = targetExts instanceof Set ? targetExts : new Set(targetExts);

  function addCandidate(record = {}) {
    const fullPath = record.full_path || record.file_path || record.path || '';
    if (!fullPath || seen.has(fullPath)) return;
    const name = String(record.name || path.basename(fullPath)).normalize('NFC');
    if (!targetExtSet.has(path.extname(name).toLowerCase())) return;
    seen.add(fullPath);
    cache.push({
      name,
      path: record.path || path.dirname(fullPath),
      full_path: fullPath,
      size: Number(record.size) || 0,
      compareTitle: normalizeFilenameForCompare(name),
    });
  }

  async function addFilePath(fullPath) {
    if (!fullPath || seen.has(fullPath)) return;
    if (!targetExtSet.has(path.extname(fullPath).toLowerCase())) return;
    try {
      const stats = await fs.promises.stat(fullPath);
      addCandidate({
        name: path.basename(fullPath),
        path: path.dirname(fullPath),
        full_path: fullPath,
        size: stats.size,
      });
    } catch {
      // Ignore unreadable duplicate target files.
    }
  }

  async function scanDir(currentPath) {
    throwIfTaskCancelled(options);
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldSkipScanDirectoryEntry(entry)) continue;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        await addFilePath(fullPath);
      }
    }
  }

  for (const folder of dupFolders || []) {
    throwIfTaskCancelled(options);
    if (!folder || !fs.existsSync(folder)) continue;
    let indexedRows = [];
    if (options.libraryDb && !options.libraryDb.__bookManagerUnavailable) {
      try {
        indexedRows = await options.libraryDb.getTargetIndex(folder);
      } catch (error) {
        options.libraryDb.__bookManagerUnavailable = true;
        console.warn(`[FolderScan] duplicate index unavailable; falling back to directory scan: ${error.message}`);
      }
    }
    if (indexedRows.length > 0) {
      for (const row of indexedRows) {
        throwIfTaskCancelled(options);
        addCandidate(row);
      }
    } else {
      await scanDir(folder);
    }
  }

  if (event && cache.length) {
    event.sender.send('scan-progress', {
      progress: 85,
      message: taskText(lang, 'task_dup_index_done', { count: cache.length }),
    });
  }

  return cache;
}

function attachDuplicateMatches(files, dupCache) {
  if (!dupCache.length) return files;
  const candidatesByNumberKey = new Map();
  for (const candidate of dupCache) {
    const key = duplicateCandidateNumberKey(candidate.name);
    if (!candidatesByNumberKey.has(key)) candidatesByNumberKey.set(key, []);
    candidatesByNumberKey.get(key).push(candidate);
  }

  return files.map(file => {
    const compareTitle = normalizeFilenameForCompare(file.name || file.full_path);
    const matches = [];
    if (compareTitle.length < 2) {
      return {
        ...file,
        duplicate_matches: [],
        dup_count: 0,
        max_ratio: 0,
      };
    }

    const normalizedFilePath = path.normalize(file.full_path);
    const candidates = candidatesByNumberKey.get(duplicateCandidateNumberKey(file.name || file.full_path)) || [];
    for (const candidate of candidates) {
      if (path.normalize(candidate.full_path) === normalizedFilePath) continue;
      if (candidate.compareTitle.length < 2) continue;
      if (!sameFilenameNumbers(file.name || file.full_path, candidate.name)) continue;

      const ratio = similarity(compareTitle, candidate.compareTitle);
      if (ratio >= 0.7) {
        matches.push({
          path: candidate.full_path,
          folder: candidate.path,
          name: candidate.name,
          size: candidate.size,
          ratio: Math.round(ratio * 1000) / 10,
        });
      }
    }

    matches.sort((a, b) => b.ratio - a.ratio);
    return {
      ...file,
      duplicate_matches: matches,
      dup_count: matches.length,
      max_ratio: matches[0]?.ratio || 0,
    };
  });
}

async function safeGetCachedFileInfo(libraryDb, fullPath) {
  if (!libraryDb || libraryDb.__bookManagerUnavailable) return null;
  try {
    return await libraryDb.getFileInfo(fullPath);
  } catch (error) {
    libraryDb.__bookManagerUnavailable = true;
    console.warn(`[FolderScan] Library DB unavailable; continuing without cache: ${error.message}`);
    return null;
  }
}

async function safeUpsertFileInfo(libraryDb, info) {
  if (!libraryDb || libraryDb.__bookManagerUnavailable) return;
  try {
    await libraryDb.upsertFileInfo(info);
  } catch (error) {
    libraryDb.__bookManagerUnavailable = true;
    console.warn(`[FolderScan] Library DB update failed; continuing without cache: ${error.message}`);
  }
}

async function createFileData(fullPath, stats, options = {}, sourceChangeRetryCount = 0) {
  const name = path.basename(fullPath);
  const folderPath = path.dirname(fullPath);
  const ext = path.extname(name).toLowerCase();
  const bookType = resolveBookType({ path: fullPath, ext });
  const filenameMeta = await extractFilenameMetadata(name);
  const cached = options.skipLibraryCache === true
    ? null
    : await safeGetCachedFileInfo(options.libraryDb, fullPath);
  const cacheValid = options.force !== true && isValidCache(cached, stats);
  const cachedThumbnailExists = hasCurrentCachedThumbnail(cached, ext);
  const shouldRefreshEpubMetadata = cacheValid
    && ext === '.epub'
    && normalizeMetadataFormat(cached?.format) !== 'Novel';
  let archiveMeta = cacheValid ? metadataFromCache(cached) : {};
  const shouldExtractArchive = options.skipArchiveExtraction !== true;
  const shouldRefreshMissingThumbnail = options.skipCoverExtraction !== true && !cachedThumbnailExists;

  if (shouldExtractArchive && (!cacheValid || shouldRefreshMissingThumbnail || shouldRefreshEpubMetadata)) {
    const extracted = await extractArchiveMetadata(fullPath, ext, {
      sevenZExe: options.sevenZExe,
      thumbnailDir: options.thumbnailDir,
      mtime: stats.mtimeMs,
      size: stats.size,
      thumbnailEncoder: options.thumbnailEncoder,
      skipCoverExtraction: options.skipCoverExtraction === true,
    });
    let latestStats;
    try {
      latestStats = await fs.promises.stat(fullPath);
    } catch (error) {
      await discardGeneratedThumbnail(extracted.thumb_path, options.thumbnailDir);
      throw error;
    }
    if (!isSameFileSnapshot(stats, latestStats)) {
      await discardGeneratedThumbnail(extracted.thumb_path, options.thumbnailDir);
      if (sourceChangeRetryCount < 1) {
        return createFileData(fullPath, latestStats, options, sourceChangeRetryCount + 1);
      }
      console.warn(`[FolderScan] File changed repeatedly during metadata extraction: ${fullPath}`);
      return createFileData(fullPath, latestStats, {
        ...options,
        skipArchiveExtraction: true,
        skipLibraryCache: true,
      }, sourceChangeRetryCount + 1);
    }
    archiveMeta = {
      ...(cacheValid ? archiveMeta : {}),
      ...extracted,
    };
    if (options.libraryDb && options.skipLibraryCache !== true) {
      let thumbnailPathForCache = archiveMeta.thumb_path || cached?.thumb_path || '';
      if (!thumbnailPathForCache && options.skipCoverExtraction === true) {
        const latestCached = await safeGetCachedFileInfo(options.libraryDb, fullPath);
        thumbnailPathForCache = latestCached?.thumb_path || '';
      }
      if (thumbnailPathForCache) archiveMeta.thumb_path = thumbnailPathForCache;
      await safeUpsertFileInfo(options.libraryDb, {
        path: fullPath,
        mtime: stats.mtimeMs / 1000,
        size: stats.size,
        ext,
        resolution: archiveMeta.resolution || '',
        title: archiveMeta.title || path.parse(name).name,
        series: archiveMeta.series || filenameMeta.series || '',
        series_group: archiveMeta.series_group || '',
        volume: archiveMeta.volume || filenameMeta.volume || '',
        number: archiveMeta.chapter || '',
        writer: archiveMeta.writer || '',
        creators: archiveMeta.producer || '',
        publisher: archiveMeta.publisher || '',
        imprint: archiveMeta.imprint || '',
        genre: archiveMeta.genre || '',
        volume_count: archiveMeta.total_volume || '',
        page_count: archiveMeta.page_count || '',
        format: normalizeMetadataFormat(archiveMeta.format),
        manga: archiveMeta.manga || '',
        language: archiveMeta.language || '',
        rating: archiveMeta.rating || '',
        age_rating: archiveMeta.age_rating || '',
        publish_date: archiveMeta.date || '',
        summary: archiveMeta.description || '',
        characters: archiveMeta.characters || '',
        teams: '',
        locations: '',
        story_arc: archiveMeta.story_arc || '',
        tags: archiveMeta.tags || '',
        notes: archiveMeta.notes || '',
        web: archiveMeta.link || '',
        isbn: archiveMeta.isbn || '',
        book_type: archiveMeta.book_type || bookType,
        thumb_path: thumbnailPathForCache,
      });
    }
  }

  const series = archiveMeta.series || filenameMeta.series || '';
  const volume = archiveMeta.volume || filenameMeta.volume || '';
  const thumbnailPath = archiveMeta.thumb_path && fs.existsSync(archiveMeta.thumb_path)
    ? archiveMeta.thumb_path
    : '';

  return {
    name,
    path: fullPath,
    folder_path: folderPath,
    full_path: fullPath,
    ext,
    book_type: archiveMeta.book_type || bookType,
    bookType: archiveMeta.book_type || bookType,
    format: normalizeMetadataFormat(archiveMeta.format),
    size: stats.size,
    mtime: stats.mtimeMs,
    ctime: stats.ctimeMs,
    created: new Date(stats.birthtimeMs).toISOString(),
    modified: new Date(stats.mtimeMs).toISOString(),
    is_folder: false,
    series,
    title: archiveMeta.title || path.parse(name).name,
    volume,
    sorted_volume: filenameMeta.sorted_volume,
    compare_nums: filenameMeta.nums || [],
    chapter: archiveMeta.chapter || '',
    author: archiveMeta.writer || archiveMeta.penciller || '',
    writer: archiveMeta.writer || '',
    penciller: archiveMeta.penciller || '',
    inker: archiveMeta.inker || '',
    colorist: archiveMeta.colorist || '',
    letterer: archiveMeta.letterer || '',
    cover_artist: archiveMeta.cover_artist || '',
    producer: archiveMeta.producer || [
      archiveMeta.writer,
      archiveMeta.penciller,
      archiveMeta.inker,
      archiveMeta.colorist,
      archiveMeta.letterer,
      archiveMeta.cover_artist,
    ].filter(Boolean).join(', '),
    creator: archiveMeta.creator || '',
    publisher: archiveMeta.publisher || '',
    imprint: archiveMeta.imprint || '',
    genre: archiveMeta.genre || '',
    total_volume: archiveMeta.total_volume || '',
    page_count: archiveMeta.page_count || '',
    description: archiveMeta.description || '',
    series_group: archiveMeta.series_group || '',
    tags: archiveMeta.tags || '',
    characters: archiveMeta.characters || '',
    teams: '',
    locations: '',
    story_arc: archiveMeta.story_arc || '',
    notes: archiveMeta.notes || '',
    link: archiveMeta.link || '',
    isbn: archiveMeta.isbn || '',
    language: archiveMeta.language || '',
    manga: archiveMeta.manga || '',
    age_rating: archiveMeta.age_rating || '',
    rating: archiveMeta.rating || '',
    date: archiveMeta.date || '',
    trapped: archiveMeta.trapped || '',
    creation_date: archiveMeta.creation_date || '',
    modified_date: archiveMeta.modified_date || '',
    metadata_date: archiveMeta.metadata_date || '',
    pdf_version: archiveMeta.pdf_version || '',
    has_metadata: archiveMeta.has_metadata === true,
    resolution: archiveMeta.resolution || '',
    thumb_path: thumbnailPath,
    cover: thumbnailUrlForPath(thumbnailPath),
    cache_source: cacheValid && cachedThumbnailExists ? 'library' : 'archive',
    duplicate_matches: [],
    dup_count: 0,
    max_ratio: 0,
  };
}

export async function inspectFolderFile(fullPath, options = {}) {
  const stats = await fs.promises.stat(fullPath);
  if (!stats.isFile()) {
    return {
      name: path.basename(fullPath),
      path: fullPath,
      full_path: fullPath,
      is_folder: stats.isDirectory(),
      size: stats.size,
      resolution: '',
      cover: '',
    };
  }
  const libraryDb = options.libraryDb || (options.dbPath ? new LibraryDB({ dbPath: options.dbPath }) : null);
  try {
    return await createFileData(fullPath, stats, {
      ...options,
      libraryDb,
    });
  } finally {
    if (!options.libraryDb) await libraryDb?.close();
  }
}

export async function scanFolder(folderPath, options = {}, event) {
  const {
    includeSubfolders = true,
    enableDupCheck = false,
    dupFolders = [],
    targetExts = DEFAULT_TARGET_EXTS,
    dbPath,
    thumbnailDir,
    sevenZExe,
    force = false,
    skipArchiveExtraction = false,
    skipCoverExtraction = false,
    skipLibraryCache = false,
    quickListOnly = false,
    suppressEvents = false,
    thumbnailEncoder,
    lang = 'ko',
  } = options;
  const normalizedExts = targetExts.map(ext => ext.toLowerCase());
  const normalizedExtSet = new Set(normalizedExts);
  const results = [];
  let scannedCount = 0;
  let matchedCount = 0;
  const shouldUseLibraryDb = !quickListOnly && (skipLibraryCache !== true || enableDupCheck);
  const libraryDb = options.libraryDb || (shouldUseLibraryDb && dbPath ? new LibraryDB({ dbPath }) : null);
  let lastTaskProgressAt = 0;
  let lastTaskLogAt = 0;

  async function scanQuickList(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Failed to read directory: ${currentPath}`, error);
      return;
    }

    for (const entry of sortEntriesForPriority(entries)) {
      throwIfTaskCancelled(options);
      if (shouldSkipScanDirectoryEntry(entry)) continue;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (includeSubfolders) await scanQuickList(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExtSet.has(ext)) {
          results.push(createQuickFileData(fullPath));
          matchedCount += 1;
        }
      }
    }
  }

  function emitTaskProgress(payload) {
    if (!event || !options.reportTaskProgress || event.sender.isDestroyed()) return;
    event.sender.send('task:progress', {
      task: 'folder:scan',
      folderPath,
      ...payload,
    });
    const now = Date.now();
    if (payload.progress >= 100 || now - lastTaskLogAt > 2000) {
      lastTaskLogAt = now;
      safeFolderScanLog(`[FolderScan] ${Math.round(payload.progress || 0)}% matched=${matchedCount} scanned=${scannedCount} current=${payload.currentFile || folderPath}`);
    }
  }

  function emitFileReady(file) {
    if (!event || !options.reportFileReady || event.sender.isDestroyed() || !file?.path) return;
    const cacheKey = JSON.stringify({
      folderPath,
      includeSubfolders,
      enableDupCheck,
      dupFolders: (dupFolders || []).filter(Boolean).sort(),
      skipArchiveExtraction,
    });
    event.sender.send('folder:fileReady', {
      folderPath,
      cacheKey,
      file,
    });
    if (file.cover) {
      safeFolderScanLog(`[FolderScan] thumbnail ready ${file.path}`);
    }
  }

  async function scanDir(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Failed to read directory: ${currentPath}`, error);
      return;
    }

    for (const entry of sortEntriesForPriority(entries)) {
      throwIfTaskCancelled(options);
      if (shouldSkipScanDirectoryEntry(entry)) continue;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (includeSubfolders) await scanDir(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExtSet.has(ext)) {
          try {
            throwIfTaskCancelled(options);
            const now = Date.now();
            if (now - lastTaskProgressAt > 150) {
              lastTaskProgressAt = now;
              emitTaskProgress({
                progress: Math.min(80, Math.floor((matchedCount / Math.max(scannedCount, 1)) * 80)),
                message: taskText(lang, 'task_scan_searching', { count: matchedCount }),
                currentFile: fullPath,
                currentFileName: entry.name,
              });
            }
            const stats = await fs.promises.stat(fullPath);
            const fileData = await createFileData(fullPath, stats, {
              libraryDb,
              thumbnailDir,
              sevenZExe,
              force,
              skipArchiveExtraction,
              skipCoverExtraction,
              skipLibraryCache,
              thumbnailEncoder,
            });
            throwIfTaskCancelled(options);
            results.push(fileData);
            matchedCount += 1;
            emitFileReady(fileData);
          } catch (statError) {
            if (statError?.code === 'TASK_CANCELLED') throw statError;
            console.error(`Failed to process file: ${fullPath}`, statError);
          }
        }

        if (event && !suppressEvents && scannedCount % 50 === 0) {
          event.sender.send('scan-progress', {
            progress: Math.min(80, Math.floor((matchedCount / Math.max(scannedCount, 1)) * 80)),
            message: taskText(lang, 'task_scan_searching', { count: matchedCount }),
          });
        }
      }
    }
  }

  let files = results;
  try {
    if (quickListOnly) {
      await scanQuickList(folderPath);
    } else {
      await scanDir(folderPath);
    }

    if (!quickListOnly && enableDupCheck && dupFolders.length > 0) {
      throwIfTaskCancelled(options);
      emitTaskProgress({
        progress: 85,
        message: taskText(lang, 'task_dup_prepare'),
        currentFile: '',
        currentFileName: '',
      });
      const dupCache = await buildDupCache(dupFolders, normalizedExts, event, lang, {
        ...options,
        libraryDb,
      });
      throwIfTaskCancelled(options);
      files = attachDuplicateMatches(results, dupCache);
    }

    emitTaskProgress({
      progress: 100,
      message: taskText(lang, 'task_scan_done', { count: files.length }),
      currentFile: '',
      currentFileName: '',
    });

    if (event && !suppressEvents) {
      const cacheKey = JSON.stringify({
        folderPath,
        includeSubfolders,
        enableDupCheck,
        dupFolders: (dupFolders || []).filter(Boolean).sort(),
        skipArchiveExtraction,
      });
      event.sender.send('scan-complete', { files, folderPath, cacheKey });
    }

    return files;
  } finally {
    if (!options.libraryDb) await libraryDb?.close();
  }
}
