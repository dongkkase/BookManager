import fs from 'node:fs';
import path from 'node:path';
import { t as i18nT } from './utils/i18n.js';

const fsp = fs.promises;

function appendRenameHistory(history, mapping) {
  if (Object.keys(mapping).length === 0) return history;
  const next = [
    ...history,
    {
      timestamp: Date.now(),
      mapping,
    },
  ];
  if (next.length > 10) next.splice(0, next.length - 10);
  return next;
}

export function executeMultiRename(renameMap, history = []) {
  const errors = [];
  let successCount = 0;
  const actualMapping = {};

  for (const [oldPath, newPath] of Object.entries(renameMap || {})) {
    try {
      if (!fs.existsSync(oldPath)) {
        errors.push(i18nT('fs_original_missing', [path.basename(oldPath)]));
        continue;
      }
      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        errors.push(i18nT('fs_name_exists', [path.basename(newPath)]));
        continue;
      }
      fs.renameSync(oldPath, newPath);
      actualMapping[newPath] = oldPath;
      successCount++;
    } catch (error) {
      errors.push(i18nT('fs_rename_failed', [path.basename(oldPath), error.message]));
    }
  }

  return {
    success: errors.length === 0,
    successCount,
    errors,
    history: appendRenameHistory(history, actualMapping),
  };
}

export function undoRename(history = []) {
  if (history.length === 0) {
    return {
      success: false,
      successCount: 0,
      errors: [],
      message: i18nT('fs_undo_empty'),
      history,
    };
  }
  const nextHistory = [...history];
  const lastRecord = nextHistory.pop();
  const mapping = lastRecord?.mapping || {};
  const errors = [];
  let successCount = 0;

  for (const [currentPath, oldPath] of Object.entries(mapping)) {
    if (fs.existsSync(currentPath)) {
      try {
        if (fs.existsSync(oldPath)) {
          errors.push(i18nT('fs_restore_exists', [path.basename(oldPath)]));
          continue;
        }
        fs.renameSync(currentPath, oldPath);
        successCount++;
      } catch (error) {
        errors.push(i18nT('fs_restore_failed', [path.basename(currentPath), error.message]));
      }
    } else {
      errors.push(i18nT('fs_file_missing', [path.basename(currentPath)]));
    }
  }

  return {
    success: errors.length === 0,
    successCount,
    errors,
    history: nextHistory,
  };
}

function hasFileInTree(rootPath) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (hasFileInTree(entryPath)) return true;
      continue;
    }
    return true;
  }
  return false;
}

function removeTreeIfNoFiles(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return false;
  const stats = fs.statSync(rootPath);
  if (!stats.isDirectory() || hasFileInTree(rootPath)) return false;
  fs.rmSync(rootPath, { recursive: true, force: false });
  return true;
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasFileInTreeAsync(rootPath) {
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (await hasFileInTreeAsync(entryPath)) return true;
      continue;
    }
    return true;
  }
  return false;
}

export async function removeTreeIfNoFilesAsync(rootPath) {
  if (!rootPath || !(await pathExists(rootPath))) return false;
  const stats = await fsp.stat(rootPath);
  if (!stats.isDirectory() || await hasFileInTreeAsync(rootPath)) return false;
  await fsp.rm(rootPath, { recursive: true, force: false });
  return true;
}

