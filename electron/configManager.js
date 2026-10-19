import fs from 'fs';
import path from 'path';
import os from 'os';
import { restoreFolderConfigPaths } from './folderConfigPaths.js';
import { isMetadataApiSourceEnabled, normalizeHardcoverToken, normalizeMetadataApiEnabled, normalizeMetadataProviderSettings } from './metadataProviderSettings.js';
import {
  migrateLegacyAppDataDir,
  resolveConfigPath,
  resolveLegacyAppDataDirs,
} from './dataPaths.js';

const SUPPORTED_LANGUAGES = new Set(['ko', 'en', 'ja']);
const COMIC_METADATA_API_SOURCES = new Set(['리디북스', '문피아', '한국웹툰', 'YES24', '알라딘', 'Google Books', 'Anilist', 'Vine', 'Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB']);
const BOOK_METADATA_API_SOURCES = new Set(['리디북스', '문피아', 'YES24', '알라딘', 'Google Books', 'Amazon', 'Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB']);
const PDF_METADATA_API_SOURCES = new Set(['리디북스', '문피아', 'YES24', '알라딘', 'Google Books', 'Amazon', 'Goodreads', 'Hardcover', 'Open Library', 'iTunes', 'Kobo', 'LubimyCzytac', 'RanobeDB']);
const AUDIO_METADATA_API_SOURCES = new Set([...BOOK_METADATA_API_SOURCES, 'Audible', 'AudNexus', 'Libro.fm']);
const AI_PROVIDERS = new Set(['Gemini', 'OpenAI']);
const VIEWER_PROGRAM_TYPES = ['comic', 'epub', 'pdf', 'text'];

function normalizeLanguage(value, fallback = 'ko') {
  return SUPPORTED_LANGUAGES.has(value) ? value : fallback;
}

