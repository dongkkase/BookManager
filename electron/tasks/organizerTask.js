import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { cleanDisplayTitle, extractCoreTitle, formatLeafName, resolveTitles } from '../parsers/parser.js';
import { missingBinaryMessage } from '../binaryPolicy.js';
import { listZipEntries, listZipEntriesFromFile, readZipEntry, readZipEntryFromFile } from '../core/zipArchive.js';
import { translate } from '../../src/utils/i18n.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const NESTED_ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.cb7', '.alz', '.egg']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.avif', '.heic', '.heif']);

function taskText(lang, key, values) {
  return translate(key, lang || 'ko', values);
}

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isArchive(filePath) {
  return ARCHIVE_EXTS.has(normalizedExt(filePath));
}

function isImage(entryPath) {
  return IMAGE_EXTS.has(normalizedExt(entryPath));
}

function isNestedArchive(entryPath) {
  return NESTED_ARCHIVE_EXTS.has(normalizedExt(entryPath));
}

function normalizedExt(filePath) {
  const name = path.basename(String(filePath || ''))
    .normalize('NFC')
    .replace(/[\s"'“”‘’\u200b-\u200f\u202a-\u202e\u2060\ufeff]+$/giu, '')
    .toLowerCase();
  const match = name.match(/(\.[^.\\/]+)$/);
  return match ? match[1].trim() : '';
}

function isWebpConvertible(entryPath) {
  return ['.jpg', '.jpeg', '.png', '.bmp'].includes(path.extname(entryPath).toLowerCase());
}

function isMacArchiveMetadataPath(entryPath) {
  const parts = String(entryPath || '')
    .replace(/\\/g, '/')
    .normalize('NFC')
    .split('/')
    .filter(Boolean);
  return parts.some(part => part === '__MACOSX' || part.startsWith('._'));
}

function isMacArchiveMetadataName(name) {
  const normalized = String(name || '').normalize('NFC');
  return normalized === '__MACOSX' || normalized.startsWith('._');
}

function safeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[._\-\s]+/, '')
    .trim() || 'Untitled';
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
    const parts = currentPath.split(path.sep);
    if (parts.includes('bak')) return;

    const entries = await fsp.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      await walk(path.join(currentPath, entry.name));
    }
  }

  for (const inputPath of paths || []) {
    await walk(inputPath);
  }

  return [...new Set(archives)].sort(naturalCompare);
}

