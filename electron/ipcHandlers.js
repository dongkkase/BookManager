import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

// IPC 핸들러 설정
export function setupIPCHandlers(configManager, getExecutableDir, getResourcePath, getBinPath, getFontPath) {
  
  // ========== 설정 관련 ==========
  ipcMain.handle('config:get', () => {
    return configManager.getConfig();
  });

  ipcMain.handle('config:save', (_, config) => {
    return configManager.saveConfig(config);
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
      const soundPath = path.join(getExecutableDir(), 'sounds', soundFilename);
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
  ipcMain.handle('dialog:selectFolder', async (_, title) => {
    const result = await import('electron');
    const { filePaths } = await result.dialog.showMessageBox?.default?.({}) 
      || await (await import('electron')).dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: title || '폴더 선택',
      });
    return filePaths?.[0] || null;
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
    return app?..getVersion?.() || '2.8.1';
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

// app, BrowserWindow import
import { app, BrowserWindow } from 'electron';
