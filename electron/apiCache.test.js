import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    API_CACHE_TTL_MS,
    clearApiCache,
    getCachedApiResults,
    openApiCache,
    setCachedApiResults,
} from './database/apiCache.js';

test('API 검색 캐시는 원본과 같은 7일 TTL을 적용한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-api-cache-'));
    try {
        const dbPath = path.join(root, '.api_cache.db');
        const db = openApiCache(dbPath);
        const now = Date.now();
        setCachedApiResults(db, 'ridibooks', 'fresh', [{ id: 1 }], new Date(now - API_CACHE_TTL_MS + 1000));
        setCachedApiResults(db, 'ridibooks', 'expired', [{ id: 2 }], new Date(now - API_CACHE_TTL_MS - 1000));
        assert.deepEqual(getCachedApiResults(db, 'ridibooks', 'fresh', now), [{ id: 1 }]);
        assert.equal(getCachedApiResults(db, 'ridibooks', 'expired', now), null);
        db.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('캐시 삭제는 SQLite row와 표지 이미지 파일을 함께 정리한다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-api-clear-'));
    try {
        const dbPath = path.join(root, '.api_cache.db');
        const images = path.join(root, 'api_cover_cache');
        fs.mkdirSync(images);
        fs.writeFileSync(path.join(images, 'cover.jpg'), 'cover');
        const db = openApiCache(dbPath);
        setCachedApiResults(db, 'google', 'book', [{ id: 1 }]);
        db.prepare('INSERT INTO img_cache (url, data) VALUES (?, ?)').run('https://example.com/a.jpg', Buffer.from('a'));
        db.close();

        const result = clearApiCache(dbPath, [images]);
        assert.equal(result.deletedRows, 2);
        assert.equal(result.deletedFiles, 1);
        const reopened = openApiCache(dbPath);
        assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM search_cache').get().count, 0);
        assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM img_cache').get().count, 0);
        reopened.close();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
