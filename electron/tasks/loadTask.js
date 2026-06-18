/**
 * loadTask.js - 아카이브 로딩 백그라운드 워커
 *
 * Python의 OrganizerLoadTask / FileLoadTask(QThread)를 Node.js EventEmitter 패턴으로 마이그레이션
 *
 * 흐름:
 * 1. 각 파일의 아카이브 엔트리 목록 조회 (ZIP/CBZ는 네이티브, 나머지는 7z)
 * 2. 한국어 파일명 인코딩 복구 (CP437 → CP949)
 * 3. 내부 구조 분석 (커버 이미지, 볼륨 그룹, 네스트된 아카이브 감지)
 * 4. 분석 결과 이벤트 방출
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

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
 * Python zipfile 모듈이 CP949(한국어)를 CP437로 잘못 읽어 깨지는 현상 완벽 복원
 */
function decodeZipFilename(filename) {
  try {
    const rawBytes = Buffer.from(filename, 'cp437');
    try {
      return rawBytes.toString('cp949');
    } catch {
      return rawBytes.toString('utf8');
    }
  } catch {
    return filename;
  }
}

/**
 * 아카이브 엔트리 목록快速获取
 * ZIP/CBZ는 AdmZip 네이티브 처리, 나머지는 7z subprocess 사용
 * @returns {Promise<{entries: Array, hasNested: boolean}>}
 */
async function listEntriesFast(filepath, ext, sevenZExe) {
  const entries = [];
  let hasNested = false;

  const imgExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
  const nestedExts = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.egg']);

  if (ext === '.zip' || ext === '.cbz') {
    try {
      const zip = new AdmZip(filepath);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        const entryName = decodeZipFilename(entry.entryName);
        const entryExt = path.extname(entryName).toLowerCase();

        if (entryExt === '' && !entry.isDirectory) continue;

        entries.push({
          name: entryName,
          isDir: entry.isDirectory,
          size: entry.uncompressedSize
        });

        if (nestedExts.has(entryExt)) {
          hasNested = true;
        }
      }
    } catch {
      // ZIP 읽기 실패 시 7z fallback
      await _listWith7z(filepath, ext, sevenZExe, entries, imgExts, nestedExts, hasNested);
    }
  } else {
    await _listWith7z(filepath, ext, sevenZExe, entries, imgExts, nestedExts, hasNested);
  }

  return { entries, hasNested };
}

/**
 * 7z로 아카이브 엔트리 목록 조회
 */
async function _listWith7z(filepath, ext, sevenZExe, entries, imgExts, nestedExts, hasNested) {
  return new Promise((resolve) => {
    const proc = spawn(sevenZExe, ['l', filepath], getSubprocessOptions());
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const lines = stdout.split('\n');
        for (const line of lines) {
          // 7z 목록 형식: Date Time Attr Size Compressed Ratio Name
          const match = line.match(
            /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+(\S+)\s+(\d+)\s+\d+\s+\d+%\s+(.+)/
          );
          if (match) {
            const attrs = match[1];
            const size = parseInt(match[2], 10);
            const name = decodeZipFilename(match[3].trim());
            const isDir = attrs.includes('D');
            const ext = path.extname(name).toLowerCase();

            entries.push({ name, isDir, size });

            if (nestedExts.has(ext)) {
              hasNested = true;
            }
          }
        }
      }
      resolve();
    });

    proc.on('error', () => {
      resolve();
    });
  });
}

/**
 * 엔트리 목록에서 아카이브 구조 분석
 * @returns {Promise<{volumeGroups: Array, innerMeaningfulName: string, swallowedName: string, forceUnit: string}>}
 */
