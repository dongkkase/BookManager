import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { missingBinaryMessage } from '../binaryPolicy.js';
import {
    listZipEntriesFromFile,
    readZipEntryFromFile,
} from '../core/zipArchive.js';
import { translate } from '../../src/utils/i18n.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const NESTED_ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.alz', '.egg']);
const RENAMER_ARCHIVE_COMPRESSION_MODES = new Set(['auto', 'fast', 'maximum']);

function taskText(lang, key, values) {
    return translate(key, lang || 'en', values);
}

function decimalDigitValue(char) {
    const code = char.codePointAt(0);
    if (code >= 0x30 && code <= 0x39) return code - 0x30;
    if (code >= 0xff10 && code <= 0xff19) return code - 0xff10;
    if (code >= 0x660 && code <= 0x669) return code - 0x660;
    if (code >= 0x6f0 && code <= 0x6f9) return code - 0x6f0;
    if (code >= 0x966 && code <= 0x96f) return code - 0x966;
    if (code >= 0x9e6 && code <= 0x9ef) return code - 0x9e6;
    if (code >= 0xa66 && code <= 0xa6f) return code - 0xa66;
    if (code >= 0xae6 && code <= 0xaef) return code - 0xae6;
    if (code >= 0xb66 && code <= 0xb6f) return code - 0xb66;
    if (code >= 0xbe6 && code <= 0xbef) return code - 0xbe6;
    if (code >= 0xc66 && code <= 0xc6f) return code - 0xc66;
    if (code >= 0xce6 && code <= 0xcef) return code - 0xce6;
    if (code >= 0xd66 && code <= 0xd6f) return code - 0xd66;
    if (code >= 0xe50 && code <= 0xe59) return code - 0xe50;
    if (code >= 0xed0 && code <= 0xed9) return code - 0xed0;
    if (code >= 0xf20 && code <= 0xf29) return code - 0xf20;
    return null;
}

function decimalTokenToAscii(token) {
    let digits = '';
    for (const char of String(token)) {
        const value = decimalDigitValue(char);
        if (value === null) return null;
        digits += String(value);
    }
    return digits;
}

function pythonNaturalKey(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map(part => part
            .split(/(\p{Decimal_Number}+)/u)
            .filter(Boolean)
            .map(token => {
                const asciiDigits = decimalTokenToAscii(token);
                if (asciiDigits !== null) {
                    const normalized = asciiDigits.replace(/^0+/, '') || '0';
                    return normalized.padStart(10, '0');
                }
                return token.toLowerCase();
            }));
}

function comparePythonNaturalKeys(left, right) {
    const leftKey = pythonNaturalKey(left);
    const rightKey = pythonNaturalKey(right);
    const groupCount = Math.max(leftKey.length, rightKey.length);

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        const leftGroup = leftKey[groupIndex] || [];
        const rightGroup = rightKey[groupIndex] || [];
        const tokenCount = Math.max(leftGroup.length, rightGroup.length);

        for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
            const leftToken = leftGroup[tokenIndex];
            const rightToken = rightGroup[tokenIndex];
            if (leftToken === rightToken) continue;
            if (leftToken === undefined) return -1;
            if (rightToken === undefined) return 1;
            return leftToken < rightToken ? -1 : 1;
        }
    }

    return 0;
}

function naturalCompare(a, b) {
    return comparePythonNaturalKeys(a, b);
}

function isArchive(filePath) {
  return ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isImage(entryPath) {
  return IMAGE_EXTS.has(path.extname(entryPath).toLowerCase());
}

function normalizeInnerPath(entryPath) {
  return String(entryPath || '').replace(/\\/g, '/').normalize('NFC');
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[._\-\s]+/, '')
    .trim() || 'Page';
}

function trailingPageNumber(entryPath = '') {
    const normalizedPath = normalizeInnerPath(entryPath);
    const directory = path.posix.dirname(normalizedPath);
    const baseName = path.posix.basename(normalizedPath, path.posix.extname(normalizedPath));
    const match = baseName.match(/(\p{Decimal_Number}+)\s*$/u);
    if (!match) return null;
    const asciiDigits = decimalTokenToAscii(match[1]);
    if (asciiDigits === null) return null;
    return {
        groupKey: `${directory === '.' ? '' : directory}/${baseName.slice(0, match.index)}`,
        page: Number.parseInt(asciiDigits, 10),
    };
}

export function missingPageNumbersForEntries(entries = []) {
    const groups = new Map();
    for (const entry of entries) {
        const parsed = trailingPageNumber(entry.name || entry.originalPath || entry.oldName || '');
        if (!parsed || !Number.isFinite(parsed.page)) continue;
        if (!groups.has(parsed.groupKey)) groups.set(parsed.groupKey, new Set());
        groups.get(parsed.groupKey).add(parsed.page);
    }

    const missing = new Set();
    for (const pages of groups.values()) {
        if (pages.size < 2) continue;
        const sorted = [...pages].sort((a, b) => a - b);
        for (let page = sorted[0]; page <= sorted.at(-1); page += 1) {
            if (!pages.has(page)) missing.add(page);
        }
    }

    return [...missing].sort((a, b) => a - b);
}

