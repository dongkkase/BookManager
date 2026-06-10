
/**
 * renameTask.js - 아카이브 내부 파일명 변경/이미지 최적화 백그라운드 워커
 *
 * Python의 RenameTask(QThread)를 Node.js EventEmitter 패턴으로 마이그레이션
 *
 * 흐름:
 * 1. 각 아카이브 파일의 엔트리 목록 조회
 * 2. 설정에 따라 파일명 변경, 폴더 평면화, WebP 변환, EXIF 제거, 용량 최적화
 * 3. 변경 사항이 없으면 스킵, 있으면 압축 해제 → 처리 → 재압축
 * 4. 처리 결과 이벤트 방출
 */

import { EventEmitter } from 'events';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { listArchiveEntries } from '../core/archiveUtils.js';

const execFileAsync = promisify(execFile);

// Windows flag for creating subprocess without window
const CREATE_NO_WINDOW = 0x08000000;

// ============================================================================
// 헬퍼 함수
// ============================================================================

/**
 * Windows에서 서브프로세스 창 숨김 옵션 반환
 */
function getSubprocessOptions() {
  if (process.platform === 'win32') {
    return { windowsHide: true };
  }
  return {};
}

/**
 * 외부 도구 경로查找 (7za, cwebp, pngquant, jpegtran)
 */
