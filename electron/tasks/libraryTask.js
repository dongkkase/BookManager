/**
 * libraryTask.js - 라이브러리 메타데이터 추출 백그라운드 워커
 * 
 * Python의 LibraryExtractThread(QThread)를 Node.js EventEmitter 패턴으로 마이그레이션
 * 
 * 흐름:
 * 1. 각 파일의 stat 정보 가져오기
 * 2. DB 캐시 확인 (유효하면 바로 emit)
 * 3. 7z 명령어로 아카이브 목록 조회
 * 4. 썸네일 + comicinfo.xml 추출 (tempdir 사용)
 * 5. XML 파싱 → title, series, volume, number, writer 추출
 * 6. DB 저장 + 이벤트 방출
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { parseStringPromise } from 'xml2js';
import { getLibraryDB } from '../database/library_db.js';
import { resolveThumbnailDir } from '../dataPaths.js';
import { normalizeMetadataFormat } from '../metadataFormat.js';

class LibraryExtractWorker extends EventEmitter {
  constructor(filepaths, sevenZipPath, thumbDir = resolveThumbnailDir(process.cwd())) {
    super();
    this.filepaths = filepaths;
    this.sevenZipPath = sevenZipPath;
    this.thumbDir = thumbDir;
    this.isCancelled = false;
    this.db = getLibraryDB();
  }

  cancel() {
    this.isCancelled = true;
  }

  async run() {
    for (const fp of this.filepaths) {
      if (this.isCancelled) break;

      try {
        // 1. 파일 stat 정보 가져오기
        const stat = await fs.stat(fp);
        const modTime = new Date(stat.mtimeMs);
        const modDate = modTime.toISOString().split('T')[0];
        const fileSize = stat.size;

        // 2. DB 캐시 확인
        const cached = await this.db.getFileInfo(fp);
        if (cached) {
          const cachedModTime = new Date(cached.mod_date * 1000);
          // 캐시가 유효하면 (수정시간이 같으면) 바로 emit
          if (Math.abs(stat.mtimeMs - cached.mod_date * 1000) < 1000) {
            const meta = {
              filepath: fp,
              title: cached.title || '',
              series: cached.series || '',
              volume: cached.volume || 0,
              number: cached.number || 0,
              writer: cached.writer || '',
              pages: cached.pages || 0,
              format: cached.format || '',
              mod_date: modDate,
              file_size: fileSize,
              thumbnail: cached.thumbnail || ''
            };
            this.emit('data_extracted', fp, meta);
            continue;
          }
        }

        // 3. 7z 명령어로 아카이브 목록 조회
        const archiveList = await this._getArchiveList(fp);
        if (!archiveList) {
          this.emit('data_extracted', fp, this._createEmptyMeta(fp, modDate, fileSize));
          continue;
        }

        // 4. 썸네일 + XML 파일 경로 추출
        const { imagePaths, xmlPath } = this._analyzeArchiveContents(archiveList);
        if (imagePaths.length === 0) {
          this.emit('data_extracted', fp, this._createEmptyMeta(fp, modDate, fileSize));
          continue;
        }

        // 5. 임시 디렉토리에서 파일 추출
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comiczip-'));
        let thumbnailPath = '';
        let meta = this._createEmptyMeta(fp, modDate, fileSize);

        try {
          // 썸네일 추출 (첫 번째 이미지)
          const coverImage = imagePaths[0];
          if (coverImage) {
            const thumbResult = await this._extractAndCacheThumbnail(fp, coverImage);
            if (thumbResult) {
              thumbnailPath = thumbResult;
            }
          }

          // XML 파싱
          if (xmlPath) {
            const xmlContent = await this._extractFile(fp, xmlPath, tempDir);
            if (xmlContent) {
              const parsedMeta = await this._parseComicInfoXML(xmlContent);
              meta = {
                ...meta,
                ...parsedMeta
              };
            }
          }

          meta.thumbnail = thumbnailPath;

        } finally {
          // 임시 디렉토리 정리
          await fs.rm(tempDir, { recursive: true, force: true });
        }

        // 6. DB 저장
        await this.db.upsertFileInfo({
          filepath: fp,
          title: meta.title,
          series: meta.series,
          volume: meta.volume,
          number: meta.number,
          writer: meta.writer,
          pages: meta.pages,
          format: meta.format,
          mod_date: Math.floor(stat.mtimeMs / 1000),
          file_size: fileSize,
          thumbnail: thumbnailPath
        });

        // 7. 이벤트 방출
        this.emit('data_extracted', fp, meta);

      } catch (error) {
        console.error(`[LibraryExtractWorker] Error processing ${fp}:`, error);
        this.emit('error', fp, error.message);
      }
    }

    this.emit('finished');
  }

  /**
   * 7z 명령어로 아카이브 목록 조회
   */
  async _getArchiveList(filePath) {
    return new Promise((resolve) => {
      const proc = spawn(this.sevenZipPath, ['l', filePath]);
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
          resolve(stdout);
        } else {
          console.error(`[7z list] Error: ${stderr}`);
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * 아카이브 내용 분석 - 이미지 및 XML 파일 경로 추출
   */
  _analyzeArchiveContents(archiveList) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.cr2', '.tif', '.tiff'];
    const lines = archiveList.split('\n');
    const imagePaths = [];
    let xmlPath = null;

    for (const line of lines) {
      // 7z 목록 형식: Date Time Attr Size Compressed Ratio Name
      // 예: 2024-01-01 12:00:00 ....A 100000 50000 50% 001.jpg
      const match = line.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\d+\s+\d+\s+\d+%\s+(.+)/);
      if (match) {
        const fileName = match[1].trim();
        const ext = path.extname(fileName).toLowerCase();

        if (imageExtensions.includes(ext)) {
          imagePaths.push(fileName);
        } else if (fileName.toLowerCase().endsWith('comicinfo.xml')) {
          xmlPath = fileName;
        }
      }
    }

    // 이미지 경로 정렬 (자연 정렬)
    imagePaths.sort((a, b) => this._naturalSort(a, b));

    return { imagePaths, xmlPath };
  }

  /**
   * 아카이브에서 파일 추출
   */
  async _extractFile(archivePath, innerPath, destDir) {
    return new Promise((resolve) => {
      const proc = spawn(this.sevenZipPath, ['e', '-o' + destDir, '-y', archivePath, innerPath]);

      proc.on('close', (code) => {
        if (code === 0) {
          const destPath = path.join(destDir, path.basename(innerPath));
          fs.readFile(destPath)
            .then(data => resolve(data))
            .catch(() => resolve(null));
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * 썸네일 추출 및 캐싱
   */
  async _extractAndCacheThumbnail(archivePath, imagePath) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
    try {
      const imageData = await this._extractFile(archivePath, imagePath, tempDir);
      if (!imageData) return null;

      // MD5 해시로 썸네일 파일명 생성
      const hash = crypto.createHash('md5').update(imageData).digest('hex');
      const ext = path.extname(imagePath).toLowerCase();
      const thumbFileName = `${hash}${ext}`;
      const thumbFullPath = path.join(this.thumbDir, thumbFileName);

      // 썸네일 디렉토리 존재 확인 및 생성
      await fs.mkdir(this.thumbDir, { recursive: true });

      // 썸네일 파일이 없으면 저장
      try {
        await fs.access(thumbFullPath);
      } catch {
        await fs.writeFile(thumbFullPath, imageData);
      }

      return thumbFullPath;
    } catch (error) {
      console.error('[Thumbnail Cache] Error:', error);
      return null;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * ComicInfo.xml 파싱
   */
  async _parseComicInfoXML(xmlContent) {
    try {
      const result = await parseStringPromise(xmlContent.toString());
      const comicInfo = result.ComicInfo;

      return {
        title: comicInfo.Title ? comicInfo.Title[0] || '' : '',
        series: comicInfo.Series ? comicInfo.Series[0] || '' : '',
        volume: this._parseNumber(comicInfo.Volume),
        number: this._parseNumber(comicInfo.Number),
        writer: comicInfo.Writer ? comicInfo.Writer[0] || '' : '',
        pages: this._parseNumber(comicInfo.PageCount),
        format: normalizeMetadataFormat(comicInfo.Format ? comicInfo.Format[0] || '' : ''),
      };
    } catch (error) {
      console.error('[XML Parse] Error:', error);
      return {};
    }
  }

  /**
   * 숫자 파싱 (안전하게)
   */
  _parseNumber(value) {
    if (!value) return 0;
    const num = parseInt(value, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * 빈 메타데이터 생성
   */
  _createEmptyMeta(filePath, modDate, fileSize) {
    return {
      filepath: filePath,
      title: '',
      series: '',
      volume: 0,
      number: 0,
      writer: '',
      pages: 0,
      format: '',
      mod_date: modDate,
      file_size: fileSize,
      thumbnail: ''
    };
  }

  /**
   * 자연 정렬 비교 함수
   */
  _naturalSort(a, b) {
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
}

export default LibraryExtractWorker;
