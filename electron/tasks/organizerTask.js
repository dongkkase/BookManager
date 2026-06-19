import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { cleanDisplayTitle, extractCoreTitle, formatLeafName, resolveTitles } from '../parsers/parser.js';

const ARCHIVE_EXTS = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function isArchive(filePath) {
  return ARCHIVE_EXTS.has(path.extname(filePath).toLowerCase());
}

function isImage(entryPath) {
  return IMAGE_EXTS.has(path.extname(entryPath).toLowerCase());
}

function isWebpConvertible(entryPath) {
  return ['.jpg', '.jpeg', '.png', '.bmp'].includes(path.extname(entryPath).toLowerCase());
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
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const rawName = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'utf8').normalize('NFC');

    entries.push({
      name,
      isDir: name.endsWith('/'),
      size: uncompressedSize || compressedSize,
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
      current = { name: value.normalize('NFC'), isDir: false, size: 0 };
    } else if (current && key === 'Attributes') {
      current.isDir = value.includes('D');
    } else if (current && key === 'Size') {
      current.size = Number(value) || 0;
    }
  }
  if (current?.name) entries.push(current);
  return entries.filter(entry => entry.name !== path.basename(filePath));
}

async function listArchiveEntries(filePath, sevenZExe) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip' || ext === '.cbz') {
    try {
      return listZipEntries(await fsp.readFile(filePath));
    } catch {
      return listWith7z(filePath, sevenZExe);
    }
  }
  return listWith7z(filePath, sevenZExe);
}

