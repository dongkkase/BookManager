import fs from 'fs';
import path from 'path';
import os from 'os';

export class ConfigManager {
  constructor(userDataPath, executableDir) {
    this.userDataPath = userDataPath;
    this.executableDir = executableDir;
    this.configPath = path.join(executableDir, 'config.json');
    this.config = null;
  }

  async initialize() {
    try {
      // 사용자 데이터 디렉토리 생성
      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }
      // 설정 로드
      this.config = this.loadConfig();
    } catch (error) {
      console.error('ConfigManager 초기화 실패:', error);
      this.config = this.getDefaultConfig();
    }
  }

  getDefaultConfig() {
    const totalCores = osCores() || 4;
    const safeMax = totalCores <= 4 ? Math.max(1, totalCores - 1) : Math.max(1, totalCores - 2);
    const defaultThreads = Math.max(1, Math.floor(totalCores * 0.5));

    return {
      lang: 'ko',
      target_format: 'none',
      backup_on: false,
      flatten_folders: false,
      webp_conversion: false,
      img_quality: 100,
      jpg_quality: 85,
      max_threads: defaultThreads,
      play_sound: true,
      viewer_path: '',
      dup_check_folders: [],
      font_family: 'Default',
      font_scale: 100,
      btn_primary: '#0078d7',
      start_num: 0,
      completion_sound: 'Default.wav',
    };
  }

  loadConfig() {
    const defaultConfig = this.getDefaultConfig();
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        Object.assign(defaultConfig, data);
      }
    } catch (error) {
      console.error('설정 로드 실패:', error);
    }
    return defaultConfig;
  }

  saveConfig(configData) {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(configData, null, 2), 'utf-8');
      this.config = configData;
      return true;
    } catch (error) {
      console.error('설정 저장 실패:', error);
      return false;
    }
  }

  getConfig() {
    return this.config;
  }

  updateConfig(updates) {
    if (this.config) {
      Object.assign(this.config, updates);
      this.saveConfig(this.config);
    }
  }
}

// os.cpu_count() 대체
function osCores() {
  try {
    return os.cpus().length;
  } catch {
    return 4;
  }
}