async function directUnsupportedInputs(paths) {
  const skipped = [];
  for (const inputPath of paths || []) {
    try {
      const stat = await fsp.stat(inputPath);
      if (stat.isFile() && !isArchive(inputPath)) {
        skipped.push(`${path.basename(inputPath)} (unsupported extension: ${normalizedExt(inputPath) || 'none'})`);
      }
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

async function isUsableConvertedWebp(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size <= 0) return false;
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

function withoutMacMetadata(entries = []) {
  return entries.filter(entry => !isMacArchiveMetadataPath(entry.name));
}

function zipEntriesToArchiveEntries(entries = []) {
  return entries.map(entry => ({
    name: entry.name,
    isDir: entry.isDirectory,
    size: entry.uncompressedSize || entry.compressedSize,
    zipEntry: entry,
  }));
}

async function listArchiveEntries(filePath, sevenZExe) {
  const ext = normalizedExt(filePath);
  if (ext === '.zip' || ext === '.cbz') {
    try {
      return withoutMacMetadata(zipEntriesToArchiveEntries(await listZipEntriesFromFile(filePath)));
    } catch {
      return withoutMacMetadata(await listWith7z(filePath, sevenZExe));
    }
  }
  return withoutMacMetadata(await listWith7z(filePath, sevenZExe));
}

function comparableArchiveName(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.normalize('NFC')
    .replace(/[\s"'“”‘’\u200b-\u200f\u202a-\u202e\u2060\ufeff]+$/giu, '')
    .toLowerCase() || '';
}

function stripKnownArchiveExtension(value = '') {
  return String(value || '').replace(/\.(zip|cbz|cbr|7z|rar|cb7|alz|egg)$/i, '');
}

function isSameArchiveWrapperName(entryPath = '', sourcePath = '') {
  const entryName = comparableArchiveName(entryPath);
  const archiveName = comparableArchiveName(sourcePath);
  if (!entryName || !archiveName) return false;
  return entryName === archiveName
    || stripKnownArchiveExtension(entryName) === stripKnownArchiveExtension(archiveName);
}

function sharedArchiveWrapperPrefix(targetEntries = [], sourcePath = '') {
  if (!sourcePath || targetEntries.length === 0) return '';
  const firstParts = targetEntries
    .map(entry => String(entry.name || '').replace(/\\/g, '/').split('/').filter(Boolean))
    .filter(parts => parts.length > 1);
  if (firstParts.length !== targetEntries.length) return '';

  const top = firstParts[0][0];
  if (!top || firstParts.some(parts => parts[0] !== top)) return '';

  const topName = comparableArchiveName(top);
  const archiveName = comparableArchiveName(sourcePath);
  if (!topName || !archiveName) return '';
  if (topName === archiveName) return top;
  if (stripKnownArchiveExtension(topName) === stripKnownArchiveExtension(archiveName)) return top;
  return '';
}

function stripWrapperPrefix(entryPath = '', wrapperPrefix = '') {
  const normalized = String(entryPath || '').replace(/\\/g, '/');
  if (!wrapperPrefix) return normalized;
  const parts = normalized.split('/').filter(Boolean);
  if (parts[0] !== wrapperPrefix) return normalized;
  return parts.slice(1).join('/');
}

function getLeafGroups(entries, sourcePath = '') {
  const targetEntries = entries
    .filter(entry => !entry.isDir && (isImage(entry.name) || isNestedArchive(entry.name)))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (targetEntries.length === 0) return [];

  const wrapperPrefix = sharedArchiveWrapperPrefix(targetEntries, sourcePath);
  const groups = new Map();
  for (const entry of targetEntries) {
    const originalNormalized = entry.name.replace(/\\/g, '/');
    const normalized = stripWrapperPrefix(originalNormalized, wrapperPrefix);
    const parts = normalized.split('/').filter(Boolean);
    const nestedArchive = isNestedArchive(normalized);
    let key = 'Root_Files';

    if (nestedArchive) {
      key = normalized.replace(/\.[^.\\/]+$/, '') || path.basename(normalized, path.extname(normalized));
    } else if (parts.length > 1) {
      const top = parts[0];
      const topLower = top.toLowerCase();
      const isPartFolder = /(\d+\s*부(?![가-힣])|제\s*\d+\s*부(?![가-힣])|시즌|season|part)/i.test(topLower);
      key = isPartFolder && parts.length > 2 ? `${top}/${parts[1]}` : top;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        name: key,
        images: [],
        type: nestedArchive ? 'archive' : key === 'Root_Files' ? 'archive' : 'folder',
        inner_path: nestedArchive ? normalized : '',
        source_inner_path: nestedArchive ? originalNormalized : '',
        source_entry: nestedArchive ? entry.zipEntry || null : null,
      });
    }
    const group = groups.get(key);
    group.images.push(normalized);
    if (nestedArchive) {
      group.type = 'archive';
      group.inner_path = normalized;
      group.source_inner_path = originalNormalized;
      group.source_entry = entry.zipEntry || group.source_entry || null;
    }
  }

  return [...groups.values()].sort((a, b) => naturalCompare(a.name, b.name));
}

async function expandSingleNestedArchiveWrapper(sourcePath, groups = []) {
  if (groups.length !== 1) return groups;
  const wrapperGroup = groups[0];
  const sourceExt = normalizedExt(sourcePath);
  const wrapperExt = normalizedExt(wrapperGroup.inner_path);
  if (!['.zip', '.cbz'].includes(sourceExt) || !['.zip', '.cbz'].includes(wrapperExt)) return groups;
  if (!wrapperGroup.source_entry || !isSameArchiveWrapperName(wrapperGroup.inner_path, sourcePath)) return groups;

  const wrapperBuffer = await readZipEntryFromFile(sourcePath, wrapperGroup.source_entry);
  if (!wrapperBuffer) return groups;

  const wrapperEntries = withoutMacMetadata(zipEntriesToArchiveEntries(listZipEntries(wrapperBuffer)));
  const nestedGroups = getLeafGroups(wrapperEntries, wrapperGroup.inner_path);
  if (nestedGroups.length <= 1) return groups;

  return nestedGroups.map(group => ({
    ...group,
    wrapper_inner_path: wrapperGroup.source_inner_path || wrapperGroup.inner_path,
    wrapper_source_entry: wrapperGroup.source_entry,
  }));
}

function countImageEntries(entries = []) {
  return entries.filter(entry => !entry.isDir && !entry.isDirectory && isImage(entry.name)).length;
}

async function countNestedZipImagesFromSourceZip(sourcePath, group) {
  const sourceExt = normalizedExt(sourcePath);
  const nestedExt = normalizedExt(group.inner_path);
  if (!['.zip', '.cbz'].includes(sourceExt) || !['.zip', '.cbz'].includes(nestedExt)) return null;
  if (!group.source_entry) return null;
  const buffer = await readZipEntryFromFile(sourcePath, group.source_entry);
  if (!buffer) return null;
  return countImageEntries(listZipEntries(buffer));
}

async function wrapperArchiveBuffer(sourcePath, group, cache) {
  if (!group.wrapper_source_entry) return null;
  const key = group.wrapper_inner_path
    || group.wrapper_source_entry.localHeaderOffset
    || group.wrapper_source_entry.name
    || 'wrapper';
  if (!cache.has(key)) {
    cache.set(key, readZipEntryFromFile(sourcePath, group.wrapper_source_entry).catch(() => null));
  }
  return cache.get(key);
}

async function countNestedZipImagesFromWrapper(sourcePath, group, cache) {
  if (!group.wrapper_source_entry || !group.source_entry) return null;
  const nestedExt = normalizedExt(group.inner_path);
  if (!['.zip', '.cbz'].includes(nestedExt)) return null;
  const wrapperBuffer = await wrapperArchiveBuffer(sourcePath, group, cache);
  if (!wrapperBuffer) return null;
  const nestedBuffer = readZipEntry(wrapperBuffer, group.source_entry);
  if (!nestedBuffer) return null;
  return countImageEntries(listZipEntries(nestedBuffer));
}

async function findExtractedArchive(rootDir, innerPath) {
  const normalizedTarget = normalizeInnerArchivePath(innerPath);
  const directPath = path.join(rootDir, ...normalizedTarget.split('/').filter(Boolean));
  if (fs.existsSync(directPath)) return directPath;
  const targetName = path.basename(normalizedTarget);
  let found = '';
  async function walk(currentDir) {
    if (found) return;
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (isMacArchiveMetadataName(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name === targetName) {
        found = fullPath;
        return;
      }
    }
  }
  await walk(rootDir);
  return found;
}

async function countNestedArchiveImagesWith7z(sourcePath, group, sevenZExe) {
  if (!sevenZExe || !group.inner_path) return null;
  if (group.wrapper_source_entry) return null;
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'BookManager_NestedCount_'));
  try {
    await runQuietProcess(sevenZExe, ['x', sourcePath, group.source_inner_path || group.inner_path, `-o${tempDir}`, '-y']);
    const nestedPath = await findExtractedArchive(tempDir, group.inner_path);
    if (!nestedPath) return null;
    const entries = await listArchiveEntries(nestedPath, sevenZExe);
    return countImageEntries(entries);
  } catch {
    return null;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveGroupImageCount(sourcePath, group, sevenZExe) {
  if (!group.inner_path) return countImageEntries(group.images.map(name => ({ name, isDir: false })));
  const directCount = await countNestedZipImagesFromSourceZip(sourcePath, group);
  if (Number.isFinite(directCount)) return directCount;
  const extractedCount = await countNestedArchiveImagesWith7z(sourcePath, group, sevenZExe);
  if (Number.isFinite(extractedCount)) return extractedCount;
  return group.images.length;
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

async function resolveGroupImageCounts(sourcePath, groups, sevenZExe, options = {}) {
  if (options.fastAnalyze || options.skipNestedImageCounts) {
    return groups.map(group => ({
      ...group,
      image_count: group.inner_path
        ? Math.max(1, group.images.length)
        : countImageEntries(group.images.map(name => ({ name, isDir: false }))),
    }));
  }

  const wrapperCache = new Map();
  return mapWithConcurrency(
    groups,
    Math.min(2, Math.max(1, groups.length)),
    async group => {
      const wrapperCount = await countNestedZipImagesFromWrapper(sourcePath, group, wrapperCache);
      return {
        ...group,
        image_count: Number.isFinite(wrapperCount)
          ? wrapperCount
          : await resolveGroupImageCount(sourcePath, group, sevenZExe),
      };
    },
  );
}

function describeNoImageEntries(entries = []) {
  const extensions = [...new Set(entries
    .filter(entry => !entry.isDir)
    .map(entry => path.extname(entry.name).toLowerCase())
    .filter(Boolean))]
    .sort(naturalCompare);
  const extensionText = extensions.length > 0 ? extensions.join(', ') : 'none';
  return `no supported images: entries=${entries.length}, extensions=${extensionText}`;
}

function applyLangFormat(name, lang, forceUnit = '') {
  const match = String(name).match(/^(.*?)\s*(?:v|c)?([\d.\-~]+)\s*(권|화|巻|話|vol\.?|ch\.?|volume|chapter)?(?:\s*(외전|번외|side\s*story|spin[\s-]*off|special|특별편|한정판|limited(?:\s+edition)?))?\s*$/i);
  if (!match) return String(name).trim();

  let base = match[1].trim();
  const num = match[2].trim();
  const detectedUnit = (match[3] || '').trim();
  const tail = (match[4] || '').trim();
  const isChapter = forceUnit === '화' || /^(화|話|c|ch\.?|chapter)$/i.test(detectedUnit);
  if (tail) base = `${base} ${tail}`.trim();

  if (lang === 'en') {
    const unit = isChapter ? 'c' : 'v';
    return base ? `${base} ${unit}${num}` : `${unit}${num}`;
  }
  if (lang === 'ja') {
    const unit = isChapter ? '話' : '巻';
    return base ? `${base} ${num}${unit}` : `${num}${unit}`;
  }
  const unit = isChapter ? '화' : '권';
  return base ? `${base} ${num}${unit}` : `${num}${unit}`;
}

export async function analyzeOrganizerInputs(paths, options = {}, onProgress) {
  const lang = options.lang || 'ko';
  const archives = await expandInputPaths(paths);
  const skippedFiles = await directUnsupportedInputs(paths);
  let completed = 0;

  const analyzed = await mapWithConcurrency(archives, maxAnalysisWorkers(options, archives.length), async (filePath, index) => {
    const filename = path.basename(filePath);
    onProgress?.({
      progress: Math.round((index / Math.max(archives.length, 1)) * 100),
      message: taskText(lang, 'task_organizer_analyzing', { index: index + 1, total: archives.length, name: filename }),
    });

    try {
      const entries = await listArchiveEntries(filePath, options.sevenZExe);
      const leafGroups = await expandSingleNestedArchiveWrapper(filePath, getLeafGroups(entries, filePath));
      const groups = await resolveGroupImageCounts(filePath, leafGroups, options.sevenZExe, options);
      if (groups.length === 0) {
        return { skipped: `${filename} (${describeNoImageEntries(entries)})` };
      }

      const stat = await fsp.stat(filePath);
      const firstImageName = groups[0]?.images?.[0] ? path.basename(groups[0].images[0], path.extname(groups[0].images[0])) : '';
      const [displayTitle, coreTitle] = resolveTitles(filePath, firstImageName);
      const volumes = groups.map((group, groupIndex) => {
        const leafBaseName = path.basename(group.name.replace(/\\/g, '/'));
        const isSingleRootFiles = groups.length === 1 && group.name === 'Root_Files';
        const leafNameForTitle = isSingleRootFiles
          ? filename
          : leafBaseName;
        const rawName = formatLeafName(
          coreTitle,
          leafNameForTitle,
          isSingleRootFiles ? 0 : groupIndex,
          isSingleRootFiles ? 1 : groups.length,
          lang,
        );
        const extractedName = applyLangFormat(rawName, lang);
        return {
          id: `${filePath}:${groupIndex}`,
          original_path: group.name,
          original_basename: leafBaseName,
          extracted_name: extractedName,
          new_name: extractedName,
          type: group.type || (group.name === 'Root_Files' ? 'archive' : 'folder'),
          inner_path: group.inner_path || '',
          source_ext: group.inner_path ? normalizedExt(group.inner_path) : normalizedExt(filePath),
          image_count: group.image_count,
          spinoff_folder: /외전|번외|side\s*story|spin[\s-]*off/i.test(group.name),
        };
      });

      return { item: {
        id: filePath,
        filepath: filePath,
        name: filename,
        checked: true,
        out_path: path.dirname(filePath),
        clean_title: cleanDisplayTitle(displayTitle),
        core_title: extractCoreTitle(coreTitle),
        size_mb: stat.size / (1024 * 1024),
        page_count: groups.reduce((sum, group) => sum + group.image_count, 0),
        volumes,
      } };
    } catch (error) {
      return { skipped: `${filename} (${error.message})` };
    } finally {
      completed += 1;
      onProgress?.({
        progress: Math.round((completed / Math.max(archives.length, 1)) * 100),
        message: taskText(lang, 'task_organizer_analyzing', { index: completed, total: archives.length, name: filename }),
      });
    }
  });

  const results = [];
  for (const result of analyzed) {
    if (result?.item) results.push(result.item);
    if (result?.skipped) skippedFiles.push(result.skipped);
  }

  onProgress?.({ progress: 100, message: taskText(lang, 'task_analysis_done') });
  return { items: results, skippedFiles };
}

function targetExtFor(filePath, targetFormat) {
  if (!targetFormat || targetFormat === 'none') return normalizedExt(filePath) || path.extname(filePath).toLowerCase();
  return `.${String(targetFormat).replace(/^\./, '').toLowerCase()}`;
}

function isSameArchiveFormat(sourceExt, targetExt) {
  const zipFamily = new Set(['.zip', '.cbz', '.cbr']);
  if (zipFamily.has(sourceExt) && zipFamily.has(targetExt)) return true;
  return sourceExt === targetExt;
}

function normalizeInnerArchivePath(entryPath) {
  return String(entryPath || '').replace(/\\/g, '/').normalize('NFC');
}

function stripFirstPathComponent(entryPath) {
  const parts = normalizeInnerArchivePath(entryPath).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : '';
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

async function uniqueOrganizerTargetPath(basePath, sourcePath, allowSourcePath = false) {
  if (!fs.existsSync(basePath)) return basePath;
  if (allowSourcePath && path.resolve(basePath) === path.resolve(sourcePath)) return basePath;

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

async function getActualRoot(dir) {
  let current = dir;
  while (true) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory());
    const images = entries.filter(entry => entry.isFile() && isImage(entry.name));
    if (dirs.length === 1 && images.length === 0) {
      current = path.join(current, dirs[0].name);
    } else {
      return current;
    }
  }
}

async function getImageLeaves(actualRoot) {
  const rootImages = [];
  const leaves = new Set();

  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && isImage(entry.name)) {
        const rel = path.relative(actualRoot, currentDir);
        if (!rel) {
          rootImages.push(fullPath);
        } else {
          const parts = rel.split(path.sep).filter(Boolean);
          const top = parts[0];
          const isPartFolder = /(\d+\s*부(?![가-힣])|제\s*\d+\s*부(?![가-힣])|시즌|season|part)/i.test(top);
          leaves.add(path.join(actualRoot, isPartFolder && parts.length > 1 ? path.join(top, parts[1]) : top));
        }
      }
    }
  }

  await walk(actualRoot);
  if (rootImages.length > 0 && leaves.size === 0) leaves.add(actualRoot);
  return [...leaves].sort(naturalCompare);
}

async function convertImagesToWebp(rootDir, cwebpExe, quality = 85) {
  if (!cwebpExe) return 0;
  let converted = 0;
  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && isWebpConvertible(entry.name)) {
        const webpPath = path.join(currentDir, `${path.basename(entry.name, path.extname(entry.name))}.webp`);
        const tempPath = await uniquePath(path.join(currentDir, `${path.basename(entry.name, path.extname(entry.name))}.tmp.webp`));
        try {
          await runQuietProcess(cwebpExe, [fullPath, '-o', tempPath, '-q', String(Math.max(1, Math.min(100, Number(quality) || 85)))]);
          if (!await isUsableConvertedWebp(tempPath)) {
            await fsp.rm(tempPath, { force: true }).catch(() => {});
            continue;
          }
          if (fs.existsSync(webpPath)) await fsp.rm(webpPath, { force: true });
          await fsp.rename(tempPath, webpPath);
          await fsp.rm(fullPath, { force: true });
          converted += 1;
        } catch {
          await fsp.rm(tempPath, { force: true }).catch(() => {});
        }
      }
    }
  }
  await walk(rootDir);
  return converted;
}

