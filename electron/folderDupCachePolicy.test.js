import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanFolder } from './tasks/folderScanTask.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'tasks/folderScanTask.js'), 'utf8');

test('중복 검사 캐시는 기존 라이브러리 인덱스를 우선 사용한다', () => {
    assert.match(source, /indexedRows = await options\.libraryDb\.getTargetIndex\(folder\)/);
    assert.match(source, /if \(indexedRows\.length > 0\) \{[\s\S]*await addFilePath\(row\.full_path\)/);
    assert.match(source, /\} else \{\s*await scanDir\(folder\);/);
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
