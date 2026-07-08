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
        const pathValue = typeof value === 'string' ? value : value?.path;
        const path = String(pathValue || '').trim();
        if (!path) continue;
        const key = libraryPathKey(path);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(path);
    }
    return result;
}

export function libraryPathKey(value = '') {
    return String(value || '').trim().replace(/[\\/]+$/, '').toLowerCase();
}

function libraryEntryFromValue(value) {
    const pathValue = typeof value === 'string' ? value : value?.path;
    const entryPath = String(pathValue || '').trim();
    if (!entryPath) return null;
    return {
        path: entryPath,
        alias: typeof value === 'string' ? '' : String(value?.alias || '').trim(),
        group: typeof value === 'string' ? '' : String(value?.group || '').trim(),
    };
}

function collectLibraryEntryMeta(values = []) {
    const metadata = new Map();
    for (const value of Array.isArray(values) ? values : []) {
        const entry = libraryEntryFromValue(value);
        if (!entry) continue;
        const key = libraryPathKey(entry.path);
        const previous = metadata.get(key) || { path: entry.path, alias: '', group: '' };
        metadata.set(key, {
            path: previous.path || entry.path,
            alias: previous.alias || entry.alias,
            group: previous.group || entry.group,
        });
    }
    return metadata;
}

export function normalizeLibraryEntries(config = {}) {
    const source = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const pathValues = [
        ...(source.libraries || []),
        ...(source.dup_check_folders || []),
    ];
    const metadataValues = [
        ...(source.library_entries || []),
        ...pathValues,
    ];
    const metadata = collectLibraryEntryMeta(metadataValues);
    const paths = uniquePaths(pathValues);
    const orderedPaths = paths.length > 0
        ? paths
        : uniquePaths(source.library_entries || []);

    return orderedPaths.map(entryPath => {
        const meta = metadata.get(libraryPathKey(entryPath));
        return {
            path: entryPath,
            alias: meta?.alias || '',
            group: meta?.group || '',
        };
    });
}

export function syncLibraryConfig(config = {}, entries = []) {
    const normalizedEntries = normalizeLibraryEntries({
        library_entries: entries,
        libraries: entries,
    });
    const libraries = normalizedEntries.map(entry => entry.path);
    return {
        ...config,
        library_entries: normalizedEntries,
        libraries,
        dup_check_folders: libraries,
    };
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
    const libraryEntries = normalizeLibraryEntries(config);
    const libraries = libraryEntries.map(entry => entry.path);
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
        tts_openai_key: String(apiKeys.tts_openai_key || '').trim(),
        tts_google_key: String(apiKeys.tts_google_key || '').trim(),
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
        library_entries: libraryEntries,
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
    const libraryPathSetSignature = config => uniquePaths(config?.libraries || [], config?.dup_check_folders || [])
        .map(libraryPathKey)
        .sort()
        .join('\n');

    return {
        resetTaskTabs: taskResetKeys.some(changed),
        restartRecommended: false,
        librariesChanged: libraryPathSetSignature(previous) !== libraryPathSetSignature(next),
    };
}