async function extractNestedArchives(rootDir, sevenZExe, shouldCancel) {
  while (true) {
    const nested = [];
    async function collect(currentDir) {
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (isMacArchiveMetadataName(entry.name)) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) await collect(fullPath);
        else if (entry.isFile() && isArchive(fullPath)) nested.push(fullPath);
      }
    }
    await collect(rootDir);
    if (nested.length === 0) return;
    for (const archivePath of nested) {
      if (shouldCancel?.()) throw new Error('ORGANIZER_CANCELLED');
      const destination = archivePath.slice(0, -path.extname(archivePath).length);
      await fsp.mkdir(destination, { recursive: true });
      await runQuietProcess(sevenZExe, ['x', archivePath, `-o${destination}`, '-y']);
      await fsp.rm(archivePath, { force: true });
    }
  }
}

async function createFlatStaging(leaf, tempBase) {
  const staging = path.join(tempBase, `flat_${Math.random().toString(16).slice(2)}`);
  await fsp.mkdir(staging, { recursive: true });
  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => naturalCompare(a.name, b.name));
    for (const entry of entries) {
      if (isMacArchiveMetadataName(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === path.resolve(staging)) continue;
        await walk(fullPath);
      } else if (entry.isFile() && isImage(entry.name)) {
        const target = await uniquePath(path.join(staging, entry.name));
        await fsp.copyFile(fullPath, target);
      }
    }
  }
  await walk(leaf);
  return staging;
}

