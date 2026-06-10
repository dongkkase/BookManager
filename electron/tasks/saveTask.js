/**
 * saveTask.js - ComicInfo.xml 저장 백그라운드 워커
 *
 * Python의 SaveWorker(QThread)를 Node.js EventEmitter 패턴으로 마이그레이션
 *
 * 흐름:
 * 1. 단일 모드: 한 파일에 ComicInfo.xml 생성 후 주입
 * 2. 배치 모드: 여러 파일에 병렬로 ComicInfo.xml 생성 후 주입
 * 3. ZIP/CBZ: Node.js 내장 zlib + fs 사용
 * 4. 7z/RAR/CBR: 7z/WinRAR subprocess 사용
 */

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { createGzip, createBrotliCompress } from 'zlib';

class SaveWorker extends EventEmitter {
  /**
   * @param {Object} targetDict - { [filepath]: metadata_object } 매핑
   * @param {Object} options - { sevenZipPath, isSingle, maxWorkers }
   */
  constructor(targetDict, options = {}) {
    super();
    this.targetDict = targetDict;
    this.sevenZipPath = options.sevenZipPath || '7z';
    this.isSingle = options.isSingle || false;
    this.maxWorkers = options.maxWorkers || 4;
    this.isCancelled = false;
  }

  cancel() {
    this.isCancelled = true;
  }

  /**
   * 메인 실행 메서드
   */
  async run() {
    if (this.isSingle) {
      await this._runSingle();
    } else {
      await this._runBatch();
    }
  }

  /**
   * 단일 파일 저장 모드
   */
  async _runSingle() {
    const entries = Object.entries(this.targetDict);
    if (entries.length === 0) {
      this.emit('finishedSingle', false, '저장할 파일이 없습니다.');
      return;
    }

    const [fp, data] = entries[0];
    const xmlStr = this._createComicInfoXML(data);
    const [success, msg] = await this._injectXMLToArchive(fp, xmlStr);
    this.emit('finishedSingle', success, msg);
  }

