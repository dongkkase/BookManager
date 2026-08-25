import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  migrateLegacyAppDataDir,
  resolveConfigPath,
  resolveLegacyAppDataDirs,
} from './dataPaths.js';

const SUPPORTED_LANGUAGES = new Set(['ko', 'en', 'ja']);
const COMIC_METADATA_API_SOURCES = new Set(['리디북스', '알라딘', 'Google Books', 'Anilist', 'Vine']);
const BOOK_METADATA_API_SOURCES = new Set(['리디북스', '알라딘', 'Google Books', 'Amazon']);
const PDF_METADATA_API_SOURCES = new Set(['리디북스', '알라딘', 'Google Books', 'Amazon']);
const AI_PROVIDERS = new Set(['Gemini', 'OpenAI']);
const VIEWER_PROGRAM_TYPES = ['comic', 'epub', 'pdf', 'text'];

function normalizeLanguage(value, fallback = 'ko') {
  return SUPPORTED_LANGUAGES.has(value) ? value : fallback;
}

function normalizeMetadataApiSource(value, sources, fallback = '리디북스') {
  const source = String(value || '').trim();
  return sources.has(source) ? source : fallback;
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
      const key = this.libraryPathKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  }

  libraryPathKey(value = '') {
    return String(value || '').trim().replace(/[\\/]+$/, '').toLowerCase();
  }

  libraryEntryFromValue(value) {
    const rawPath = typeof value === 'string' ? value : value?.path;
    const normalizedPath = String(rawPath || '').trim();
    if (!normalizedPath) return null;
    return {
      path: normalizedPath,
      alias: typeof value === 'string' ? '' : String(value?.alias || '').trim(),
      group: typeof value === 'string' ? '' : String(value?.group || '').trim(),
    };
  }

  normalizeLibraryEntries(values = [], pathValues = []) {
    const metadata = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const entry = this.libraryEntryFromValue(value);
      if (!entry) continue;
      const key = this.libraryPathKey(entry.path);
      const previous = metadata.get(key) || { path: entry.path, alias: '', group: '' };
      metadata.set(key, {
        path: previous.path || entry.path,
        alias: previous.alias || entry.alias,
        group: previous.group || entry.group,
      });
    }

    const normalizedPathValues = this.normalizePathList(pathValues);
    const orderedPaths = normalizedPathValues.length > 0
      ? normalizedPathValues
      : this.normalizePathList(values);
    return orderedPaths.map(entryPath => {
      const meta = metadata.get(this.libraryPathKey(entryPath));
      return {
        path: entryPath,
        alias: meta?.alias || '',
        group: meta?.group || '',
      };
    });
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

  normalizeViewerPaths(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return VIEWER_PROGRAM_TYPES.reduce((result, type) => {
      result[type] = String(source[type] || '').trim();
      return result;
    }, {});
  }

  normalizeConfig(data = {}) {
    const defaults = this.getDefaultConfig();
    const raw = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const lang = normalizeLanguage(raw.language || raw.lang, defaults.language);
    const rawLibraryPaths = [
      ...(raw.libraries || []),
      ...(raw.dup_check_folders || []),
    ];
    const libraryEntries = this.normalizeLibraryEntries([
      ...(raw.library_entries || []),
      ...rawLibraryPaths,
    ], rawLibraryPaths);
    const libraries = libraryEntries.map(entry => entry.path);
    const favorites = this.normalizeFavorites(raw.favorites || raw.folder_favorites || []);
    const preferredComicApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_comic || raw.last_meta_api || defaults.preferred_meta_api_comic,
      COMIC_METADATA_API_SOURCES,
      defaults.preferred_meta_api_comic,
    );
    const preferredBookApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_book || raw.last_meta_api || defaults.preferred_meta_api_book,
      BOOK_METADATA_API_SOURCES,
      defaults.preferred_meta_api_book,
    );
    const preferredPdfApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_pdf || raw.last_meta_api || defaults.preferred_meta_api_pdf,
      PDF_METADATA_API_SOURCES,
      defaults.preferred_meta_api_pdf,
    );
    const fontFamily = String(raw.font_family || defaults.font_family);
    const rawApiKeys = raw.api_keys && typeof raw.api_keys === 'object' && !Array.isArray(raw.api_keys)
      ? raw.api_keys
      : {};
    const mergedApiKeys = {
      ...defaults.api_keys,
      ...rawApiKeys,
    };
    const aiProvider = AI_PROVIDERS.has(mergedApiKeys.ai_provider) ? mergedApiKeys.ai_provider : 'Gemini';
    const legacyAiKey = String(mergedApiKeys.ai_key || '').trim();
    const hasProviderAiKeys = Object.prototype.hasOwnProperty.call(rawApiKeys, 'ai_gemini_key')
      || Object.prototype.hasOwnProperty.call(rawApiKeys, 'ai_openai_key');
    const aiGeminiKey = String(
      mergedApiKeys.ai_gemini_key || (!hasProviderAiKeys && aiProvider === 'Gemini' ? legacyAiKey : '')
    ).trim();
    const aiOpenAiKey = String(
      mergedApiKeys.ai_openai_key || (!hasProviderAiKeys && aiProvider === 'OpenAI' ? legacyAiKey : '')
    ).trim();
    return {
      ...defaults,
      ...raw,
      lang,
      language: lang,
      viewer_path: String(raw.viewer_path || defaults.viewer_path).trim(),
      viewer_paths: this.normalizeViewerPaths(raw.viewer_paths || defaults.viewer_paths),
      font_family: fontFamily === 'Default' ? defaults.font_family : fontFamily,
      library_entries: libraryEntries,
      libraries,
      dup_check_folders: libraries,
      favorites,
      folder_favorites: favorites,
      preferred_meta_api_comic: preferredComicApi,
      preferred_meta_api_book: preferredBookApi,
      preferred_meta_api_pdf: preferredPdfApi,
      last_meta_api: String(raw.last_meta_api || preferredComicApi || defaults.last_meta_api).trim(),
      api_keys: {
        ...mergedApiKeys,
        ai_provider: aiProvider,
        ai_key: aiProvider === 'OpenAI' ? aiOpenAiKey : aiGeminiKey,
        ai_gemini_key: aiGeminiKey,
        ai_openai_key: aiOpenAiKey,
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
      renamer_default_cap_opt: false,
      renamer_default_exif_opt: false,
      max_threads: defaultThreads,
      play_sound: true,
      viewer_path: '',
      viewer_paths: {
        comic: '',
        epub: '',
        pdf: '',
        text: '',
      },
      libraries: [],
      favorites: [],
      folder_favorites: [],
      library_entries: [],
      dup_check_folders: [],
      opds_port: 8080,
      web_port: 8082,
      webdav_port: 8081,
      webdav_username: 'user',
      webdav_password: '1234',
      sharing_https_enabled: false,
      sharing_server_address: '',
      pass_skip_meta: false,
      last_meta_api: '리디북스',
      preferred_meta_api_comic: '리디북스',
      preferred_meta_api_book: '리디북스',
      preferred_meta_api_pdf: '리디북스',
      api_keys: {
        aladin: '',
        vine: '',
        google: '',
        ai_provider: 'Gemini',
        ai_key: '',
        ai_gemini_key: '',
        ai_openai_key: '',
        tts_openai_key: '',
        tts_google_key: '',
        tag_rules: '',
      },
      font_family: 'Noto Sans KR',
      font_scale: 100,
      btn_primary: '#0078d7',
      start_num: 0,
      completion_sound: 'Default.wav',
      width: 1200,
      height: 800,
      is_maximized: false,
      viewer_x: null,
      viewer_y: null,
      viewer_width: 1280,
      viewer_height: 860,
      viewer_is_maximized: false,
      audio_viewer_x: null,
      audio_viewer_y: null,
      audio_viewer_width: 1280,
      audio_viewer_height: 860,
      audio_viewer_is_maximized: false,
      last_tab_id: 'folder',
      last_tab_index: 0,
      folder_left_panel_width: null,
      folder_detail_panel_height: null,
      folder_last_path: '',
      folder_goto_history: [],
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
      const hasLibraryPathUpdate = Object.prototype.hasOwnProperty.call(configData || {}, 'libraries')
        || Object.prototype.hasOwnProperty.call(configData || {}, 'dup_check_folders');
      const hasLibraryEntryUpdate = Object.prototype.hasOwnProperty.call(configData || {}, 'library_entries');
      const nextConfig = this.normalizeConfig({
        ...(this.config || {}),
        ...(configData || {}),
        ...(hasLibraryPathUpdate && !hasLibraryEntryUpdate ? {
          library_entries: this.normalizeLibraryEntries(
            this.config?.library_entries || [],
            [
              ...(configData?.libraries || []),
              ...(configData?.dup_check_folders || []),
            ],
          ),
        } : {}),
        ...(requestedLang ? {
          lang: requestedLang,
          language: requestedLang,
        } : {}),
        viewer_paths: {
          ...(this.config?.viewer_paths || {}),
          ...(configData?.viewer_paths || {}),
        },
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