function imageQuality(options = {}) {
    const value = Number(options.img_quality ?? options.jpg_quality ?? 100);
    if (!Number.isFinite(value)) return 100;
    return Math.max(1, Math.min(100, Math.round(value)));
}

function isRemovableJpegMetadataMarker(marker) {
    return marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xee);
}

export function hasJpegRemovableMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;

    let offset = 2;
    while (offset + 4 <= buffer.length) {
        while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
        if (offset >= buffer.length) return false;

        const marker = buffer[offset];
        offset += 1;

        if (marker === 0xda || marker === 0xd9) return false;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > buffer.length) return false;

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2) return false;
        const segmentEnd = offset + segmentLength;

        if (isRemovableJpegMetadataMarker(marker)) {
            return true;
        }
        if (segmentEnd > buffer.length) return false;
        offset = segmentEnd;
    }

    return false;
}

export function stripJpegRemovableMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) return { buffer, removed: false };
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { buffer, removed: false };

    const parts = [buffer.subarray(0, 2)];
    let offset = 2;
    let removed = false;

    while (offset < buffer.length) {
        const markerStart = offset;
        while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
        if (offset >= buffer.length) {
            parts.push(buffer.subarray(markerStart));
            break;
        }

        const marker = buffer[offset];
        offset += 1;

        if (marker === 0xda || marker === 0xd9) {
            parts.push(buffer.subarray(markerStart));
            return {
                buffer: removed ? Buffer.concat(parts) : buffer,
                removed,
            };
        }

        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            parts.push(buffer.subarray(markerStart, offset));
            continue;
        }

        if (offset + 2 > buffer.length) {
            parts.push(buffer.subarray(markerStart));
            break;
        }

        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2) {
            parts.push(buffer.subarray(markerStart));
            break;
        }

        const segmentEnd = offset + segmentLength;
        if (segmentEnd > buffer.length) {
            parts.push(buffer.subarray(markerStart));
            break;
        }

        if (isRemovableJpegMetadataMarker(marker)) {
            removed = true;
        } else {
            parts.push(buffer.subarray(markerStart, segmentEnd));
        }
        offset = segmentEnd;
    }

    return {
        buffer: removed ? Buffer.concat(parts) : buffer,
        removed,
    };
}

export function hasPngRemovableMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
    if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return false;
    }

    const metadataChunks = new Set(['eXIf', 'iCCP', 'iTXt', 'tEXt', 'zTXt']);
    let offset = 8;
    while (offset + 12 <= buffer.length) {
        const chunkLength = buffer.readUInt32BE(offset);
        const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
        if (metadataChunks.has(chunkType)) return true;

        const nextOffset = offset + 12 + chunkLength;
        if (nextOffset <= offset || nextOffset > buffer.length) return false;
        offset = nextOffset;
    }

    return false;
}

export function hasWebpRemovableMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 20) return false;
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        return false;
    }

    const metadataChunks = new Set(['EXIF', 'ICCP', 'XMP ']);
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const chunkType = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (metadataChunks.has(chunkType)) return true;

        const paddedSize = chunkSize + (chunkSize % 2);
        const nextOffset = offset + 8 + paddedSize;
        if (nextOffset <= offset || nextOffset > buffer.length) return false;
        offset = nextOffset;
    }

    return false;
}

export function stripWebpRemovableMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 20) return { buffer, removed: false };
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        return { buffer, removed: false };
    }

    const metadataChunks = new Set(['EXIF', 'ICCP', 'XMP ']);
    const removedChunkTypes = new Set();
    const chunks = [];
    let offset = 12;
    let removed = false;

    while (offset + 8 <= buffer.length) {
        const chunkStart = offset;
        const chunkType = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + chunkSize;
        if (dataEnd > buffer.length) {
            chunks.push({
                type: '',
                buffer: buffer.subarray(chunkStart),
            });
            break;
        }

        const chunkEnd = dataEnd + (chunkSize % 2);
        if (metadataChunks.has(chunkType)) {
            removed = true;
            removedChunkTypes.add(chunkType);
        } else {
            chunks.push({
                type: chunkType,
                buffer: buffer.subarray(chunkStart, chunkEnd),
            });
        }
        offset = chunkEnd;
    }

    if (!removed) return { buffer, removed: false };

    const parts = chunks.map(chunkInfo => {
        if (chunkInfo.type !== 'VP8X' || chunkInfo.buffer.length < 18) return chunkInfo.buffer;

        const chunk = Buffer.from(chunkInfo.buffer);
        if (removedChunkTypes.has('ICCP')) chunk[8] &= ~0x20;
        if (removedChunkTypes.has('EXIF')) chunk[8] &= ~0x08;
        if (removedChunkTypes.has('XMP ')) chunk[8] &= ~0x04;
        return chunk;
    });
    const body = Buffer.concat(parts);
    const header = Buffer.from(buffer.subarray(0, 12));
    header.writeUInt32LE(4 + body.length, 4);
    return {
        buffer: Buffer.concat([header, body]),
        removed: true,
    };
}