async function movePreparedFile(sourcePath, finalPath, options = {}) {
  const renameFile = options.renameFile || fsp.rename;
  const copyFile = options.copyFile || fsp.copyFile;
  try {
    await renameFile(sourcePath, finalPath);
    return;
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }

  try {
    await copyFile(sourcePath, finalPath);
  } catch (copyError) {
    await fsp.rm(finalPath, { force: true }).catch(() => {});
    throw copyError;
  }
  await fsp.rm(sourcePath, { force: true }).catch(() => {});
}

async function replaceSourceWithPreparedArchive(sourcePath, preparedArchive, finalPath, options = {}) {
  const holdingPath = await uniquePath(`${sourcePath}.bookmanager.tmp`);
  await fsp.rename(sourcePath, holdingPath);
  try {
    if (fs.existsSync(finalPath)) await fsp.rm(finalPath, { force: true });
    await movePreparedFile(preparedArchive, finalPath, options);
    await fsp.rm(holdingPath, { force: true });
  } catch (error) {
    await fsp.rm(finalPath, { force: true }).catch(() => {});
    if (fs.existsSync(holdingPath)) await fsp.rename(holdingPath, sourcePath);
    throw error;
  }
}

async function writePreparedArchive(sourcePath, preparedArchive, finalPath, options = {}) {
  const filename = path.basename(sourcePath);

  if (options.backup_on) {
    const backupDir = path.join(path.dirname(sourcePath), 'bak');
    await fsp.mkdir(backupDir, { recursive: true });
    await fsp.copyFile(sourcePath, await uniquePath(path.join(backupDir, filename)));
  }

  if (options.deleteOriginal === false) {
    await movePreparedFile(preparedArchive, finalPath, options);
    return;
  }

  if (path.resolve(sourcePath) === path.resolve(finalPath)) {
    await replaceSourceWithPreparedArchive(sourcePath, preparedArchive, finalPath, options);
    return;
  }

  await replaceSourceWithPreparedArchive(sourcePath, preparedArchive, finalPath, options);
}

