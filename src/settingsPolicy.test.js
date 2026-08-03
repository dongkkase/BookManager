import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeLibraryEntries,
    normalizeSettingsConfig,
    safeThreadLimit,
    settingsEffects,
    syncLibraryConfig,
    uniquePaths,
} from './settingsPolicy.js';

test('settings normalization preserves legacy aliases and bounds values', () => {
    const normalized = normalizeSettingsConfig({
        lang: 'ja',
        backup: true,
        flatten: true,
        convert_webp: true,
        img_quality: 120,
        renamer_archive_compression: 'maximum',
        max_threads: 99,
        font_scale: 77,
        viewer_path: ' C:/Tools/viewer.exe ',
        viewer_paths: {
            comic: ' C:/Tools/comic.exe ',
            epub: ' C:/Tools/epub.exe ',
            pdf: ' C:/Tools/pdf.exe ',
            unknown: 'ignored',
        },
        dup_check_folders: ['/Books'],
        last_meta_api: 'Google Books',
        preferred_meta_api_comic: 'Vine',
        preferred_meta_api_book: 'Amazon',
        preferred_meta_api_pdf: 'Google Books',
        api_keys: {
            custom_provider: 'keep-me',
            tts_openai_key: ' sk-openai ',
            tts_google_key: ' google-tts ',
        },
    }, 8);

    assert.equal(normalized.language, 'ja');
    assert.equal(normalized.backup_on, true);
    assert.equal(normalized.flatten_folders, true);
    assert.equal(normalized.webp_conversion, true);
    assert.equal(normalized.img_quality, 100);
    assert.equal(normalized.renamer_archive_compression, 'maximum');
    assert.equal(normalized.max_threads, 6);
    assert.equal(normalized.font_family, 'Noto Sans KR');
    assert.equal(normalized.font_scale, 80);
    assert.equal(normalized.viewer_path, 'C:/Tools/viewer.exe');
    assert.deepEqual(normalized.viewer_paths, {
        comic: 'C:/Tools/comic.exe',
        epub: 'C:/Tools/epub.exe',
        pdf: 'C:/Tools/pdf.exe',
        text: '',
    });
    assert.deepEqual(normalized.libraries, ['/Books']);
    assert.deepEqual(normalized.library_entries, [{ path: '/Books', alias: '', group: '' }]);
    assert.equal(normalized.preferred_meta_api_comic, 'Vine');
    assert.equal(normalized.preferred_meta_api_book, 'Amazon');
    assert.equal(normalized.preferred_meta_api_pdf, 'Google Books');
    assert.equal(normalized.last_meta_api, 'Google Books');
    assert.equal(normalized.api_keys.custom_provider, 'keep-me');
    assert.equal(normalized.api_keys.tts_openai_key, 'sk-openai');
    assert.equal(normalized.api_keys.tts_google_key, 'google-tts');
});

test('AI 표지 검색 키는 제공자별로 저장하고 기존 ai_key를 선택된 제공자 키로 이전한다', () => {
    const migrated = normalizeSettingsConfig({
        api_keys: {
            ai_provider: 'OpenAI',
            ai_key: ' sk-legacy ',
        },
    });
    assert.equal(migrated.api_keys.ai_openai_key, 'sk-legacy');
    assert.equal(migrated.api_keys.ai_gemini_key, '');
    assert.equal(migrated.api_keys.ai_key, 'sk-legacy');

    const separated = normalizeSettingsConfig({
        api_keys: {
            ai_provider: 'Gemini',
            ai_key: 'legacy-ignored',
            ai_gemini_key: ' AIza-gemini ',
            ai_openai_key: ' sk-openai ',
        },
    });
    assert.equal(separated.api_keys.ai_gemini_key, 'AIza-gemini');
    assert.equal(separated.api_keys.ai_openai_key, 'sk-openai');
    assert.equal(separated.api_keys.ai_key, 'AIza-gemini');

    const switchedWithoutOpenAiKey = normalizeSettingsConfig({
        api_keys: {
            ai_provider: 'OpenAI',
            ai_key: 'AIza-legacy-active-key',
            ai_gemini_key: 'AIza-gemini',
            ai_openai_key: '',
        },
    });
    assert.equal(switchedWithoutOpenAiKey.api_keys.ai_gemini_key, 'AIza-gemini');
    assert.equal(switchedWithoutOpenAiKey.api_keys.ai_openai_key, '');
    assert.equal(switchedWithoutOpenAiKey.api_keys.ai_key, '');
});

