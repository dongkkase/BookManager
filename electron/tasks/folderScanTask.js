import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const DEFAULT_TARGET_EXTS = ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7', '.pdf', '.epub'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
const MAX_INLINE_COVER_BYTES = 12 * 1024 * 1024;

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
    author: readXmlTag(xml, 'Writer') || readXmlTag(xml, 'Penciller'),
    writer: readXmlTag(xml, 'Writer'),
    producer: readXmlTag(xml, 'Penciller'),
    publisher: readXmlTag(xml, 'Publisher'),
    imprint: readXmlTag(xml, 'Imprint'),
    genre: readXmlTag(xml, 'Genre'),
    page_count: readXmlTag(xml, 'PageCount'),
    total_volume: readXmlTag(xml, 'Count'),
    description: readXmlTag(xml, 'Summary'),
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

function getImageMime(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
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

async function extractArchiveMetadata(filePath, ext) {
  if (ext !== '.zip' && ext !== '.cbz') return {};

  try {
    const buffer = await fs.promises.readFile(filePath);
    const entries = listZipEntries(buffer);
    const comicInfoEntry = entries.find(entry => path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
    const imageEntry = entries
      .filter(entry => IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith('/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))[0];

    const result = {};
    if (comicInfoEntry) {
      const xmlBuffer = readZipEntry(buffer, comicInfoEntry);
      if (xmlBuffer) Object.assign(result, parseComicInfo(xmlBuffer.toString('utf8')));
    }
    if (imageEntry) {
      const imageBuffer = readZipEntry(buffer, imageEntry);
      if (imageBuffer) {
        result.cover = `data:${getImageMime(imageEntry.name)};base64,${imageBuffer.toString('base64')}`;
        result.resolution = getImageResolution(imageBuffer, imageEntry.name);
      }
    }
    return result;
  } catch (error) {
    console.warn(`Failed to extract archive metadata: ${filePath}`, error.message);
    return {};
  }
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

async function createFileData(fullPath, stats) {
  const name = path.basename(fullPath);
  const folderPath = path.dirname(fullPath);
  const ext = path.extname(name).toLowerCase();
  const filenameMeta = await extractFilenameMetadata(name);
  const archiveMeta = await extractArchiveMetadata(fullPath, ext);

  const series = archiveMeta.series || filenameMeta.series || '';
  const volume = archiveMeta.volume || filenameMeta.volume || '';

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
    author: archiveMeta.author || '',
    writer: archiveMeta.writer || archiveMeta.author || '',
    producer: archiveMeta.producer || '',
    publisher: archiveMeta.publisher || '',
    imprint: archiveMeta.imprint || '',
    genre: archiveMeta.genre || '',
    total_volume: archiveMeta.total_volume || '',
    page_count: archiveMeta.page_count || '',
    description: archiveMeta.description || '',
    resolution: archiveMeta.resolution || '',
    cover: archiveMeta.cover || '',
    duplicate_matches: [],
    dup_count: 0,
    max_ratio: 0,
  };
}

export async function scanFolder(folderPath, options = {}, event) {
  const {
    includeSubfolders = true,
    enableDupCheck = false,
    dupFolders = [],
    targetExts = DEFAULT_TARGET_EXTS,
  } = options;
  const normalizedExts = targetExts.map(ext => ext.toLowerCase());
  const results = [];
  let scannedCount = 0;
  let matchedCount = 0;

  async function scanDir(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Failed to read directory: ${currentPath}`, error);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (includeSubfolders) await scanDir(fullPath);
      } else if (entry.isFile()) {
        scannedCount += 1;
        const ext = path.extname(entry.name).toLowerCase();
        if (normalizedExts.includes(ext)) {
          try {
            const stats = await fs.promises.stat(fullPath);
            results.push(await createFileData(fullPath, stats));
            matchedCount += 1;
          } catch (statError) {
            console.error(`Failed to process file: ${fullPath}`, statError);
          }
        }

        if (event && scannedCount % 50 === 0) {
          event.sender.send('scan-progress', {
            progress: Math.min(80, Math.floor((matchedCount / Math.max(scannedCount, 1)) * 80)),
            message: `${matchedCount}개 항목 검색 중...`,
          });
        }
      }
    }
  }

  await scanDir(folderPath);

  let files = results;
  if (enableDupCheck && dupFolders.length > 0) {
    const dupCache = await buildDupCache(dupFolders, normalizedExts, event);
    files = attachDuplicateMatches(results, dupCache);
  }

  if (event) {
    const cacheKey = JSON.stringify({
      folderPath,
      includeSubfolders,
      enableDupCheck,
      dupFolders: (dupFolders || []).filter(Boolean).sort(),
    });
    event.sender.send('scan-complete', { files, folderPath, cacheKey });
  }

  return files;
}
