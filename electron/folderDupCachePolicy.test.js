import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LibraryDB } from './database/library_db.js';
import { scanFolder } from './tasks/folderScanTask.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'tasks/folderScanTask.js'), 'utf8');

test('중복 검사 캐시는 기존 라이브러리 인덱스를 우선 사용한다', () => {
    assert.match(source, /indexedRows = await options\.libraryDb\.getTargetIndex\(folder\)/);
    assert.match(source, /if \(indexedRows\.length > 0\) \{[\s\S]*addCandidate\(row\)/);
    assert.match(source, /\} else \{\s*await scanDir\(folder\);/);
});

test('중복 검사는 DB에 등록된 파일명 기준으로 현재 폴더 파일명과 비교한다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-db-name-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');
    const currentName = '페이트 스테이 나이트(화질개선) 17권.cbz';
    const indexedName = '페이트 스테이 나이트(스캔) 17권.cbz';

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, currentName), '');

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
        assert.ok(files[0].duplicate_matches[0].ratio >= 70);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('중복 검사는 dbPath로 열린 라이브러리 인덱스를 사용한다', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-dup-dbpath-'));
    const currentDir = path.join(tempRoot, 'current');
    const libraryDir = path.join(tempRoot, 'library');
    const dbPath = path.join(tempRoot, 'library.db');
    const currentName = '페이트 스테이 나이트(화질개선) 17권.cbz';
    const indexedName = '페이트 스테이 나이트(스캔) 17권.cbz';

    try {
        fs.mkdirSync(currentDir, { recursive: true });
        fs.mkdirSync(libraryDir, { recursive: true });
        fs.writeFileSync(path.join(currentDir, currentName), '');

        const library = new LibraryDB({ dbPath });
        await library.saveTargetIndex([{
            full_path: path.join(libraryDir, indexedName),
            target_folder: libraryDir,
            name: indexedName,
            size: 5678,
            mtime: 0,
        }]);
        await library.close();

        const files = await scanFolder(currentDir, {
            enableDupCheck: true,
            dupFolders: [libraryDir],
            sevenZExe: '',
            skipArchiveExtraction: true,
            dbPath,
        });

        assert.equal(files.length, 1);
        assert.equal(files[0].dup_count, 1);
        assert.equal(files[0].duplicate_matches[0].name, indexedName);
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
