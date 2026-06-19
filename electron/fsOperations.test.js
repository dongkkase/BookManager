import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  executeLibraryMove,
  executeMultiRename,
  undoRename,
} from './fsOperations.js';

test('다중 파일 이름 변경 후 실행 취소로 원래 경로를 복구한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-multi-rename-'));
  try {
    const first = path.join(root, 'Book 1.cbz');
    const second = path.join(root, 'Book 2.cbz');
    const nextFirst = path.join(root, 'Volume 1.cbz');
    const nextSecond = path.join(root, 'Volume 2.cbz');
    fs.writeFileSync(first, 'one');
    fs.writeFileSync(second, 'two');

    const renamed = executeMultiRename({
      [first]: nextFirst,
      [second]: nextSecond,
    });
    assert.equal(renamed.success, true);
    assert.equal(renamed.successCount, 2);
    assert.equal(fs.existsSync(nextFirst), true);
    assert.equal(fs.existsSync(nextSecond), true);

    const undone = undoRename(renamed.history);
    assert.equal(undone.success, true);
    assert.equal(undone.successCount, 2);
    assert.equal(fs.readFileSync(first, 'utf8'), 'one');
    assert.equal(fs.readFileSync(second, 'utf8'), 'two');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('시리즈 폴더 이동 후 라이브러리 충돌 rename 선택은 대상명을 변경해 보존한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-move-'));
  try {
    const sourceDir = path.join(root, 'source');
    const libraryDir = path.join(root, 'library');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(path.join(libraryDir, 'Series'), { recursive: true });
    const sourceFile = path.join(sourceDir, 'Series 01.cbz');
    const groupedFile = path.join(sourceDir, 'Series', 'Series 01.cbz');
    const existingLibraryFile = path.join(libraryDir, 'Series', 'Series 01.cbz');
    fs.writeFileSync(sourceFile, 'new');
    fs.writeFileSync(existingLibraryFile, 'existing');

    const grouped = executeLibraryMove([{
      src: sourceFile,
      dest: groupedFile,
      cleanupRoot: '',
    }]);
    assert.equal(grouped.successCount, 1);
    assert.equal(fs.existsSync(groupedFile), true);

    const moved = executeLibraryMove([{
      src: groupedFile,
      dest: existingLibraryFile,
      conflictAction: 'rename',
      cleanupRoot: path.dirname(groupedFile),
    }]);
    assert.equal(moved.successCount, 1);
    assert.equal(moved.completedMoves[0].dest, path.join(libraryDir, 'Series', 'Series 01_1.cbz'));
    assert.equal(fs.readFileSync(existingLibraryFile, 'utf8'), 'existing');
    assert.equal(fs.readFileSync(moved.completedMoves[0].dest, 'utf8'), 'new');
    assert.equal(fs.existsSync(path.dirname(groupedFile)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
