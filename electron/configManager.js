import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  migrateLegacyAppDataDir,
  resolveConfigPath,
  resolveLegacyAppDataDirs,
} from './dataPaths.js';

const SUPPORTED_LANGUAGES = new Set(['ko', 'en', 'ja']);

function normalizeLanguage(value, fallback = 'ko') {
  return SUPPORTED_LANGUAGES.has(value) ? value : fallback;
}

export class ConfigManager {
  constructor(userDataPath, executableDir, options = {}) {
    this.userDataPath = userDataPath;
    this.executableDir = executableDir;
    this.platform = options.platform;
    this.env = options.env;
    this.usesDefaultConfigPath = !options.configPath;
    this.configPath = options.configPath || resolveConfigPath(executableDir, options.platform, options.env);
    this.legacyConfigPaths = [
      executableDir ? path.join(executableDir, 'config.json') : null,
      ...resolveLegacyAppDataDirs(executableDir, options.platform, options.env)
        .map(legacyDir => path.join(legacyDir, 'config.json')),
      userDataPath ? path.join(userDataPath, 'config.json') : null,
    ].filter((legacyPath, index, paths) => (
      legacyPath
      && path.resolve(legacyPath) !== path.resolve(this.configPath)
      && paths.indexOf(legacyPath) === index
    ));
    this.config = null;
  }

  normalizePathList(values = []) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const rawPath = typeof value === 'string' ? value : value?.path;
      const normalized = String(rawPath || '').trim();
      if (!normalized) continue;
      const key = normalized.replace(/[\\/]+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  normalizeFavorites(values = []) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const rawPath = typeof value === 'string' ? value : value?.path;
      const normalized = String(rawPath || '').trim();
      if (!normalized) continue;
      const key = normalized.replace(/[\\/]+$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(typeof value === 'string'
        ? normalized
        : { ...value, path: normalized });
    }
    return result;
  }

  normalizeConfig(data = {}) {
    const defaults = this.getDefaultConfig();
    const raw = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const lang = normalizeLanguage(raw.language || raw.lang, defaults.language);
    const libraries = this.normalizePathList([
      ...(raw.libraries || []),
      ...(raw.dup_check_folders || []),
    ]);
    const favorites = this.normalizeFavorites(raw.favorites || raw.folder_favorites || []);
    return {
      ...defaults,
      ...raw,
      lang,
      language: lang,
      libraries,
      dup_check_folders: libraries,
      favorites,
      folder_favorites: favorites,
      api_keys: {
        ...defaults.api_keys,
        ...(raw.api_keys || {}),
      },
    };
  }

  async initialize() {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
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
      language: 'ko',
      target_format: 'none',
      backup_on: false,
      flatten_folders: false,
      webp_conversion: false,
      img_quality: 100,
      jpg_quality: 85,
      renamer_archive_compression: 'auto',
      max_threads: defaultThreads,
      play_sound: true,
      viewer_path: '',
      libraries: [],
      favorites: [],
      folder_favorites: [],
      dup_check_folders: [],
      opds_port: 8080,
      web_port: 8082,
      webdav_port: 8081,
      webdav_username: 'user',
      webdav_password: '1234',
      sharing_https_enabled: false,
      pass_skip_meta: false,
      api_keys: {
        aladin: '',
        vine: '',
        google: '',
        ai_trans_enabled: false,
        ai_provider: 'Gemini',
        ai_key: '',
        tag_rules: '',
      },
      font_family: 'Default',
      font_scale: 100,
      btn_primary: '#0078d7',
      start_num: 0,
      completion_sound: 'Default.wav',
      width: 1200,
      height: 800,
      is_maximized: false,
      last_tab_id: 'folder',
      last_tab_index: 0,
      folder_left_panel_width: null,
      folder_detail_panel_height: null,
      folder_last_path: '',
      last_selected_library: '',
      index_last_mtimes: {},
      min_window_width: 1200,
      min_window_height: 750,
      metadata_search_min_width: 1200,
      metadata_search_min_height: 780,
    };
  }

  loadConfig() {
    try {
      if (this.usesDefaultConfigPath) {
        migrateLegacyAppDataDir(this.executableDir, this.platform, this.env);
      }
      this.migrateLegacyConfig();
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.config = this.normalizeConfig(data);
        return this.config;
      }
    } catch (error) {
      console.error('설정 로드 실패:', error);
      try {
        const corruptPath = `${this.configPath}.corrupt-${Date.now()}.bak`;
        fs.renameSync(this.configPath, corruptPath);
      } catch {
        // 손상 파일이 없거나 이동할 수 없으면 기본 설정 생성만 진행합니다.
      }
    }
    this.config = this.normalizeConfig({});
    this.saveConfig(this.config);
    return this.config;
  }

  migrateLegacyConfig() {
    if (fs.existsSync(this.configPath)) {
      return false;
    }
    for (const legacyPath of this.legacyConfigPaths) {
      try {
        if (!fs.existsSync(legacyPath)) {
          continue;
        }
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        fs.copyFileSync(legacyPath, this.configPath);
        return true;
      } catch (error) {
        console.error('기존 설정 마이그레이션 실패:', error);
      }
    }
    return false;
  }

  saveConfig(configData) {
    try {
      const requestedLang = configData?.language || configData?.lang;
      const nextConfig = this.normalizeConfig({
        ...(this.config || {}),
        ...(configData || {}),
        ...(requestedLang ? {
          lang: requestedLang,
          language: requestedLang,
        } : {}),
        api_keys: {
          ...(this.config?.api_keys || {}),
          ...(configData?.api_keys || {}),
        },
      });
      const configDir = path.dirname(this.configPath);
      fs.mkdirSync(configDir, { recursive: true });
      const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(nextConfig, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.configPath);
      this.config = nextConfig;
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
    return this.saveConfig(updates);
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