function getLeafGroups(entries) {
  const imageEntries = entries
    .filter(entry => !entry.isDir && isImage(entry.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (imageEntries.length === 0) return [];

  const groups = new Map();
  for (const entry of imageEntries) {
    const normalized = entry.name.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    let key = 'Root_Files';
    if (parts.length > 1) {
      const top = parts[0];
      const topLower = top.toLowerCase();
      const isPartFolder = /(\d+\s*부|제\s*\d+\s*부|시즌|season|part)/i.test(topLower);
      key = isPartFolder && parts.length > 2 ? `${top}/${parts[1]}` : top;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.name);
  }

  return [...groups.entries()]
    .sort((a, b) => naturalCompare(a[0], b[0]))
    .map(([name, images]) => ({ name, images }));
}

function applyLangFormat(name, lang, forceUnit = '') {
  const isChapter = forceUnit === '화';
  const match = String(name).match(/^(.*?)\s*(?:v|c)?([\d.\-~]+)(?:권|화|巻|話|vol\.?|ch\.?|volume|chapter)?\s*([^0-9]*)$/i);
  if (!match) return String(name).trim();

  let base = match[1].trim();
  const num = match[2].trim();
  const tail = match[3].trim();
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
  const results = [];
  const skippedFiles = [];

  for (let index = 0; index < archives.length; index += 1) {
    const filePath = archives[index];
    const filename = path.basename(filePath);
    onProgress?.({
      progress: Math.round((index / Math.max(archives.length, 1)) * 100),
      message: lang === 'en' ? `[${index + 1}/${archives.length}] Analyzing: ${filename}` : `[${index + 1}/${archives.length}] 구조 분석 중: ${filename}`,
    });

    try {
      const entries = await listArchiveEntries(filePath, options.sevenZExe);
      const groups = getLeafGroups(entries);
      if (groups.length === 0) {
        skippedFiles.push(filename);
        continue;
      }

      const stat = await fsp.stat(filePath);
      const firstImageName = groups[0]?.images?.[0] ? path.basename(groups[0].images[0], path.extname(groups[0].images[0])) : '';
      const [displayTitle, coreTitle] = resolveTitles(filePath, firstImageName);
      const volumes = groups.map((group, groupIndex) => {
        const leafBaseName = path.basename(group.name.replace(/\\/g, '/'));
        const rawName = groups.length === 1 && group.name === 'Root_Files'
          ? formatLeafName(coreTitle, firstImageName || filename, 0, 1, lang)
          : formatLeafName(coreTitle, leafBaseName, groupIndex, groups.length, lang);
        return {
          id: `${filePath}:${groupIndex}`,
          original_path: group.name,
          original_basename: leafBaseName,
          new_name: applyLangFormat(rawName, lang),
          type: group.name === 'Root_Files' ? 'archive' : 'folder',
          image_count: group.images.length,
        };
      });

      results.push({
        id: filePath,
        filepath: filePath,
        name: filename,
        checked: true,
        out_path: path.dirname(filePath),
        clean_title: cleanDisplayTitle(displayTitle),
        core_title: extractCoreTitle(coreTitle),
        size_mb: stat.size / (1024 * 1024),
        page_count: groups.reduce((sum, group) => sum + group.images.length, 0),
        volumes,
      });
    } catch (error) {
      skippedFiles.push(`${filename} (${error.message})`);
    }
  }

  onProgress?.({ progress: 100, message: lang === 'en' ? 'Analysis Done' : '분석 완료' });
  return { items: results, skippedFiles };
}

function targetExtFor(filePath, targetFormat) {
  if (!targetFormat || targetFormat === 'none') return path.extname(filePath).toLowerCase();
  return `.${String(targetFormat).replace(/^\./, '').toLowerCase()}`;
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
          const isPartFolder = /(\d+\s*부|제\s*\d+\s*부|시즌|season|part)/i.test(top);
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
          await runProcess(cwebpExe, [fullPath, '-o', tempPath, '-q', String(Math.max(1, Math.min(100, Number(quality) || 85)))]);
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

async function processOrganizerItem(item, options) {
  const sevenZExe = options.sevenZExe;
  if (!sevenZExe) throw new Error('7za executable not found.');

  const sourcePath = item.filepath;
  const filename = path.basename(sourcePath);
  const targetExt = targetExtFor(sourcePath, options.target_format);
  const tempBase = path.join(os.tmpdir(), `BookManager_Organizer_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const created = [];

  await fsp.mkdir(tempBase, { recursive: true });

  try {
    await runProcess(sevenZExe, ['x', sourcePath, `-o${tempBase}`, '-y']);
    const actualRoot = await getActualRoot(tempBase);
    const leaves = await getImageLeaves(actualRoot);
    if (leaves.length === 0) throw new Error('이미지 파일이 없거나 압축을 풀 수 없습니다.');

    const volumes = item.volumes || [];
    const archiveType = targetExt === '.7z' ? '-t7z' : '-tzip';

    for (let index = 0; index < leaves.length; index += 1) {
      const leaf = leaves[index];
      const volumeName = safeName(volumes[index]?.new_name || `${item.clean_title || path.basename(sourcePath, path.extname(sourcePath))} ${String(index + 1).padStart(2, '0')}권`);
      const outDir = item.out_path || path.dirname(sourcePath);
      await fsp.mkdir(outDir, { recursive: true });
      const targetPath = await uniquePath(path.join(outDir, `${volumeName}${targetExt}`));
      const tempArchive = path.join(os.tmpdir(), `BookManager_Done_${Date.now()}_${Math.random().toString(16).slice(2)}_${path.basename(targetPath)}`);

      if (options.webp_conversion || options.webpConversion) {
        await convertImagesToWebp(leaf, options.cwebpExe, options.img_quality ?? options.jpg_quality ?? 85);
      }
      await runProcess(sevenZExe, ['a', archiveType, tempArchive, '*', '-mx=0', '-mmt=on'], { cwd: leaf });
      await fsp.rename(tempArchive, targetPath);
      created.push(targetPath);
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
  } finally {
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
      message: options.lang === 'en' ? `[${index + 1}/${targets.length}] Processing: ${item.name}` : `[${index + 1}/${targets.length}] 처리 중: ${item.name}`,
    });

    try {
      const result = await processOrganizerItem(item, options);
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

  if (!cancelled) {
    onProgress?.({ progress: 100, message: options.lang === 'en' ? 'Done!' : '작업 완료!' });
  }
  return { stats, createdFiles, cancelled };
}