test('library entries preserve alias, group, and display order while syncing path arrays', () => {
    const normalized = normalizeSettingsConfig({
        library_entries: [
            { path: '/Comics', alias: 'Comics NAS', group: 'NAS' },
            { path: '/Books', alias: 'Bookshelf', group: 'Local' },
        ],
    });

    assert.deepEqual(normalized.libraries, ['/Comics', '/Books']);
    assert.deepEqual(normalized.dup_check_folders, normalized.libraries);
    assert.deepEqual(normalized.library_entries, [
        { path: '/Comics', alias: 'Comics NAS', group: 'NAS' },
        { path: '/Books', alias: 'Bookshelf', group: 'Local' },
    ]);
});

test('legacy path updates keep matching library metadata and remove stale entries', () => {
    const synced = syncLibraryConfig({
        library_entries: [
            { path: '/A', alias: 'Alpha', group: 'G1' },
            { path: '/B', alias: 'Beta', group: 'G2' },
        ],
    }, [
        { path: '/B', alias: 'Beta', group: 'G2' },
        { path: '/C', alias: '', group: '' },
    ]);

    assert.deepEqual(synced.libraries, ['/B', '/C']);
    assert.deepEqual(normalizeLibraryEntries(synced), [
        { path: '/B', alias: 'Beta', group: 'G2' },
        { path: '/C', alias: '', group: '' },
    ]);
});

test('preferred metadata API settings inherit legacy last API where valid', () => {
    const normalized = normalizeSettingsConfig({ last_meta_api: 'Google Books' });

    assert.equal(normalized.preferred_meta_api_comic, 'Google Books');
    assert.equal(normalized.preferred_meta_api_book, 'Google Books');
    assert.equal(normalized.preferred_meta_api_pdf, 'Google Books');
});

test('Default 글꼴 설정은 Noto Sans KR 기본값으로 정규화한다', () => {
    assert.equal(normalizeSettingsConfig({ font_family: 'Default' }).font_family, 'Noto Sans KR');
    assert.equal(normalizeSettingsConfig({ font_family: 'Jua' }).font_family, 'Jua');
});

test('renamer archive compression setting accepts only supported modes', () => {
    assert.equal(normalizeSettingsConfig({ renamer_archive_compression: 'fast' }).renamer_archive_compression, 'fast');
    assert.equal(normalizeSettingsConfig({ renamer_archive_compression: 'maximum' }).renamer_archive_compression, 'maximum');
    assert.equal(normalizeSettingsConfig({ renamer_archive_compression: 'unknown' }).renamer_archive_compression, 'auto');
});

test('folder paths are deduplicated without changing first occurrence order', () => {
    assert.deepEqual(uniquePaths(['/Books/', '/Comics'], ['/books', '/Manga']), [
        '/Books/',
        '/Comics',
        '/Manga',
    ]);
});

test('safe thread limit follows the original CPU rule', () => {
    assert.equal(safeThreadLimit(4), 3);
    assert.equal(safeThreadLimit(8), 6);
});

test('settings side effects identify task reset and library changes without restart prompts', () => {
    assert.deepEqual(settingsEffects(
        { target_format: 'none', lang: 'ko', libraries: ['/A'] },
        { target_format: 'cbz', lang: 'en', libraries: ['/B'] },
    ), {
        resetTaskTabs: true,
        restartRecommended: false,
        librariesChanged: true,
    });
    assert.equal(settingsEffects({ lang: 'en' }, { language: 'en' }).restartRecommended, false);
    assert.equal(settingsEffects({ lang: 'ko' }, { language: 'en' }).restartRecommended, false);
    assert.equal(settingsEffects({ font_family: 'Default' }, { font_family: 'Jua' }).restartRecommended, false);
    assert.equal(settingsEffects({ font_scale: 100 }, { font_scale: 125 }).restartRecommended, false);
    assert.equal(settingsEffects(
        { libraries: ['/A', '/B'] },
        { libraries: ['/B', '/A'], library_entries: [{ path: '/B', alias: 'Beta' }, { path: '/A', alias: 'Alpha' }] },
    ).librariesChanged, false);
});
