const FORMAT_KEYS = new Set(['none', 'zip', 'cbz', 'cbr', '7z']);
const LANGUAGE_KEYS = new Set(['ko', 'en', 'ja']);
const AI_PROVIDERS = new Set(['Gemini', 'OpenAI']);

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

export function normalizeSettingsConfig(config = {}, coreCount = 4) {
    const lang = LANGUAGE_KEYS.has(config.language)
        ? config.language
        : LANGUAGE_KEYS.has(config.lang) ? config.lang : 'ko';
    const libraries = uniquePaths(config.libraries || [], config.dup_check_folders || []);
    const threadMax = safeThreadLimit(coreCount);
    const apiKeys = config.api_keys || {};

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
        max_threads: Math.min(threadMax, Math.max(1, Number(config.max_threads) || Math.floor(coreCount / 2) || 1)),
        play_sound: config.play_sound !== false,
        pass_skip_meta: Boolean(config.pass_skip_meta),
        completion_sound: String(config.completion_sound || 'Default.wav'),
        viewer_path: String(config.viewer_path || '').trim(),
        font_family: String(config.font_family || 'Default'),
        font_scale: Math.min(155, Math.max(80, Number(config.font_scale) || 100)),
        libraries,
        dup_check_folders: libraries,
        api_keys: {
            ...apiKeys,
            aladin: String(apiKeys.aladin || '').trim(),
            vine: String(apiKeys.vine || '').trim(),
            google: String(apiKeys.google || '').trim(),
            ai_trans_enabled: Boolean(apiKeys.ai_trans_enabled),
            ai_provider: AI_PROVIDERS.has(apiKeys.ai_provider) ? apiKeys.ai_provider : 'Gemini',
            ai_key: String(apiKeys.ai_key || '').trim(),
            tag_rules: String(apiKeys.tag_rules || ''),
        },
    };
}

export function settingsEffects(previous = {}, next = {}) {
    const taskResetKeys = ['target_format', 'webp_conversion', 'img_quality'];
    const restartKeys = ['lang', 'language', 'font_family', 'font_scale'];
    const changed = key => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]);

    return {
        resetTaskTabs: taskResetKeys.some(changed),
        restartRecommended: restartKeys.some(changed),
        librariesChanged: JSON.stringify(uniquePaths(previous.libraries || [], previous.dup_check_folders || []))
            !== JSON.stringify(uniquePaths(next.libraries || [], next.dup_check_folders || [])),
    };
}