async function readImageMetadataProbe(filePath, maxBytes = 512 * 1024) {
    const handle = await fsp.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
    } finally {
        await handle.close();
    }
}

async function hasRemovableImageMetadata(filePath, extension) {
    try {
        const buffer = await readImageMetadataProbe(filePath);
        if (extension === '.jpg' || extension === '.jpeg') return hasJpegRemovableMetadata(buffer);
        if (extension === '.png') return hasPngRemovableMetadata(buffer);
        if (extension === '.webp') return hasWebpRemovableMetadata(buffer);
    } catch {
        return true;
    }
    return false;
}

async function stripJpegMetadataFile(filePath) {
    const source = await fsp.readFile(filePath);
    const result = stripJpegRemovableMetadata(source);
    if (!result.removed) return false;
    await fsp.writeFile(filePath, result.buffer);
    return true;
}

async function stripWebpMetadataFile(filePath) {
    const source = await fsp.readFile(filePath);
    const result = stripWebpRemovableMetadata(source);
    if (!result.removed) return false;
    await fsp.writeFile(filePath, result.buffer);
    return true;
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

    if (stat.isFile() && isArchive(currentPath)) {
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

async function directUnsupportedInputs(paths) {
  const skipped = [];
  for (const inputPath of paths || []) {
    try {
      const stat = await fsp.stat(inputPath);
      if (stat.isFile() && !isArchive(inputPath)) skipped.push(`${path.basename(inputPath)} (unsupported format)`);
    } catch {
      skipped.push(`${path.basename(inputPath)} (not found)`);
    }
  }
  return skipped;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const captureOutput = options.captureOutput !== false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', captureOutput ? 'pipe' : 'ignore', captureOutput ? 'pipe' : 'ignore'],
    });
    let stdout = '';
    let stderr = '';
    if (captureOutput) {
      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });
    }
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 || code === 1) resolve({ code, stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
}

function runQuietProcess(command, args, options = {}) {
  return runProcess(command, args, { ...options, captureOutput: false });
}

async function isUsableConvertedFile(filePath, expectedExtension = '') {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size <= 0) return false;
    if (String(expectedExtension || '').toLowerCase() !== '.webp') return true;

    const handle = await fsp.open(filePath, 'r');
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return bytesRead >= 12
        && header.toString('ascii', 0, 4) === 'RIFF'
        && header.toString('ascii', 8, 12) === 'WEBP';
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function listWith7z(filePath, sevenZExe) {
  if (!sevenZExe) return [];
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
      current = { name: normalizeInnerPath(value), isDir: false, size: 0, encrypted: false };
    } else if (current && key === 'Attributes') {
      current.isDir = value.includes('D');
    } else if (current && key === 'Size') {
      current.size = Number(value) || 0;
    } else if (current && key === 'Encrypted') {
      current.encrypted = value === '+';
    }
  }
  if (current?.name) entries.push(current);
  const archivePath = normalizeInnerPath(path.resolve(filePath)).toLowerCase();
  const archiveName = path.basename(filePath).normalize('NFC').toLowerCase();
  return entries.filter(entry => {
    const entryName = normalizeInnerPath(entry.name).toLowerCase();
    return entryName !== archivePath && entryName !== archiveName;
  });
}

function imageMime(entryPath) {
  const extension = path.extname(entryPath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

export async function extractRenamerImage(filePath, entryPath, sevenZExe) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip' || ext === '.cbz') {
    try {
      const normalizedEntryPath = normalizeInnerPath(entryPath);
      const entry = (await listZipEntriesFromFile(filePath))
        .find(item => normalizeInnerPath(item.name) === normalizedEntryPath);
      if (!entry) return { success: false, message: `${entryPath} not found` };
      const buffer = await readZipEntryFromFile(filePath, entry);
      if (!buffer || buffer.length === 0) {
        return { success: false, message: `${entryPath} extraction failed` };
      }
      return {
        success: true,
        dataUrl: `data:${imageMime(entryPath)};base64,${buffer.toString('base64')}`,
      };
    } catch (error) {
      if (!sevenZExe) return { success: false, message: error.message };
    }
  }

  if (!sevenZExe) return { success: false, message: missingBinaryMessage('7z') };
  return new Promise(resolve => {
    const child = spawn(sevenZExe, ['x', '-so', filePath, entryPath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let errorText = '';
    child.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => { errorText += chunk.toString(); });
    child.on('error', error => resolve({ success: false, message: error.message }));
    child.on('close', code => {
      const buffer = Buffer.concat(chunks);
      if (code !== 0 || buffer.length === 0) {
        resolve({ success: false, message: errorText || 'Image extraction failed.' });
        return;
      }
      resolve({
        success: true,
        dataUrl: `data:${imageMime(entryPath)};base64,${buffer.toString('base64')}`,
      });
    });
  });
}

async function listArchiveEntries(filePath, sevenZExe) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip' || ext === '.cbz') {
    try {
      const nativeEntries = await listZipEntriesFromFile(filePath);
      if (nativeEntries.length > 0) {
        return nativeEntries.map(entry => ({
          name: normalizeInnerPath(entry.name),
          isDir: Boolean(entry.isDirectory),
          size: entry.uncompressedSize || entry.compressedSize || 0,
          encrypted: Boolean(entry.flags & 0x1),
        }));
      }
    } catch (error) {
      if (!sevenZExe) throw error;
    }
  }
  return listWith7z(filePath, sevenZExe);
}

