import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { libraryReadingStorageScopeKey } from './libraryReadingStorage.js';
import { normalizeLibraryEntries } from './settingsPolicy.js';

function sourceBetween(file, start, end) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert.ok(startIndex >= 0 && endIndex > startIndex);
    return source.slice(startIndex, endIndex);
}

function memoHooks() {
    const slots = [];
    let cursor = 0;
    const useMemo = (callback, dependencies) => {
        const index = cursor++;
        const previous = slots[index];
        if (!previous || dependencies.some((value, key) => !Object.is(value, previous.dependencies[key]))) {
            slots[index] = { dependencies, value: callback() };
        }
        return slots[index].value;
    };
    return { begin() { cursor = 0; }, useMemo, useEffect: useMemo };
}

test('대메뉴 설정 저장은 로컬 읽기 기록을 다시 순회하지 않고 실제 범위 변경과 정리 허용 전환만 반영한다', () => {
    const hooks = memoHooks();
    const prunedScopes = [];
    const renderEffect = new Function('config', 'useEffect', 'window', 'libraryReadingStorageScopeKey', 'pruneLibraryReadingStorage', sourceBetween(
        './App.jsx', 'const readingStorageScopeKey =', '  useEffect(() => {\n    const listBundledFonts',
    ));
    const render = config => {
        hooks.begin();
        renderEffect(config, hooks.useEffect, { localStorage: {} }, libraryReadingStorageScopeKey, (_storage, roots) => prunedScopes.push(roots));
    };
    render(null);
    render({ libraries: ['/책장'], library_data_prune_pending: true });
    assert.equal(prunedScopes.length, 0);
    render({ libraries: ['/책장'] });
    assert.deepEqual(prunedScopes, [['/책장']]);
    for (const tab of ['tools', 'folder', 'releases']) {
        render(JSON.parse(JSON.stringify({ libraries: ['/책장'], last_tab_id: tab })));
    }
    render({ libraries: ['/책장/'.normalize('NFD'), '/책장'] });
    assert.equal(prunedScopes.length, 1);
    render({ libraries: ['/다른책장', '/책장'] });
    assert.equal(prunedScopes.length, 2);
    render({ libraries: ['/책장', '/다른책장'] });
    assert.equal(prunedScopes.length, 2);
    render({ libraries: ['/책장', '/다른책장'], library_data_prune_pending: true });
    assert.equal(prunedScopes.length, 2);
    render({ libraries: ['/책장', '/다른책장'], library_data_prune_pending: false });
    assert.equal(prunedScopes.length, 3);
    render({ libraries: [] });
    assert.deepEqual(prunedScopes.at(-1), []);
});

test('설정 객체가 복제되어도 라이브러리 조회 의존성을 유지하고 별칭·그룹·순서 변경을 반영한다', () => {
    const hooks = memoHooks();
    const renderEntries = new Function('config', 'useMemo', 'normalizeLibraryEntries', `${sourceBetween(
        './tabs/FolderTab.jsx', 'const libraryEntriesKey =', '    const readingLibraryPathsRef =',
    )}\nreturn { libraryEntries, libraries };`);
    const render = config => {
        hooks.begin();
        return renderEntries(config, hooks.useMemo, normalizeLibraryEntries);
    };
    const config = {
        libraries: ['/books', '/audio'],
        library_entries: [{ path: '/books', alias: 'Books', group: 'Local' }, { path: '/audio', alias: 'Audio', group: 'Local' }],
    };
    const initial = render(config);
    const updated = render({ ...JSON.parse(JSON.stringify(config)), last_tab_id: 'tools' });
    assert.equal(updated.libraryEntries, initial.libraryEntries);
    assert.equal(updated.libraries, initial.libraries);
    const renamedConfig = { ...config, library_entries: [{ path: '/books', alias: 'Reading', group: 'Favorites' }, config.library_entries[1]] };
    const renamed = render(renamedConfig);
    assert.equal(renamed.libraryEntries[0].alias, 'Reading');
    assert.equal(renamed.libraryEntries[0].group, 'Favorites');
    assert.equal(renamed.libraries, initial.libraries);
    const reordered = render({ ...renamedConfig, libraries: ['/audio', '/books'] });
    assert.deepEqual(reordered.libraries, ['/audio', '/books']);
    assert.notEqual(reordered.libraries, initial.libraries);
    const removed = render({ libraries: ['/audio'], library_entries: [config.library_entries[1]] });
    assert.deepEqual(removed.libraries, ['/audio']);
    assert.equal(removed.libraryEntries[0].alias, 'Audio');
});