async function mapLimit(items, limit, iterator) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await iterator(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function findLibraryMoveConflicts(movePlans = []) {
  const plans = Array.isArray(movePlans) ? movePlans : [];
  const checks = await mapLimit(plans, 64, async (plan, index) => {
    const src = plan?.src;
    const dest = plan?.dest;
    if (!src || !dest || path.normalize(src) === path.normalize(dest)) return null;
    if (!await pathExists(dest)) return null;
    return { index, src, dest };
  });
  return {
    success: true,
    conflicts: checks.filter(Boolean),
  };
}

async function nextAvailableDestination(dest) {
  const ext = path.extname(dest);
  const base = dest.substring(0, dest.length - ext.length);
  let counter = 1;
  while (await pathExists(`${base}_${counter}${ext}`)) counter++;
  return `${base}_${counter}${ext}`;
}

async function movePathAsync(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const sourceStats = await fsp.stat(src);
    if (sourceStats.isDirectory()) {
      await fsp.cp(src, dest, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    } else {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }
}

export async function executeLibraryMoveAsync(movePlans = []) {
  let successCount = 0;
  let skippedCount = 0;
  const errors = [];
  const completedMoves = [];
  const cleanupRoots = new Set();

  for (const plan of movePlans) {
    let { src, dest } = plan;
    if (!await pathExists(src)) continue;

    if (await pathExists(dest) && path.normalize(src) !== path.normalize(dest)) {
      const choice = plan.conflictAction || 'skip';
      if (choice === 'skip') {
        skippedCount++;
        continue;
      }
      if (choice === 'overwrite') {
        try {
          const destinationStats = await fsp.stat(dest);
          if (destinationStats.isDirectory()) {
            await fsp.rm(dest, { recursive: true, force: true });
          } else {
            await fsp.unlink(dest);
          }
        } catch (_error) {
          errors.push(i18nT('fs_delete_existing_failed', [path.basename(dest)]));
          continue;
        }
      } else if (choice === 'rename') {
        dest = await nextAvailableDestination(dest);
      }
    }

    try {
      const destDir = path.dirname(dest);
      await fsp.mkdir(destDir, { recursive: true });
      await movePathAsync(src, dest);
      successCount++;
      completedMoves.push({ src, dest });
      const cleanupRoot = plan.cleanupRoot;
      if (cleanupRoot && path.normalize(cleanupRoot) === path.normalize(path.dirname(src))) {
        cleanupRoots.add(cleanupRoot);
      }
    } catch (error) {
      errors.push(i18nT('fs_move_failed', [path.basename(src), error.message]));
    }
  }

  for (const cleanupRoot of cleanupRoots) {
    await removeTreeIfNoFilesAsync(cleanupRoot).catch(() => {});
  }

  return {
    successCount,
    skippedCount,
    errors,
    completedMoves,
  };
}

export function executeLibraryMove(movePlans = []) {
  let successCount = 0;
  let skippedCount = 0;
  const errors = [];
  const completedMoves = [];

  for (const plan of movePlans) {
    let { src, dest } = plan;
    if (!fs.existsSync(src)) continue;

    if (fs.existsSync(dest) && path.normalize(src) !== path.normalize(dest)) {
      const choice = plan.conflictAction || 'skip';
      if (choice === 'skip') {
        skippedCount++;
        continue;
      }
      if (choice === 'overwrite') {
        try {
          const destinationStats = fs.statSync(dest);
          if (destinationStats.isDirectory()) {
            fs.rmSync(dest, { recursive: true, force: true });
          } else {
            fs.unlinkSync(dest);
          }
        } catch (_error) {
          errors.push(i18nT('fs_delete_existing_failed', [path.basename(dest)]));
          continue;
        }
      } else if (choice === 'rename') {
        const ext = path.extname(dest);
        const base = dest.substring(0, dest.length - ext.length);
        let counter = 1;
        while (fs.existsSync(`${base}_${counter}${ext}`)) counter++;
        dest = `${base}_${counter}${ext}`;
      }
    }

    try {
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      try {
        fs.renameSync(src, dest);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        const sourceStats = fs.statSync(src);
        if (sourceStats.isDirectory()) {
          fs.cpSync(src, dest, { recursive: true });
          fs.rmSync(src, { recursive: true, force: true });
        } else {
          fs.copyFileSync(src, dest);
          fs.unlinkSync(src);
        }
      }
      successCount++;
      completedMoves.push({ src, dest });
      const cleanupRoot = plan.cleanupRoot;
      if (cleanupRoot && path.normalize(cleanupRoot) === path.normalize(path.dirname(src))) {
        try {
          removeTreeIfNoFiles(cleanupRoot);
        } catch {
          // A non-empty or concurrently changed source folder is intentionally preserved.
        }
      }
    } catch (error) {
      errors.push(i18nT('fs_move_failed', [path.basename(src), error.message]));
    }
  }

  return {
    successCount,
    skippedCount,
    errors,
    completedMoves,
  };
}
