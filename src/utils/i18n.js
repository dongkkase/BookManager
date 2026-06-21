import { legacyTranslations } from './i18nData.js';

export const SUPPORTED_LANGUAGES = ['ko', 'en', 'ja'];

const EXTRA_TRANSLATIONS = {
  ko: {
    folder: {
      status: {
        no_folder: '스캔할 폴더를 선택하세요',
        scanning: '폴더 스캔 중...',
        files_found: '{count}개 파일 발견',
        error: '스캔 중 오류 발생',
      },
    },
  },
  en: {
    folder: {
      status: {
        no_folder: 'Select a folder to scan',
        scanning: 'Scanning folder...',
        files_found: '{count} files found',
        error: 'An error occurred while scanning',
      },
    },
  },
  ja: {
    folder: {
      status: {
        no_folder: 'スキャンするフォルダを選択してください',
        scanning: 'フォルダーをスキャン中...',
        files_found: '{count} 個のファイルが見つかりました',
        error: 'スキャン中にエラーが発生しました',
      },
    },
  },
};

const ALIASES = {
  app: {
    name: 'title',
    version: 'msg_latest_version',
  },
  tabs: {
    folder: 'tab_folders',
    organizer: 'tab1',
    renamer: 'tab2',
    metadata: 'tab3',
    sharing: 'tab_sharing',
    releases: 'tab_releases',
  },
  common: {
    start: 'run_btn',
    stop: 'cancel_btn',
    cancel: 'btn_cancel',
    save: 'btn_save',
    close: 'btn_close',
    select: 'btn_select',
    delete: 'remove_sel',
    settings: 'settings_btn',
    confirm: 'btn_ok',
    ok: 'btn_ok',
    warning: 'dlg_warn',
    error: 'dlg_err',
    success: 'msg_success',
    info: 'msg_notice',
  },
  settings: {
    title: 'settings_title',
    general: 'tab_basic',
    language: 'lang_lbl',
    threads: 'max_threads',
    processing: 'tab_folder_settings',
    quality: 'common_quality',
    output_format: 'format_lbl',
    server: 'tab_sharing',
    port: 'tab_sharing_port',
    auto_start_server: 'tab_sharing_turn_on',
    sound: 'sound_lbl',
    enable_sound: 'play_sound',
    sound_file: 'sound_lbl',
  },
  organizer: {
    expand_all: 'menu_toggle_order',
    batch_default: 'batch_default',
    batch_title: 'batch_title',
    drag_drop: 'drag_drop',
    col_name: 'col_org_name',
    col_path: 'col_org_path',
    col_count: 'col_org_count',
    col_size: 'col_org_size',
    total_files: 'total_files',
  },
  renamer: {
    cover_preview: 'cover_preview',
    inner_preview: 'inner_preview',
  },
  metadata: {
    cover: 't3_cover',
  },
  folder: {
    toolbar: {
      group_by: 'folder_grouped',
      sort_by: 'folder_sorted',
      no_group: 'menu_none',
      group_by_type: 'menu_folder',
      view_detail: 'menu_detail',
      view_thumbnail: 'menu_thumbnail',
      view_tile: 'menu_tile',
      include_subfolders: 'folder_inc_sub_on',
      dup_check: 'folder_dup_check_on',
      refresh: 'folder_refresh_list',
      search: 'folder_search_ph',
      filter: 'folder_filter',
      layouts: 'folder_layouts',
      export_csv: 'folder_export_csv',
    },
    sidebar: {
      libraries: 'nav_library',
      favorites: 'nav_favorites',
      folders: 'tab_folders',
      add_library: 'grp_dup_folders_title',
      remove_library: 'action_del_folder',
      add_favorite: 'action_fav_add',
      remove_favorite: 'action_fav_rem',
      empty_libraries: 'folder_sidebar_empty_libraries',
      empty_favorites: 'folder_sidebar_empty_favorites',
    },
    columns: {
      cover: 'col_cover',
      name: 'col_name',
      size: 'col_size',
      resolution: 'col_res',
      modified: 'col_mtime',
      created: 'col_ctime',
      path: 'col_path',
      ext: 'col_ext',
      series: 'col_series',
      title: 'col_title',
      volume: 'col_vol',
      issue: 'col_num',
      chapter: 'col_num',
      writer: 'col_writer',
      author: 'col_writer',
      series_group: 'col_series_group',
      producer: 'col_creators',
      publisher: 'col_publisher',
      imprint: 'col_imprint',
      genre: 'col_genre',
      total_volume: 'col_vol_count',
      page_count: 'col_page_count',
      format: 'col_format',
    },
    status: {
      no_folder: 'folder_ready',
      scanning: 'folder_scan_prep',
      scanning_progress: 'folder_scanning',
      files_found: 'folder_status_sel',
      error: 'dlg_err_occurred',
      no_files: 'tf_empty_no_data',
      empty_folder: 'tf_empty_no_data',
    },
    detail: {
      metadata: 'tab3',
      no_selection: 't3_msg_sel',
    },
    message: {
      noFiles: 'tf_empty_no_data',
    },
  },
};

let currentLanguage = 'ko';

function normalizeLanguage(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'ko';
}

function getByPath(source, key) {
  return key.split('.').reduce((value, part) => {
    if (value && typeof value === 'object' && part in value) return value[part];
    return undefined;
  }, source);
}

function getAliasValue(lang, key) {
  const aliasKey = getByPath(ALIASES, key);
  if (!aliasKey) return undefined;
  return legacyTranslations[lang]?.[aliasKey] ?? legacyTranslations.ko?.[aliasKey];
}

export function getTranslations(lang = currentLanguage) {
  return legacyTranslations[normalizeLanguage(lang)] || legacyTranslations.ko;
}

export function setLanguage(lang) {
  currentLanguage = normalizeLanguage(lang);
  return currentLanguage;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function formatTranslation(template, values = []) {
  if (typeof template !== 'string') return template;
  if (Array.isArray(values)) {
    return values.reduce((text, value, index) => {
      const indexed = text.replaceAll(`{${index}}`, String(value));
      if (indexed !== text) return indexed;
      if (!indexed.includes('{}')) return indexed;
      return indexed.replace('{}', String(value));
    }, template);
  }
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function translate(key, lang = currentLanguage, values) {
  const safeLang = normalizeLanguage(lang);
  const extraValue = getByPath(EXTRA_TRANSLATIONS[safeLang], key) ?? getByPath(EXTRA_TRANSLATIONS.ko, key);
  if (extraValue !== undefined) return values === undefined ? extraValue : formatTranslation(extraValue, values);
  const directValue = legacyTranslations[safeLang]?.[key] ?? legacyTranslations.ko?.[key];
  const nestedValue = getByPath(legacyTranslations[safeLang], key) ?? getByPath(legacyTranslations.ko, key);
  const aliasValue = getAliasValue(safeLang, key);
  const value = directValue ?? nestedValue ?? aliasValue;
  if (value === undefined) return key;
  return values === undefined ? value : formatTranslation(value, values);
}

export function translateKnownText(text, lang = currentLanguage) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const safeLang = normalizeLanguage(lang);
  for (const translations of Object.values(legacyTranslations)) {
    for (const [key, value] of Object.entries(translations)) {
      if (typeof value === 'string' && value === text) {
        return translate(key, safeLang);
      }
    }
  }
  return text;
}

export { legacyTranslations };