function normalizeMetadataApiSource(value, sources, fallback = '리디북스', enabledMap = {}, apiKeys = {}) {
    const source = String(value || '').trim();
    if (source === '통합검색') return source;
    if (sources.has(source) && isMetadataApiSourceEnabled(source, enabledMap)) return source;
    const requiredKeys = { YES24: 'yes24', '알라딘': 'aladin', 'Google Books': 'google', Vine: 'vine', Hardcover: 'hardcover' };
    const available = candidate => {
        if (!isMetadataApiSourceEnabled(candidate, enabledMap)) return false;
        const key = requiredKeys[candidate];
        if (!key) return true;
        return key === 'hardcover'
            ? normalizeHardcoverToken(apiKeys?.[key]).length > 0
            : String(apiKeys?.[key] || '').trim().length > 0;
    };
    if (sources.has(fallback) && available(fallback)) return fallback;
    return [...sources].find(available) || '통합검색';
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
    this.configInitialized = false;
    this.configInitializationFailed = false;
    this.configLoadTrusted = false;
    this.libraryDataPruneReady = false;
  }

    hasTrustedLibraryPaths(config = {}) {
        const keys = ['libraries', 'dup_check_folders', 'library_entries'];
        const pathApi = (this.platform || process.platform) === 'win32' ? path.win32 : path;
        return keys.some(key => Object.prototype.hasOwnProperty.call(config, key))
            && keys.every(key => !Object.prototype.hasOwnProperty.call(config, key)
                || Array.isArray(config[key]) && config[key].every(entry => {
                    const value = typeof entry === 'string' ? entry : entry?.path;
                    return typeof value === 'string' && !value.includes('\0') && pathApi.isAbsolute(value.trim());
                }));
    }

    canPruneLibraryData() {
        return this.libraryDataPruneReady;
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
    const metadataApiEnabled = normalizeMetadataApiEnabled(raw.metadata_api_enabled);
    const preferredComicApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_comic || raw.last_meta_api || defaults.preferred_meta_api_comic,
      COMIC_METADATA_API_SOURCES,
      defaults.preferred_meta_api_comic,
        metadataApiEnabled,
        raw.api_keys,
    );
    const preferredBookApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_book || raw.last_meta_api || defaults.preferred_meta_api_book,
      BOOK_METADATA_API_SOURCES,
      defaults.preferred_meta_api_book,
        metadataApiEnabled,
        raw.api_keys,
    );
    const preferredPdfApi = normalizeMetadataApiSource(
      raw.preferred_meta_api_pdf || raw.last_meta_api || defaults.preferred_meta_api_pdf,
      PDF_METADATA_API_SOURCES,
      defaults.preferred_meta_api_pdf,
        metadataApiEnabled,
        raw.api_keys,
    );
    const preferredAudioApi = normalizeMetadataApiSource(
        raw.preferred_meta_api_audio || raw.preferred_meta_api_book || raw.last_meta_api || defaults.preferred_meta_api_audio,
        AUDIO_METADATA_API_SOURCES,
        defaults.preferred_meta_api_audio,
        metadataApiEnabled,
        raw.api_keys,
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
        hardware_acceleration: raw.hardware_acceleration !== false,
        telemetry_error_reports: raw.telemetry_error_reports === undefined ? defaults.telemetry_error_reports : raw.telemetry_error_reports === true,
        telemetry_usage_stats: raw.telemetry_usage_stats === undefined ? defaults.telemetry_usage_stats : raw.telemetry_usage_stats === true,
      viewer_path: String(raw.viewer_path || defaults.viewer_path).trim(),
      viewer_paths: this.normalizeViewerPaths(raw.viewer_paths || defaults.viewer_paths),
      font_family: fontFamily === 'Default' ? defaults.font_family : fontFamily,
        motion_preference: ['system', 'full', 'reduced'].includes(raw.motion_preference) ? raw.motion_preference : 'system',
      library_entries: libraryEntries,
      libraries,
      dup_check_folders: libraries,
      favorites,
      folder_favorites: favorites,
      preferred_meta_api_comic: preferredComicApi,
      preferred_meta_api_book: preferredBookApi,
      preferred_meta_api_pdf: preferredPdfApi,
        preferred_meta_api_audio: preferredAudioApi,
        metadata_providers: normalizeMetadataProviderSettings(raw.metadata_providers),
        metadata_api_enabled: metadataApiEnabled,
      last_meta_api: String(raw.last_meta_api || preferredComicApi || defaults.last_meta_api).trim(),
      api_keys: {
        ...mergedApiKeys,
        yes24: String(mergedApiKeys.yes24 || '').trim(),
        hardcover: normalizeHardcoverToken(mergedApiKeys.hardcover),
        ai_provider: aiProvider,
        ai_key: aiProvider === 'OpenAI' ? aiOpenAiKey : aiGeminiKey,
        ai_gemini_key: aiGeminiKey,
        ai_openai_key: aiOpenAiKey,
      },
    };
  }

  async initialize() {
    this.configInitialized = false;
    this.configInitializationFailed = false;
    this.libraryDataPruneReady = false;
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      this.config = this.loadConfig();
        const restored = await restoreFolderConfigPaths(this.config, { platform: this.platform });
        const restoredSaved = restored === this.config || this.saveConfig(restored, { allowLibraryDataPrune: false });
        this.configInitialized = restoredSaved;
        this.configInitializationFailed = !restoredSaved;
        if (!restoredSaved) this.config.library_data_prune_pending = true;
        this.libraryDataPruneReady = restoredSaved && this.configLoadTrusted
            && this.config.library_data_prune_pending !== true;
    } catch (error) {
      console.error('ConfigManager 초기화 실패:', error);
      this.configInitializationFailed = true;
      this.configLoadTrusted = false;
      this.config = { ...this.getDefaultConfig(), library_data_prune_pending: true };
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
        hardware_acceleration: true,
        telemetry_error_reports: true,
        telemetry_usage_stats: true,
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
        preferred_meta_api_audio: '리디북스',
        metadata_providers: normalizeMetadataProviderSettings(),
        metadata_api_enabled: normalizeMetadataApiEnabled(),
      api_keys: {
        yes24: '',
        aladin: '',
        vine: '',
        google: '',
        hardcover: '',
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
        motion_preference: 'system',
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
      folder_search_history: [],
      last_selected_library: '',
        last_library_move_target: '',
      index_last_mtimes: {},
      min_window_width: 1200,
      min_window_height: 750,
      metadata_search_min_width: 1200,
      metadata_search_min_height: 780,
    };
  }

  loadConfig() {
    this.configLoadTrusted = false;
    this.libraryDataPruneReady = false;
    try {
      if (this.usesDefaultConfigPath) {
        migrateLegacyAppDataDir(this.executableDir, this.platform, this.env);
      }
      this.migrateLegacyConfig();
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid configuration object.');
        this.config = this.normalizeConfig(data);
        this.configLoadTrusted = !this.configInitializationFailed
            && data.library_data_prune_pending !== true && this.hasTrustedLibraryPaths(data);
        if (!this.configLoadTrusted) this.config.library_data_prune_pending = true;
        this.libraryDataPruneReady = this.configInitialized && this.configLoadTrusted;
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
    this.config = { ...this.normalizeConfig({}), library_data_prune_pending: true };
    this.saveConfig(this.config, { allowLibraryDataPrune: false });
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

  saveConfig(configData, { allowLibraryDataPrune = true } = {}) {
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
        metadata_providers: {
            ...(this.config?.metadata_providers || {}),
            ...(configData?.metadata_providers || {}),
        },
        metadata_api_enabled: {
            ...(this.config?.metadata_api_enabled || {}),
            ...(configData?.metadata_api_enabled || {}),
        },
        api_keys: {
          ...(this.config?.api_keys || {}),
          ...(configData?.api_keys || {}),
        },
      });
        const pathSignature = values => JSON.stringify([...new Set((values || []).map(value => this.libraryPathKey(value)))].sort());
        const hasLibraryUpdate = hasLibraryPathUpdate || hasLibraryEntryUpdate;
        const validLibraryUpdate = !hasLibraryUpdate || this.hasTrustedLibraryPaths(configData);
        const explicitLibraryChange = allowLibraryDataPrune && hasLibraryUpdate && validLibraryUpdate
            && pathSignature(this.config?.libraries) !== pathSignature(nextConfig.libraries);
        if (validLibraryUpdate && (explicitLibraryChange || this.configLoadTrusted && this.config?.library_data_prune_pending !== true)) {
            delete nextConfig.library_data_prune_pending;
        } else {
            nextConfig.library_data_prune_pending = true;
        }
      const configDir = path.dirname(this.configPath);
      fs.mkdirSync(configDir, { recursive: true });
      const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(nextConfig, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.configPath);
      this.config = nextConfig;
        if (explicitLibraryChange) {
            this.configInitialized = true;
            this.configInitializationFailed = false;
            this.configLoadTrusted = true;
            this.libraryDataPruneReady = true;
        } else if (nextConfig.library_data_prune_pending) {
            this.configLoadTrusted = false;
            this.libraryDataPruneReady = false;
        }
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
