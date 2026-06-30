import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

test('메타데이터 저장 IPC는 표지 data URL 없이 필요한 필드만 전달한다', () => {
    const source = readProjectFile('src/tabs/MetadataTab.jsx');
    const sanitizeStart = source.indexOf('const sanitizeItemForSave = (item) => {');
    const sanitizeEnd = source.indexOf('const handleSave = async', sanitizeStart);
    const sanitizeSource = source.slice(sanitizeStart, sanitizeEnd);

    assert.match(sanitizeSource, /id:\s*item\.id/);
    assert.match(sanitizeSource, /filepath:\s*item\.filepath \|\| item\.path \|\| ''/);
    assert.match(sanitizeSource, /metadata:\s*pickMetadataFields/);
    assert.doesNotMatch(sanitizeSource, /\.\.\.item/);
    assert.doesNotMatch(sanitizeSource, /coverDataUrl/);
});

test('메타데이터 표지는 렌더러 메모리에 무제한 누적하지 않는다', () => {
    const source = readProjectFile('src/tabs/MetadataTab.jsx');

    assert.match(source, /const METADATA_COVER_CACHE_LIMIT = 50/);
    assert.match(source, /function trimMetadataCoverCache/);
    assert.match(source, /trimMetadataCoverCache\(prev\.map/);
});

test('검색 API 표지는 base64 대신 파일 캐시 URL을 우선 사용한다', () => {
    const rendererSource = readProjectFile('src/tabs/MetadataTab.jsx');
    const ipcSource = readProjectFile('electron/ipcHandlers.js');
    const mainSource = readProjectFile('electron/main.js');

    assert.match(rendererSource, /coverCacheUrl \|\| result\.coverDataUrl \|\| result\.coverUrl/);
    assert.match(rendererSource, /url\.startsWith\('bookmanager-thumbnail:'\)/);
    assert.match(ipcSource, /function stripTransientApiImageFields/);
    assert.match(ipcSource, /coverCacheUrl = await fetchImageCacheUrlFromUrl/);
    assert.match(ipcSource, /setCachedApiResults\(writeCacheDb, apiName, cacheQuery, stripTransientApiImageFieldsFromResults\(results\)\)/);
    assert.match(mainSource, /requestUrl\.hostname === 'api-cover'/);
    assert.match(mainSource, /resolveApiCoverCacheDir\(getExecutableDir\(\)\)/);
});
