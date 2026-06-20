import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { LibraryDB } from '../database/library_db.js';

const DEFAULT_TARGET_EXTS = ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf', '.epub'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
const MAX_INLINE_COVER_BYTES = 12 * 1024 * 1024;
const MAX_INLINE_ZIP_BYTES = 256 * 1024 * 1024;
const execFileAsync = promisify(execFile);

async function getFolderUtils() {
  const folderUtilsUrl = new URL('../../src/utils/folderUtils.js', import.meta.url);
  return import(folderUtilsUrl);
}

async function extractFilenameMetadata(name) {
  try {
    const { extractCoreTitle, extractVolNumbers } = await getFolderUtils();
    const series = extractCoreTitle(name);
    const vols = extractVolNumbers(name, series);
    const volume = vols.length > 0 ? (vols.length === 1 ? String(vols[0]) : `${vols[0]}~${vols[vols.length - 1]}`) : '';
    return { series, volume, sorted_volume: vols[0] || null };
  } catch (err) {
    console.warn('Failed to extract filename metadata:', err);
    return { series: path.parse(name).name, volume: '', sorted_volume: null };
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

function readXmlTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1].trim()) : '';
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
    description: readXmlTag(xml, 'Summary'),
    series_group: readXmlTag(xml, 'SeriesGroup') || readXmlTag(xml, 'AlternateSeries'),
    tags: readXmlTag(xml, 'Tags'),
    characters: readXmlTag(xml, 'Characters'),
    teams: readXmlTag(xml, 'Teams'),
    locations: readXmlTag(xml, 'Locations'),
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

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function listZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return [];

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) break;

    const flags = buffer.readUInt16LE(centralOffset + 8);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralOffset + 42);
    const encoding = flags & 0x800 ? 'utf8' : 'utf8';
    const name = buffer.toString(encoding, centralOffset + 46, centralOffset + 46 + fileNameLength);

    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entry) {
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length || entry.compressedSize > MAX_INLINE_COVER_BYTES) return null;

  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(compressed);
    } catch {
      return null;
    }
  }
  return null;
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

async function saveThumbnail(imageBuffer, imageName, filePath, mtime, thumbnailDir, thumbnailEncoder) {
  if (!imageBuffer || !thumbnailDir) return '';
  const encoded = typeof thumbnailEncoder === 'function'
    ? thumbnailEncoder(imageBuffer)
    : null;
  const outputBuffer = encoded?.buffer || imageBuffer;
  const hash = crypto.createHash('md5')
    .update(`${path.normalize(filePath)}_${mtime}`)
    .digest('hex');
  const extension = encoded?.extension || (IMAGE_EXTS.includes(path.extname(imageName).toLowerCase())
    ? path.extname(imageName).toLowerCase()
    : '.jpg');
  const thumbnailPath = path.join(thumbnailDir, `${hash}${extension}`);
  await fs.promises.mkdir(thumbnailDir, { recursive: true });
  await fs.promises.writeFile(thumbnailPath, outputBuffer);
  return thumbnailPath;
}

