import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { missingBinaryMessage } from '../binaryPolicy.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const NESTED_ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.alz', '.egg']);

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
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

  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(centralOffset + 8);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const rawName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'utf8').normalize('NFC');

    entries.push({
      name: normalizeInnerPath(name),
      isDir: name.endsWith('/'),
      size: uncompressedSize || compressedSize,
      encrypted: Boolean(flags & 0x1),
    });

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 || code === 1) resolve({ code, stdout, stderr });
      else reject(new Error(stderr || stdout || `${command} exited with ${code}`));
    });
  });
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
      const nativeEntries = listZipEntries(await fsp.readFile(filePath));
      if (nativeEntries.length > 0) return nativeEntries;
      return listWith7z(filePath, sevenZExe);
    } catch {
      return listWith7z(filePath, sevenZExe);
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

export async function analyzeRenamerInputs(paths, options = {}, onProgress) {
  const archives = await expandInputPaths(paths);
  const items = [];
  const skippedFiles = await directUnsupportedInputs(paths);

  for (let index = 0; index < archives.length; index += 1) {
    const filePath = archives[index];
    const name = path.basename(filePath);
    onProgress?.({
      progress: Math.round((index / Math.max(archives.length, 1)) * 100),
      message: options.lang === 'en' ? `[${index + 1}/${archives.length}] Analyzing: ${name}` : `[${index + 1}/${archives.length}] 분석 중: ${name}`,
    });

    try {
      const stat = await fsp.stat(filePath);
      const archiveEntries = await listArchiveEntries(filePath, options.sevenZExe);
      if (archiveEntries.some(entry => entry.encrypted)) {
        skippedFiles.push(`${name} (encrypted archive)`);
        continue;
      }
      if (archiveEntries.some(entry => !entry.isDir && NESTED_ARCHIVE_EXTS.has(path.extname(entry.name).toLowerCase()))) {
        skippedFiles.push(`${name} (nested archive)`);
        continue;
      }
      const entries = buildEntries(filePath, archiveEntries, options);
      if (entries.length === 0) {
        skippedFiles.push(`${name} (no supported images)`);
        continue;
      }

      items.push({
        id: filePath,
        filepath: filePath,
        name,
        checked: true,
        capOpt: false,
        exifOpt: true,
        count: entries.length,
        sizeMb: stat.size / (1024 * 1024),
        entries,
      });
    } catch (error) {
      skippedFiles.push(`${name} (${error.message})`);
    }
  }

  onProgress?.({ progress: 100, message: options.lang === 'en' ? 'Analysis Done' : '분석 완료' });
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
  if (!optimize && !stripExif) return;

  async function replaceWhenUseful(sourcePath, tempPath) {
    const [sourceStat, tempStat] = await Promise.all([fsp.stat(sourcePath), fsp.stat(tempPath)]);
    if (stripExif || tempStat.size < sourceStat.size) {
      await fsp.rm(sourcePath, { force: true });
      await fsp.rename(tempPath, sourcePath);
    } else {
      await fsp.rm(tempPath, { force: true });
    }
  }

  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (options.shouldCancel?.()) return;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isImage(entry.name)) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const tempPath = `${fullPath}.opt.tmp`;
      try {
        if ((extension === '.jpg' || extension === '.jpeg') && options.jpegtranExe) {
          const args = ['-optimize', '-copy', stripExif ? 'none' : 'all', '-outfile', tempPath, fullPath];
          await runProcess(options.jpegtranExe, args);
          await replaceWhenUseful(fullPath, tempPath);
        } else if (extension === '.png' && options.pngquantExe) {
          const quality = Math.max(40, Math.min(100, Number(options.img_quality) || 85));
          const args = ['--force', '--quality', `${quality}-${quality}`, '--output', tempPath];
          if (stripExif) args.push('--strip');
          args.push(fullPath);
          await runProcess(options.pngquantExe, args);
          await replaceWhenUseful(fullPath, tempPath);
        } else if (extension === '.webp' && options.cwebpExe) {
          const quality = Math.max(1, Math.min(100, Number(options.img_quality) || 85));
          const args = [fullPath, '-o', tempPath, '-q', String(quality)];
          if (stripExif) args.push('-metadata', 'none');
          await runProcess(options.cwebpExe, args);
          await replaceWhenUseful(fullPath, tempPath);
        }
      } catch {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
      }
    }
  }
  await walk(rootDir);
}