async function renameOrganizerArchiveDirectly(sourcePath, renamePairs, finalPath, options = {}) {
  const sevenZExe = options.sevenZExe;
  const filename = path.basename(sourcePath);
  let tempArchive = path.join(os.tmpdir(), `BookManager_OrganizerRN_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(finalPath)}`);

  try {
    await fsp.copyFile(sourcePath, tempArchive);
    for (let index = 0; index < renamePairs.length; index += 20) {
      if (options.shouldCancel?.()) return { cancelled: true, message: filename, created: [] };
      const args = [];
      for (const pair of renamePairs.slice(index, index + 20)) {
        args.push(pair.oldPath, pair.newPath);
      }
      await runQuietProcess(sevenZExe, ['rn', tempArchive, ...args]);
    }

    await writePreparedArchive(sourcePath, tempArchive, finalPath, options);
    tempArchive = '';
    return { success: true, message: filename, created: [finalPath] };
  } finally {
    if (tempArchive) await fsp.rm(tempArchive, { force: true }).catch(() => {});
  }
}

async function copyOrganizerArchiveDirectly(sourcePath, finalPath, options = {}) {
  const filename = path.basename(sourcePath);
  let tempArchive = path.join(os.tmpdir(), `BookManager_OrganizerCopy_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(finalPath)}`);

  try {
    await fsp.copyFile(sourcePath, tempArchive);
    await writePreparedArchive(sourcePath, tempArchive, finalPath, options);
    tempArchive = '';
    return { success: true, message: filename, created: [finalPath] };
  } finally {
    if (tempArchive) await fsp.rm(tempArchive, { force: true }).catch(() => {});
  }
}

