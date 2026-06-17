import pkg from 'electron';
const { ipcMain, app, BrowserWindow, dialog, shell } = pkg;
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';

import { scanFolder } from './tasks/folderScanTask.js';
import { analyzeOrganizerInputs, executeOrganizer } from './tasks/organizerTask.js';
import { analyzeRenamerInputs, executeRenamer } from './tasks/renamerTask.js';
import { analyzeMetadataInputs, saveMetadataItems } from './tasks/metadataTask.js';
import { getSharingServerStatus, startSharingServer, stopSharingServer } from './servers/sharingServers.js';

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'BookManager',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('요청 시간이 초과되었습니다.')));
    req.on('error', reject);
  });
}

function markdownToHtml(markdown = '') {
  const escaped = String(markdown)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, match => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

const INDEX_EXTENSIONS = new Set(['.zip', '.cbz', '.rar', '.cbr', '.7z', '.cb7']);

async function openLibraryDb(dbPath) {
  const Database = (await import('better-sqlite3')).default;
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS target_index (
      target_folder TEXT,
      file_path TEXT,
      UNIQUE(target_folder, file_path)
    );
    CREATE TABLE IF NOT EXISTS dup_match (
      a_path TEXT PRIMARY KEY,
      match_path TEXT,
      match_score REAL,
      match_time TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_target_index_folder ON target_index(target_folder);
  `);
  return db;
}

async function scanArchivePaths(rootPath) {
  const results = [];
  async function walk(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && INDEX_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  await walk(rootPath);
  return results;
}

// IPC 핸들러 설정
export function setupIPCHandlers(configManager, getExecutableDir, getResourcePath, getBinPath, getFontPath) {
  
  // ========== 폴더 스캔 ==========
  ipcMain.handle('folder:scan', async (event, folderPath, options) => {
    try {
      return await scanFolder(folderPath, options, event);
    } catch (error) {
      console.error('Folder scan error:', error);
      event.sender.send('scan-error', { message: error.message });
      throw error;
    }
  });

  // ========== 압축 파일 구조 정리 ==========
  ipcMain.handle('organizer:analyze', async (event, paths, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return analyzeOrganizerInputs(paths, {
      ...options,
      sevenZExe,
      lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'organizer:analyze', ...progress });
    });
  });

  ipcMain.handle('organizer:execute', async (event, items, options = {}) => {
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return executeOrganizer(items, {
      ...config,
      ...options,
      sevenZExe,
      lang: options.lang || config.language || config.lang || 'ko',
      target_format: options.target_format ?? config.target_format ?? 'none',
      backup_on: options.backup_on ?? config.backup_on ?? false,
    }, (progress) => {
      event.sender.send('task:progress', { task: 'organizer:execute', ...progress });
    });
  });

  // ========== 내부 파일명 변경 ==========
  ipcMain.handle('renamer:analyze', async (event, paths, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return analyzeRenamerInputs(paths, {
      ...options,
      sevenZExe,
      lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'renamer:analyze', ...progress });
    });
  });

  ipcMain.handle('renamer:execute', async (event, items, options = {}) => {
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return executeRenamer(items, {
      ...config,
      ...options,
      sevenZExe,
      lang: options.lang || config.language || config.lang || 'ko',
      target_format: options.target_format ?? config.target_format ?? 'none',
      backup_on: options.backup_on ?? config.backup_on ?? false,
      flattenFolders: options.flattenFolders ?? config.flatten_folders ?? false,
    }, (progress) => {
      event.sender.send('task:progress', { task: 'renamer:execute', ...progress });
    });
  });

  // ========== 메타데이터 관리 ==========
  ipcMain.handle('metadata:analyze', async (event, paths, options = {}) => {
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return analyzeMetadataInputs(paths, {
      ...options,
      sevenZExe,
      lang: options.lang || configManager.getConfig()?.language || configManager.getConfig()?.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'metadata:analyze', ...progress });
    });
  });

  ipcMain.handle('metadata:save', async (event, items, options = {}) => {
    const config = configManager.getConfig() || {};
    const sevenZExe = options.sevenZExe || await getBinPath('7za') || await getBinPath('7z');
    return saveMetadataItems(items, {
      ...config,
      ...options,
      sevenZExe,
      lang: options.lang || config.language || config.lang || 'ko',
    }, (progress) => {
      event.sender.send('task:progress', { task: 'metadata:save', ...progress });
    });
  });

  // ========== 공유 서버 ==========
  ipcMain.handle('server:start', async (event, serverType, options = {}) => {
    const config = configManager.getConfig() || {};
    const updates = serverType === 'WebDAV'
      ? {
          webdav_port: Number(options.port) || config.webdav_port || 8081,
          webdav_username: options.username ?? config.webdav_username ?? 'user',
          webdav_password: options.password ?? config.webdav_password ?? '1234',
        }
      : {
          opds_port: Number(options.port) || config.opds_port || 8080,
        };
    configManager.saveConfig({ ...config, ...updates });
    return startSharingServer(serverType, { ...options, port: updates.webdav_port || updates.opds_port }, configManager.getConfig(), (log) => {
      event.sender.send('server:log', { ...log, status: getSharingServerStatus() });
    });
  });

  ipcMain.handle('server:stop', async (event, serverType) => {
    return stopSharingServer(serverType, (log) => {
      event.sender.send('server:log', { ...log, status: getSharingServerStatus() });
    });
  });

  ipcMain.handle('server:status', () => {
    return getSharingServerStatus();
  });

  // ========== 캐시/인덱스 관리 ==========
  ipcMain.handle('cache:clearApi', async () => {
    const targets = [
      path.join(configManager.userDataPath, '.api_cache.db'),
      path.join(getExecutableDir(), '.api_cache.db'),
    ];
    let deleted = 0;
    for (const target of targets) {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        deleted += 1;
      }
    }
    return { success: true, deleted };
  });

  ipcMain.handle('folder:clearDupCache', async () => {
    const db = await openLibraryDb(path.join(configManager.userDataPath, 'library.db'));
    try {
      const result = db.prepare('DELETE FROM dup_match').run();
      return { success: true, changes: result.changes };
    } finally {
      db.close();
    }
  });

  ipcMain.handle('folder:updateIndex', async (event, folders = null) => {
    const config = configManager.getConfig() || {};
    const targetFolders = (folders || config.dup_check_folders || config.libraries || [])
      .filter(Boolean)
      .map(folder => path.resolve(folder))
      .filter(folder => fs.existsSync(folder));

    const db = await openLibraryDb(path.join(configManager.userDataPath, 'library.db'));
    try {
      const clearStmt = db.prepare('DELETE FROM target_index WHERE target_folder = ?');
      const insertStmt = db.prepare('INSERT OR REPLACE INTO target_index (target_folder, file_path) VALUES (?, ?)');
      const insertMany = db.transaction((root, files) => {
        clearStmt.run(root);
        for (const filePath of files) insertStmt.run(root, filePath);
      });

      let total = 0;
      for (let index = 0; index < targetFolders.length; index += 1) {
        const folder = targetFolders[index];
        event.sender.send('task:progress', {
          task: 'folder:updateIndex',
          progress: Math.round((index / Math.max(targetFolders.length, 1)) * 100),
          message: `인덱스 갱신 중: ${path.basename(folder) || folder}`,
        });
        const files = await scanArchivePaths(folder);
        insertMany(folder, files);
        total += files.length;
      }

      event.sender.send('task:progress', {
        task: 'folder:updateIndex',
        progress: 100,
        message: `인덱스 갱신 완료: ${total}개`,
      });
      return { success: true, folderCount: targetFolders.length, total };
    } finally {
      db.close();
    }
  });

  // ========== 릴리즈 노트 ==========
  ipcMain.handle('releases:list', async () => {
    try {
      const releases = await requestJson('https://api.github.com/repos/dongkkase/ComicZIP_Optimizer/releases?per_page=10');
      return releases.map(item => ({
        id: item.id || item.tag_name,
        name: item.name || item.tag_name,
        tag: item.tag_name,
        date: item.published_at ? item.published_at.slice(0, 10) : '',
        body: markdownToHtml(item.body || ''),
        url: item.html_url,
      }));
    } catch (error) {
      return {
        error: error.message,
        releases: [{
          id: 'current',
          name: `v${app?.getVersion?.() || '3.0.0'}`,
          date: '',
          body: '릴리즈 정보를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.',
        }],
      };
    }
  });

  // ========== 설정 관련 ==========
  ipcMain.handle('config:get', () => {
    return configManager.getConfig();
  });

  ipcMain.handle('config:save', (_, config) => {
    const currentConfig = configManager.getConfig() || {};
    const updates = config || {};
    const nextLang = updates.language || updates.lang || currentConfig.language || currentConfig.lang || 'ko';
    const nextConfig = {
      ...currentConfig,
      ...updates,
      lang: nextLang,
      language: nextLang,
      api_keys: {
        ...(currentConfig.api_keys || {}),
        ...(updates.api_keys || {}),
      },
    };
    configManager.saveConfig(nextConfig);
    return nextConfig;
  });

  // ========== 폰트 관련 ==========
  ipcMain.handle('font:getPath', (_, fontFilename) => {
    return getFontPath(fontFilename);
  });

  // ========== 바이너리 도구 관련 ==========
  ipcMain.handle('bin:getPath', async (_, toolName) => {
    return await getBinPath(toolName);
  });

  // ========== 사운드 재생 ==========
  ipcMain.handle('sound:play', async (_, soundFilename) => {
    try {
      let soundPath = getResourcePath('src', 'sounds', soundFilename);
      if (!fs.existsSync(soundPath)) {
        soundPath = path.join(getExecutableDir(), 'sounds', soundFilename);
      }
      if (fs.existsSync(soundPath)) {
        const { exec } = await import('child_process');
        if (process.platform === 'darwin') {
          exec(`afplay "${soundPath}" &`);
        } else if (process.platform === 'win32') {
          exec(`powershell -Command "(New-Object Media.SoundPlayer '${soundPath}').PlaySync()"`);
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('사운드 재생 실패:', error);
      return false;
    }
  });

  // ========== 파일/폴더 선택 ==========
  ipcMain.handle('dialog:selectFolder', async (event, title) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: title || '폴더 선택',
    });
    return canceled ? null : filePaths?.[0] || null;
  });

  ipcMain.handle('dialog:selectFile', async (_, title, filters) => {
    const result = await import('electron');
    const { filePaths } = await result.dialog.showOpenDialog({
      properties: ['openFile'],
      title: title || '파일 선택',
      filters: filters || [],
    });
    return filePaths?.[0] || null;
  });

  ipcMain.handle('dialog:selectFiles', async (_, title, filters) => {
    const result = await import('electron');
    const { filePaths } = await result.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: title || '파일 선택',
      filters: filters || [],
    });
    return filePaths || [];
  });

  ipcMain.handle('dialog:saveFile', async (_, title, filters) => {
    const result = await import('electron');
    const { filePath } = await result.dialog.showSaveDialog({
      title: title || '저장',
      filters: filters || [],
    });
    return filePath || null;
  });

  // ========== 파일 시스템 ==========
  ipcMain.handle('fs:getRoots', async () => {
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        const output = execSync('wmic logicaldisk get name').toString();
        const drives = output.split('\r\r\n')
          .map(line => line.trim())
          .filter(line => /^[A-Z]:$/.test(line));
        return drives;
      } catch (e) {
        return ['C:'];
      }
    } else {
      return ['/'];
    }
  });

  ipcMain.handle('fs:getSpecialPaths', () => ({
    desktop: app.getPath('desktop'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads'),
    home: app.getPath('home'),
  }));

  ipcMain.handle('fs:readDir', (_, dirPath) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items.map(item => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        isFile: item.isFile(),
      }));
    } catch (error) {
      console.error('디렉토리 읽기 실패:', error);
      return [];
    }
  });

  ipcMain.handle('fs:stat', (_, filePath) => {
    try {
      const stats = fs.statSync(filePath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtimeMs,
        birthtime: stats.birthtimeMs,
      };
    } catch (error) {
      return null;
    }
  });

  ipcMain.handle('fs:exists', (_, filePath) => {
    return fs.existsSync(filePath);
  });

  // ========== 파일/폴더 작업 확장 (FolderTab 지원) ==========
  const historyPath = path.join(configManager.userDataPath, 'rename_history.json');

  function loadRenameHistory() {
    try {
      if (fs.existsSync(historyPath)) {
        return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load rename history', e);
    }
    return [];
  }

  function saveRenameHistory(history) {
    try {
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save rename history', e);
    }
  }

  // 1. 단일 파일/폴더 이름 변경
  ipcMain.handle('fs:rename', async (_, oldPath, newPath) => {
    try {
      if (fs.existsSync(newPath) && oldPath.toLowerCase() !== newPath.toLowerCase()) {
        return { success: false, message: '동일한 이름의 파일/폴더가 이미 존재합니다.' };
      }
      fs.renameSync(oldPath, newPath);

      // 히스토리 기록
      const history = loadRenameHistory();
      history.push({
        timestamp: Date.now(),
        mapping: { [newPath]: oldPath }
      });
      if (history.length > 30) history.shift();
      saveRenameHistory(history);

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 2. 다중 파일 이름 변경 (Multi-rename)
  ipcMain.handle('fs:multiRename', async (_, renameMap) => {
    const errors = [];
    let successCount = 0;
    const actualMapping = {};

    for (const [oldPath, newPath] of Object.entries(renameMap)) {
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
      } catch (err) {
        errors.push(`${path.basename(oldPath)} 변경 실패: ${err.message}`);
      }
    }

    if (Object.keys(actualMapping).length > 0) {
      const history = loadRenameHistory();
      history.push({
        timestamp: Date.now(),
        mapping: actualMapping
      });
      if (history.length > 30) history.shift();
      saveRenameHistory(history);
    }

    return {
      success: errors.length === 0,
      successCount,
      errors
    };
  });

  // 3. 파일 이름 변경 Undo
  ipcMain.handle('fs:undoRename', async () => {
    const history = loadRenameHistory();
    if (history.length === 0) {
      return { success: false, message: '되돌릴 이력이 없습니다.' };
    }
    const lastRecord = history.pop();
    const { mapping } = lastRecord;
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
        } catch (err) {
          errors.push(`${path.basename(currentPath)} 복구 실패: ${err.message}`);
        }
      } else {
        errors.push(`${path.basename(currentPath)} 파일을 찾을 수 없습니다.`);
      }
    }

    saveRenameHistory(history);

    return {
      success: errors.length === 0,
      successCount,
      errors
    };
  });

  // 4. 휴지통으로 이동
  ipcMain.handle('fs:delete', async (_, filePaths) => {
    const deleted = [];
    const errors = [];
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          await shell.trashItem(filePath);
          deleted.push(filePath);
        }
      } catch (err) {
        errors.push(`${path.basename(filePath)} 삭제 실패: ${err.message}`);
      }
    }
    return {
      success: errors.length === 0,
      deleted,
      errors
    };
  });

  // 5. 파일 탐색기에서 열기
  ipcMain.handle('fs:openInExplorer', async (_, folderPath) => {
    try {
      if (fs.existsSync(folderPath)) {
        await shell.openPath(folderPath);
        return { success: true };
      }
      return { success: false, message: '경로를 찾을 수 없습니다.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 6. 파일 위치 탐색기에서 열고 선택하기
  ipcMain.handle('fs:showInFolder', async (_, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
        return { success: true };
      }
      return { success: false, message: '경로를 찾을 수 없습니다.' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 7. CSV 파일로 내보내기
  ipcMain.handle('fs:exportCsv', async (_, { filePath, headers, rows }) => {
    try {
      let csvContent = '\uFEFF'; // UTF-8 BOM
      csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';
      for (const row of rows) {
        csvContent += row.map(cell => {
          const val = cell === null || cell === undefined ? '' : String(cell);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(',') + '\n';
      }
      fs.writeFileSync(filePath, csvContent, 'utf8');
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // 8. 라이브러리로 파일 이동 처리 (충돌 해결 지원)
  ipcMain.handle('fs:executeLibraryMove', async (event, movePlans) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    let successCount = 0;
    const errors = [];
    const completedMoves = [];

    for (const plan of movePlans) {
      let { src, dest } = plan;
      if (!fs.existsSync(src)) {
        continue;
      }

      if (fs.existsSync(dest) && path.normalize(src) !== path.normalize(dest)) {
        const choice = dialog.showMessageBoxSync(window, {
          type: 'warning',
          buttons: ['스킵(Skip)', '덮어쓰기(Overwrite)', '새 이름으로 저장(Rename)'],
          defaultId: 0,
          title: '파일 이름 충돌',
          message: `대상의 위치에 이미 파일이 존재합니다:\n${path.basename(dest)}\n\n어떻게 하시겠습니까?`,
          cancelId: 0
        });

        if (choice === 0) {
          continue;
        } else if (choice === 1) {
          try {
            fs.unlinkSync(dest);
          } catch (e) {
            errors.push(`기존 파일 삭제 실패: ${path.basename(dest)}`);
            continue;
          }
        } else if (choice === 2) {
          const ext = path.extname(dest);
          const base = dest.substring(0, dest.length - ext.length);
          let counter = 1;
          while (fs.existsSync(`${base}_${counter}${ext}`)) {
            counter++;
          }
          dest = `${base}_${counter}${ext}`;
        }
      }

      try {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.renameSync(src, dest);
        successCount++;
        completedMoves.push({ src, dest });
      } catch (err) {
        errors.push(`${path.basename(src)} 이동 실패: ${err.message}`);
      }
    }

    return {
      successCount,
      errors,
      completedMoves
    };
  });

  // 9. 파일명에서 코어 시리즈명 추출
  ipcMain.handle('parser:extractCoreTitle', async (_, filename) => {
    try {
      const folderUtilsUrl = new URL('../src/utils/folderUtils.js', import.meta.url);
      const { extractCoreTitle } = await import(folderUtilsUrl);
      return extractCoreTitle(filename);
    } catch (err) {
      console.warn('Failed to extract core title:', err);
      return filename;
    }
  });

  // ========== 시스템 정보 ==========
  ipcMain.handle('system:info', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
    };
  });

  ipcMain.handle('system:cpuCores', () => {
    return os.cpus().length;
  });

  // ========== 앱 정보 ==========
  ipcMain.handle('app:version', () => {
    return app?.getVersion?.() || '3.0.0';
  });

  // ========== 윈도우 관련 ==========
  ipcMain.handle('window:isMaximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isMaximized?.() || false;
  });

  // 로그 전송
  ipcMain.on('log', (event, data) => {
    console.log('[Renderer Log]:', data);
  });
}