async function processRenamerItem(item, options) {
  const sevenZExe = options.sevenZExe;
  if (!sevenZExe) throw new Error(missingBinaryMessage('7z'));

  const sourcePath = item.filepath;
  const filename = path.basename(sourcePath);
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const targetExt = targetExtFor(sourcePath, options.target_format);
  const tempBase = path.join(os.tmpdir(), `BookManager_Renamer_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const holdingDir = path.join(tempBase, '.bookmanager_rename_tmp');
  const archiveType = targetExt === '.7z' ? '-t7z' : '-tzip';
  let tempArchive = '';

  await fsp.mkdir(holdingDir, { recursive: true });

  try {
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };
    await runProcess(sevenZExe, ['x', sourcePath, `-o${tempBase}`, '-y']);

    const moves = [];
    for (let index = 0; index < (item.entries || []).length; index += 1) {
      const entry = item.entries[index];
      const originalPath = normalizeInnerPath(entry.originalPath);
      const oldAbs = path.join(tempBase, ...originalPath.split('/').filter(Boolean));
      const dirPart = options.flattenFolders ? '' : path.posix.dirname(originalPath);
      const targetDir = dirPart && dirPart !== '.'
        ? path.join(tempBase, ...dirPart.split('/').filter(Boolean))
        : tempBase;
      const targetAbs = path.join(targetDir, safeName(entry.newName));

      if (!fs.existsSync(oldAbs)) continue;
      await fsp.mkdir(targetDir, { recursive: true });
      moves.push({ oldAbs, targetAbs, tempAbs: path.join(holdingDir, `${String(index).padStart(5, '0')}_${safeName(path.basename(oldAbs))}`) });
    }

    for (const move of moves) {
      const sourceExtension = path.extname(move.oldAbs).toLowerCase();
      if ((options.webp_conversion || options.webpConversion) && sourceExtension !== '.webp') {
        if (!options.cwebpExe) throw new Error('cwebp executable not found.');
        await runProcess(options.cwebpExe, [
          move.oldAbs,
          '-o',
          move.tempAbs,
          '-q',
          String(Math.max(1, Math.min(100, Number(options.img_quality) || 85))),
          ...(item.exifOpt ? ['-metadata', 'none'] : []),
        ]);
        await fsp.rm(move.oldAbs, { force: true });
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

    const outputName = `${path.basename(sourcePath, sourceExt)}${targetExt}`;
    const finalPath = options.deleteOriginal === false
      ? await uniquePath(path.join(path.dirname(sourcePath), outputName))
      : path.join(path.dirname(sourcePath), outputName);
    tempArchive = path.join(os.tmpdir(), `BookManager_Renamed_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(finalPath)}`);

    await optimizeExtractedImages(tempBase, item, options);
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };
    await runProcess(sevenZExe, ['a', archiveType, tempArchive, '*', '-mx=0', '-mmt=on'], { cwd: tempBase });
    if (options.shouldCancel?.()) return { cancelled: true, message: filename };

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
      message: options.lang === 'en' ? `[${index + 1}/${targets.length}] Renaming: ${item.name}` : `[${index + 1}/${targets.length}] 이름 변경 중: ${item.name}`,
    });

    try {
      const result = await processRenamerItem(item, options);
      if (result.cancelled) {
        stats.skip.push(`${item.name || path.basename(item.filepath)} (Cancelled)`);
        cancelled = true;
        break;
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

  if (!cancelled) {
    onProgress?.({ progress: 100, message: options.lang === 'en' ? 'Done!' : '작업 완료!' });
  }
  return {
    stats,
    outputFiles,
    cancelled,
    pathMap,
  };
}
