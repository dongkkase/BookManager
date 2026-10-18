import test from 'node:test';
import { normalizeMetadataApiEnabled } from '../electron/metadataProviderSettings.js';
import assert from 'node:assert/strict';
import {
    mergeSettingsDraft,
    normalizeLibraryEntries,
    normalizeSettingsConfig,
    safeThreadLimit,
    settingsConfigsEqual,
    settingsEffects,
    syncLibraryConfig,
    uniquePaths,
} from './settingsPolicy.js';

test('telemetry settings default to enabled and preserve independent opt-outs', () => {
    const defaults = normalizeSettingsConfig();
    assert.equal(defaults.telemetry_error_reports, true);
    assert.equal(defaults.telemetry_usage_stats, true);

    const legacyConfig = normalizeSettingsConfig({ language: 'en', telemetry_error_reports: undefined });
    assert.equal(legacyConfig.telemetry_error_reports, true);
    assert.equal(legacyConfig.telemetry_usage_stats, true);

    for (const value of [null, false, 'true', 'false', 1, {}, []]) {
        const normalized = normalizeSettingsConfig({
            telemetry_error_reports: value,
            telemetry_usage_stats: value,
        });
        assert.equal(normalized.telemetry_error_reports, false);
        assert.equal(normalized.telemetry_usage_stats, false);
    }

    const errorOnly = normalizeSettingsConfig({ telemetry_usage_stats: false });
    assert.equal(errorOnly.telemetry_error_reports, true);
    assert.equal(errorOnly.telemetry_usage_stats, false);
    const usageOnly = normalizeSettingsConfig({ telemetry_error_reports: false });
    assert.equal(usageOnly.telemetry_error_reports, false);
    assert.equal(usageOnly.telemetry_usage_stats, true);
    const optedOut = normalizeSettingsConfig({ telemetry_error_reports: false, telemetry_usage_stats: false });
    assert.equal(normalizeSettingsConfig(optedOut).telemetry_error_reports, false);
    assert.equal(normalizeSettingsConfig(optedOut).telemetry_usage_stats, false);
    assert.equal(settingsEffects(defaults, usageOnly).restartRecommended, false);
});

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