function padFor(totalCount) {
  if (totalCount < 100) return 2;
  if (totalCount < 1000) return 3;
  return 4;
}

export function generateRenamedEntryName(entry, index, totalCount, options = {}) {
  const basename = path.posix.basename(normalizeInnerPath(entry.oldName || entry.originalPath || entry.name || ''));
  const ext = options.webpConversion || options.webp_conversion
    ? '.webp'
    : path.extname(basename) || '.jpg';
  if (options.keepName) return basename;

  const startNum = Number.isFinite(Number(options.startNum)) ? Number(options.startNum) : 0;
  const n = startNum + index;
  const pad = padFor(totalCount);
  const padded = String(n).padStart(pad, '0');
  const patternIndex = Number(options.patternIndex || 0);
  const archiveStem = safeName(options.archiveStem || '');
  const customText = safeName(options.customText || 'Custom');

  if (patternIndex === 1) return index === 0 ? `Cover${ext}` : `Page_${padded}${ext}`;
  if (patternIndex === 2) return `${archiveStem}_${padded}${ext}`;
  if (patternIndex === 3) return index === 0 ? `${archiveStem}_Cover${ext}` : `${archiveStem}_Page_${padded}${ext}`;
  if (patternIndex === 4) return `${customText}_${padded}${ext}`;
  return `${padded}${ext}`;
}

function buildEntries(filePath, archiveEntries, options = {}) {
    const archiveStem = path.basename(filePath, path.extname(filePath));
    const images = archiveEntries
        .filter(entry => !entry.isDir && isImage(entry.name))
        .sort((a, b) => naturalCompare(a.name, b.name));
    const coverIndex = images.findIndex(entry => path.posix.basename(entry.name).toLowerCase().startsWith('cover'));
    if (coverIndex > 0) {
        const [cover] = images.splice(coverIndex, 1);
        images.unshift(cover);
    }

    return images.map((entry, index) => {
        const oldName = normalizeInnerPath(entry.name);
        return {
            id: `${filePath}:${oldName}:${index}`,
            originalPath: oldName,
            oldName: path.posix.basename(oldName),
            newName: generateRenamedEntryName(
                { oldName },
                index,
                images.length,
                { ...options, archiveStem }
            ),
            size_kb: (Number(entry.size) || 0) / 1024,
            ext: path.extname(oldName).toLowerCase(),
        };
    });
}

export function refreshRenamerEntries(item, options = {}) {
  const archiveStem = path.basename(item.filepath || item.name || '', path.extname(item.filepath || item.name || ''));
  const entries = (item.entries || []).map((entry, index, source) => ({
    ...entry,
    newName: generateRenamedEntryName(entry, index, source.length, { ...options, archiveStem }),
  }));
  return { ...item, entries, count: entries.length };
}

function maxAnalysisWorkers(options = {}, totalCount = 1) {
  const configured = Number(options.max_analysis_threads ?? options.maxAnalysisThreads);
  const fallback = Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1));
  const workerCount = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : fallback;
  return Math.min(Math.max(1, totalCount), workerCount);
}

