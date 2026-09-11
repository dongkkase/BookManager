import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createPermanentDeleteDialogOptions, deleteFileEntries } from './fileDeletion.js';
import { translate } from '../src/utils/i18n.js';

const tr = (key, values) => translate(key, 'ko', values);
const unavailableTrash = async () => { throw Object.assign(new Error('SMB recycle unavailable'), { code: 'ENOTSUP' }); };

async function fixture(t, names = ['one.txt']) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-file-deletion-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const paths = names.map(name => path.join(directory, name));
    for (const filePath of paths) await fs.writeFile(filePath, `Original ${path.basename(filePath)}`);
    return { directory, paths };
}

test('휴지통 이동이 성공하면 영구 삭제 확인과 rm 없이 완료 경로만 동기화한다', async t => {
    const f = await fixture(t);
    const [filePath] = f.paths;
    const trashedPath = path.join(f.directory, 'trashed-one.txt');
    const synced = [];
    const result = await deleteFileEntries([filePath], {
        trashItem: target => fs.rename(target, trashedPath),
        confirmPermanentDelete: () => assert.fail('Permanent deletion must not be offered.'),
        syncDeletedPaths: entries => synced.push(entries),
        fsApi: { ...fs, rm: () => assert.fail('Permanent deletion must not run.') },
        t: tr,
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, [filePath]);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(synced, [[{ path: filePath, recursive: false }]]);
    assert.equal(await fs.readFile(trashedPath, 'utf8'), 'Original one.txt');
});

test('휴지통 이동 실패 항목만 승인 대상으로 제시하고 승인된 폴더를 영구 삭제한다', async t => {
    const f = await fixture(t);
    const [filePath] = f.paths;
    const folderPath = path.join(f.directory, 'bak');
    await fs.mkdir(folderPath);
    await fs.writeFile(path.join(folderPath, 'backup.cbz'), 'Original backup');
    const confirmed = [];
    const removed = [];
    const synced = [];
    const result = await deleteFileEntries([filePath, folderPath], {
        trashItem: async target => {
            if (target === folderPath) return unavailableTrash();
            await fs.rename(target, path.join(f.directory, 'trashed.txt'));
        },
        confirmPermanentDelete: entries => { confirmed.push(entries); return true; },
        syncDeletedPaths: entries => synced.push(entries),
        fsApi: { ...fs, rm: async (...args) => { removed.push(args); await fs.rm(...args); } },
        t: tr,
    });
    assert.equal(result.success, true);
    assert.deepEqual(confirmed, [[{ path: folderPath, error: 'SMB recycle unavailable' }]]);
    assert.deepEqual(removed, [[folderPath, { recursive: true, force: false }]]);
    assert.deepEqual(result.deleted, [filePath, folderPath]);
    assert.deepEqual(synced, [[{ path: filePath, recursive: false }, { path: folderPath, recursive: true }]]);
    await assert.rejects(fs.lstat(folderPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(f.directory, 'trashed.txt'), 'utf8'), 'Original one.txt');
});

test('영구 삭제 확인을 취소하면 실패 항목을 보존하고 이미 휴지통으로 이동한 항목만 동기화한다', async t => {
    const f = await fixture(t, ['done.txt', 'keep.txt']);
    const [done, keep] = f.paths;
    const synced = [];
    const result = await deleteFileEntries(f.paths, {
        trashItem: async target => {
            if (target === keep) return unavailableTrash();
            await fs.rename(target, path.join(f.directory, 'trashed.txt'));
        },
        confirmPermanentDelete: () => false,
        syncDeletedPaths: entries => synced.push(entries),
        fsApi: { ...fs, rm: () => assert.fail('Cancelled deletion must not run.') },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.cancelledPaths, [keep]);
    assert.deepEqual(result.deleted, [done]);
    assert.deepEqual(synced, [[{ path: done, recursive: false }]]);
    assert.equal(await fs.readFile(keep, 'utf8'), 'Original keep.txt');
});

test('명시적인 true 외의 확인 결과와 확인창 오류는 영구 삭제를 허용하지 않는다', async t => {
    const f = await fixture(t);
    const [filePath] = f.paths;
    for (const decision of ['yes', 1, {}, new Boolean(true), undefined]) {
        const result = await deleteFileEntries([filePath], {
            trashItem: unavailableTrash,
            confirmPermanentDelete: () => decision,
            syncDeletedPaths: () => assert.fail('Unapproved deletion must not be synced.'),
            fsApi: { ...fs, rm: () => assert.fail('An explicit boolean approval is required.') },
            t: tr,
        });
        assert.equal(result.cancelled, true);
        assert.deepEqual(result.deleted, []);
    }
    const result = await deleteFileEntries([filePath], {
        trashItem: unavailableTrash,
        confirmPermanentDelete: () => { throw new Error('Window closed'); },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, []);
    assert.match(result.errors.join('\n'), /Window closed/);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'Original one.txt');
});

test('폴더 심볼릭 링크는 재귀 삭제 없이 링크만 제거하고 실제 대상과 내용을 보존한다', async t => {
    const f = await fixture(t, []);
    const targetPath = path.join(f.directory, 'target');
    const linkPath = path.join(f.directory, 'link');
    await fs.mkdir(targetPath);
    await fs.writeFile(path.join(targetPath, 'keep.txt'), 'Keep linked target');
    await fs.symlink(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    const removed = [];
    const synced = [];
    const result = await deleteFileEntries([`${linkPath}${path.sep}`], {
        trashItem: unavailableTrash,
        confirmPermanentDelete: () => true,
        syncDeletedPaths: entries => synced.push(entries),
        fsApi: { ...fs, rm: async (...args) => { removed.push(args); await fs.rm(...args); } },
        t: tr,
    });
    assert.equal(result.success, true);
    assert.deepEqual(removed, [[linkPath, { recursive: false, force: false }]]);
    assert.equal(synced[0][0].recursive, false);
    await assert.rejects(fs.lstat(linkPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(targetPath, 'keep.txt'), 'utf8'), 'Keep linked target');
});

test('확인창이 열린 동안 파일이 바뀌면 교체된 파일과 원본을 모두 보존한다', async t => {
    const f = await fixture(t);
    const [filePath] = f.paths;
    const originalPath = path.join(f.directory, 'original.txt');
    const result = await deleteFileEntries([filePath], {
        trashItem: unavailableTrash,
        confirmPermanentDelete: async () => {
            await fs.rename(filePath, originalPath);
            await fs.writeFile(filePath, 'Replacement content');
            return true;
        },
        syncDeletedPaths: () => assert.fail('Changed entries must not be synced as deleted.'),
        fsApi: { ...fs, rm: () => assert.fail('Changed entries must not be removed.') },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, []);
    assert.match(result.errors.join('\n'), /삭제 확인 중 항목이 변경/);
    assert.equal(await fs.readFile(filePath, 'utf8'), 'Replacement content');
    assert.equal(await fs.readFile(originalPath, 'utf8'), 'Original one.txt');
});

test('영구 삭제 일부가 실패하면 성공 항목만 반환하고 실패한 폴더 전체를 DB에서 제거하지 않는다', async t => {
    const f = await fixture(t, ['done.txt']);
    const folderPath = path.join(f.directory, 'protected-folder');
    await fs.mkdir(folderPath);
    await fs.writeFile(path.join(folderPath, 'keep.txt'), 'Protected content');
    const synced = [];
    const result = await deleteFileEntries([f.paths[0], folderPath], {
        trashItem: unavailableTrash,
        confirmPermanentDelete: () => true,
        syncDeletedPaths: entries => synced.push(entries),
        fsApi: { ...fs, rm: async (target, options) => {
            if (target === folderPath) throw Object.assign(new Error('Permission denied'), { code: 'EPERM' });
            await fs.rm(target, options);
        } },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, f.paths);
    assert.deepEqual(synced, [[{ path: f.paths[0], recursive: false }]]);
    assert.match(result.errors.join('\n'), /protected-folder.*Permission denied/);
    assert.equal(await fs.readFile(path.join(folderPath, 'keep.txt'), 'utf8'), 'Protected content');
});

test('삭제 후 DB 동기화가 실패해도 실제 삭제된 경로를 결과에서 잃지 않는다', async t => {
    const f = await fixture(t);
    const result = await deleteFileEntries(f.paths, {
        trashItem: unavailableTrash,
        confirmPermanentDelete: () => true,
        syncDeletedPaths: () => { throw new Error('DB unavailable'); },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, f.paths);
    assert.deepEqual(result.errors, ['DB unavailable']);
    await assert.rejects(fs.lstat(f.paths[0]), { code: 'ENOENT' });
});

test('휴지통과 영구 삭제 단계의 ENOENT를 조용한 삭제 성공으로 처리하지 않는다', async t => {
    const f = await fixture(t);
    let confirmations = 0;
    const result = await deleteFileEntries(f.paths, {
        trashItem: async () => { throw Object.assign(new Error('Trash entry not found'), { code: 'ENOENT' }); },
        confirmPermanentDelete: entries => {
            confirmations += 1;
            assert.deepEqual(entries.map(entry => entry.path), f.paths);
            return true;
        },
        syncDeletedPaths: () => assert.fail('An incomplete removal must not be synced.'),
        fsApi: { ...fs, rm: async () => { throw Object.assign(new Error('Incomplete removal'), { code: 'ENOENT' }); } },
        t: tr,
    });
    assert.equal(confirmations, 1);
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, []);
    assert.match(result.errors.join('\n'), /Incomplete removal/);
    assert.equal(await fs.readFile(f.paths[0], 'utf8'), 'Original one.txt');
});

test('상대 경로와 NUL 및 파일 시스템 루트는 파일 작업 전에 거부한다', async () => {
    const invalidPaths = ['relative/bak', '', null, '/invalid\0path', path.parse(process.cwd()).root];
    let inspected = 0;
    const result = await deleteFileEntries(invalidPaths, {
        trashItem: () => assert.fail('Invalid paths must not be passed to trash.'),
        confirmPermanentDelete: () => assert.fail('Invalid paths must not be offered for deletion.'),
        fsApi: { lstat: () => { inspected += 1; assert.fail('Invalid paths must be rejected before filesystem access.'); } },
        t: tr,
    });
    assert.equal(inspected, 0);
    assert.equal(result.success, false);
    assert.equal(result.errors.length, invalidPaths.length);
    assert.deepEqual(result.deleted, []);
});

test('다른 장치에 마운트된 최상위 폴더는 승인 후에도 영구 삭제하지 않는다', async t => {
    const f = await fixture(t, []);
    const target = path.join(f.directory, 'mounted-volume');
    const stat = { dev: 2, ino: 10, mode: 16877, mtimeMs: 1, ctimeMs: 1, isDirectory: () => true };
    const result = await deleteFileEntries([target], {
        trashItem: unavailableTrash,
        confirmPermanentDelete: () => true,
        fsApi: {
            lstat: async () => stat,
            stat: async () => ({ dev: 1 }),
            rm: () => assert.fail('Mount roots must not be removed.'),
        },
        t: tr,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.deleted, []);
    assert.match(result.errors.join('\n'), /최상위 폴더/);
});

test('POSIX 파일명 끝의 역슬래시는 경로 구분자로 제거하지 않는다', { skip: process.platform === 'win32' }, async t => {
    const f = await fixture(t, ['bak', 'bak\\']);
    const trashed = [];
    const result = await deleteFileEntries([f.paths[1]], {
        trashItem: target => { trashed.push(target); },
        confirmPermanentDelete: () => assert.fail('The supplied trash operation succeeds.'),
        t: tr,
    });
    assert.equal(result.success, true);
    assert.deepEqual(trashed, [f.paths[1]]);
    assert.equal(await fs.readFile(f.paths[0], 'utf8'), 'Original bak');
});

test('영구 삭제 확인창은 취소가 기본이며 전체 대상과 오류 및 복원 불가 안내를 보여준다', () => {
    const entries = [{ path: '/Volumes/example/one/bak', error: 'SMB unavailable' }, { path: '/Volumes/example/two/bak', error: 'Permission denied' }];
    const options = createPermanentDeleteDialogOptions(entries, tr);
    assert.equal(options.type, 'warning');
    assert.deepEqual(options.buttons, ['취소', '영구 삭제']);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    assert.equal(options.noLink, true);
    assert.match(options.message, /2개 항목/);
    assert.match(options.detail, /휴지통에서 복원할 수 없습니다/);
    for (const entry of entries) {
        assert.ok(options.detail.includes(entry.path));
        assert.ok(options.detail.includes(entry.error));
    }
});
