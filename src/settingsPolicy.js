import { normalizeMetadataApiSourceForBookType } from './metadataApiPolicy.js';

const FORMAT_KEYS = new Set(['none', 'zip', 'cbz', 'cbr', '7z']);
const LANGUAGE_KEYS = new Set(['ko', 'en', 'ja']);
const AI_PROVIDERS = new Set(['Gemini', 'OpenAI']);
const RENAMER_ARCHIVE_COMPRESSION_KEYS = new Set(['auto', 'fast', 'maximum']);
const VIEWER_PROGRAM_TYPES = ['comic', 'epub', 'pdf', 'text'];

export function safeThreadLimit(coreCount = 4) {
    const cores = Math.max(1, Number(coreCount) || 4);
    return cores <= 4 ? Math.max(1, cores - 1) : Math.max(1, cores - 2);
}

export function uniquePaths(...groups) {
    const seen = new Set();
    const result = [];
    for (const value of groups.flat()) {
        const path = String(value || '').trim();
        if (!path) continue;
        const key = path.replace(/[\\/]+$/, '').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(path);
    }
    return result;
}

export function normalizeViewerPaths(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return VIEWER_PROGRAM_TYPES.reduce((result, type) => {
        result[type] = String(source[type] || '').trim();
        return result;
    }, {});
}

export function normalizeSettingsConfig(config = {}, coreCount = 4) {
    const lang = LANGUAGE_KEYS.has(config.language)
        ? config.language
        : LANGUAGE_KEYS.has(config.lang) ? config.lang : 'ko';
    const libraries = uniquePaths(config.libraries || [], config.dup_check_folders || []);
    const threadMax = safeThreadLimit(coreCount);
    const apiKeys = config.api_keys || {};
    const normalizedApiKeys = {
        ...apiKeys,
        aladin: String(apiKeys.aladin || '').trim(),
        vine: String(apiKeys.vine || '').trim(),
        google: String(apiKeys.google || '').trim(),
        ai_trans_enabled: Boolean(apiKeys.ai_trans_enabled),
        ai_provider: AI_PROVIDERS.has(apiKeys.ai_provider) ? apiKeys.ai_provider : 'Gemini',
        ai_key: String(apiKeys.ai_key || '').trim(),
        tag_rules: String(apiKeys.tag_rules || ''),
    };
    const preferredComicApi = normalizeMetadataApiSourceForBookType(
        config.preferred_meta_api_comic || config.last_meta_api || '',
        'comic',
        normalizedApiKeys,
    );
    const preferredBookApi = normalizeMetadataApiSourceForBookType(
        config.preferred_meta_api_book || config.last_meta_api || '',
        'book',
        normalizedApiKeys,
    );
    const preferredPdfApi = normalizeMetadataApiSourceForBookType(
        config.preferred_meta_api_pdf || config.last_meta_api || '',
        'pdf',
        normalizedApiKeys,
    );

    const fontFamily = String(config.font_family || 'Noto Sans KR');

    return {
        ...config,
        lang,
        language: lang,
        target_format: FORMAT_KEYS.has(config.target_format) ? config.target_format : 'none',
        backup_on: Boolean(config.backup_on ?? config.backup),
        backup: Boolean(config.backup_on ?? config.backup),
        flatten_folders: Boolean(config.flatten_folders ?? config.flatten),
        flatten: Boolean(config.flatten_folders ?? config.flatten),
        webp_conversion: Boolean(config.webp_conversion ?? config.convert_webp),
        convert_webp: Boolean(config.webp_conversion ?? config.convert_webp),
        img_quality: Math.min(100, Math.max(1, Number(config.img_quality) || 100)),
        renamer_archive_compression: RENAMER_ARCHIVE_COMPRESSION_KEYS.has(config.renamer_archive_compression)
            ? config.renamer_archive_compression
            : 'auto',
        max_threads: Math.min(threadMax, Math.max(1, Number(config.max_threads) || Math.floor(coreCount / 2) || 1)),
        play_sound: config.play_sound !== false,
        pass_skip_meta: Boolean(config.pass_skip_meta),
        completion_sound: String(config.completion_sound || 'Default.wav'),
        viewer_path: String(config.viewer_path || '').trim(),
        viewer_paths: normalizeViewerPaths(config.viewer_paths),
        font_family: fontFamily === 'Default' ? 'Noto Sans KR' : fontFamily,
        font_scale: Math.min(155, Math.max(80, Number(config.font_scale) || 100)),
        libraries,
        dup_check_folders: libraries,
        preferred_meta_api_comic: preferredComicApi,
        preferred_meta_api_book: preferredBookApi,
        preferred_meta_api_pdf: preferredPdfApi,
        last_meta_api: String(config.last_meta_api || preferredComicApi || preferredBookApi || '').trim(),
        api_keys: normalizedApiKeys,
    };
}

export function settingsEffects(previous = {}, next = {}) {
    const taskResetKeys = ['target_format', 'webp_conversion', 'img_quality'];
    const changed = key => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]);

    return {
        resetTaskTabs: taskResetKeys.some(changed),
        restartRecommended: false,
        librariesChanged: JSON.stringify(uniquePaths(previous.libraries || [], previous.dup_check_folders || []))
            !== JSON.stringify(uniquePaths(next.libraries || [], next.dup_check_folders || [])),
    };
}