async function extractWith7Zip(filePath, sevenZExe) {
  if (!sevenZExe) return {};
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
  if (imageName) {
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

async function extractArchiveMetadata(filePath, ext, options = {}) {
  try {
    let result = {};
    if (ext === '.zip' || ext === '.cbz') {
      const maxInlineZipBytes = options.maxInlineZipBytes || MAX_INLINE_ZIP_BYTES;
      const archiveSize = options.size || fs.statSync(filePath).size;
      if (archiveSize > maxInlineZipBytes) {
        result = await extractWith7Zip(filePath, options.sevenZExe);
      } else {
        const buffer = await fs.promises.readFile(filePath);
        const entries = listZipEntries(buffer);
        const comicInfoEntry = entries.find(entry => path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
        const imageEntry = entries
          .filter(entry => IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith('/'))
          .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))[0];

        if (comicInfoEntry) {
          result.has_metadata = true;
          const xmlBuffer = readZipEntry(buffer, comicInfoEntry);
          if (xmlBuffer) Object.assign(result, parseComicInfo(xmlBuffer.toString('utf8')));
        }
        if (imageEntry) {
          const imageBuffer = readZipEntry(buffer, imageEntry);
          if (imageBuffer) {
            result.imageBuffer = imageBuffer;
            result.imageName = imageEntry.name;
            result.resolution = getImageResolution(imageBuffer, imageEntry.name);
          }
        }
      }
    } else if (['.rar', '.cbr', '.7z', '.cb7'].includes(ext)) {
      result = await extractWith7Zip(filePath, options.sevenZExe);
    }

    if (result.imageBuffer) {
      result.thumb_path = await saveThumbnail(
        result.imageBuffer,
        result.imageName,
        filePath,
        options.mtime,
        options.thumbnailDir,
        options.thumbnailEncoder,
      );
    }
    delete result.imageBuffer;
    delete result.imageName;
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
    format: cached.format || '',
    resolution: cached.resolution || '',
    producer: cached.creators || '',
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

function sortEntriesForPriority(entries = []) {
  return [...entries].sort((left, right) => {
    if (left.isFile() !== right.isFile()) return left.isFile() ? -1 : 1;
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name, 'ko', { numeric: true });
  });
}

function normalizeForCompare(text = '') {
  const synonyms = {
    '블랙': '검은', black: '검은', '화이트': '흰', white: '흰',
    '레드': '빨간', red: '빨간', '블루': '파란', blue: '파란',
    love: '사랑', hell: '지옥', hero: '영웅', heroes: '영웅',
  };
  const stopwords = ['만화책', '만화', '코믹스', 'e북', 'ebook', '완결', '합본', '웹툰', '단행본', '시리즈', '총집편', '풀컬러', '미완'];
  let value = text.toLowerCase();
  for (const word of stopwords) value = value.replace(new RegExp(word, 'gi'), '');
  for (const [from, to] of Object.entries(synonyms)) value = value.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  return value.replace(/[^가-힣a-z0-9]/g, '');
}

function bigrams(text) {
  if (!text) return new Set();
  if (text.length === 1) return new Set([text]);
  const values = new Set();
  for (let i = 0; i < text.length - 1; i += 1) values.add(text.slice(i, i + 2));
  return values;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length > b.length ? a : b;
  const containment = long.includes(short) ? 1 : 0;
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  const intersection = [...aBigrams].filter(value => bBigrams.has(value)).length;
  const union = new Set([...aBigrams, ...bBigrams]).size || 1;
  return Math.max(containment, intersection / union);
}

async function buildDupCache(dupFolders, targetExts, event) {
  const cache = [];
  const seen = new Set();

  async function scanDir(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && targetExts.includes(path.extname(entry.name).toLowerCase()) && !seen.has(fullPath)) {
        seen.add(fullPath);
        try {
          const stats = await fs.promises.stat(fullPath);
          const meta = await extractFilenameMetadata(entry.name);
          const compareTitle = normalizeForCompare(meta.series || path.parse(entry.name).name);
          cache.push({
            name: entry.name,
            path: currentPath,
            full_path: fullPath,
            size: stats.size,
            series: meta.series,
            nums: meta.sorted_volume ? [meta.sorted_volume] : [],
            compareTitle,
          });
        } catch {
          // Ignore unreadable duplicate target files.
        }
      }
    }
  }

  for (const folder of dupFolders || []) {
    if (folder && fs.existsSync(folder)) await scanDir(folder);
  }

  if (event && cache.length) {
    event.sender.send('scan-progress', {
      progress: 85,
      message: `중복 검사 대상 ${cache.length}개 인덱싱 완료...`,
    });
  }

  return cache;
}

