import fs from 'node:fs';
import path from 'node:path';

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
        errors.push(`${path.basename(oldPath)}: 원본 파일이 없습니다.`);
        continue;
      }
      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        errors.push(`${path.basename(newPath)}: 이미 동일한 파일명이 존재합니다.`);
        continue;
      }
      fs.renameSync(oldPath, newPath);
      actualMapping[newPath] = oldPath;
      successCount++;
    } catch (error) {
      errors.push(`${path.basename(oldPath)} 변경 실패: ${error.message}`);
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
      message: '되돌릴 이력이 없습니다.',
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
          errors.push(`${path.basename(oldPath)}이(가) 이미 존재합니다.`);
          continue;
        }
        fs.renameSync(currentPath, oldPath);
        successCount++;
      } catch (error) {
        errors.push(`${path.basename(currentPath)} 복구 실패: ${error.message}`);
      }
    } else {
      errors.push(`${path.basename(currentPath)} 파일을 찾을 수 없습니다.`);
    }
  }

  return {
    success: errors.length === 0,
    successCount,
    errors,
    history: nextHistory,
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
          errors.push(`기존 파일 삭제 실패: ${path.basename(dest)}`);
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
          if (fs.readdirSync(cleanupRoot).length === 0) fs.rmdirSync(cleanupRoot);
        } catch {
          // A non-empty or concurrently changed source folder is intentionally preserved.
        }
      }
    } catch (error) {
      errors.push(`${path.basename(src)} 이동 실패: ${error.message}`);
    }
  }

  return {
    successCount,
    skippedCount,
    errors,
    completedMoves,
  };
}