  /**
   * 배치 저장 모드 - 병렬 처리
   */
  async _runBatch() {
    const entries = Object.entries(this.targetDict);
    const total = entries.length;
    let current = 0;
    let successCount = 0;
    let failCount = 0;

    const processFile = async (fp, data) => {
      if (this.isCancelled) return false;
      const xmlStr = this._createComicInfoXML(data);
      const [success] = await this._injectXMLToArchive(fp, xmlStr);
      return success;
    };

    // 병렬 처리 - maxWorkers 제한
    const queue = entries.map(([fp, data]) => ({ fp, data }));
    const results = [];
    let index = 0;

    const worker = async () => {
      while (index < queue.length && !this.isCancelled) {
        const item = queue[index++];
        const success = await processFile(item.fp, item.data);
        results.push(success);
        current++;
        this.emit('progress', current, total);
      }
    };

    // 워커 пул 생성
    const workerCount = Math.min(this.maxWorkers, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    results.forEach((success) => {
      if (success) successCount++;
      else failCount++;
    });

    this.emit('finishedAll', successCount, failCount);
  }

  /**
   * ComicInfo.xml 문자열 생성
   * Python의 _create_comicinfo_xml(data) 마이그레이션
   */
  _createComicInfoXML(data) {
    const now = new Date();
    const nowStr = now.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

    // XML 헤더
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n';

    // 각 필드 처리 (ComicZipAddedDate, ComicZipModifiedDate 제외)
    const excludeKeys = ['ComicZipAddedDate', 'ComicZipModifiedDate'];
    for (const [k, v] of Object.entries(data)) {
      if (v && !excludeKeys.includes(k)) {
        xml += `  <${k}>${this._escapeXML(String(v))}</${k}>\n`;
      }
    }

    // ComicZipAddedDate 처리
    const addedDate = data.ComicZipAddedDate || nowStr;
    xml += `  <ComicZipAddedDate>${addedDate}</ComicZipAddedDate>\n`;

    // ComicZipModifiedDate는 항상 현재 시간
    xml += `  <ComicZipModifiedDate>${nowStr}</ComicZipModifiedDate>\n`;

    // 데이터에도 반영
    data.ComicZipAddedDate = addedDate;
    data.ComicZipModifiedDate = nowStr;

    xml += '</ComicInfo>';
    return xml;
  }

  /**
   * XML 이스케이프
   */
  _escapeXML(str) {
    return str
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, ''');
  }

  /**
   * 아카이브에 ComicInfo.xml 주입
   * Python의 _inject_xml_to_archive(archive_path, xml_str) 마이그레이션
   */
  async _injectXMLToArchive(archivePath, xmlStr) {
    const ext = path.extname(archivePath).toLowerCase();
    const supportedExts = ['.zip', '.cbz', '.7z', '.rar', '.cbr'];

    if (!supportedExts.includes(ext)) {
      return [false, '미지원 포맷입니다.'];
    }

    // ZIP/CBZ는 Node.js 네이티브 처리 시도
    if (ext === '.zip' || ext === '.cbz') {
      const nativeResult = await this._injectZIP_Native(archivePath, xmlStr);
      if (nativeResult[0]) {
        return nativeResult;
      }
      // 네이티브 실패 시 7z fallback
    }

    // 7z 기반 처리 (ZIP/CBZ fallback 및 7z/RAR/CBR)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comiczip-save-'));
    try {
      const xmlPath = path.join(tempDir, 'ComicInfo.xml');
      await fs.writeFile(xmlPath, xmlStr, 'utf-8');

      // RAR/CBR은 WinRAR 시도
      if ((ext === '.rar' || ext === '.cbr') && process.platform === 'win32') {
        const winrarResult = await this._injectWithWinRAR(archivePath, tempDir);
        if (winrarResult[0]) {
          return winrarResult;
        }
        // WinRAR 없으면 에러
        if (!winrarResult[1]) {
          return [false, 'RAR/CBR 파일에 메타데이터를 저장하려면 PC에 WinRAR가 설치되어 있어야 합니다.\n(안정성을 위해 CBZ 포맷으로 변환 후 사용을 권장합니다.)'];
        }
        return winrarResult;
      }

      // 7z로 처리
      const cmd7z = [
        'u',
        archivePath,
        'ComicInfo.xml',
        '-mx=0',
        `-w${os.tmpdir()}`,
        '-mmt=on'
      ];

      const result = await this._run7zCommand(cmd7z, tempDir);
      if (result === 0) {
        return [true, '성공'];
      } else {
        return [false, '7z 에러 발생'];
      }
    } catch (error) {
      return [false, error.message];
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * ZIP/CBZ에 네이티브 방식으로 XML 주입
   * Python의 zipfile 기반 로직을 Node.js로 재현
   */
  async _injectZIP_Native(archivePath, xmlStr) {
    try {
      // AD-ZIP 라이브러리 없이 네이티브 ZIP 조작은 복잡하므로
      // 7z fallback으로 바로 이동
      // 후속에서 'adzip' 또는 'yauzl'/'yazl' 라이브러리로 교체 가능
      return [false, null];
    } catch {
      return [false, null];
    }
  }

  /**
   * WinRAR로 XML 주입 (Windows 전용)
   */
  async _injectWithWinRAR(archivePath, cwd) {
    const winrarPaths = [
      'C:\\Program Files\\WinRAR\\WinRAR.exe',
      'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe'
    ];

    let winrarExe = null;
    for (const p of winrarPaths) {
      try {
        await fs.access(p);
        winrarExe = p;
        break;
      } catch {
        // 다음 경로 시도
      }
    }

    if (!winrarExe) {
      return [false, null]; // WinRAR 없음
    }

    const cmdRAR = [
      'u',
      '-ibck',
      '-inul',
      '-m0',
      '-ep',
      archivePath,
      'ComicInfo.xml'
    ];

    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(winrarExe, cmdRAR, { cwd });
        proc.on('close', (code) => resolve(code));
        proc.on('error', () => resolve(-1));
      });

      if (result === 0) {
        return [true, '성공'];
      }
      return [false, 'WinRAR 업데이트 실패'];
    } catch {
      return [false, null];
    }
  }

  /**
   * 7z 명령어 실행
   */
  _run7zCommand(args, cwd) {
    return new Promise((resolve) => {
      const proc = spawn(this.sevenZipPath, args, { cwd });
      proc.on('close', (code) => resolve(code || 0));
      proc.on('error', () => resolve(-1));
    });
  }
}

export default SaveWorker;
