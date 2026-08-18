import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitRenameOperation,
  executeLibraryMove,
  executeLibraryMoveAsync,
  executeMultiRename,
  findLibraryMoveConflicts,
  reverseRenameMapForCompletedMoves,
  saveRenameHistoryFile,
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
    assert.deepEqual(renamed.completedMoves, [
      { src: first, dest: nextFirst, recursive: false },
      { src: second, dest: nextSecond, recursive: false },
    ]);

    const undone = undoRename(renamed.history);
    assert.equal(undone.success, true);
    assert.equal(undone.successCount, 2);
    assert.deepEqual(undone.completedMoves, [
      { src: nextSecond, dest: second, recursive: false },
      { src: nextFirst, dest: first, recursive: false },
    ]);
    assert.equal(fs.readFileSync(first, 'utf8'), 'one');
    assert.equal(fs.readFileSync(second, 'utf8'), 'two');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('체인 이름 변경은 역순 Undo와 redo로 모든 경로를 복원한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-chain-rename-'));
  try {
    const first = path.join(root, 'A.cbz');
    const second = path.join(root, 'B.cbz');
    const third = path.join(root, 'C.cbz');
    fs.writeFileSync(first, 'first');
    fs.writeFileSync(second, 'second');

    const renamed = executeMultiRename({
      [second]: third,
      [first]: second,
    });
    assert.equal(renamed.success, true);
    assert.equal(renamed.successCount, 2);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.readFileSync(second, 'utf8'), 'first');
    assert.equal(fs.readFileSync(third, 'utf8'), 'second');

    const undone = undoRename(renamed.history);
    assert.equal(undone.success, true);
    assert.equal(undone.successCount, 2);
    assert.deepEqual(undone.completedMoves, [
      { src: second, dest: first, recursive: false },
      { src: third, dest: second, recursive: false },
    ]);
    assert.equal(fs.readFileSync(first, 'utf8'), 'first');
    assert.equal(fs.readFileSync(second, 'utf8'), 'second');
    assert.equal(fs.existsSync(third), false);

    const redone = executeMultiRename(
      reverseRenameMapForCompletedMoves(undone.completedMoves),
    );
    assert.equal(redone.success, true);
    assert.equal(redone.successCount, 2);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.readFileSync(second, 'utf8'), 'first');
    assert.equal(fs.readFileSync(third, 'utf8'), 'second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('부분 Undo 실패는 실패한 매핑만 히스토리에 남겨 재시도한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-partial-undo-'));
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
    fs.writeFileSync(second, 'blocking');

    const partialUndo = undoRename(renamed.history);
    assert.equal(partialUndo.success, false);
    assert.equal(partialUndo.successCount, 1);
    assert.deepEqual(partialUndo.history.at(-1)?.mapping, {
      [nextSecond]: second,
    });
    assert.equal(fs.readFileSync(first, 'utf8'), 'one');
    assert.equal(fs.readFileSync(nextSecond, 'utf8'), 'two');

    fs.rmSync(second);
    const retried = undoRename(partialUndo.history);
    assert.equal(retried.success, true);
    assert.equal(retried.successCount, 1);
    assert.equal(retried.history.length, 0);
    assert.equal(fs.readFileSync(second, 'utf8'), 'two');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('다중 이름 변경은 실제 성공한 경로만 DB 동기화 대상으로 반환한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-partial-multi-rename-'));
  try {
    const source = path.join(root, 'Book 1.cbz');
    const missing = path.join(root, 'Missing.cbz');
    const destination = path.join(root, 'Volume 1.cbz');
    const missingDestination = path.join(root, 'Missing Volume.cbz');
    fs.writeFileSync(source, 'one');

    const renamed = executeMultiRename({
      [source]: destination,
      [missing]: missingDestination,
    });

    assert.equal(renamed.success, false);
    assert.equal(renamed.successCount, 1);
    assert.deepEqual(renamed.completedMoves, [
      { src: source, dest: destination, recursive: false },
    ]);
    assert.deepEqual(renamed.history.at(-1)?.mapping, { [destination]: source });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('손상된 비배열 히스토리는 파일 이동 전에 빈 기록으로 정규화한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-invalid-rename-history-'));
  try {
    const source = path.join(root, 'Old.cbz');
    const destination = path.join(root, 'New.cbz');
    fs.writeFileSync(source, 'book');

    const renamed = executeMultiRename({ [source]: destination }, {});
    assert.equal(renamed.success, true);
    assert.equal(fs.existsSync(destination), true);
    assert.equal(Array.isArray(renamed.history), true);
    assert.deepEqual(renamed.history.at(-1)?.mapping, { [destination]: source });
    assert.deepEqual(undoRename(null).history, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('이름 변경 히스토리는 임시 파일을 거쳐 교체하고 저장 실패 시 기존 내용을 보존한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-rename-history-'));
  try {
    const historyPath = path.join(root, 'rename-history.json');
    const previousHistory = [{ mapping: { old: 'older' } }];
    const nextHistory = [{ mapping: { next: 'old' } }];
    fs.writeFileSync(historyPath, JSON.stringify(previousHistory), 'utf8');
    const failingFs = {
      mkdirSync: fs.mkdirSync,
      writeFileSync(tempPath, content, encoding) {
        fs.writeFileSync(tempPath, content.slice(0, 4), encoding);
        throw new Error('history write failed');
      },
      renameSync: fs.renameSync,
      rmSync: fs.rmSync,
    };

    assert.throws(
      () => saveRenameHistoryFile(historyPath, nextHistory, failingFs),
      /history write failed/,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(historyPath, 'utf8')), previousHistory);
    assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);

    saveRenameHistoryFile(historyPath, nextHistory);
    assert.deepEqual(JSON.parse(fs.readFileSync(historyPath, 'utf8')), nextHistory);
    assert.equal(fs.readdirSync(root).some(name => name.endsWith('.tmp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('히스토리 저장 실패는 DB 동기화 전에 경로를 롤백한다', async () => {
  const calls = [];
  const committed = await commitRenameOperation({
    completedMoves: [{ src: 'old', dest: 'new' }],
    previousHistory: ['previous'],
    nextHistory: ['next'],
    saveHistory() {
      calls.push('save-next');
      throw new Error('history unavailable');
    },
    syncPathChanges() {
      calls.push('sync-db');
    },
    rollbackPathChanges() {
      calls.push('rollback-fs');
      return { successCount: 1, errors: [] };
    },
  });

  assert.equal(committed.success, false);
  assert.equal(committed.rollbackComplete, true);
  assert.deepEqual(calls, ['save-next', 'rollback-fs']);
});

test('DB 동기화 실패는 전체 경로 롤백 때만 기존 히스토리를 복원한다', async () => {
  const runCommit = async rollbackCount => {
    const calls = [];
    const committed = await commitRenameOperation({
      completedMoves: [{ src: 'old', dest: 'new' }],
      previousHistory: ['previous'],
      nextHistory: ['next'],
      saveHistory(history) {
        calls.push(`save-${history[0]}`);
      },
      syncPathChanges() {
        calls.push('sync-db');
        throw new Error('db unavailable');
      },
      rollbackPathChanges() {
        calls.push('rollback-fs');
        return { successCount: rollbackCount, errors: [] };
      },
    });
    return { calls, committed };
  };

  const fullRollback = await runCommit(1);
  assert.equal(fullRollback.committed.rollbackComplete, true);
  assert.deepEqual(fullRollback.calls, [
    'save-next',
    'sync-db',
    'rollback-fs',
    'save-previous',
  ]);

  const partialRollback = await runCommit(0);
  assert.equal(partialRollback.committed.rollbackComplete, false);
  assert.deepEqual(partialRollback.calls, ['save-next', 'sync-db', 'rollback-fs']);
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

test('라이브러리 이동 후 원본 폴더에 파일이 없으면 빈 하위 폴더까지 정리한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-cleanup-empty-'));
  try {
    const sourceDir = path.join(root, 'source');
    const emptyChildDir = path.join(sourceDir, 'empty-child');
    const libraryDir = path.join(root, 'library');
    const sourceFile = path.join(sourceDir, 'Book 01.cbz');
    const destinationFile = path.join(libraryDir, 'Book 01.cbz');
    fs.mkdirSync(emptyChildDir, { recursive: true });
    fs.writeFileSync(sourceFile, 'book');

    const moved = executeLibraryMove([{
      src: sourceFile,
      dest: destinationFile,
      cleanupRoot: sourceDir,
    }]);

    assert.equal(moved.successCount, 1);
    assert.equal(fs.existsSync(destinationFile), true);
    assert.equal(fs.existsSync(sourceDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('라이브러리 이동 후 원본 폴더에 파일이 남아 있으면 폴더를 보존한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-cleanup-preserve-'));
  try {
    const sourceDir = path.join(root, 'source');
    const childDir = path.join(sourceDir, 'child');
    const libraryDir = path.join(root, 'library');
    const sourceFile = path.join(sourceDir, 'Book 01.cbz');
    const remainingFile = path.join(childDir, 'Book 02.cbz');
    const destinationFile = path.join(libraryDir, 'Book 01.cbz');
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(sourceFile, 'book1');
    fs.writeFileSync(remainingFile, 'book2');

    const moved = executeLibraryMove([{
      src: sourceFile,
      dest: destinationFile,
      cleanupRoot: sourceDir,
    }]);

    assert.equal(moved.successCount, 1);
    assert.equal(fs.existsSync(destinationFile), true);
    assert.equal(fs.existsSync(sourceDir), true);
    assert.equal(fs.readFileSync(remainingFile, 'utf8'), 'book2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('라이브러리 이동 충돌은 일괄 확인으로 대상이 있는 항목만 반환한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-conflicts-'));
  try {
    const sourceDir = path.join(root, 'source');
    const libraryDir = path.join(root, 'library');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(libraryDir, { recursive: true });
    const sourceA = path.join(sourceDir, 'Book 01.cbz');
    const sourceB = path.join(sourceDir, 'Book 02.cbz');
    const destA = path.join(libraryDir, 'Book 01.cbz');
    const destB = path.join(libraryDir, 'Book 02.cbz');
    fs.writeFileSync(sourceA, 'source-a');
    fs.writeFileSync(sourceB, 'source-b');
    fs.writeFileSync(destA, 'dest-a');

    const result = await findLibraryMoveConflicts([
      { src: sourceA, dest: destA },
      { src: sourceB, dest: destB },
    ]);

    assert.equal(result.success, true);
    assert.deepEqual(result.conflicts, [{ index: 0, src: sourceA, dest: destA }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('비동기 라이브러리 이동은 메인 프로세스를 막는 동기 파일 작업 없이 이동과 정리를 수행한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-library-async-move-'));
  try {
    const sourceDir = path.join(root, 'source');
    const libraryDir = path.join(root, 'library');
    const sourceFile = path.join(sourceDir, 'Book 01.cbz');
    const destinationFile = path.join(libraryDir, 'Book 01.cbz');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourceFile, 'book');

    const moved = await executeLibraryMoveAsync([{
      src: sourceFile,
      dest: destinationFile,
      cleanupRoot: sourceDir,
    }]);

    assert.equal(moved.successCount, 1);
    assert.equal(fs.readFileSync(destinationFile, 'utf8'), 'book');
    assert.equal(fs.existsSync(sourceDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
