import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'database', 'library_db.js'), 'utf8');

test('라이브러리 DB는 앱 시작 import 시 better-sqlite3 네이티브 바인딩을 즉시 로드하지 않는다', () => {
    assert.doesNotMatch(source, /import\s+Database\s+from\s+['"]better-sqlite3['"]/);
    assert.match(source, /let DatabaseConstructor = null/);
    assert.match(source, /function getDatabaseConstructor\(\) \{[\s\S]*require\('better-sqlite3'\)/);
    assert.match(source, /const Database = getDatabaseConstructor\(\);[\r\n\s]*this\.db = new Database\(this\.dbPath\)/);
});
