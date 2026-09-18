import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreFolderConfigPaths } from './folderConfigPaths.js';

const nfc = '/Volumes/NAS/_소설/TEXT';
const nfd = nfc.normalize('NFD');
const directory = { isDirectory: () => true };
const failure = code => Object.assign(new Error(code), { code });

test('기존 NFC 라이브러리와 탐색 경로를 실제 존재하는 NFD 경로로 함께 복구한다', async () => {
    const config = {
        libraries: [nfc],
        dup_check_folders: [nfc],
        library_entries: [{ path: nfc, alias: '소설', group: '도서' }],
        favorites: [nfc, { path: nfc, name: '즐겨찾기' }],
        folder_favorites: [nfc],
        folder_last_path: nfc,
        last_folder_path: nfc,
        last_selected_folder_path: nfc,
        last_selected_library: nfc,
        folder_goto_history: [nfc, '/books'],
        index_last_mtimes: { [nfc]: 'fingerprint', '/books': 'other' },
        custom_setting: { keep: true },
    };
    const checked = [];
    const restored = await restoreFolderConfigPaths(config, {
        platform: 'darwin',
        stat: async value => {
            checked.push(value);
            if (value === nfd) return directory;
            throw failure('ENOENT');
        },
    });
    assert.deepEqual(checked, [nfc, nfd]);
    assert.deepEqual(restored.libraries, [nfd]);
    assert.deepEqual(restored.dup_check_folders, [nfd]);
    assert.deepEqual(restored.library_entries, [{ path: nfd, alias: '소설', group: '도서' }]);
    assert.deepEqual(restored.favorites, [nfd, { path: nfd, name: '즐겨찾기' }]);
    assert.deepEqual(restored.folder_favorites, [nfd]);
    for (const key of ['folder_last_path', 'last_folder_path', 'last_selected_folder_path', 'last_selected_library']) {
        assert.equal(restored[key], nfd);
        assert.equal(config[key], nfc);
    }
    assert.deepEqual(restored.folder_goto_history, [nfd, '/books']);
    assert.equal(restored.index_last_mtimes, config.index_last_mtimes);
    assert.equal(restored.index_last_mtimes[nfd], undefined);
    assert.equal(restored.custom_setting, config.custom_setting);
    assert.deepEqual(config.libraries, [nfc]);
});

test('정상 NFC·NFD·혼합 경로는 대체 경로를 조회하거나 변환하지 않는다', async () => {
    for (const original of [nfc, nfd, `${nfd}/한글`]) {
        const config = { libraries: [original] };
        const checked = [];
        assert.equal(await restoreFolderConfigPaths(config, {
            platform: 'darwin',
            stat: async value => { checked.push(value); return directory; },
        }), config);
        assert.deepEqual(checked, [original]);
    }
});

test('NFD 경로가 없고 NFC 경로만 존재하는 볼륨도 지원한다', async () => {
    const restored = await restoreFolderConfigPaths({ libraries: [nfd] }, {
        platform: 'darwin',
        stat: async value => {
            if (value === nfc) return directory;
            throw failure('ENOENT');
        },
    });
    assert.deepEqual(restored.libraries, [nfc]);
});

test('삭제·연결 해제·권한 오류 또는 디렉토리가 아닌 경로는 설정에서 제거하거나 대체하지 않는다', async () => {
    for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ENOTDIR', 'file']) {
        const config = { libraries: [nfc] };
        const checked = [];
        assert.equal(await restoreFolderConfigPaths(config, {
            platform: 'darwin',
            stat: async value => {
                checked.push(value);
                if (code === 'file') return { isDirectory: () => false };
                throw failure(code);
            },
        }), config);
        assert.deepEqual(checked, code === 'ENOENT' ? [nfc, nfd] : [nfc]);
    }
});

test('macOS 이외의 플랫폼과 ASCII 경로는 파일 시스템을 조회하지 않는다', async () => {
    for (const [platform, folderPath] of [['win32', nfc], ['linux', nfc], ['darwin', '/Volumes/NAS/Books']]) {
        const config = { libraries: [folderPath] };
        assert.equal(await restoreFolderConfigPaths(config, {
            platform,
            stat: async () => assert.fail('Unexpected filesystem access'),
        }), config);
    }
});

test('느린 NAS 응답은 시작을 무한정 막거나 제한 시간 후 설정을 바꾸지 않는다', async () => {
    const config = { libraries: [nfc] };
    const checked = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const restored = await restoreFolderConfigPaths(config, {
        platform: 'darwin',
        timeoutMs: 10,
        stat: async value => { checked.push(value); await pending; throw failure('ENOENT'); },
    });
    assert.equal(restored, config);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(checked, [nfc]);
    assert.deepEqual(config.libraries, [nfc]);
});
