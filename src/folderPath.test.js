import assert from 'node:assert/strict';
import test from 'node:test';
import {
    basename,
    joinPath,
    parentPath,
    replaceBasename,
} from './utils/folderPath.js';

test('폴더 경로 헬퍼는 기존 FolderTab 경로 처리 방식을 유지한다', () => {
    assert.equal(parentPath('/Books/Series/A.cbz'), '/Books/Series');
    assert.equal(parentPath('C:\\Books\\Series\\A.cbz'), 'C:/Books/Series');
    assert.equal(basename('/Books/Series/A.cbz'), 'A.cbz');
    assert.equal(basename('C:\\Books\\Series\\A.cbz'), 'A.cbz');
});

test('폴더 경로 헬퍼는 파일명 교체와 하위 경로 결합을 처리한다', () => {
    assert.equal(replaceBasename('/Books/Series/A.cbz', 'B.cbz'), '/Books/Series/B.cbz');
    assert.equal(replaceBasename('C:\\Books\\Series\\A.cbz', 'B.cbz'), 'C:\\Books\\Series\\B.cbz');
    assert.equal(joinPath('/Books', 'Series', 'A.cbz'), '/Books/Series/A.cbz');
    assert.equal(joinPath('C:\\Books', 'Series', 'A.cbz'), 'C:\\Books\\Series\\A.cbz');
});
