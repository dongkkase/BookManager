/**
 * organizeTask.js - 라이브러리 정렬(그룹화) 백그라운드 워커
 *
 * Python의 OrganizerTask(QThread)를 Node.js EventEmitter 패턴으로 마이그레이션
 *
 * 흐름:
 * 1. loadTask를 사용하여 모든 파일의 아카이브 정보 로드
 * 2. 파일 제목을 파싱하여 display_title / core_title 추출
 * 3. core_title 기준으로 파일들을 책(Volume) 단위로 그룹화
 * 4. 각 책 내부에서 화(Chapter)로 정리
 * 5. 정렬 결과 이벤트 방출
 */

import { EventEmitter } from 'events';
import path from 'path';
import { resolveTitles, cleanDisplayTitle, extractCoreTitle } from '../parsers/parser.js';
import { FileLoadTask } from './loadTask.js';

// ============================================================================
// 자연 정렬 헬퍼
// ============================================================================

function naturalCompare(a, b) {
  const tokenizer = /(\d+)|(\D+)/g;
  const matchesA = a.match(tokenizer) || [];
  const matchesB = b.match(tokenizer) || [];
  let i = 0;
  while (i < matchesA.length && i < matchesB.length) {
    const thisIsNumber = /\d+/.test(matchesA[i]);
    const otherIsNumber = /\d+/.test(matchesB[i]);
    if (thisIsNumber && otherIsNumber) {
      const diff = parseInt(matchesA[i], 10) - parseInt(matchesB[i], 10);
      if (diff !== 0) return diff;
    } else if (thisIsNumber) {
      return 1;
    } else if (otherIsNumber) {
      return -1;
    } else {
      if (matchesA[i] < matchesB[i]) return -1;
      if (matchesA[i] > matchesB[i]) return 1;
    }
    i++;
  }
  return matchesA.length - matchesB.length;
}

// ============================================================================
// OrganizeTask 클래스
// ============================================================================

export class OrganizeTask extends EventEmitter {
  constructor(config) {
    super();
    this.maxWorkers = config.maxWorkers || 2;
    this.sevenZExe = config.sevenZExe || '';
    this.abort = false;
    this.fileList = [];
    this.volumes = [];
    this._fileLoadTask = null;
  }

  /**
   * 정렬 작업 시작
   * @param {Array<string>} filePaths - 정렬할 파일 경로 목록
   */
  async run(filePaths) {
    this.fileList = filePaths;
    this.abort = false;
    this.volumes = [];

    this.emit('started', 0, this.fileList.length);

    // Step 1: 모든 파일의 정보 로드
    const fileInfos = await this._loadAllFiles();
    if (this.abort) {
      this.emit('finished', []);
      return;
    }

    // Step 2: 파일 정보를 기반으로 책(Volume) 그룹화
    await this._groupIntoVolumes(fileInfos);

    // Step 3: 각 책 내부 화(Chapter) 정렬
    for (const volume of this.volumes) {
      this._sortChapters(volume);
    }

    // Step 4: 책 목록 정렬
    this.volumes.sort((a, b) => naturalCompare(a.core_title, b.core_title));

    this.emit('finished', this.volumes);
  }

  /**
   * 작업 중단
   */
  cancel() {
    this.abort = true;
    if (this._fileLoadTask) {
      this._fileLoadTask.cancel();
    }
  }

  /**
   * 모든 파일의 아카이브 정보 로드
   */
  async _loadAllFiles() {
    const fileInfos = [];
    const loadTask = new FileLoadTask({
      maxWorkers: this.maxWorkers,
      sevenZExe: this.sevenZExe,
    });
    this._fileLoadTask = loadTask;

    let loadedCount = 0;
    const totalCount = this.fileList.length;

    loadTask.on('file_loaded', (info) => {
      loadedCount++;
      this.emit('started', loadedCount, totalCount);
      fileInfos.push(info);
    });

    loadTask.on('error', (err) => {
      console.error('File load error:', err);
    });

    await loadTask.run(this.fileList);

    if (this.abort) {
      return [];
    }

    return fileInfos;
  }

