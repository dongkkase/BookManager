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

const DEFAULT_TARGET_EXTS = SCAN_TARGET_EXTENSIONS;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
const MAX_INLINE_COVER_BYTES = 12 * 1024 * 1024;
const execFileAsync = promisify(execFile);

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
  const folderUtilsUrl = new URL('../../src/utils/folderUtils.js', import.meta.url);
  return import(folderUtilsUrl);
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
    format: readXmlTag(xml, 'Format'),
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
    ? await thumbnailEncoder(imageBuffer, { imageName, filePath, mtime, thumbnailDir })
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
      const entries = await listZipEntriesFromFile(filePath);
      const comicInfoEntry = entries.find(entry => path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
      const imageEntry = entries
        .filter(entry => IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !entry.isDirectory)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))[0];

      if (comicInfoEntry) {
        result.has_metadata = true;
        const xmlBuffer = await readZipEntryFromFile(filePath, comicInfoEntry, {
          maxBytes: MAX_INLINE_COVER_BYTES,
          maxCompressedBytes: MAX_INLINE_COVER_BYTES,
        });
        if (xmlBuffer) Object.assign(result, parseComicInfo(xmlBuffer.toString('utf8')));
      }
      if (imageEntry) {
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
    format: normalizeMetadataFormat(cached.format),
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

  function addCandidate(record = {}) {
    const fullPath = record.full_path || record.file_path || record.path || '';
    if (!fullPath || seen.has(fullPath)) return;
    const name = String(record.name || path.basename(fullPath)).normalize('NFC');
    if (!targetExts.includes(path.extname(name).toLowerCase())) return;
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
    if (!targetExts.includes(path.extname(fullPath).toLowerCase())) return;
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
    for (const candidate of dupCache) {
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

async function createFileData(fullPath, stats, options = {}) {
  const name = path.basename(fullPath);
  const folderPath = path.dirname(fullPath);
  const ext = path.extname(name).toLowerCase();
  const filenameMeta = await extractFilenameMetadata(name);
  const cached = await safeGetCachedFileInfo(options.libraryDb, fullPath);
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
      await safeUpsertFileInfo(options.libraryDb, {
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
        format: normalizeMetadataFormat(archiveMeta.format),
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
    lang = 'ko',
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
      throwIfTaskCancelled(options);
      if (shouldSkipScanDirectoryEntry(entry)) continue;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (includeSubfolders) await scanDir(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExts.includes(ext)) {
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
    await scanDir(folderPath);

    if (enableDupCheck && dupFolders.length > 0) {
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
