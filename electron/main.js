import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, protocol, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setupIPCHandlers } from './ipcHandlers.js';
import { setupViewerWindowManager } from './viewerWindow.js';
import { ConfigManager } from './configManager.js';
import { setupI18n, t as i18nT } from './utils/i18n.js';
import { resolveWindowState, serializeWindowState } from './windowState.js';
import { createExitDialogOptions, shouldProceedWithExit } from './exitPolicy.js';
import { getSharingServerStatus, stopAllSharingServers } from './servers/sharingServers.js';
import { findBinaryPath } from './binaryPolicy.js';
import {
  resolveApiCoverCacheDir,
  resolveAppDataDir,
  resolveThumbnailDir,
} from './dataPaths.js';
import { installConsolePipeGuard } from './utils/consolePipeGuard.js';
import {
  attachWindowSafetyHandlers,
  createProcessFaultReporter,
  installProcessSafetyHandlers,
} from './processSafety.js';

installConsolePipeGuard();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
let configManager = null;
let ipcController = null;
let viewerController = null;
let allowWindowClose = false;
let isShowingExitDialog = false;
let sharingServersStopped = false;

// 개발 모드 여부
const isDev = process.argv.includes('--dev');
const useUnsafeDevNodeIntegration = isDev && (
  process.env.BOOKMANAGER_UNSAFE_DEV_NODE === '1'
  || process.argv.includes('--unsafe-dev-node')
);
const useDevServer = isDev && process.env.BOOKMANAGER_DEV_LOAD_DIST !== '1';
const APP_NAME = 'BookManager';
const APP_ID = 'com.bookmanager.app';
const DEV_SERVER_URL = process.env.BOOKMANAGER_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const DIST_INDEX_PATH = path.join(__dirname, '..', 'dist', 'index.html');
const THUMBNAIL_MEMORY_CACHE_LIMIT = 256;
const thumbnailMemoryCache = new Map();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bookmanager-thumbnail',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: 'bookmanager-document',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: 'bookmanager-comic',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
}

// 앱 사용자 데이터 디렉토리
function getUserDataPath() {
  return path.join(app.getPath('userData'));
}

// 리소스 경로 얻기
function getResourcePath(...subPaths) {
  if (isDev) {
    // 개발 모드: 프로젝트 루트의 리소스 폴더 사용
    return path.join(__dirname, '..', ...subPaths);
  } else {
    // 프로덕션 모드: extraResources에 복사된 리소스 사용
    return path.join(process.resourcesPath, ...subPaths);
  }
}

function getAppIconPath() {
  const iconFile = process.platform === 'win32'
    ? 'app.ico'
    : process.platform === 'darwin'
      ? 'app-1024.png'
      : 'app.png';
  const iconPath = getResourcePath('src', 'images', iconFile);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

// 실행 파일 디렉토리
function getExecutableDir() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.join(__dirname, '..');
}

function getProcessLogPath() {
  return path.join(resolveAppDataDir(getExecutableDir()), 'process.log');
}

const reportProcessFault = createProcessFaultReporter({
  getLogPath: getProcessLogPath,
});

installProcessSafetyHandlers({
  appTarget: app,
  reportFault: reportProcessFault,
});

// 바이너리 도구 경로
async function getBinPath(toolName) {
  return findBinaryPath(toolName, {
    resourcesPath: process.resourcesPath,
    executableDir: getExecutableDir(),
    projectRoot: path.join(__dirname, '..'),
  });
}

// 폰트 경로
function getFontPath(fontFilename) {
  const fontPath = getResourcePath('src', 'fonts', fontFilename);
  if (fs.existsSync(fontPath)) return fontPath;
  const legacyFontPath = path.join(getExecutableDir(), 'fonts', fontFilename);
  if (fs.existsSync(legacyFontPath)) return legacyFontPath;
  return null;
}

function mimeTypeForThumbnail(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function readCachedThumbnail(thumbnailPath) {
  const stat = await fs.promises.stat(thumbnailPath);
  const cacheKey = `${thumbnailPath}:${stat.mtimeMs}:${stat.size}`;
  const cached = thumbnailMemoryCache.get(cacheKey);
  if (cached) {
    thumbnailMemoryCache.delete(cacheKey);
    thumbnailMemoryCache.set(cacheKey, cached);
    return cached;
  }

  const data = await fs.promises.readFile(thumbnailPath);
  const value = {
    data,
    mimeType: mimeTypeForThumbnail(thumbnailPath),
  };
  thumbnailMemoryCache.set(cacheKey, value);
  while (thumbnailMemoryCache.size > THUMBNAIL_MEMORY_CACHE_LIMIT) {
    const oldestKey = thumbnailMemoryCache.keys().next().value;
    thumbnailMemoryCache.delete(oldestKey);
  }
  return value;
}

// 단일 인스턴스 락
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(initializeApp)
    .catch(error => {
      reportProcessFault('startup-failed', error);
      try {
        dialog.showErrorBox(APP_NAME, error?.message || String(error));
      } catch {
        // The process fault log is the fallback if a native dialog cannot be shown.
      }
      app.quit();
    });
}

