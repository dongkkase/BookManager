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
        max_threads: 99,
        font_scale: 77,
        dup_check_folders: ['/Books'],
        api_keys: { custom_provider: 'keep-me' },
    }, 8);

    assert.equal(normalized.language, 'ja');
    assert.equal(normalized.backup_on, true);
    assert.equal(normalized.flatten_folders, true);
    assert.equal(normalized.webp_conversion, true);
    assert.equal(normalized.img_quality, 100);
    assert.equal(normalized.max_threads, 6);
    assert.equal(normalized.font_scale, 80);
    assert.deepEqual(normalized.libraries, ['/Books']);
    assert.equal(normalized.api_keys.custom_provider, 'keep-me');
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

test('settings side effects identify task reset, restart, and library changes', () => {
    assert.deepEqual(settingsEffects(
        { target_format: 'none', lang: 'ko', libraries: ['/A'] },
        { target_format: 'cbz', lang: 'en', libraries: ['/B'] },
    ), {
        resetTaskTabs: true,
        restartRecommended: true,
        librariesChanged: true,
    });
});
