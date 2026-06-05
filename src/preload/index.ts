import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { IPC_CHANNELS } from '../shared/constants/ipc';
import {
  AppConfig,
  FileMetadata,
  TaskInfo,
  TaskProgress,
  ArchiveEntry,
  ComicInfo,
  ImageOptimizeOptions,
  FileSystemStats,
  ServerStatus,
  UpdateInfo,
  OpenDirectoryOptions,
  OpenFileOptions,
  SaveFileOptions,
  MessageDialogOptions,
  MessageDialogResult,
} from '../shared/types';

/**
 * Preload API
 * Renderer에서 사용할 수 있는 안전한 API 노출
 */
const api = {
  // Config
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET) as Promise<AppConfig>,
  saveConfig: (newConfig: Partial<AppConfig>) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, newConfig) as Promise<boolean>,

  // DB
  getFileInfo: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_FILE_INFO, path) as Promise<FileMetadata | undefined>,
  upsertFileInfo: (fileInfo: FileMetadata) => ipcRenderer.invoke(IPC_CHANNELS.DB_UPSERT_FILE_INFO, fileInfo) as Promise<boolean>,
  getAllFilesInPath: (folderPath: string, includeSub: boolean) => ipcRenderer.invoke(IPC_CHANNELS.DB_GET_ALL_FILES, folderPath, includeSub) as Promise<Record<string, FileMetadata>>,
  clearDupCache: () => ipcRenderer.invoke(IPC_CHANNELS.DB_CLEAR_DUP_CACHE) as Promise<boolean>,

  // Task
  cancelTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CANCEL, taskId) as Promise<boolean>,
  pauseTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_PAUSE, taskId) as Promise<boolean>,
  resumeTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_RESUME, taskId) as Promise<boolean>,
  getTaskInfo: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_GET_INFO, taskId) as Promise<TaskInfo | undefined>,
  getAllTaskInfo: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_GET_ALL_INFO) as Promise<TaskInfo[]>,

  // Task progress listener
  onTaskProgress: (callback: (progress: TaskProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: TaskProgress): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.TASK_PROGRESS, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_PROGRESS, subscription);
  },

  // Archive
  listArchive: (filepath: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_LIST, filepath) as Promise<ArchiveEntry[]>,
  extractArchive: (archivePath: string, outputDir?: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_EXTRACT, archivePath, outputDir) as Promise<string>,
  extractCover: (archivePath: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_EXTRACT_COVER, archivePath) as Promise<string | null>,
  readInnerFile: (archivePath: string, innerPath: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_READ_FILE, archivePath, innerPath) as Promise<string>,
  readComicInfo: (archivePath: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_READ_COMIC_INFO, archivePath) as Promise<ComicInfo | null>,
  injectComicInfo: (archivePath: string, xmlContent: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_INJECT_COMIC_INFO, archivePath, xmlContent) as Promise<boolean>,
  compressArchive: (sourceDir: string, destArchive: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_COMPRESS, sourceDir, destArchive) as Promise<void>,
  renameInnerFiles: (archivePath: string, renameMap: [string, string][], targetPath: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_RENAME_INNER, archivePath, renameMap, targetPath) as Promise<boolean>,

  // Image
  optimizeImage: (inputPath: string, outputPath: string, options: ImageOptimizeOptions) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_OPTIMIZE, inputPath, outputPath, options) as Promise<void>,
  getImageDimensions: (inputPath: string) => ipcRenderer.invoke(IPC_CHANNELS.IMAGE_GET_DIMENSIONS, inputPath) as Promise<{ width: number; height: number }>,

  // Dialog
  openDirectory: (options?: OpenDirectoryOptions) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, options) as Promise<string | null>,
  openFile: (options?: OpenFileOptions) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options) as Promise<string[]>,
  saveFile: (options?: SaveFileOptions) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SAVE_FILE, options) as Promise<string | null>,
  showMessage: (options: MessageDialogOptions) => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SHOW_MESSAGE, options) as Promise<MessageDialogResult>,

  // Shell
  openPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, path) as Promise<boolean>,
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url) as Promise<boolean>,

  // File System
  readDir: (dirPath: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_DIR, dirPath) as Promise<string[]>,
  pathExists: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_EXISTS, path) as Promise<boolean>,
  stat: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FS_STAT, path) as Promise<FileSystemStats | null>,

  // Sound
  playSound: (soundName: string) => ipcRenderer.invoke(IPC_CHANNELS.SOUND_PLAY, soundName) as Promise<boolean>,

  // Server
  startServer: (protocol: string, port: number) => ipcRenderer.invoke(IPC_CHANNELS.SERVER_START, protocol, port) as Promise<boolean>,
  stopServer: () => ipcRenderer.invoke(IPC_CHANNELS.SERVER_STOP) as Promise<boolean>,
  getServerStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SERVER_STATUS) as Promise<ServerStatus>,

  // Update
  checkForUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK) as Promise<UpdateInfo>,

  // IPC Renderer proxy (for direct communication)
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      ipcRenderer.removeListener(channel, listener);
    },
  },
};

// contextBridge를 통해 안전하게 API 노출
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