async function initializeApp() {
  protocol.handle('bookmanager-thumbnail', async request => {
    const requestUrl = new URL(request.url);
    const requestedName = decodeURIComponent(requestUrl.pathname.slice(1));
    if (!requestedName || path.basename(requestedName) !== requestedName) {
      return new Response('Not found', { status: 404 });
    }
    const cacheDir = requestUrl.hostname === 'api-cover'
      ? resolveApiCoverCacheDir(getExecutableDir())
      : resolveThumbnailDir(getExecutableDir());
    const thumbnailPath = path.join(cacheDir, requestedName);
    try {
      const cached = await readCachedThumbnail(thumbnailPath);
      return new Response(cached.data, {
        headers: {
          'Content-Type': cached.mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  const appIconPath = getAppIconPath();
  if (process.platform === 'darwin' && appIconPath) {
    app.dock.setIcon(appIconPath);
  }

  // 설정 관리자 초기화
  configManager = new ConfigManager(getUserDataPath(), getExecutableDir(), {
    useUserData: app.isPackaged && process.platform === 'darwin',
  });
  await configManager.initialize();

  // i18n 초기화
  const config = configManager.loadConfig();
  await setupI18n(config?.lang || 'ko');

  // IPC 핸들러 설정
  ipcController = setupIPCHandlers(configManager, getExecutableDir, getResourcePath, getBinPath, getFontPath);
  viewerController = setupViewerWindowManager({
    isDev: useDevServer,
    devServerUrl: DEV_SERVER_URL,
    distIndexPath: DIST_INDEX_PATH,
    preloadPath: path.join(__dirname, 'viewerPreload.cjs'),
    getIconPath: getAppIconPath,
    getSevenZPath: async () => await getBinPath('7za') || await getBinPath('7z'),
    configManager,
  });

  // 메인 윈도우 생성
  createMainWindow(config);

  // 트레이 생성
  createTray();
}

function createMainWindow(config) {
  if (useUnsafeDevNodeIntegration) {
    console.warn('[BookManager] Unsafe dev Node integration is enabled for this session.');
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const windowState = resolveWindowState(
    config,
    screen.getAllDisplays(),
    primaryDisplay.workArea,
  );

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: windowState.minWidth,
    minHeight: windowState.minHeight,
    title: APP_NAME,
    icon: getAppIconPath(),
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: !useUnsafeDevNodeIntegration,
      nodeIntegration: useUnsafeDevNodeIntegration,
    },
    show: false,
  });
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null);
  }
  const windowOwnerId = mainWindow.webContents.id;
  attachWindowSafetyHandlers(mainWindow, {
    reportFault: reportProcessFault,
  });

  // 개발 모드 또는 로컬 파일 로드
  if (isDev) {
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[BookManager] Main window failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[BookManager] Main window loaded.');
    });
  }

  if (useDevServer) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(DIST_INDEX_PATH);
  }

  if (isDev) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    if (windowState.isMaximized) {
      mainWindow.maximize();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', async (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (allowWindowClose) {
      configManager?.updateConfig(serializeWindowState(mainWindow));
      return;
    }

    event.preventDefault();
    if (isShowingExitDialog) return;

    const runtimeState = ipcController?.getRuntimeState(windowOwnerId);
    if (runtimeState?.isWorking) {
      isShowingExitDialog = true;
      try {
        const result = await dialog.showMessageBox(
          mainWindow,
          createExitDialogOptions(runtimeState.language),
        );
        if (!shouldProceedWithExit(result.response)) return;
        ipcController?.cancelAll(windowOwnerId);
        await ipcController?.waitForIdle(windowOwnerId, 30000);
      } finally {
        isShowingExitDialog = false;
      }
    }

    configManager?.updateConfig(serializeWindowState(mainWindow));
    allowWindowClose = true;
    mainWindow.close();
  });

  mainWindow.on('closed', () => {
    ipcController?.clear(windowOwnerId);
    const viewerWindow = viewerController?.getWindow?.();
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.close();
    }
    mainWindow = null;
    allowWindowClose = false;
  });
}

function createTray() {
  try {
    const iconPath = getAppIconPath();
    if (!iconPath) throw new Error('Application icon not found');

    if (process.platform === 'darwin') {
      const trayIcon = nativeImage.createFromPath(iconPath).resize({
        width: 16,
        height: 16,
        quality: 'best',
      });
      trayIcon.setTemplateImage(true);
      tray = new Tray(trayIcon);
    } else {
      tray = new Tray(iconPath);
    }
  } catch (error) {
    console.warn('Tray icon failed to load, continuing without tray:', error.message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18nT('tray_open_app', [APP_NAME]),
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: i18nT('tray_quit'),
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// 앱 종료 처리
app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', async event => {
    const status = getSharingServerStatus();
    const hasRunningServer = status.OPDS.running || status.Web.running || status.WebDAV.running;
    if (sharingServersStopped || !hasRunningServer) return;

    event.preventDefault();
    try {
        await stopAllSharingServers(undefined, configManager?.getConfig?.() || {});
    } finally {
        sharingServersStopped = true;
        app.quit();
    }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(configManager.config);
  }
});

app.on('will-quit', () => {
  void ipcController?.dispose?.().catch(error => {
    console.warn(`[LibrarySearch] Failed to stop worker: ${error.message}`);
  });
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
