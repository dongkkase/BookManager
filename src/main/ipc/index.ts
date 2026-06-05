import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import fs from 'fs-extra';
import { IPC_CHANNELS } from '../../shared/constants/ipc';
import { configService } from '../services/configService';
import { db } from '../services/libraryDb';
import { taskManager } from '../services/taskManager';
import {
  listArchiveEntries,
  extractArchive,
  extractCoverImage,
  readInnerFile,
  readComicInfo,
  injectComicInfo,
  compressArchive,
  renameInnerFiles,
} from '../utils/archiveUtils';
import { optimizeImage, getImageDimensions } from '../utils/imageUtils';
import { AppConfig, FileMetadata } from '../../shared/types';

/**
 * IPC 핸들러 설정
 */
export function setupIpcHandlers(): void {
  // === Config ===
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, () => {
    return configService.getConfig();
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG_SAVE, (_, newConfig: Partial<AppConfig>) => {
    configService.saveConfig(newConfig);
    return true;
  });

  // === DB ===
  ipcMain.handle(IPC_CHANNELS.DB_GET_FILE_INFO, (_, path: string) => {
    return db.getFileInfo(path);
  });

  ipcMain.handle(IPC_CHANNELS.DB_UPSERT_FILE_INFO, (_, fileInfo: FileMetadata) => {
    db.upsertFileInfo(fileInfo);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.DB_GET_ALL_FILES, (_, folderPath: string, includeSub: boolean) => {
    return db.getAllFilesInPath(folderPath, includeSub);
  });

  ipcMain.handle(IPC_CHANNELS.DB_CLEAR_DUP_CACHE, () => {
    db.clearDupCache();
    return true;
  });

  // === Task ===
  ipcMain.handle(IPC_CHANNELS.TASK_CANCEL, (_, taskId: string) => {
    return taskManager.cancelTask(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.TASK_PAUSE, (_, taskId: string) => {
    return taskManager.pauseTask(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.TASK_RESUME, (_, taskId: string) => {
    return taskManager.resumeTask(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.TASK_GET_INFO, (_, taskId: string) => {
    return taskManager.getTaskInfo(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.TASK_GET_ALL_INFO, () => {
    return taskManager.getAllTaskInfo();
  });

  // === Archive ===
  ipcMain.handle(IPC_CHANNELS.ARCHIVE_LIST, (_, filepath: string) => {
    return listArchiveEntries(filepath);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_EXTRACT, (_, archivePath: string, outputDir?: string) => {
    return extractArchive(archivePath, outputDir);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_EXTRACT_COVER, (_, archivePath: string) => {
    return extractCoverImage(archivePath);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_READ_FILE, (_, archivePath: string, innerPath: string) => {
    return readInnerFile(archivePath, innerPath);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_READ_COMIC_INFO, (_, archivePath: string) => {
    return readComicInfo(archivePath);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_INJECT_COMIC_INFO, (_, archivePath: string, xmlContent: string) => {
    return injectComicInfo(archivePath, xmlContent);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_COMPRESS, (_, sourceDir: string, destArchive: string) => {
    return compressArchive(sourceDir, destArchive);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_RENAME_INNER, (_, archivePath: string, renameMap: [string, string][], targetPath: string) => {
    return renameInnerFiles(archivePath, renameMap, targetPath);
  });

  // === Image ===
  ipcMain.handle(IPC_CHANNELS.IMAGE_OPTIMIZE, (_, inputPath: string, outputPath: string, options: unknown) => {
    return optimizeImage(inputPath, outputPath, options as Parameters<typeof optimizeImage>[2]);
  });

  ipcMain.handle(IPC_CHANNELS.IMAGE_GET_DIMENSIONS, (_, inputPath: string) => {
    return getImageDimensions(inputPath);
  });

  // === Dialog ===
  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, async (_, options?: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      properties: ['openDirectory'],
      ...options,
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE, async (_, options?: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      properties: ['openFile'],
      ...options,
    });
    return result.filePaths || [];
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_FILE, async (_, options?: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow()!, options);
    return result.filePath || null;
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_SHOW_MESSAGE, async (_, options) => {
    return dialog.showMessageBox(BrowserWindow.getFocusedWindow()!, options);
  });

  // === Shell ===
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_PATH, (_, path: string) => {
    shell.showItemInFolder(path);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, (_, url: string) => {
    shell.openExternal(url);
    return true;
  });

  // === File System ===
  ipcMain.handle(IPC_CHANNELS.FS_READ_DIR, (_, dirPath: string) => {
    return fs.readdir(dirPath);
  });

  ipcMain.handle(IPC_CHANNELS.FS_EXISTS, (_, path: string) => {
    return fs.pathExists(path);
  });

  ipcMain.handle(IPC_CHANNELS.FS_STAT, (_, path: string) => {
    return fs.stat(path);
  });
}
