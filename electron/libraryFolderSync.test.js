import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';

function createFixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-folder-sync-'));
    const library = new LibraryDB({ dbPath: path.join(directory, 'library.db') });
    t.after(async () => {
        await library.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const root = path.join(directory, 'Library');
    const rows = () => library.getConnection().prepare(`
        SELECT * FROM library_folders WHERE library_path = ? ORDER BY folder_path
    `).all(root);
    return { library, root, rows };
}

function folder(root, name, properties = {}) {
    return {
        folder_path: name ? path.join(root, name) : root,
        parent_path: name ? path.dirname(path.join(root, name)) : '',
        name: name ? path.basename(name) : 'Library',
        child_folder_count: 0,
        direct_file_count: 0,
        recursive_file_count: 0,
        last_seen_at: '2026-10-17T00:00:00.000Z',
        ...properties,
    };
}

test('폴더 재색인은 변경 없는 구조를 다시 쓰지 않고 확인 시각만 갱신한다', async t => {
    const { library, root, rows } = createFixture(t);
    const first = [
        folder(root, '', { child_folder_count: 1, recursive_file_count: 2 }),
        folder(root, '시리즈', { direct_file_count: 2, recursive_file_count: 2 }),
    ];
    await library.replaceLibraryFolders(root, first);
    const db = library.getConnection();
    db.exec(`
        CREATE TEMP TABLE folder_writes (operation TEXT);
        CREATE TEMP TRIGGER folder_insert AFTER INSERT ON library_folders
            BEGIN INSERT INTO folder_writes VALUES ('insert'); END;
        CREATE TEMP TRIGGER folder_delete AFTER DELETE ON library_folders
            BEGIN INSERT INTO folder_writes VALUES ('delete'); END;
        CREATE TEMP TRIGGER folder_detail_update AFTER UPDATE OF
            parent_path, name, child_folder_count, direct_file_count, recursive_file_count ON library_folders
            BEGIN INSERT INTO folder_writes VALUES ('details'); END;
        CREATE TEMP TRIGGER folder_seen_update AFTER UPDATE OF last_seen_at ON library_folders
            BEGIN INSERT INTO folder_writes VALUES ('seen'); END;
    `);
    const seenAt = '2026-10-18T00:00:00.000Z';
    const second = first.map(entry => ({ ...entry, last_seen_at: seenAt }));
    assert.deepEqual(await library.replaceLibraryFolders(root, second), { changes: 2 });
    assert.deepEqual(rows(), second.map(entry => ({ library_path: root, ...entry })));
    assert.deepEqual(db.prepare('SELECT operation FROM folder_writes').all(), [
        { operation: 'seen' }, { operation: 'seen' },
    ]);

    db.exec('DELETE FROM folder_writes');
    await library.replaceLibraryFolders(root, second);
    assert.deepEqual(db.prepare('SELECT operation FROM folder_writes').all(), []);
});

test('폴더 재색인은 추가·삭제·개수 변경과 루트 행을 반영하고 다른 라이브러리를 보존한다', async t => {
    const { library, root, rows } = createFixture(t);
    const otherRoot = path.join(path.dirname(root), 'Other');
    await library.replaceLibraryFolders(otherRoot, [folder(otherRoot, '')]);
    await library.replaceLibraryFolders(root, [
        folder(root, '', { child_folder_count: 2, recursive_file_count: 3 }),
        folder(root, '기존', { direct_file_count: 1, recursive_file_count: 1 }),
        folder(root, '삭제', { direct_file_count: 2, recursive_file_count: 2 }),
    ]);
    const expected = [
        folder(root, '', { child_folder_count: 2, recursive_file_count: 5 }),
        folder(root, '기존', { name: '이름 변경', direct_file_count: 4, recursive_file_count: 4 }),
        folder(root, '추가', { child_folder_count: 1, recursive_file_count: 1 }),
        folder(root, path.join('추가', '하위'), { direct_file_count: 1, recursive_file_count: 1 }),
    ];
    assert.deepEqual(await library.replaceLibraryFolders(root, expected), { changes: expected.length });
    assert.deepEqual(rows(), expected.map(entry => ({ library_path: root, ...entry })));
    assert.equal(await library.hasLibraryFolderIndex(otherRoot), true);
    await library.replaceLibraryFolders(root, []);
    assert.deepEqual(rows(), []);
    assert.equal(await library.hasLibraryFolderIndex(otherRoot), true);
});

test('폴더별 확인 시각과 입력 별칭을 유지한다', async t => {
    const { library, root, rows } = createFixture(t);
    await library.replaceLibraryFolders(root, [folder(root, ''), folder(root, '하위')]);
    const rootSeenAt = '2026-10-18T01:00:00.000Z';
    const childSeenAt = '2026-10-18T02:00:00.000Z';
    await library.replaceLibraryFolders(root, [
        { folderPath: root, lastSeenAt: rootSeenAt },
        { path: path.join(root, '하위'), parentPath: root, directFileCount: 3, recursiveFileCount: 3, lastSeenAt: childSeenAt },
    ]);
    assert.deepEqual(rows(), [
        { library_path: root, ...folder(root, '', { last_seen_at: rootSeenAt }) },
        { library_path: root, ...folder(root, '하위', { direct_file_count: 3, recursive_file_count: 3, last_seen_at: childSeenAt }) },
    ]);
});

test('중복 폴더 입력으로 실패하면 갱신·삭제 내역을 롤백한다', async t => {
    const { library, root, rows } = createFixture(t);
    await library.replaceLibraryFolders(root, [folder(root, ''), folder(root, '기존')]);
    const before = rows();
    await assert.rejects(library.replaceLibraryFolders(root, [
        folder(root, '', { recursive_file_count: 20 }),
        folder(root, '신규'),
        folder(root, ''),
    ]), /UNIQUE constraint failed/);
    assert.deepEqual(rows(), before);
});