  /**
   * 파일 정보를 기반으로 책(Volume) 그룹화
   * Python의 _organize_files() 로직 포팅
   */
  async _groupIntoVolumes(fileInfos) {
    // core_title 기준으로 그룹화
    const titleMap = new Map();

    for (const fileInfo of fileInfos) {
      const { filepath, nestedInfo } = fileInfo;
      const ext = path.extname(filepath).toLowerCase();

      // 파일 제목 파싱
      let innerName = '';
      if (nestedInfo && nestedInfo.coverPath) {
        innerName = path.basename(nestedInfo.coverPath, path.extname(nestedInfo.coverPath));
      }

      const [displayTitle, coreTitle] = resolveTitles(filepath, innerName);

      // 파일 정보에 제목 추가
      fileInfo.display_title = displayTitle;
      fileInfo.core_title = coreTitle;

      // 네스트된 아카이브 정보 처리
      if (nestedInfo && nestedInfo.chapters) {
        for (const chapter of nestedInfo.chapters) {
          const chapterDisplay = cleanDisplayTitle(chapter.name);
          const chapterCore = extractCoreTitle(chapter.name);

          const groupKey = chapterCore || coreTitle;

          if (!titleMap.has(groupKey)) {
            titleMap.set(groupKey, {
              display_title: chapterDisplay || displayTitle,
              core_title: groupKey,
              files: [],
              _rawKey: groupKey,
            });
          }

          const volume = titleMap.get(groupKey);
          volume.files.push({
            filepath: filepath,
            display_title: chapterDisplay || displayTitle,
            core_title: groupKey,
            chapter_name: chapter.name,
            image_paths: chapter.imagePaths || [],
            is_nested: true,
          });
        }
      } else {
        // 일반 파일 (네스트되지 않음)
        const groupKey = coreTitle;

        if (!titleMap.has(groupKey)) {
          titleMap.set(groupKey, {
            display_title: displayTitle,
            core_title: groupKey,
            files: [],
            _rawKey: groupKey,
          });
        }

        const volume = titleMap.get(groupKey);
        volume.files.push({
          filepath: filepath,
          display_title: displayTitle,
          core_title: groupKey,
          chapter_name: path.basename(filepath),
          image_paths: this._extractImagePaths(fileInfo),
          is_nested: false,
        });
      }
    }

    this.volumes = Array.from(titleMap.values());
  }

  /**
   * 파일 정보에서 이미지 경로 추출
   */
  _extractImagePaths(fileInfo) {
    const imagePaths = [];
    if (fileInfo.entries) {
      for (const entry of fileInfo.entries) {
        if (!entry.isDir) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext)) {
            imagePaths.push(entry.name);
          }
        }
      }
    }
    // 자연 정렬 적용
    imagePaths.sort((a, b) => naturalCompare(a, b));
    return imagePaths;
  }

  /**
   * 각 책 내부의 화(Chapter) 정렬
   */
  _sortChapters(volume) {
    const files = volume.files;

    // 네스트된 아카이브인 경우 chapter_name 기준으로 정렬
    const hasNested = files.some(f => f.is_nested);

    if (hasNested) {
      files.sort((a, b) => {
        // 네스트된 아카이브 먼저 정렬
        if (a.is_nested && !b.is_nested) return -1;
        if (!a.is_nested && b.is_nested) return 1;
        return naturalCompare(a.chapter_name, b.chapter_name);
      });
    } else {
      // 일반 파일은 filepath 기준으로 정렬
      files.sort((a, b) => naturalCompare(a.filepath, b.filepath));
    }

    // 화 번호 할당
    for (let i = 0; i < files.length; i++) {
      files[i].chapter_index = i;
    }
  }
}

// ============================================================================
// 스태틱 메서드: 단일 파일 정렬
// ============================================================================

/**
 * 단일 파일의 정렬 정보 반환
 * @param {string} filepath - 파일 경로
 * @param {object} fileInfo - 파일 정보 (loadTask 결과)
 * @returns {object} 정렬 정보
 */
export function organizeSingleFile(filepath, fileInfo) {
  let innerName = '';
  if (fileInfo && fileInfo.nestedInfo && fileInfo.nestedInfo.coverPath) {
    innerName = path.basename(fileInfo.nestedInfo.coverPath, path.extname(fileInfo.nestedInfo.coverPath));
  }

  const [displayTitle, coreTitle] = resolveTitles(filepath, innerName);

  const imagePaths = [];
  if (fileInfo && fileInfo.entries) {
    for (const entry of fileInfo.entries) {
      if (!entry.isDir) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext)) {
          imagePaths.push(entry.name);
        }
      }
    }
  }
  imagePaths.sort((a, b) => naturalCompare(a, b));

  return {
    filepath,
    display_title: displayTitle,
    core_title: coreTitle,
    image_paths: imagePaths,
    entries: fileInfo?.entries || [],
  };
}

export default OrganizeTask;
