import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeSettingsConfig,
    safeThreadLimit,
    settingsEffects,
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
        dup_check_folders: ['/Books'],
        last_meta_api: 'Google Books',
        preferred_meta_api_comic: 'Vine',
        preferred_meta_api_book: 'Amazon',
        api_keys: { custom_provider: 'keep-me' },
    }, 8);

    assert.equal(normalized.language, 'ja');
    assert.equal(normalized.backup_on, true);
    assert.equal(normalized.flatten_folders, true);
    assert.equal(normalized.webp_conversion, true);
    assert.equal(normalized.img_quality, 100);
    assert.equal(normalized.renamer_archive_compression, 'maximum');
    assert.equal(normalized.max_threads, 6);
    assert.equal(normalized.font_scale, 80);
    assert.deepEqual(normalized.libraries, ['/Books']);
    assert.equal(normalized.preferred_meta_api_comic, 'Vine');
    assert.equal(normalized.preferred_meta_api_book, 'Amazon');
    assert.equal(normalized.last_meta_api, 'Google Books');
    assert.equal(normalized.api_keys.custom_provider, 'keep-me');
});

test('preferred metadata API settings inherit legacy last API where valid', () => {
    const normalized = normalizeSettingsConfig({ last_meta_api: 'Google Books' });

    assert.equal(normalized.preferred_meta_api_comic, 'Google Books');
    assert.equal(normalized.preferred_meta_api_book, 'Google Books');
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
});