function analyzeFromEntries(entries, filepath, lang) {
  const imgExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.cr2', '.tif', '.tiff']);
  const nestedExts = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.egg']);

  let innerMeaningfulName = '';
  let swallowedName = '';
  let forceUnit = '';

  // 이미지 엔트리 수집
  const imageEntries = [];
  const nestedEntries = [];

  for (const entry of entries) {
    const ext = path.extname(entry.name).toLowerCase();
    if (imgExts.has(ext)) {
      imageEntries.push(entry);
    }
    if (nestedExts.has(ext)) {
      nestedEntries.push(entry);
    }
  }

  // 이미지 엔트리가 없으면 빈 결과 반환
  if (imageEntries.length === 0) {
    return {
      volumeGroups: [],
      innerMeaningfulName: '',
      swallowedName: '',
      forceUnit: ''
    };
  }

  // 내부 의미 있는 이름 추출 (이미지 파일명에서)
  const firstImage = imageEntries[0];
  const firstImageStem = path.basename(firstImage.name, path.extname(firstImage.name));
  innerMeaningfulName = firstImageStem;

  // 볼륨 그룹 분석
  const volumeGroups = _analyzeVolumeGroups(entries, filepath, lang);

  return {
    volumeGroups,
    innerMeaningfulName,
    swallowedName,
    forceUnit
  };
}

/**
 * 볼륨 그룹 분석 - 자연 정렬로 이미지 파일명에서 볼륨 번호 추출
 */
function _analyzeVolumeGroups(entries, filepath, lang) {
  const imgExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
  const imageEntries = entries.filter(e => imgExts.has(path.extname(e.name).toLowerCase()));

  if (imageEntries.length === 0) return [];

  // 자연 정렬
  imageEntries.sort((a, b) => naturalSort(a.name, b.name));

  // 파일명에서 볼륨 번호 추출
  const volumePattern = /(?:^|\/)(\d+(?:\.\d+)?)\s*\./;
  const volumes = [];

  for (const entry of imageEntries) {
    const stem = path.basename(entry.name, path.extname(entry.name));
    const match = stem.match(volumePattern);
    if (match) {
      volumes.push(parseFloat(match[1]));
    }
  }

  return volumes;
}

/**
 * 자연 정렬 비교 함수
 */
function naturalSort(a, b) {
  const tokenizer = /(\d+)|(\D+)/g;
  const aParts = a.match(tokenizer) || [];
  const bParts = b.match(tokenizer) || [];

  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];

    if (/\d+/.test(aPart) && /\d+/.test(bPart)) {
      const numA = parseInt(aPart, 10);
      const numB = parseInt(bPart, 10);
      if (numA !== numB) return numA - numB;
    } else {
      if (aPart < bPart) return -1;
      if (aPart > bPart) return 1;
    }
  }

  return aParts.length - bParts.length;
}

// ============================================================================
// OrganizerLoadTask - Organizer 탭용 로딩 태스크
// ============================================================================