test('YES24 키를 정리하고 책 타입별 기본 검색 API를 유지한다', () => {
    const normalized = normalizeSettingsConfig({
        api_keys: { yes24: '  yk_live_test  ', aladin: 'aladin-key' },
        preferred_meta_api_comic: 'YES24',
        preferred_meta_api_book: 'YES24',
        preferred_meta_api_pdf: 'YES24',
    });
    assert.equal(normalized.api_keys.yes24, 'yk_live_test');
    assert.equal(normalized.api_keys.aladin, 'aladin-key');
    assert.equal(normalized.preferred_meta_api_comic, 'YES24');
    assert.equal(normalized.preferred_meta_api_book, 'YES24');
    assert.equal(normalized.preferred_meta_api_pdf, 'YES24');
    assert.equal(normalizeSettingsConfig().api_keys.yes24, '');
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

test('hardware acceleration defaults to enabled and keeps an explicit opt-out', () => {
    assert.equal(normalizeSettingsConfig({}).hardware_acceleration, true);
    assert.equal(normalizeSettingsConfig({ hardware_acceleration: false }).hardware_acceleration, false);
    assert.equal(normalizeSettingsConfig({ hardware_acceleration: true }).hardware_acceleration, true);
    assert.equal(normalizeSettingsConfig({ hardware_acceleration: 'false' }).hardware_acceleration, true);
});

test('only an effective hardware acceleration change asks for a restart', () => {
    assert.equal(settingsEffects({}, { hardware_acceleration: true }).restartRecommended, false);
    assert.equal(settingsEffects({}, { hardware_acceleration: false }).restartRecommended, true);
    assert.equal(settingsEffects({ hardware_acceleration: true }, { hardware_acceleration: false }).restartRecommended, true);
    assert.equal(settingsEffects({ hardware_acceleration: false }, { hardware_acceleration: true }).restartRecommended, true);
    assert.equal(settingsEffects({ hardware_acceleration: false }, { hardware_acceleration: false }).restartRecommended, false);
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

test('검색 소스별 옵션과 Hardcover 토큰을 정규화하며 오디오북 기본 소스를 이전 설정에서 가져온다', () => {
    const migrated = normalizeSettingsConfig({
        preferred_meta_api_book: 'Kobo',
        api_keys: { hardcover: ' Bearer hc_test ', custom_provider: 'preserved' },
        metadata_providers: { itunes_country: 'jp', kobo_country: 'CA', kobo_language: 'FR', audible_region: 'UK' },
    });
    assert.equal(migrated.preferred_meta_api_audio, 'Kobo');
    assert.equal(migrated.api_keys.hardcover, 'hc_test');
    assert.equal(migrated.api_keys.custom_provider, 'preserved');
    assert.deepEqual(migrated.metadata_providers, {
        itunes_country: 'JP', itunes_cover_resolution: 'high',
        kobo_country: 'ca', kobo_language: 'fr', audible_region: 'uk',
    });
    assert.equal(normalizeSettingsConfig({ ...migrated, preferred_meta_api_audio: 'Audible' }).preferred_meta_api_audio, 'Audible');
    assert.equal(normalizeSettingsConfig({ preferred_meta_api_book: 'Audible' }).preferred_meta_api_book, '리디북스');
});

test('검색 소스 토글은 정규화 후 유지되고 비활성 기본값은 활성 소스로 복구한다', () => {
    const normalized = normalizeSettingsConfig({
        last_meta_api: '리디북스',
        preferred_meta_api_audio: 'Audible',
        metadata_api_enabled: { '리디북스': false, Audible: false, unknown: false },
        api_keys: { hardcover: 'Bearer saved-token' },
        metadata_providers: { audible_region: 'uk' },
    });
    assert.deepEqual(normalized.metadata_api_enabled, normalizeMetadataApiEnabled({ '리디북스': false, Audible: false }));
    for (const type of ['comic', 'book', 'pdf', 'audio']) {
        assert.equal(normalized[`preferred_meta_api_${type}`], '문피아');
    }
    assert.equal(normalized.api_keys.hardcover, 'saved-token');
    assert.equal(normalized.metadata_providers.audible_region, 'uk');
    const disabled = Object.fromEntries(Object.keys(normalized.metadata_api_enabled).map(source => [source, false]));
    const allOff = normalizeSettingsConfig({ ...normalized, metadata_api_enabled: disabled });
    for (const type of ['comic', 'book', 'pdf', 'audio']) {
        assert.equal(allOff[`preferred_meta_api_${type}`], '통합검색');
    }
});

test('settings equality compares normalized defaults and legacy aliases in every supported language', () => {
    for (const language of ['ko', 'en', 'ja']) {
        const legacy = { lang: language, backup: true, flatten: true, convert_webp: true, font_family: 'Default' };
        const current = {
            language,
            backup_on: true,
            flatten_folders: true,
            webp_conversion: true,
            font_family: 'Noto Sans KR',
            hardware_acceleration: true,
            play_sound: true,
        };
        assert.equal(settingsConfigsEqual(legacy, current), true);
        assert.equal(settingsConfigsEqual(current, normalizeSettingsConfig(current)), true);
    }
    assert.equal(settingsConfigsEqual({}, normalizeSettingsConfig()), true);
    assert.equal(settingsConfigsEqual({ max_threads: 99 }, { max_threads: 6 }, 8), true);
    assert.equal(settingsConfigsEqual({ max_threads: 99 }, { max_threads: 3 }, 4), true);
    assert.equal(settingsConfigsEqual({ language: 'ko' }, { language: 'ja' }), false);
});

test('settings equality ignores object key order while retaining nested values and array order', () => {
    assert.equal(settingsConfigsEqual({
        api_keys: { yes24: ' key ', aladin: 'other' },
        extension: { nested: { b: 2, a: 1 }, optional: undefined },
    }, {
        extension: { nested: { a: 1, b: 2 } },
        api_keys: { aladin: 'other', yes24: 'key' },
    }), true);
    assert.equal(settingsConfigsEqual({ extension: { enabled: false } }, { extension: { enabled: true } }), false);
    assert.equal(settingsConfigsEqual({ extension: { optional: null } }, { extension: {} }), false);
    assert.equal(settingsConfigsEqual({ favorites: ['/A', '/B'] }, { favorites: ['/B', '/A'] }), false);
});

test('settings equality detects edits and becomes equal again when the edit is restored', () => {
    const baseline = normalizeSettingsConfig({ api_keys: { google: 'original' }, font_scale: 100 });
    const edited = { ...baseline, api_keys: { ...baseline.api_keys, google: 'changed' }, font_scale: 125 };
    assert.equal(settingsConfigsEqual(baseline, edited), false);
    const restored = { ...edited, api_keys: { ...edited.api_keys, google: ' original ' }, font_scale: 100 };
    assert.equal(settingsConfigsEqual(baseline, restored), true);
    assert.equal(settingsConfigsEqual(baseline, { ...baseline, api_keys: { ...baseline.api_keys, tag_rules: ' ' } }), false);
});

test('settings equality treats library order, aliases, and group changes as settings edits', () => {
    const baseline = syncLibraryConfig({}, [
        { path: '/A', alias: 'Alpha', group: 'NAS' },
        { path: '/B', alias: 'Beta', group: '' },
    ]);
    assert.equal(settingsConfigsEqual(baseline, syncLibraryConfig(baseline, [...baseline.library_entries].reverse())), false);
    assert.equal(settingsConfigsEqual(baseline, syncLibraryConfig(baseline, [
        { ...baseline.library_entries[0], alias: 'Renamed' }, baseline.library_entries[1],
    ])), false);
    assert.equal(settingsConfigsEqual(baseline, syncLibraryConfig(baseline, [
        { ...baseline.library_entries[0], group: 'Local' }, baseline.library_entries[1],
    ])), false);
});

test('an unchanged or restored pending draft adopts the saved configuration and its extra fields', () => {
    const submitted = normalizeSettingsConfig({ language: 'en', api_keys: { google: 'submitted' } });
    const saved = { ...submitted, api_keys: { ...submitted.api_keys, google: 'saved' }, server_revision: 7 };
    const restored = { ...submitted, api_keys: { ...submitted.api_keys, google: ' submitted ' } };
    assert.deepEqual(mergeSettingsDraft(saved, submitted, submitted), normalizeSettingsConfig(saved));
    assert.deepEqual(mergeSettingsDraft(saved, submitted, restored), normalizeSettingsConfig(saved));
    assert.equal(settingsConfigsEqual(saved, mergeSettingsDraft(saved, submitted, restored)), true);
});

test('pending edits preserve only changed nested settings while accepting other saved values', () => {
    const submitted = normalizeSettingsConfig({
        language: 'en',
        api_keys: { google: 'old-google', yes24: 'old-yes24' },
        metadata_providers: { kobo_country: 'us', kobo_language: 'en' },
    });
    const saved = {
        ...submitted,
        language: 'ko',
        api_keys: { ...submitted.api_keys, google: 'server-google', yes24: 'server-yes24', server_key: 'keep' },
        metadata_providers: { ...submitted.metadata_providers, kobo_country: 'ca' },
        server_revision: 2,
    };
    const current = {
        ...submitted,
        language: 'ja',
        api_keys: { ...submitted.api_keys, google: ' next-google ' },
        metadata_providers: { ...submitted.metadata_providers, kobo_language: 'FR' },
    };
    const merged = mergeSettingsDraft(saved, submitted, current);
    assert.equal(merged.language, 'ja');
    assert.equal(merged.lang, 'ja');
    assert.equal(merged.api_keys.google, 'next-google');
    assert.equal(merged.api_keys.yes24, 'server-yes24');
    assert.equal(merged.api_keys.server_key, 'keep');
    assert.equal(merged.metadata_providers.kobo_country, 'ca');
    assert.equal(merged.metadata_providers.kobo_language, 'fr');
    assert.equal(merged.server_revision, 2);
    assert.equal(settingsConfigsEqual(saved, merged), false);
    assert.equal(current.api_keys.google, ' next-google ');
    assert.equal(saved.api_keys.google, 'server-google');
});

test('pending array edits replace arrays as a whole and keep library metadata synchronized', () => {
    const submitted = syncLibraryConfig({ favorites: ['/A', '/B'] }, [
        { path: '/A', alias: 'Alpha', group: 'NAS' },
        { path: '/B', alias: 'Beta', group: 'Local' },
    ]);
    const saved = syncLibraryConfig({ ...submitted, favorites: ['/A', '/B', '/C'] }, [
        { path: '/A', alias: 'Server Alpha', group: 'NAS' },
        { path: '/B', alias: 'Beta', group: 'Local' },
        { path: '/C', alias: 'Server addition', group: '' },
    ]);
    const current = syncLibraryConfig({ ...submitted, favorites: ['/B', '/A'] }, [
        { path: '/B', alias: 'Draft Beta', group: 'Local' },
        { path: '/A', alias: 'Alpha', group: 'NAS' },
    ]);
    const merged = mergeSettingsDraft(saved, submitted, current);
    assert.deepEqual(merged.favorites, ['/B', '/A']);
    assert.deepEqual(merged.libraries, ['/B', '/A']);
    assert.deepEqual(merged.dup_check_folders, merged.libraries);
    assert.deepEqual(merged.library_entries, current.library_entries);
    assert.deepEqual(mergeSettingsDraft(saved, submitted, { ...submitted, font_scale: 125 }).library_entries, saved.library_entries);

    const aliasOnly = syncLibraryConfig(submitted, [
        { ...submitted.library_entries[0], alias: 'Draft Alpha' }, submitted.library_entries[1],
    ]);
    const aliasMerged = mergeSettingsDraft(saved, submitted, aliasOnly);
    assert.deepEqual(aliasMerged.library_entries, aliasOnly.library_entries);
    assert.deepEqual(aliasMerged.libraries, ['/A', '/B']);
    assert.deepEqual(aliasMerged.dup_check_folders, aliasMerged.libraries);
});

test('pending nested additions and removals preserve unrelated values returned by the save', () => {
    const submitted = { extension: { edited: 'old', removed: 'old', untouched: 'old' } };
    const saved = { extension: { edited: 'server', removed: 'server', untouched: 'server', addedByServer: true }, serverOnly: { keep: 1 } };
    const current = { extension: { edited: 'draft', untouched: 'old', addedByUser: true }, clientOnly: { keep: 2 } };
    const merged = mergeSettingsDraft(saved, submitted, current);
    assert.deepEqual(merged.extension, { edited: 'draft', untouched: 'server', addedByServer: true, addedByUser: true });
    assert.deepEqual(merged.serverOnly, { keep: 1 });
    assert.deepEqual(merged.clientOnly, { keep: 2 });
    assert.equal(Object.prototype.hasOwnProperty.call(merged.extension, 'removed'), false);
});

test('pending draft merging keeps normalized aliases and provider keys consistent', () => {
    const submitted = { backup: true, api_keys: { ai_provider: 'Gemini', ai_gemini_key: 'gemini', ai_openai_key: 'openai' } };
    const saved = { ...submitted, api_keys: { ...submitted.api_keys, ai_openai_key: 'saved-openai' } };
    const current = { backup_on: false, api_keys: { ...submitted.api_keys, ai_provider: 'OpenAI' } };
    const merged = mergeSettingsDraft(saved, submitted, current, 8);
    assert.equal(merged.backup_on, false);
    assert.equal(merged.backup, false);
    assert.equal(merged.api_keys.ai_provider, 'OpenAI');
    assert.equal(merged.api_keys.ai_openai_key, 'saved-openai');
    assert.equal(merged.api_keys.ai_key, 'saved-openai');
    assert.equal(merged.max_threads, normalizeSettingsConfig({}, 8).max_threads);
});
