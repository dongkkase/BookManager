import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LibraryDB } from './database/library_db.js';
import { checkDuplicateFiles, scanFolder } from './tasks/folderScanTask.js';

test('중복 검사는 현재 파일명과 크기를 사용하고 내용은 추출하지 않는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-db-name-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');
    const currentName = '페이트 스테이 나이트(화질개선) 17권.cbz';
    const indexedName = '페이트 스테이 나이트(스캔) 17권.cbz';

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, currentName), '');
        fs.writeFileSync(path.join(libraryDir, indexedName), 'current file content');

        const fakeLibraryDb = {
            async getFileInfo() {
                return null;
            },
            async getTargetIndex(folder) {
                assert.equal(folder, libraryDir);
                return [{
                    full_path: path.join(libraryDir, indexedName),
                    target_folder: libraryDir,
                    name: indexedName,
                    size: 1234,
                    mtime: 0,
                    path: libraryDir,
                }];
            },
        };

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
            libraryDb: fakeLibraryDb,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].dup_count, 1);
        assert.equal(files[0].duplicate_matches[0].name, indexedName);
        assert.equal(files[0].duplicate_matches[0].path, path.join(libraryDir, indexedName));
        assert.equal(files[0].duplicate_matches[0].size, Buffer.byteLength('current file content'));
        assert.ok(files[0].duplicate_matches[0].ratio >= 70);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 인덱스 이후 추가·삭제된 파일을 반영하고 인덱스는 재구축하지 않는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-dbpath-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');
    const dbPath = path.join(tempRoot, 'library.db');
    const currentName = '페이트 스테이 나이트(화질개선) 17권.cbz';
    const indexedName = '페이트 스테이 나이트(스캔) 17권.cbz';
    const addedName = '페이트 스테이 나이트 17권.cbz';
    const nestedLibraryDir = path.join(libraryDir, 'nested');

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(nestedLibraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, currentName), '');
        fs.writeFileSync(path.join(nestedLibraryDir, indexedName), 'indexed');

        const library = new LibraryDB({ dbPath });
        await library.saveTargetIndex([{
            full_path: path.join(nestedLibraryDir, indexedName),
            target_folder: libraryDir,
            name: indexedName,
            size: 5678,
            mtime: 0,
        }]);
        await library.close();
        fs.unlinkSync(path.join(nestedLibraryDir, indexedName));
        fs.writeFileSync(path.join(nestedLibraryDir, addedName), 'new file');

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
            dbPath,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].dup_count, 1);
        assert.equal(files[0].duplicate_matches[0].name, addedName);
        assert.equal(files[0].duplicate_matches[0].path, path.join(nestedLibraryDir, addedName));
        const reopened = new LibraryDB({ dbPath });
        try {
            assert.deepEqual((await reopened.getTargetIndex(libraryDir)).map(row => row.name), [indexedName]);
        } finally {
            await reopened.close();
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 다른 시리즈의 같은 권수를 중복으로 보지 않는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-match-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, '페이트 스테이 나이트(화질개선) 17권.cbz'), '');
        fs.writeFileSync(path.join(libraryDir, '2.5차원의 유혹 17권.cbz'), '');
        fs.writeFileSync(path.join(libraryDir, '페이트 스테이 나이트(스캔) 17권.cbz'), '');

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
        });

        assert.equal(files.length, 1);
        assert.deepEqual(
            files[0].duplicate_matches.map(match => match.name),
            ['페이트 스테이 나이트(스캔) 17권.cbz'],
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 권 단위 공통 요소만으로 후보 전체를 매칭하지 않는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-noise-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, '페이트 스테이 나이트(화질개선) 17권.cbz'), '');

        for (let index = 1; index <= 50; index += 1) {
            const folder = path.join(libraryDir, `다른 시리즈 ${index}`);
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, `다른 시리즈 ${index} 17권.cbz`), '');
        }

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].dup_count, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 macOS NFD 한글 파일명에서도 확장자만으로 100% 매칭하지 않는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-nfd-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, '페이트 스테이 나이트(화질개선) 17권.cbz'.normalize('NFD')), '');
        fs.writeFileSync(path.join(libraryDir, '#진상을 말씀드립니다 01권.cbz'.normalize('NFD')), '');

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].dup_count, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 일본어·한자 제목을 보존해 다른 작품을 구분하고 같은 제목을 찾는다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-unicode-'));
    const libraryDir = path.join(tempRoot, 'library');
    try {
        fs.mkdirSync(libraryDir);
        for (const name of ['青の祓魔師 01.cbz', '進撃の巨人.cbz', '三体.cbz']) {
            fs.writeFileSync(path.join(libraryDir, name), '');
        }
        const files = ['進撃の巨人 01.cbz', '進撃の巨人.cbz', '三体.cbz'].map(name => ({
            name,
            path: path.join(tempRoot, 'current', name),
        }));
        const result = await checkDuplicateFiles(files, { dupFolders: [libraryDir] });
        assert.equal(result[0].dup_count, 0);
        assert.deepEqual(result[1].duplicate_matches.map(match => match.name), ['進撃の巨人.cbz']);
        assert.deepEqual(result[2].duplicate_matches.map(match => match.name), ['三体.cbz']);
        assert.equal(result[1].max_ratio, 100);
        assert.equal(result[2].max_ratio, 100);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('현재 목록 중복 검사는 입력 행만 반환하고 겹치는 라이브러리와 후보 stat를 중복 처리하지 않는다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-current-list-'));
    const libraryDir = path.join(tempRoot, 'library');
    const nestedDir = path.join(libraryDir, 'nested');
    const name = '페이트 스테이 나이트 17권.cbz';
    const matchPath = path.join(nestedDir, name);
    try {
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(matchPath, 'current size');
        fs.writeFileSync(path.join(nestedDir, '드래곤볼 17권.cbz'), '');
        const stat = fs.promises.stat.bind(fs.promises);
        const statSpy = t.mock.method(fs.promises, 'stat', stat);
        const readSpy = t.mock.method(fs.promises, 'readFile', () => assert.fail('File content must not be read'));
        const openSpy = t.mock.method(fs.promises, 'open', () => assert.fail('Archives must not be opened'));
        const libraryDb = {
            getFileInfo() { assert.fail('Metadata must not be loaded'); },
            getTargetIndex() { assert.fail('A stale index must not replace current directory contents'); },
        };
        const files = [
            Object.freeze({ name, path: path.join(tempRoot, 'current', name), cover: 'keep-cover', metadata: { Title: 'keep-title' } }),
            Object.freeze({ name, full_path: path.join(tempRoot, 'another', name) }),
        ];
        const result = await checkDuplicateFiles(files, {
            dupFolders: [libraryDir, nestedDir, libraryDir],
            libraryDb,
        });
        assert.equal(result.length, files.length);
        assert.equal(result[0].cover, 'keep-cover');
        assert.equal(result[0].metadata, files[0].metadata);
        assert.equal(files[0].dup_count, undefined);
        assert.ok(result.every(file => file.dup_count === 1));
        assert.ok(result.every(file => file.duplicate_matches[0].path === matchPath));
        assert.ok(result.every(file => file.duplicate_matches[0].size === Buffer.byteLength('current size')));
        assert.deepEqual(statSpy.mock.calls.map(call => call.arguments[0]), [matchPath]);
        assert.equal(readSpy.mock.callCount(), 0);
        assert.equal(openSpy.mock.callCount(), 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('같은 파일 엔트리가 여러 번 반환되어도 중복 후보는 경로별로 한 번만 표시한다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-repeated-entries-'));
    const libraryDir = path.join(tempRoot, 'library');
    const nestedDir = path.join(libraryDir, 'nested');
    const name = '같은 도서 01권.cbz';
    const candidatePath = path.join(nestedDir, name);
    try {
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(candidatePath, 'candidate');
        const readdir = fs.promises.readdir;
        t.mock.method(fs.promises, 'readdir', async function (...args) {
            const entries = await readdir.apply(this, args);
            return Array.from({ length: 7 }, () => entries).flat();
        });
        const result = await checkDuplicateFiles([{ name, path: path.join(tempRoot, 'current', name) }], {
            dupFolders: [libraryDir, nestedDir],
        });
        assert.equal(result[0].dup_count, 1);
        assert.equal(result[0].max_ratio, 100);
        assert.deepEqual(result[0].duplicate_matches.map(match => match.path), [candidatePath]);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('등록 대상이 없거나 파일이 삭제되면 이전 중복 결과를 비우고 자기 자신과 폴더는 제외한다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-reset-'));
    const name = '같은 도서 01권.cbz';
    const filePath = path.join(tempRoot, name);
    const oldMatch = { duplicate_matches: [{ path: '/old.cbz' }], dup_count: 1, max_ratio: 100 };
    try {
        fs.writeFileSync(filePath, '');
        const files = [
            { name, path: filePath, ...oldMatch },
            { name, path: path.join(tempRoot, 'a-directory'), isDirectory: true, ...oldMatch },
        ];
        for (const options of [{ dupFolders: [] }, { dupFolders: [tempRoot] }]) {
            const result = await checkDuplicateFiles(files, options);
            assert.ok(result.every(file => file.dup_count === 0 && file.max_ratio === 0));
            assert.ok(result.every(file => file.duplicate_matches.length === 0));
        }
        assert.deepEqual(await checkDuplicateFiles([], { dupFolders: [tempRoot] }), []);
        const current = [{ name, path: path.join(tempRoot, 'current', name) }];
        const first = await checkDuplicateFiles(current, { dupFolders: [tempRoot] });
        assert.equal(first[0].dup_count, 1);
        fs.unlinkSync(filePath);
        const afterDeletion = await checkDuplicateFiles(first, { dupFolders: [tempRoot] });
        assert.equal(afterDeletion[0].dup_count, 0);
        assert.deepEqual(afterDeletion[0].duplicate_matches, []);
        assert.equal(afterDeletion[0].max_ratio, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('macOS에서는 NFC/NFD 경로가 다른 같은 파일을 중복으로 보지 않는다', { skip: process.platform !== 'darwin' }, async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-self-nfd-'));
    const name = '한글 도서 01권.cbz';
    try {
        fs.writeFileSync(path.join(tempRoot, name.normalize('NFD')), '');
        const result = await checkDuplicateFiles([{ name, path: path.join(tempRoot, name.normalize('NFC')) }], {
            dupFolders: [tempRoot],
        });
        assert.equal(result[0].dup_count, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('Windows에서는 대소문자가 다른 같은 경로를 중복으로 보지 않는다', { skip: process.platform !== 'win32' }, async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-self-case-'));
    const name = 'BookTitle 01.cbz';
    try {
        fs.writeFileSync(path.join(tempRoot, name), '');
        const result = await checkDuplicateFiles([{ name, full_path: path.join(tempRoot, name).toUpperCase() }], {
            dupFolders: [tempRoot],
        });
        assert.equal(result[0].dup_count, 0);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 후보 확인 중 취소하면 이전 결과나 부분 결과를 반환하지 않는다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-cancel-'));
    const name = '취소할 도서 01권.cbz';
    try {
        fs.writeFileSync(path.join(tempRoot, name), '');
        let cancelled = false;
        const stat = fs.promises.stat.bind(fs.promises);
        t.mock.method(fs.promises, 'stat', async filePath => {
            cancelled = true;
            return stat(filePath);
        });
        await assert.rejects(checkDuplicateFiles([{ name, path: path.join(tempRoot, 'current', name) }], {
            dupFolders: [tempRoot],
            shouldCancel: () => cancelled,
        }), error => error.code === 'TASK_CANCELLED');
        await assert.rejects(checkDuplicateFiles([], {
            shouldCancel: () => true,
        }), error => error.code === 'TASK_CANCELLED');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('파일 I/O가 없는 긴 후보 비교 중에도 예약된 취소 요청을 처리한다', async t => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-scheduled-cancel-'));
    let cancelHandle;
    let cancelled = false;
    try {
        const entries = Array.from({ length: 4096 }, (_, index) => ({
            name: `zzzz${String.fromCharCode(97 + Math.floor(index / 676), 97 + Math.floor(index / 26) % 26, 97 + index % 26)}.cbz`,
            isDirectory: () => false,
            isFile: () => true,
        }));
        t.mock.method(fs.promises, 'readdir', async () => entries);
        t.mock.method(fs.promises, 'stat', () => assert.fail('Unrelated candidate files must not be read'));
        await assert.rejects(checkDuplicateFiles([{ name: '가나다라.cbz', path: path.join(tempRoot, 'current.cbz') }], {
            dupFolders: [tempRoot],
            shouldCancel: () => cancelled,
        }, {
            sender: {
                send() {
                    cancelHandle = setImmediate(() => { cancelled = true; });
                },
            },
        }), error => error.code === 'TASK_CANCELLED');
        assert.equal(cancelled, true);
    } finally {
        clearImmediate(cancelHandle);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
