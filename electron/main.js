import { app, BrowserWindow, ipcMain, dialog, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { setupIPCHandlers } from './ipcHandlers.js';
import { ConfigManager } from './configManager.js';
import { setupI18n } from './utils/i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let tray = null;
let configManager = null;

// 개발 모드 여부
const isDev = process.argv.includes('--dev');

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
    // 프로덕션 모드: app.getAppPath() 사용
    return path.join(app.getAppPath(), ...subPaths);
  }
}

// 실행 파일 디렉토리
function getExecutableDir() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.join(__dirname, '..');
}

// 바이너리 도구 경로
async function getBinPath(toolName) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binPath = path.join(getExecutableDir(), 'bin', 'win', toolName + ext);
  if (fs.existsSync(binPath)) return binPath;
  
  // 시스템에서 검색
  try {
    const { execSync } = await import('child_process');
    if (process.platform === 'win32') {
      return execSync(`where ${toolName}`).toString().trim().split('\n')[0];
    } else {
      return execSync(`which ${toolName}`).toString().trim();
    }
  } catch {
    return null;
  }
}

// 폰트 경로
function getFontPath(fontFilename) {
  const fontPath = path.join(getExecutableDir(), 'fonts', fontFilename);
  if (fs.existsSync(fontPath)) return fontPath;
  return null;
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

  app.whenReady().then(async () => {
    // 설정 관리자 초기화
    configManager = new ConfigManager(getUserDataPath(), getExecutableDir());
    await configManager.initialize();

    // i18n 초기화
    const config = configManager.loadConfig();
    await setupI18n(config?.lang || 'ko');

    // IPC 핸들러 설정
    setupIPCHandlers(configManager, getExecutableDir, getResourcePath, getBinPath, getFontPath);

    // 메인 윈도우 생성
    createMainWindow();

    // 트레이 생성
    createTray();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'BookManager',
    icon: path.join(getExecutableDir(), 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // 개발 모드 또는 로컬 파일 로드
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    const iconPath = getResourcePath('src', 'app.ico');
    
    if (process.platform === 'darwin') {
      // macOS는 템플릿 아이콘 사용
      tray = new Tray(iconPath);
    } else {
      tray = new Tray(iconPath);
    }
  } catch (error) {
    console.warn('Tray icon failed to load, continuing without tray:', error.message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'BookManager 열기',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('BookManager');
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
