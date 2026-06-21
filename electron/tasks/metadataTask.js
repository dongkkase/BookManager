import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { missingBinaryMessage } from '../binaryPolicy.js';
import {
  listZipEntries,
  readZipEntry,
  replaceZipEntry,
} from '../core/zipArchive.js';
import { translate } from '../../src/utils/i18n.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const XML_FIELDS = [
  'Series', 'SeriesGroup', 'Title', 'Number', 'Count', 'Volume',
  'AlternateSeries', 'AlternateNumber', 'AlternateCount', 'Summary', 'Notes', 'Web',
  'Writer', 'Penciller', 'Inker', 'Colorist', 'Letterer', 'CoverArtist', 'Editor',
  'Translator', 'Publisher', 'Imprint', 'Genre', 'Tags', 'Characters', 'Teams',
  'Locations', 'PageCount', 'LanguageISO', 'Format', 'BlackAndWhite', 'Manga',
  'AgeRating', 'CommunityRating', 'Year', 'Month', 'Day',
  'ComicZipAddedDate', 'ComicZipModifiedDate',
];

function taskText(lang, key, values) {
  return translate(key, lang || 'ko', values);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isArchive(filePath) {
  return ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
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

async function extractArchiveFile(filePath, innerPath, sevenZExe) {
  if (isZipArchive(filePath)) {
    const buffer = await fsp.readFile(filePath);
    const entry = listZipEntries(buffer).find(item => item.name === innerPath);
    if (!entry) throw new Error(`${innerPath} not found`);
    const extracted = readZipEntry(buffer, entry);
    if (!extracted) throw new Error(`${innerPath} extraction failed`);
    return extracted;
  }
  const result = await runProcess(sevenZExe, ['e', '-so', filePath, innerPath]);
  return result.buffer;
}

async function listArchiveEntries(filePath, sevenZExe) {
  if (isZipArchive(filePath)) {
    const buffer = await fsp.readFile(filePath);
    return listZipEntries(buffer).map(entry => ({
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

function inferMetadataFromFilename(filePath, pageCount) {
  const filename = path.basename(filePath, path.extname(filePath));
  const volumeMatch = filename.match(/(?:v|vol\.?|volume|\s)(\d+(?:\.\d+)?)(?:권)?/i);
  const title = filename.replace(/\.(zip|cbz|cbr|rar|7z)$/i, '').trim();
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

export async function analyzeMetadataInputs(paths, options = {}, onProgress) {
  const sevenZExe = options.sevenZExe;

  const archives = await expandInputPaths(paths);
  const items = [];
  const skippedFiles = [];

  for (let index = 0; index < archives.length; index += 1) {
    const filePath = archives[index];
    const filename = path.basename(filePath);
    onProgress?.({
      progress: Math.round((index / Math.max(archives.length, 1)) * 100),
      message: taskText(options.lang, 'task_metadata_analyzing', { index: index + 1, total: archives.length, name: filename }),
    });

    try {
      const entries = await listArchiveEntries(filePath, sevenZExe);
      const imageEntries = entries
        .filter(entry => !entry.isDir && isImage(entry.name))
        .sort((a, b) => naturalCompare(a.name, b.name));
      const comicInfoEntry = entries.find(entry => !entry.isDir && path.basename(entry.name).toLowerCase() === 'comicinfo.xml');
      let metadata = inferMetadataFromFilename(filePath, imageEntries.length);

      if (comicInfoEntry) {
        const xmlBuffer = await extractArchiveFile(filePath, comicInfoEntry.name, sevenZExe);
        metadata = { ...metadata, ...parseComicInfo(xmlBuffer.toString('utf8')) };
      }

      let coverDataUrl = '';
      if (imageEntries[0]) {
        try {
          coverDataUrl = imageDataUrl(await extractArchiveFile(filePath, imageEntries[0].name, sevenZExe), imageEntries[0].name);
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
        hasComicInfo: Boolean(comicInfoEntry),
        pageCount: imageEntries.length,
        sizeMb: stat.size / (1024 * 1024),
        coverDataUrl,
        metadata,
        originalMetadata: { ...metadata },
      });
    } catch (error) {
      skippedFiles.push(`${filename} (${error.message})`);
    }
  }

  onProgress?.({ progress: 100, message: taskText(options.lang, 'task_analysis_done') });
  return { items, skippedFiles };
}

export function metadataWriteSupport(filePath, lang = 'ko') {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.rar' || ext === '.cbr') {
    return {
      supported: false,
      message: taskText(lang, 'metadata_rar_write_unsupported'),
    };
  }
  return { supported: true, message: '' };
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

    const extension = path.extname(item.filepath);
    const token = `${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const tempArchive = path.join(
      path.dirname(item.filepath),
      `.${path.basename(item.filepath, extension)}.bookmanager_metadata_${token}${extension}`,
    );
    const sourceHoldingPath = `${item.filepath}.bookmanager.metadata.old`;
    try {
      const support = metadataWriteSupport(item.filepath, options.lang);
      if (!support.supported) {
        stats.skip.push(`${item.name || item.filepath} - ${support.message}`);
        continue;
      }
      await fsp.copyFile(item.filepath, tempArchive);
      await injectComicInfo(tempArchive, item.metadata || {}, sevenZExe, options.lang);
      if (options.shouldCancel?.()) {
        cancelled = true;
        break;
      }

      if (options.backup_on) {
        const backupDir = path.join(path.dirname(item.filepath), 'bak');
        await fsp.mkdir(backupDir, { recursive: true });
        let backupPath = path.join(backupDir, path.basename(item.filepath));
        if (fs.existsSync(backupPath)) {
          backupPath = path.join(
            backupDir,
            `${path.basename(item.filepath, extension)}_${token}${extension}`,
          );
        }
        await fsp.copyFile(item.filepath, backupPath);
      }

      await fsp.rm(sourceHoldingPath, { force: true }).catch(() => {});
      await fsp.rename(item.filepath, sourceHoldingPath);
      try {
        await fsp.rename(tempArchive, item.filepath);
        await fsp.rm(sourceHoldingPath, { force: true });
      } catch (error) {
        await fsp.rm(item.filepath, { force: true }).catch(() => {});
        if (fs.existsSync(sourceHoldingPath)) {
          await fsp.rename(sourceHoldingPath, item.filepath);
        }
        throw error;
      }
      stats.success.push(item.name || path.basename(item.filepath));
    } catch (error) {
      stats.error.push(`${item.name || item.filepath} - ${error.message}`);
    } finally {
      await fsp.rm(tempArchive, { force: true }).catch(() => {});
      if (fs.existsSync(sourceHoldingPath) && !fs.existsSync(item.filepath)) {
        await fsp.rename(sourceHoldingPath, item.filepath).catch(() => {});
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