async function mapWithConcurrency(items, workerCount, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function analyzeRenamerInputs(paths, options = {}, onProgress) {
  const archives = await expandInputPaths(paths);
  const skippedFiles = await directUnsupportedInputs(paths);
  let completed = 0;

  const results = await mapWithConcurrency(archives, maxAnalysisWorkers(options, archives.length), async (filePath, index) => {
    const name = path.basename(filePath);
    onProgress?.({
      progress: Math.round((index / Math.max(archives.length, 1)) * 100),
      message: taskText(options.lang, 'task_analyzing', { index: index + 1, total: archives.length, name }),
    });

    try {
      const stat = await fsp.stat(filePath);
      const archiveEntries = await listArchiveEntries(filePath, options.sevenZExe);
      if (archiveEntries.some(entry => entry.encrypted)) {
        return { skipped: taskText(options.lang, 'task_skip_encrypted_archive', { name }) };
      }
      if (archiveEntries.some(entry => !entry.isDir && NESTED_ARCHIVE_EXTS.has(path.extname(entry.name).toLowerCase()))) {
        return { skipped: taskText(options.lang, 'task_skip_nested_archive', { name }) };
      }
      const entries = buildEntries(filePath, archiveEntries, options);
      if (entries.length === 0) {
        return { skipped: taskText(options.lang, 'task_skip_no_supported_images', { name }) };
      }

      return { item: {
        id: filePath,
        filepath: filePath,
        name,
        checked: true,
        capOpt: false,
        exifOpt: false,
        count: entries.length,
        missingPages: missingPageNumbersForEntries(entries).join(', '),
        sizeMb: stat.size / (1024 * 1024),
        entries,
      } };
    } catch (error) {
      return { skipped: `${name} (${error.message})` };
    } finally {
      completed += 1;
      onProgress?.({
        progress: Math.round((completed / Math.max(archives.length, 1)) * 100),
        message: taskText(options.lang, 'task_analyzing', { index: completed, total: archives.length, name }),
      });
    }
  });

  const items = [];
  for (const result of results) {
    if (result?.item) items.push(result.item);
    if (result?.skipped) skippedFiles.push(result.skipped);
  }

  onProgress?.({ progress: 100, message: taskText(options.lang, 'task_analysis_done') });
  return { items, skippedFiles };
}

async function uniquePath(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);
  let counter = 1;
  while (true) {
    const candidate = path.join(dir, `${stem}_${counter}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function targetExtFor(filePath, targetFormat) {
  if (!targetFormat || targetFormat === 'none') return path.extname(filePath).toLowerCase();
  return `.${String(targetFormat).replace(/^\./, '').toLowerCase()}`;
}

function targetInnerPath(entry, options = {}) {
  const originalPath = normalizeInnerPath(entry.originalPath);
  const dirPart = options.flattenFolders ? '' : path.posix.dirname(originalPath);
  const filename = safeName(entry.newName);
  return dirPart && dirPart !== '.'
    ? normalizeInnerPath(path.posix.join(dirPart, filename))
    : filename;
}

function replacePathExtension(filePath, extension) {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}${extension}`,
  );
}

function maxWorkers(options = {}, totalCount = 1) {
  const configured = Math.max(1, Math.floor(Number(options.max_threads) || 1));
  return Math.min(Math.max(1, totalCount), configured);
}

function sizePreservingOptimizationEnabled(item, options = {}) {
  return Boolean(item?.capOpt)
    || Boolean(item?.exifOpt)
    || Boolean(options.webp_conversion || options.webpConversion);
}

export function shouldSkipLargerOptimizedArchive(item, options, hasActualStructuralChange, packResult = {}) {
  return sizePreservingOptimizationEnabled(item, options)
    && !Boolean(item?.exifOpt)
    && !hasActualStructuralChange
    && Number(packResult.outputSize) > Number(packResult.sourceSize);
}

function renamerArchiveCompressionMode(options = {}) {
  const mode = String(options.renamer_archive_compression || options.archive_compression || 'auto');
  return RENAMER_ARCHIVE_COMPRESSION_MODES.has(mode) ? mode : 'auto';
}

function archiveCompressionArgs(level = 0) {
  return [`-mx=${level}`, '-mmt=on'];
}

async function packArchive(sevenZExe, archiveType, outputPath, cwd, level = 0) {
  await fsp.rm(outputPath, { force: true }).catch(() => {});
  await runQuietProcess(sevenZExe, ['a', archiveType, outputPath, '*', ...archiveCompressionArgs(level)], { cwd });
  return (await fsp.stat(outputPath)).size;
}

async function packArchiveWithSizeFallback(sevenZExe, archiveType, outputPath, cwd, sourcePath, mode = 'auto', shouldPreserveSize = false) {
  const sourceSize = (await fsp.stat(sourcePath)).size;
  if (mode === 'maximum') {
    const outputSize = await packArchive(sevenZExe, archiveType, outputPath, cwd, 9);
    return { outputSize, sourceSize };
  }

  let outputSize = await packArchive(sevenZExe, archiveType, outputPath, cwd, 0);
  if (mode === 'fast' || !shouldPreserveSize || outputSize <= sourceSize) return { outputSize, sourceSize };

  const compressedPath = `${outputPath}.mx9.tmp`;
  try {
    const compressedSize = await packArchive(sevenZExe, archiveType, compressedPath, cwd, 9);
    if (compressedSize < outputSize) {
      await fsp.rm(outputPath, { force: true });
      await fsp.rename(compressedPath, outputPath);
      outputSize = compressedSize;
    }
  } catch {
    // 고압축 재시도는 선택 사항입니다. 실패하면 빠른 저장 모드 결과를 유지합니다.
  } finally {
    await fsp.rm(compressedPath, { force: true }).catch(() => {});
  }
  return { outputSize, sourceSize };
}

async function removeEmptyDirs(rootDir) {
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await removeEmptyDirs(path.join(rootDir, entry.name));
    }
  }

  if (rootDir.endsWith(`${path.sep}.bookmanager_rename_tmp`)) return;
  if (rootDir === path.parse(rootDir).root) return;
  const remaining = await fsp.readdir(rootDir);
  if (remaining.length === 0) await fsp.rmdir(rootDir);
}