class OrganizerLoadTask extends EventEmitter {
  /**
   * @param {string[]} paths - 로딩할 파일 경로 목록
   * @param {string} sevenZExe - 7z 실행파일 경로
   * @param {string} lang - 언어 ('ko', 'en', 'ja')
   */
  constructor(paths, sevenZExe, lang) {
    super();
    this.paths = paths;
    this.sevenZExe = sevenZExe;
    this.lang = lang || 'ko';
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  /**
   * 메인 실행 메서드
   */
  async run() {
    const results = [];
    const skippedFiles = [];

    for (const pathStr of this.paths) {
      if (this.isCancelled) break;

      try {
        const filepath = pathStr;
        const ext = path.extname(filepath).toLowerCase();

        // 파일 존재 확인
        try {
          await fs.access(filepath);
        } catch {
          skippedFiles.push(filepath);
          continue;
        }

        // 아카이브 엔트리 목록 조회
        const { entries, hasNested } = await listEntriesFast(filepath, ext, this.sevenZExe);

        // 구조 분석
        const analysis = analyzeFromEntries(entries, filepath, this.lang);

        // 파일 정보
        const stat = await fs.stat(filepath);
        const modDate = new Date(stat.mtimeMs).toISOString().split('T')[0];

        // 결과 객체 구성
        const result = {
          filepath,
          filename: path.basename(filepath),
          ext,
          size: stat.size,
          modDate,
          entries,
          hasNested,
          volumeGroups: analysis.volumeGroups,
          innerMeaningfulName: analysis.innerMeaningfulName,
          swallowedName: analysis.swallowedName,
          forceUnit: analysis.forceUnit,
          pageCount: entries.filter(e => !e.isDir).length
        };

        results.push(result);
        this.emit('progress', results.length, this.paths.length);

      } catch (error) {
        console.error(`[OrganizerLoadTask] Error processing ${pathStr}:`, error);
        skippedFiles.push(pathStr);
      }
    }

    this.emit('org_load_done', results, skippedFiles);
  }
}

// ============================================================================
// FileLoadTask - 일반 파일 로딩 태스크
// ============================================================================

class FileLoadTask extends EventEmitter {
  /**
   * @param {string[]} paths - 로딩할 파일 경로 목록
   * @param {string} sevenZExe - 7z 실행파일 경로
   * @param {string} lang - 언어 ('ko', 'en', 'ja')
   */
  constructor(paths, sevenZExe, lang) {
    super();
    this.paths = paths;
    this.sevenZExe = sevenZExe;
    this.lang = lang || 'ko';
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  /**
   * 메인 실행 메서드
   */
  async run() {
    const results = [];
    const nestedFiles = [];
    const unsupportedFiles = [];

    for (const pathStr of this.paths) {
      if (this.isCancelled) break;

      try {
        const filepath = pathStr;
        const ext = path.extname(filepath).toLowerCase();

        // 지원되는 확장자 확인
        const supportedExts = new Set(['.zip', '.cbz', '.cbr', '.7z', '.rar', '.egg']);
        if (!supportedExts.has(ext)) {
          unsupportedFiles.push(filepath);
          continue;
        }

        // 파일 존재 확인
        try {
          await fs.access(filepath);
        } catch {
          unsupportedFiles.push(filepath);
          continue;
        }

        // 아카이브 엔트리 목록 조회
        const { entries, hasNested } = await listEntriesFast(filepath, ext, this.sevenZExe);

        if (hasNested) {
          nestedFiles.push(filepath);
        }

        // 구조 분석
        const analysis = analyzeFromEntries(entries, filepath, this.lang);

        // 파일 정보
        const stat = await fs.stat(filepath);
        const modDate = new Date(stat.mtimeMs).toISOString().split('T')[0];
        const sizeMB = stat.size / (1024 * 1024);

        // 이미지 엔트리 필터링
        const imgExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
        const imgEntries = entries.filter(e => imgExts.has(path.extname(e.name).toLowerCase()));

        // 결과 객체 구성
        const result = {
          filepath,
          filename: path.basename(filepath),
          ext,
          size: stat.size,
          sizeMB: Math.round(sizeMB * 100) / 100,
          modDate,
          entries,
          imageEntries: imgEntries,
          pageCount: imgEntries.length,
          hasNested,
          volumeGroups: analysis.volumeGroups,
          innerMeaningfulName: analysis.innerMeaningfulName,
          swallowedName: analysis.swallowedName,
          forceUnit: analysis.forceUnit
        };

        results.push(result);
        this.emit('progress', results.length, this.paths.length);

      } catch (error) {
        console.error(`[FileLoadTask] Error processing ${pathStr}:`, error);
        unsupportedFiles.push(pathStr);
      }
    }

    this.emit('load_done', results, nestedFiles, unsupportedFiles);
  }

  /**
   * 7z로 아카이브 엔트리 직접 조회 (FileLoadTask 전용)
   */
  async get7zEntries(filepath) {
    return new Promise((resolve) => {
      const proc = spawn(this.sevenZExe, ['l', filepath], getSubprocessOptions());
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const entries = [];
          const lines = stdout.split('\n');
          for (const line of lines) {
            const match = line.match(
              /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\d+\s+\d+\s+\d+%\s+(.+)/
            );
            if (match) {
              entries.push(decodeZipFilename(match[1].trim()));
            }
          }
          resolve(entries);
        } else {
          resolve([]);
        }
      });

      proc.on('error', () => {
        resolve([]);
      });
    });
  }
}

export { OrganizerLoadTask, FileLoadTask, decodeZipFilename, listEntriesFast, analyzeFromEntries };