function canUseOrganizerDirectPath(item, sourceExt, targetExt, options = {}) {
  const volumes = item.volumes || [];
  return volumes.length === 1
    && isSameArchiveFormat(sourceExt, targetExt)
    && !(options.flatten_folders || options.flattenFolders)
    && !(options.webp_conversion || options.webpConversion);
}

async function tryProcessOrganizerItemDirectly(item, sourceExt, targetExt, options = {}) {
  if (!canUseOrganizerDirectPath(item, sourceExt, targetExt, options)) return null;

  const sourcePath = item.filepath;
  const volume = (item.volumes || [])[0];
  const outDir = item.out_path || path.dirname(sourcePath);
  const volumeName = safeName(volume?.new_name || item.clean_title || path.basename(sourcePath, path.extname(sourcePath)));
  await fsp.mkdir(outDir, { recursive: true });
  const finalPath = await uniqueOrganizerTargetPath(
    path.join(outDir, `${volumeName}${targetExt}`),
    sourcePath,
    options.deleteOriginal !== false,
  );

  if (options.shouldCancel?.()) return { cancelled: true, message: path.basename(sourcePath), created: [] };

  if (volume?.type !== 'folder') {
    if (volume?.inner_path) return null;
    return copyOrganizerArchiveDirectly(sourcePath, finalPath, options);
  }

  const entries = await listArchiveEntries(sourcePath, options.sevenZExe);
  const originalPath = normalizeInnerArchivePath(volume.original_path || '');
  if (!originalPath) return copyOrganizerArchiveDirectly(sourcePath, finalPath, options);

  const prefix = originalPath.endsWith('/') ? originalPath : `${originalPath}/`;
  const renamePairs = entries
    .filter(entry => !entry.isDir)
    .map(entry => {
      const oldPath = normalizeInnerArchivePath(entry.name);
      if (!oldPath.startsWith(prefix)) return null;
      const newPath = stripFirstPathComponent(oldPath);
      if (!newPath || oldPath === newPath) return null;
      return { oldPath, newPath };
    })
    .filter(Boolean);

  if (renamePairs.length === 0) return null;
  return renameOrganizerArchiveDirectly(sourcePath, renamePairs, finalPath, options);
}