async function optimizeExtractedImages(rootDir, item, options) {
  const optimize = Boolean(item.capOpt);
  const stripExif = Boolean(item.exifOpt);
  const quality = imageQuality(options);
  if (!optimize && !stripExif) return;

  const imageFiles = [];

  async function collect(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (options.shouldCancel?.()) return;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await collect(fullPath);
      } else if (entry.isFile() && isImage(entry.name) && !entry.name.endsWith('.opt.tmp')) {
        imageFiles.push(fullPath);
      }
    }
  }

  await collect(rootDir);
  if (imageFiles.length === 0 || options.shouldCancel?.()) return;

  async function replaceWhenUseful(sourcePath, tempPath, allowEqualSize = false) {
    if (!await isUsableConvertedFile(tempPath, path.extname(sourcePath).toLowerCase())) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      return false;
    }
    const [sourceStat, tempStat] = await Promise.all([fsp.stat(sourcePath), fsp.stat(tempPath)]);
    if (tempStat.size < sourceStat.size || (allowEqualSize && tempStat.size === sourceStat.size)) {
      await fsp.rm(sourcePath, { force: true });
      await fsp.rename(tempPath, sourcePath);
      return true;
    } else {
      await fsp.rm(tempPath, { force: true });
      return false;
    }
  }

  async function processImage(fullPath) {
      if (options.shouldCancel?.()) return;
      const extension = path.extname(fullPath).toLowerCase();
      const hasRemovableMetadata = stripExif
        ? await hasRemovableImageMetadata(fullPath, extension)
        : false;
      if (!optimize && !hasRemovableMetadata) return;

      const tempPath = `${fullPath}.opt.tmp`;
      try {
        if (extension === '.jpg' || extension === '.jpeg') {
          const metadataRemoved = hasRemovableMetadata
            ? await stripJpegMetadataFile(fullPath).catch(() => false)
            : false;
          const metadataStillNeedsStrip = hasRemovableMetadata && !metadataRemoved;
          if (!optimize && !metadataStillNeedsStrip) return;

          if (optimize && quality < 100 && options.djpegExe && options.cjpegExe) {
            const ppmPath = `${fullPath}.ppm.tmp`;
            try {
              await runProcess(options.djpegExe, ['-outfile', ppmPath, fullPath]);
              await runProcess(options.cjpegExe, ['-quality', String(quality), '-optimize', '-outfile', tempPath, ppmPath]);
              const replaced = await replaceWhenUseful(fullPath, tempPath);
              if (!replaced && metadataStillNeedsStrip && options.jpegtranExe) {
                const stripTempPath = `${fullPath}.strip.tmp`;
                try {
                  await runProcess(options.jpegtranExe, ['-copy', 'none', '-outfile', stripTempPath, fullPath]);
                  await replaceWhenUseful(fullPath, stripTempPath, true);
                } finally {
                  await fsp.rm(stripTempPath, { force: true }).catch(() => {});
                }
              }
            } finally {
              await fsp.rm(ppmPath, { force: true }).catch(() => {});
            }
          } else if (options.jpegtranExe) {
            const args = ['-optimize', '-copy', metadataStillNeedsStrip ? 'none' : 'all', '-outfile', tempPath, fullPath];
            await runProcess(options.jpegtranExe, args);
            await replaceWhenUseful(fullPath, tempPath, metadataStillNeedsStrip);
          }
        } else if (extension === '.png' && options.pngquantExe) {
          const pngQuality = Math.max(40, quality);
          const args = ['--force', '--quality', `${pngQuality}-${pngQuality}`, '--output', tempPath];
          if (hasRemovableMetadata) args.push('--strip');
          args.push(fullPath);
          await runProcess(options.pngquantExe, args);
          await replaceWhenUseful(fullPath, tempPath, hasRemovableMetadata);
        } else if (extension === '.webp') {
          if (hasRemovableMetadata) {
            const metadataRemoved = await stripWebpMetadataFile(fullPath).catch(() => false);
            if (metadataRemoved) return;
          }
        }
      } catch {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
      }
  }

  let cursor = 0;
  async function worker() {
    while (cursor < imageFiles.length) {
      if (options.shouldCancel?.()) return;
      const index = cursor;
      cursor += 1;
      await processImage(imageFiles[index]);
    }
  }

  await Promise.all(Array.from({ length: maxWorkers(options, imageFiles.length) }, worker));
}

