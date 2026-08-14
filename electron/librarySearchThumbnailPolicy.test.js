import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');

test('라이브러리 검색 썸네일 URL은 원본 파일 버전으로 캐시를 갱신한다', () => {
    assert.match(ipcSource, /function thumbnailUrlForSearchResult\(thumbnailPath, sourceMtime = 0, sourceSize = 0\)/);
    assert.match(ipcSource, /`\$\{baseUrl\}\?v=\$\{versionMtime\}-\$\{versionSize\}`/);
    assert.match(ipcSource, /cover:\s*thumbnailUrlForSearchResult\(thumbnailPath, row\.mtime, row\.size\)/);
});