async function processOrganizerItem(item, options) {
  const sevenZExe = options.sevenZExe;
  if (!sevenZExe) throw new Error(missingBinaryMessage('7z'));

  const sourcePath = item.filepath;
  const filename = path.basename(sourcePath);
  const sourceExt = normalizedExt(sourcePath) || path.extname(sourcePath).toLowerCase();
  const targetExt = targetExtFor(sourcePath, options.target_format);
  const directResult = await tryProcessOrganizerItemDirectly(item, sourceExt, targetExt, options).catch(() => null);
  if (directResult) return directResult;

  const tempBase = path.join(os.tmpdir(), `BookManager_Organizer_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const created = [];
  const tempArchives = [];

  await fsp.mkdir(tempBase, { recursive: true });

  try {
    if (options.shouldCancel?.()) return { cancelled: true, message: filename, created: [] };
    await runQuietProcess(sevenZExe, ['x', sourcePath, `-o${tempBase}`, '-y']);
    await extractNestedArchives(tempBase, sevenZExe, options.shouldCancel);
    const actualRoot = await getActualRoot(tempBase);
    const leaves = await getImageLeaves(actualRoot);
    if (leaves.length === 0) throw new Error(taskText(options.lang, 'task_no_images_or_extract_failed'));

    const volumes = item.volumes || [];
    const archiveType = targetExt === '.7z' ? '-t7z' : '-tzip';

    for (let index = 0; index < leaves.length; index += 1) {
      if (options.shouldCancel?.()) {
        for (const createdPath of created) await fsp.rm(createdPath, { force: true }).catch(() => {});
        return { cancelled: true, message: filename, created: [] };
      }
      const leaf = leaves[index];
      const volumeName = safeName(volumes[index]?.new_name || `${item.clean_title || path.basename(sourcePath, path.extname(sourcePath))} ${String(index + 1).padStart(2, '0')}권`);
      const outDir = item.out_path || path.dirname(sourcePath);
      await fsp.mkdir(outDir, { recursive: true });
      const targetPath = await uniquePath(path.join(outDir, `${volumeName}${targetExt}`));
      const tempArchive = path.join(os.tmpdir(), `BookManager_Done_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(targetPath)}`);
      tempArchives.push(tempArchive);

      if (options.webp_conversion || options.webpConversion) {
        await convertImagesToWebp(leaf, options.cwebpExe, options.img_quality ?? options.jpg_quality ?? 85);
      }
      const packRoot = options.flatten_folders || options.flattenFolders
        ? await createFlatStaging(leaf, tempBase)
        : leaf;
      if (options.shouldCancel?.()) {
        for (const createdPath of created) await fsp.rm(createdPath, { force: true }).catch(() => {});
        return { cancelled: true, message: filename, created: [] };
      }
      await runQuietProcess(sevenZExe, ['a', archiveType, tempArchive, '*', '-mx=0', '-mmt=on'], { cwd: packRoot });
      await movePreparedFile(tempArchive, targetPath, options);
      created.push(targetPath);
    }

    if (options.shouldCancel?.()) {
      for (const createdPath of created) await fsp.rm(createdPath, { force: true }).catch(() => {});
      return { cancelled: true, message: filename, created: [] };
    }

    if (options.backup_on) {
      const backupDir = path.join(path.dirname(sourcePath), 'bak');
      await fsp.mkdir(backupDir, { recursive: true });
      await fsp.copyFile(sourcePath, await uniquePath(path.join(backupDir, filename)));
    }

    if (options.deleteOriginal !== false) {
      await fsp.unlink(sourcePath);
    }

    return { success: true, message: filename, created };
  } catch (error) {
    for (const createdPath of created) {
      await fsp.rm(createdPath, { force: true }).catch(() => {});
    }
    throw error;
  } finally {
    for (const tempArchive of tempArchives) {
      await fsp.rm(tempArchive, { force: true }).catch(() => {});
    }
    await fsp.rm(tempBase, { recursive: true, force: true });
  }
}

export async function executeOrganizer(items, options = {}, onProgress) {
  const targets = (items || []).filter(item => item.checked !== false);
  const stats = { success: [], skip: [], error: [] };
  const createdFiles = [];
  let cancelled = false;

  for (let index = 0; index < targets.length; index += 1) {
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const item = targets[index];
    onProgress?.({
      progress: Math.round((index / Math.max(targets.length, 1)) * 100),
      message: taskText(options.lang, 'task_processing_item', { index: index + 1, total: targets.length, name: item.name }),
    });

    try {
      const result = await processOrganizerItem(item, options);
      if (result.cancelled) {
        stats.skip.push(`${item.name || path.basename(item.filepath)} (Cancelled)`);
        cancelled = true;
        break;
      }
      stats.success.push(result.message);
      createdFiles.push(...result.created);
    } catch (error) {
      stats.error.push(`${item.name || item.filepath} - ${error.message}`);
    }
    if (options.shouldCancel?.()) {
      cancelled = true;
      break;
    }
  }

  if (!cancelled) onProgress?.({ progress: 100, message: taskText(options.lang, 'task_done') });
  return { stats, createdFiles, cancelled };
}