async function renameArchiveEntriesDirectly(sourcePath, pairs, targetExt, options = {}) {
  const sevenZExe = options.sevenZExe;
  const filename = path.basename(sourcePath);
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const outputName = `${path.basename(sourcePath, sourceExt)}${targetExt}`;
  const finalPath = options.deleteOriginal === false
    ? await uniquePath(path.join(path.dirname(sourcePath), outputName))
    : path.join(path.dirname(sourcePath), outputName);
  let tempArchive = path.join(os.tmpdir(), `BookManager_RenameOnly_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(finalPath)}`);

  try {
    await fsp.copyFile(sourcePath, tempArchive);
    for (let index = 0; index < pairs.length; index += 20) {
      if (options.shouldCancel?.()) return { cancelled: true, message: filename };
      const args = [];
      for (const pair of pairs.slice(index, index + 20)) {
        args.push(pair.oldPath, pair.newPath);
      }
      await runQuietProcess(sevenZExe, ['rn', tempArchive, ...args]);
    }

    if (options.backup_on) {
      const backupDir = path.join(path.dirname(sourcePath), 'bak');
      await fsp.mkdir(backupDir, { recursive: true });
      await fsp.copyFile(sourcePath, await uniquePath(path.join(backupDir, filename)));
    }

    if (options.deleteOriginal === false) {
      await fsp.rename(tempArchive, finalPath);
      tempArchive = '';
    } else {
      const sourceHoldingPath = `${sourcePath}.bookmanager.tmp`;
      await fsp.rm(sourceHoldingPath, { force: true }).catch(() => {});
      await fsp.rename(sourcePath, sourceHoldingPath);
      try {
        if (fs.existsSync(finalPath)) await fsp.rm(finalPath, { force: true });
        await fsp.rename(tempArchive, finalPath);
        tempArchive = '';
        await fsp.rm(sourceHoldingPath, { force: true });
      } catch (error) {
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        if (fs.existsSync(sourceHoldingPath)) await fsp.rename(sourceHoldingPath, sourcePath);
        throw error;
      }
    }

    return { success: true, message: filename, outputPath: finalPath };
  } finally {
    if (tempArchive) await fsp.rm(tempArchive, { force: true }).catch(() => {});
  }
}

