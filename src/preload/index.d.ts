import { ElectronAPI } from '@electron-toolkit/preload';
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

export interface CustomAPI {
  // Config
  getConfig: () => Promise<AppConfig>;
  saveConfig: (newConfig: Partial<AppConfig>) => Promise<boolean>;

  // DB
  getFileInfo: (path: string) => Promise<FileMetadata | undefined>;
  upsertFileInfo: (fileInfo: FileMetadata) => Promise<boolean>;
  getAllFilesInPath: (folderPath: string, includeSub: boolean) => Promise<Record<string, FileMetadata>>;
  clearDupCache: () => Promise<boolean>;

  // Task
  cancelTask: (taskId: string) => Promise<boolean>;
  pauseTask: (taskId: string) => Promise<boolean>;
  resumeTask: (taskId: string) => Promise<boolean>;
  getTaskInfo: (taskId: string) => Promise<TaskInfo | undefined>;
  getAllTaskInfo: () => Promise<TaskInfo[]>;
  onTaskProgress: (callback: (progress: TaskProgress) => void) => () => void;

  // Archive
  listArchive: (filepath: string) => Promise<ArchiveEntry[]>;
  extractArchive: (archivePath: string, outputDir?: string) => Promise<string>;
  extractCover: (archivePath: string) => Promise<string | null>;
  readInnerFile: (archivePath: string, innerPath: string) => Promise<string>;
  readComicInfo: (archivePath: string) => Promise<ComicInfo | null>;
  injectComicInfo: (archivePath: string, xmlContent: string) => Promise<boolean>;
  compressArchive: (sourceDir: string, destArchive: string) => Promise<void>;
  renameInnerFiles: (archivePath: string, renameMap: [string, string][], targetPath: string) => Promise<boolean>;

  // Image
  optimizeImage: (inputPath: string, outputPath: string, options: ImageOptimizeOptions) => Promise<void>;
  getImageDimensions: (inputPath: string) => Promise<{ width: number; height: number }>;

  // Dialog
  openDirectory: (options?: OpenDirectoryOptions) => Promise<string | null>;
  openFile: (options?: OpenFileOptions) => Promise<string[]>;
  saveFile: (options?: SaveFileOptions) => Promise<string | null>;
  showMessage: (options: MessageDialogOptions) => Promise<MessageDialogResult>;

  // Shell
  openPath: (path: string) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;

  // File System
  readDir: (dirPath: string) => Promise<string[]>;
  pathExists: (path: string) => Promise<boolean>;
  stat: (path: string) => Promise<FileSystemStats | null>;

  // Sound
  playSound: (soundName: string) => Promise<boolean>;

  // Server
  startServer: (protocol: string, port: number) => Promise<boolean>;
  stopServer: () => Promise<boolean>;
  getServerStatus: () => Promise<ServerStatus>;

  // Update
  checkForUpdate: () => Promise<UpdateInfo>;

  // IPC Renderer proxy
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (channel: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: CustomAPI;
  }
}