function attachDuplicateMatches(files, dupCache) {
  if (!dupCache.length) return files;

  return files.map(file => {
    const compareTitle = normalizeForCompare(file.series || path.parse(file.name).name);
    const fileNums = file.sorted_volume ? [file.sorted_volume] : [];
    const matches = [];

    for (const candidate of dupCache) {
      if (path.normalize(candidate.full_path) === path.normalize(file.full_path)) continue;
      const sameNumber = !fileNums.length || !candidate.nums.length || fileNums.some(num => candidate.nums.includes(num));
      if (!sameNumber) continue;

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

async function createFileData(fullPath, stats, options = {}) {
  const name = path.basename(fullPath);
  const folderPath = path.dirname(fullPath);
  const ext = path.extname(name).toLowerCase();
  const filenameMeta = await extractFilenameMetadata(name);
  const cached = options.libraryDb
    ? await options.libraryDb.getFileInfo(fullPath)
    : null;
  const cachedThumbnailExists = Boolean(
    cached?.thumb_path
    && fs.existsSync(cached.thumb_path)
    && fs.statSync(cached.thumb_path).size > 0,
  );
  const cacheValid = options.force !== true && isValidCache(cached, stats);
  let archiveMeta = cacheValid ? metadataFromCache(cached) : {};
  const shouldExtractArchive = options.skipArchiveExtraction !== true;

  if (shouldExtractArchive && (!cacheValid || !cachedThumbnailExists)) {
    const extracted = await extractArchiveMetadata(fullPath, ext, {
      sevenZExe: options.sevenZExe,
      thumbnailDir: options.thumbnailDir,
      mtime: stats.mtimeMs,
      size: stats.size,
      thumbnailEncoder: options.thumbnailEncoder,
    });
    archiveMeta = {
      ...(cacheValid ? archiveMeta : {}),
      ...extracted,
    };
    if (options.libraryDb) {
      await options.libraryDb.upsertFileInfo({
        path: fullPath,
        mtime: stats.mtimeMs / 1000,
        size: stats.size,
        ext,
        resolution: archiveMeta.resolution || '',
        title: archiveMeta.title || '',
        series: archiveMeta.series || '',
        series_group: archiveMeta.series_group || '',
        volume: archiveMeta.volume || '',
        number: archiveMeta.chapter || '',
        writer: archiveMeta.writer || '',
        creators: archiveMeta.producer || '',
        publisher: archiveMeta.publisher || '',
        imprint: archiveMeta.imprint || '',
        genre: archiveMeta.genre || '',
        volume_count: archiveMeta.total_volume || '',
        page_count: archiveMeta.page_count || '',
        format: archiveMeta.format || ext.replace('.', '').toUpperCase(),
        manga: archiveMeta.manga || '',
        language: archiveMeta.language || '',
        rating: archiveMeta.rating || '',
        age_rating: archiveMeta.age_rating || '',
        publish_date: archiveMeta.date || '',
        summary: archiveMeta.description || '',
        characters: archiveMeta.characters || '',
        teams: archiveMeta.teams || '',
        locations: archiveMeta.locations || '',
        story_arc: archiveMeta.story_arc || '',
        tags: archiveMeta.tags || '',
        notes: archiveMeta.notes || '',
        web: archiveMeta.link || '',
        thumb_path: archiveMeta.thumb_path || '',
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
    format: ext.replace('.', '').toUpperCase(),
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
    publisher: archiveMeta.publisher || '',
    imprint: archiveMeta.imprint || '',
    genre: archiveMeta.genre || '',
    total_volume: archiveMeta.total_volume || '',
    page_count: archiveMeta.page_count || '',
    description: archiveMeta.description || '',
    series_group: archiveMeta.series_group || '',
    tags: archiveMeta.tags || '',
    characters: archiveMeta.characters || '',
    teams: archiveMeta.teams || '',
    locations: archiveMeta.locations || '',
    story_arc: archiveMeta.story_arc || '',
    notes: archiveMeta.notes || '',
    link: archiveMeta.link || '',
    language: archiveMeta.language || '',
    manga: archiveMeta.manga || '',
    age_rating: archiveMeta.age_rating || '',
    rating: archiveMeta.rating || '',
    date: archiveMeta.date || '',
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
    suppressEvents = false,
    thumbnailEncoder,
  } = options;
  const normalizedExts = targetExts.map(ext => ext.toLowerCase());
  const results = [];
  let scannedCount = 0;
  let matchedCount = 0;
  const libraryDb = options.libraryDb || (dbPath ? new LibraryDB({ dbPath }) : null);
  let lastTaskProgressAt = 0;
  let lastTaskLogAt = 0;

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
      console.log(`[FolderScan] ${Math.round(payload.progress || 0)}% matched=${matchedCount} scanned=${scannedCount} current=${payload.currentFile || folderPath}`);
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
      console.log(`[FolderScan] thumbnail ready ${file.path}`);
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
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (includeSubfolders) await scanDir(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExts.includes(ext)) {
          try {
            const now = Date.now();
            if (now - lastTaskProgressAt > 150) {
              lastTaskProgressAt = now;
              emitTaskProgress({
                progress: Math.min(80, Math.floor((matchedCount / Math.max(scannedCount, 1)) * 80)),
                message: `${matchedCount}개 항목 검색 중...`,
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
              thumbnailEncoder,
            });
            results.push(fileData);
            matchedCount += 1;
            emitFileReady(fileData);
          } catch (statError) {
            console.error(`Failed to process file: ${fullPath}`, statError);
          }
        }

        if (event && !suppressEvents && scannedCount % 50 === 0) {
          event.sender.send('scan-progress', {
            progress: Math.min(80, Math.floor((matchedCount / Math.max(scannedCount, 1)) * 80)),
            message: `${matchedCount}개 항목 검색 중...`,
          });
        }
      }
    }
  }

  try {
    await scanDir(folderPath);
  } finally {
    if (!options.libraryDb) await libraryDb?.close();
  }

  let files = results;
  if (enableDupCheck && dupFolders.length > 0) {
    emitTaskProgress({
      progress: 85,
      message: `중복 검사 대상 준비 중...`,
      currentFile: '',
      currentFileName: '',
    });
    const dupCache = await buildDupCache(dupFolders, normalizedExts, event);
    files = attachDuplicateMatches(results, dupCache);
  }

  emitTaskProgress({
    progress: 100,
    message: `${files.length}개 항목 검색 완료`,
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
}