function getBinPath(toolName) {
  // Config에서 설정된 도구 경로 우선 사용
  const configPaths = {
    cwebp: process.env.CWEBP_PATH || null,
    pngquant: process.env.PNGQUANT_PATH || null,
    jpegtran: process.env.JPEGTRAN_PATH || null,
    '7za': process.env.SEVEN_ZIP_PATH || null,
  };

  if (configPaths[toolName]) {
    return configPaths[toolName];
  }

  // Fallback: 시스템 PATH에서查找
  try {
    const { stdout } = execFileAsync(
      process.platform === 'win32' ? 'where' : 'which',
      [toolName],
      getSubprocessOptions()
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

// 전역 도구 경로 캐시
const TOOL_CACHE = {};

function getCachedTool(toolName) {
  if (!(toolName in TOOL_CACHE)) {
    TOOL_CACHE[toolName] = getBinPath(toolName);
  }
  return TOOL_CACHE[toolName];
}

// ============================================================================
// RenameTask 클래스
// ============================================================================

class RenameTask extends EventEmitter {
  /**
   * @param {Array} fileDicts - [{ filepath, entries }] 배열
   * @param {Object} options - 설정 옵션
   */
  constructor(fileDicts, options = {}) {
    super();

    this.fileDicts = fileDicts;
    this.sevenZExe = options.sevenZipPath || getCachedTool('7za') || '7z';
    this.webpConversion = options.webpConversion || false;
    this.flattenFolders = options.flattenFolders || false;
    this.capOpt = options.capOpt || false; // 용량 최적화
    this.exifOpt = options.exifOpt || false; // EXIF 제거
    this.quality = options.quality ?? 80; // 이미지 품질 (0-100)
    this.targetExt = options.targetExt || '.zip'; // 변경할 확장자 (.zip, .7z)
    this.maxThreads = options.maxThreads || Math.max(2, os.cpus().length);
    this.lang = options.lang || 'ko';
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  /**
   * 파일명 생성 (예: 001_name.jpg → 001_name.webp)
   */
  generateNewName(index, ext, totalCount, stemName) {
    const padding = Math.ceil(Math.log10(totalCount));
    const num = String(index + 1).padStart(padding, '0');
    return `${num}_${stemName}${ext}`;
  }

  /**
   * 메인 실행 메서드
   */
  async run() {
    const stats = { success: [], skip: [], error: [] };
    const newArchiveData = {};
    const total = this.fileDicts.length;

    try {
      for (let idx = 0; idx < total; idx++) {
        if (this.isCancelled) break;

        const fileDict = this.fileDicts[idx];
        const file_path = fileDict.filepath;
        const filename = path.basename(file_path);
        const ext_type = path.extname(filename).toLowerCase();

        this.emit('progress', Math.round((idx / total) * 100), 
          this.lang === 'en' 
            ? `Processing: ${filename}` 
            : `처리 중: ${filename}`
        );

        try {
          // 아카이브 엔트리 목록 조회
          const entries = await this._getEntries(file_path, ext_type);
          if (!entries || entries.length === 0) {
            stats['skip'].push(filename);
            newArchiveData[file_path] = file_path;
            continue;
          }

          // 파일명 패턴 분석을 위한 데이터 준비
          const entryData = entries.map(e => ({
            original_name: e.name,
            filename: e.name,
            size: e.size
          }));

          // 타겟 확장자 결정
          const target_ext = this.targetExt || ext_type;
          const archive_type = target_ext === '.7z' ? '-t7z' : '-tzip';

          // Cover 파일 찾아서 맨 앞으로 이동
          const coverIndex = entryData.findIndex(
            e => path.basename(e.filename).toLowerCase().startsWith('cover')
          );
          if (coverIndex >= 0) {
            const [coverEntry] = entryData.splice(coverIndex, 1);
            entryData.unshift(coverEntry);
          }

          const rename_args = [];
          const total_count = entryData.length;
          const stem_name = path.basename(file_path, ext_type);

          const hasNonWebp = entryData.some(
            e => !e.original_name.toLowerCase().endsWith('.webp')
          );
          const actualWebpNeeded = this.webpConversion && hasNonWebp;

          // 파일명 변경 여부 확인
          for (let count = 0; count < entryData.length; count++) {
            const entry = entryData[count];
            const old_name = entry.original_name;
            const dir_name = path.dirname(entry.filename);
            let ext = path.extname(entry.filename) || '.jpg';
            
            if (this.webpConversion) {
              ext = '.webp';
            }

            const newBasename = this.generateNewName(count, ext, total_count, stem_name);
            const new_name = this.flattenFolders
              ? newBasename
              : path.join(dir_name, newBasename).replace(/\\/g, '/');

            if (old_name !== new_name || actualWebpNeeded) {
              rename_args.push([old_name, new_name]);
            }
          }

          const formatChanged = target_ext !== ext_type;
          const needsRename = rename_args.length > 0;

          // 🌟 [핵심 2] EXIF나 용량 최적화가 켜져 있으면 압축 풀기를 강제함
          const mustExtract = actualWebpNeeded || formatChanged || this.flattenFolders || 
            ext_type !== '.zip' && ext_type !== '.cbz' || this.capOpt || this.exifOpt;

          if (!needsRename && !mustExtract) {
            stats['skip'].push(filename);
            newArchiveData[file_path] = file_path;
            continue;
          }

          //_rename only mode (no extract needed)
          if (!mustExtract) {
            const flatArgs = [];
            for (const [oldN, newN] of rename_args) {
              flatArgs.push(oldN, newN);
            }

            const safeId = uuidv4().slice(0, 6);
            const tempRnArchive = path.join(
              os.tmpdir(),
              `ComicZIP_RN_${safeId}_${filename}`
            );
            await fs.copyFile(file_path, tempRnArchive);

            let renameSuccess = true;
            for (let i = 0; i < flatArgs.length; i += 40) {
              if (this.isCancelled) break;
              try {
                await execFileAsync(
                  this.sevenZExe,
                  ['rn', tempRnArchive, ...flatArgs.slice(i, i + 40)],
                  getSubprocessOptions()
                );
              } catch {
                renameSuccess = false;
                break;
              }
            }

            if (renameSuccess && !this.isCancelled) {
              await fs.unlink(file_path);
              await fs.rename(tempRnArchive, file_path);
              stats['success'].push(filename);
              newArchiveData[file_path] = file_path;
            } else {
              try { await fs.unlink(tempRnArchive); } catch {}
              // Fallback to full extract mode
              await this._processWithExtract(
                file_path, filename, ext_type, target_ext, archive_type,
                entryData, rename_args, stats, newArchiveData
              );
            }
            continue;
          }

          // Full extract & re-archive mode
          await this._processWithExtract(
            file_path, filename, ext_type, target_ext, archive_type,
            entryData, rename_args, stats, newArchiveData
          );

        } catch (e) {
          stats['error'].push(`${filename} - ${e.message}`);
        }
      }

      if (this.isCancelled) {
        this.emit('progress', 0, this.lang === 'en' ? 'Cancelled' : '작업 중단됨');
      } else {
        this.emit('progress', 100, this.lang === 'en' ? 'Done!' : '작업 완료!');
      }

      this.emit('renameDone', stats, newArchiveData, this.isCancelled);

    } catch (e) {
      this.emit('progress', 100, `Critical Error: ${e.message}`);
      stats['error'].push(e.message);
      this.emit('renameDone', stats, newArchiveData, true);
    }
  }

  /**
   * 아카이브 엔트리 목록 조회
   */
  async _getEntries(file_path, ext_type) {
    try {
      return await listArchiveEntries(file_path, ext_type, this.sevenZExe);
    } catch {
      return [];
    }
  }

  /**
   * 🌟 [핵심 1] 압축 해제 → 파일 처리 → 재압축 전체 파이프라인
   */
  async _processWithExtract(
    file_path, filename, ext_type, target_ext, archive_type,
    entries, rename_args, stats, newArchiveData
  ) {
    if (this.isCancelled) return;

    const safeId = uuidv4().slice(0, 6);
    const tempDir = path.join(os.tmpdir(), `ComicZIP_${safeId}_${filename}`);

    // 임시 디렉토리 생성
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
    await fs.mkdir(tempDir, { recursive: true });

    // 1. 아카이브 압축 해제
    await execFileAsync(
      this.sevenZExe,
      ['x', file_path, `-o${tempDir}`, '-y'],
      getSubprocessOptions()
    );

    // 🌟 [핵심 3] 파일명 변경이 없어도 EXIF 처리를 위해 전체 파일을 스레드풀에 매핑
    const tempRenameMapping = [];
    if (rename_args && rename_args.length > 0) {
      for (const [oldN, newN] of rename_args) {
        const tmpN = `${oldN}.rn.${uuidv4().slice(0, 8)}.tmp`;
        tempRenameMapping.push([oldN, tmpN, newN]);
      }
    } else {
      for (const entry of entries) {
        const oldN = entry.original_name || entry.name;
        const tmpN = `${oldN}.rn.${uuidv4().slice(0, 8)}.tmp`;
        tempRenameMapping.push([oldN, tmpN, oldN]);
      }
    }

    const actualTmpResults = new Map();

    // 🌟 [핵심 4] EXIF 옵션을 온전히 전달하는 _phase1Convert 엔진
    const processFiles = async () => {
      const queue = [...tempRenameMapping];
      const workers = [];

      const worker = async () => {
        for (const [oldN, tmpN, newN] of queue.splice(0, 1)) {
          if (this.isCancelled) break;
          try {
            const res = await this._phase1Convert(
              tempDir, oldN, tmpN, this.capOpt, this.exifOpt
            );
            if (res && res[0]) {
              actualTmpResults.set(tmpN, res);
            }
          } catch {}
        }
      };

      // 워커 пул
      for (let w = 0; w < Math.min(this.maxThreads, queue.length); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);
    };

    await processFiles();

    if (this.isCancelled) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
      return;
    }

    // 파일명 변경 및 정리
    for (const [oldN, tmpN, newN] of tempRenameMapping) {
      const res = actualTmpResults.get(tmpN);
      if (!res) continue;

      const [actualTmp, converted] = res;

      let newPath = path.join(tempDir, newN);
      await fs.mkdir(path.dirname(newPath), { recursive: true });

      // WebP fallback logic
      if (this.webpConversion && !converted && !oldN.toLowerCase().endsWith('.webp')) {
        const oldExt = path.extname(oldN);
        newPath = path.basename(newPath, path.extname(newPath)) + oldExt;
        newPath = path.join(path.dirname(newPath), path.basename(newPath));
      }

      if (fsSync.existsSync(newPath)) {
        await fs.unlink(newPath);
      }
      await fs.rename(actualTmp, newPath);
    }

    // Flatten folders
    if (this.flattenFolders) {
      await this._flattenDirectory(tempDir);
    }

    this.emit('progress', 
      Math.round(((tempRenameMapping.length * 0.9) / tempRenameMapping.length) * 100),
      `Re-archiving: ${filename}`
    );

    // 재압축
    const targetFinalPath = file_path.replace(new RegExp(ext_type + '$'), target_ext);
    const tempArchive = path.join(
      os.tmpdir(),
      `ComicZIP_Done_${safeId}_${filename}${target_ext}`
    );

    if (fsSync.existsSync(tempArchive)) {
      await fs.unlink(tempArchive);
    }

    await execFileAsync(
      this.sevenZExe,
      ['a', archive_type, tempArchive, '*', '-mx=0'],
      { ...getSubprocessOptions(), cwd: tempDir }
    );

    // 임시 디렉토리 정리
    fsSync.rmSync(tempDir, { recursive: true, force: true });

    // 원본 파일 교체
    const isSamePath = path.normalize(file_path) === path.normalize(targetFinalPath);

    if (isSamePath) {
      const tmpBackupPath = file_path + '.tmp';
      if (fsSync.existsSync(tmpBackupPath)) {
        await fs.unlink(tmpBackupPath);
      }
      await fs.rename(file_path, tmpBackupPath);

      try {
        await fs.rename(tempArchive, targetFinalPath);
        await fs.unlink(tmpBackupPath);
      } catch (e) {
        if (fsSync.existsSync(targetFinalPath)) {
          await fs.unlink(targetFinalPath);
        }
        await fs.rename(tmpBackupPath, file_path);
        throw e;
      }
    } else {
      if (fsSync.existsSync(targetFinalPath)) {
        await fs.unlink(targetFinalPath);
      }
      await fs.rename(tempArchive, targetFinalPath);
      if (fsSync.existsSync(file_path)) {
        await fs.unlink(file_path);
      }
    }

    stats['success'].push(filename);
    newArchiveData[file_path] = targetFinalPath;
  }

  /**
   * 폴더 평면화 - 모든 파일을 루트로 이동하고 빈 폴더 삭제
   */
  async _flattenDirectory(dirPath) {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        await this._flattenDirectory(fullPath);
        try {
          await fs.rmdir(fullPath);
        } catch {}
      }
    }
  }

  /**
   * 🌟 [핵심 4] 파일 변환 Phase 1
   * - WebP 변환, 용량 최적화, EXIF 제거
   * @returns {[string, boolean]} [actualTmpPath, converted]
   */
  async _phase1Convert(tempDir, oldName, tmpName, capOpt, exifOpt) {
    const oldPath = path.join(tempDir, oldName);
    const tmpPath = path.join(tempDir, tmpName);
    const ext = path.extname(oldName).toLowerCase();
    const qualityVal = this.quality;

    // 원본 파일이 없으면 스킵
    if (!fsSync.existsSync(oldPath)) {
      return null;
    }

    let converted = false;

    try {
      // WebP 변환
      if (this.webpConversion && !oldName.toLowerCase().endsWith('.webp')) {
        const toolCwebp = getCachedTool('cwebp');
        if (toolCwebp) {
          const cmd = [toolCwebp, oldPath, '-o', tmpPath, '-q', String(qualityVal)];
          if (exifOpt) {
            cmd.push('-no_metadata');
          }
          await execFileAsync(cmd[0], cmd.slice(1), getSubprocessOptions());
          converted = true;
          return [tmpPath, converted];
        }
      }

      // PNG 용량 최적화 (pngquant)
      if (ext === '.png' && capOpt) {
        const toolPngquant = getCachedTool('pngquant');
        if (toolPngquant) {
          const cmd = [
            toolPngquant,
            '--force',
            '--quality',
            `${Math.max(40, qualityVal)}-${qualityVal}`,
            '--output',
            tmpPath,
            oldPath
          ];
          if (exifOpt) {
            cmd.splice(4, 0, '--strip');
          }
          await execFileAsync(cmd[0], cmd.slice(1), getSubprocessOptions());
          converted = true;
          return [tmpPath, converted];
        }
      }

      // JPEG 용량 최적화 (jpegtran)
      if (ext === '.jpg' || ext === '.jpeg') {
        if (qualityVal === 100) {
          // Quality 100: jpegtran lossless 최적화
          const toolJpegtran = getCachedTool('jpegtran');
          if ((capOpt || exifOpt) && toolJpegtran) {
            const cmd = [toolJpegtran, '-optimize'];
            if (exifOpt) {
              cmd.push('-copy', 'none');
            } else {
              cmd.push('-copy', 'all');
            }
            cmd.push('-outfile', tmpPath, oldPath);
            await execFileAsync(cmd[0], cmd.slice(1), getSubprocessOptions());
            converted = true;
            return [tmpPath, converted];
          }
        } else {
          // Quality < 100: cwebp → webp 또는 jpegtran + 모질리
          const toolCwebp = getCachedTool('cwebp');
          if (toolCwebp) {
            const cmd = [toolCwebp, oldPath, '-o', tmpPath, '-q', String(qualityVal)];
            if (exifOpt) {
              cmd.push('-no_metadata');
            }
            await execFileAsync(cmd[0], cmd.slice(1), getSubprocessOptions());
            converted = true;
            return [tmpPath, converted];
          }
        }
      }

      // 변환이 필요 없으면 원본을 tmp로 복사
      await fs.copyFile(oldPath, tmpPath);
      return [tmpPath, false];

    } catch {
      // 실패 시 원본 복사
      try {
        await fs.copyFile(oldPath, tmpPath);
        return [tmpPath, false];
      } catch {
        return null;
      }
    }
  }
}

export default RenameTask;