async function processRenamerItem(item, options) {
  const sevenZExe = options.sevenZExe;
  if (!sevenZExe) throw new Error(missingBinaryMessage('7z'));

  const sourcePath = item.filepath;
  const filename = path.basename(sourcePath);
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const targetExt = targetExtFor(sourcePath, options.target_format);
  const plannedMoves = (item.entries || [])
    .map(entry => ({
      originalPath: normalizeInnerPath(entry.originalPath),
      oldPath: normalizeInnerPath(entry.originalPath),
      newPath: targetInnerPath(entry, options),
    }));
  const renamePairs = plannedMoves
    .filter(pair => pair.oldPath !== pair.newPath);
  const canRenameDirectly = ['.zip', '.cbz'].includes(sourceExt)
    && targetExt === sourceExt
    && !item.capOpt
    && !item.exifOpt
    && !options.flattenFolders
    && !(options.webp_conversion || options.webpConversion);

  if (renamePairs.length === 0 && canRenameDirectly) {
    return { success: true, message: filename, outputPath: sourcePath };
  }

  if (renamePairs.length > 0 && canRenameDirectly) {
    return renameArchiveEntriesDirectly(sourcePath, renamePairs, targetExt, options);
  }

  const tempBase = path.join(os.tmpdir(), `BookManager_Renamer_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const holdingDir = path.join(tempBase, '.bookmanager_rename_tmp');
  const archiveType = targetExt === '.7z' ? '-t7z' : '-tzip';
  let tempArchive = '';

  await fsp.mkdir(holdingDir, { recursive: true });

  try {
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };
    await runQuietProcess(sevenZExe, ['x', sourcePath, `-o${tempBase}`, '-y']);

    const moves = [];
    for (let index = 0; index < plannedMoves.length; index += 1) {
      const entry = plannedMoves[index];
      const oldAbs = path.join(tempBase, ...entry.originalPath.split('/').filter(Boolean));
      const nextInnerPath = entry.newPath;
      const nextDirPart = path.posix.dirname(nextInnerPath);
      const targetDir = nextDirPart && nextDirPart !== '.'
        ? path.join(tempBase, ...nextDirPart.split('/').filter(Boolean))
        : tempBase;
      const targetAbs = path.join(tempBase, ...nextInnerPath.split('/').filter(Boolean));

      if (!fs.existsSync(oldAbs)) continue;
      await fsp.mkdir(targetDir, { recursive: true });
      moves.push({
        originalPath: entry.originalPath,
        oldAbs,
        targetAbs,
        tempAbs: path.join(holdingDir, `${String(index).padStart(5, '0')}_${safeName(path.basename(oldAbs))}`),
      });
    }

    for (const move of moves) {
      const sourceExtension = path.extname(move.oldAbs).toLowerCase();
      if ((options.webp_conversion || options.webpConversion) && sourceExtension !== '.webp') {
        if (!options.cwebpExe) throw new Error('cwebp executable not found.');
        const convertedTempAbs = `${move.tempAbs}.webp.tmp`;
        let useConverted = false;
        try {
          await runQuietProcess(options.cwebpExe, [
            move.oldAbs,
            '-o',
            convertedTempAbs,
            '-q',
            String(imageQuality(options)),
            ...(item.exifOpt ? ['-metadata', 'none'] : []),
          ]);
          const [sourceStat, convertedStat] = await Promise.all([
            fsp.stat(move.oldAbs),
            fsp.stat(convertedTempAbs),
          ]);
          useConverted = convertedStat.size < sourceStat.size
            && await isUsableConvertedFile(convertedTempAbs, '.webp');
        } catch {
          useConverted = false;
        }
        if (useConverted) {
          await fsp.rm(move.oldAbs, { force: true });
          move.tempAbs = convertedTempAbs;
        } else {
          await fsp.rm(convertedTempAbs, { force: true }).catch(() => {});
          move.targetAbs = replacePathExtension(move.targetAbs, sourceExtension);
          await fsp.mkdir(path.dirname(move.targetAbs), { recursive: true });
          await fsp.rename(move.oldAbs, move.tempAbs);
        }
      } else {
        await fsp.rename(move.oldAbs, move.tempAbs);
      }
    }
    for (const move of moves) {
      if (options.shouldCancel?.()) return { cancelled: true, message: filename };
      if (fs.existsSync(move.targetAbs)) await fsp.rm(move.targetAbs, { force: true });
      await fsp.rename(move.tempAbs, move.targetAbs);
    }

    await fsp.rm(holdingDir, { recursive: true, force: true });
    await removeEmptyDirs(tempBase).catch(() => {});
    const hasActualStructuralChange = targetExt !== sourceExt
      || Boolean(options.flattenFolders)
      || moves.some(move => normalizeInnerPath(path.relative(tempBase, move.targetAbs)) !== move.originalPath);

    const outputName = `${path.basename(sourcePath, sourceExt)}${targetExt}`;
    const finalPath = options.deleteOriginal === false
      ? await uniquePath(path.join(path.dirname(sourcePath), outputName))
      : path.join(path.dirname(sourcePath), outputName);
    tempArchive = path.join(os.tmpdir(), `BookManager_Renamed_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(finalPath)}`);

    await optimizeExtractedImages(tempBase, item, options);
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };
    const packResult = await packArchiveWithSizeFallback(
      sevenZExe,
      archiveType,
      tempArchive,
      tempBase,
      sourcePath,
      renamerArchiveCompressionMode(options),
      sizePreservingOptimizationEnabled(item, options),
    );
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };
    if (shouldSkipLargerOptimizedArchive(item, options, hasActualStructuralChange, packResult)) {
      return {
        skipped: true,
        message: taskText(options.lang, 'task_skip_optimized_larger', {
          name: filename,
          source: packResult.sourceSize,
          output: packResult.outputSize,
        }),
        outputPath: sourcePath,
      };
    }

    if (options.backup_on) {
      const backupDir = path.join(path.dirname(sourcePath), 'bak');
      await fsp.mkdir(backupDir, { recursive: true });
      await fsp.copyFile(sourcePath, await uniquePath(path.join(backupDir, filename)));
    }

    if (options.deleteOriginal === false) {
      await fsp.rename(tempArchive, finalPath);
    } else {
      const sourceHoldingPath = `${sourcePath}.bookmanager.tmp`;
      await fsp.rm(sourceHoldingPath, { force: true }).catch(() => {});
      await fsp.rename(sourcePath, sourceHoldingPath);
      try {
        if (fs.existsSync(finalPath)) await fsp.rm(finalPath, { force: true });
        await fsp.rename(tempArchive, finalPath);
        await fsp.rm(sourceHoldingPath, { force: true });
      } catch (error) {
        await fsp.rm(finalPath, { force: true }).catch(() => {});
        if (fs.existsSync(sourceHoldingPath)) await fsp.rename(sourceHoldingPath, sourcePath);
        throw error;
      }
    }

    return { success: true, message: filename, outputPath: finalPath };
  } finally {
    if (tempArchive) await fsp.rm(tempArchive, { force: true }).catch(() => {});
    await fsp.rm(tempBase, { recursive: true, force: true });
  }
}

export async function executeRenamer(items, options = {}, onProgress) {
  const targets = (items || []).filter(item => item.checked !== false);
  const stats = { success: [], skip: [], error: [] };
  const outputFiles = [];
  const pathMap = {};
  let cancelled = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const item = targets[index];
    onProgress?.({
      progress: Math.round((index / Math.max(targets.length, 1)) * 100),
      message: taskText(options.lang, 'task_renamer_renaming', { index: index + 1, total: targets.length, name: item.name }),
    });

    try {
      const result = await processRenamerItem(item, options);
      if (result.cancelled) {
        stats.skip.push(`${item.name || path.basename(item.filepath)} (Cancelled)`);
        cancelled = true;
        break;
      }
      if (result.skipped) {
        stats.skip.push(result.message);
        pathMap[item.filepath] = result.outputPath || item.filepath;
        continue;
      }
      stats.success.push(result.message);
      outputFiles.push(result.outputPath);
      pathMap[item.filepath] = result.outputPath;
    } catch (error) {
      stats.error.push(`${item.name || item.filepath} - ${error.message}`);
    }
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
  }

  if (!cancelled) onProgress?.({ progress: 100, message: taskText(options.lang, 'task_done') });
  return {
    stats,
    outputFiles,
    cancelled,
    pathMap,
  };
}
