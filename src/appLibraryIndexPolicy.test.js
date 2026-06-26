import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./App.jsx', import.meta.url)), 'utf8');

test('설정에서 라이브러리 변경 후 자동 인덱싱은 메타데이터 캐시를 강제로 무시하지 않는다', () => {
    assert.match(source, /if \(effects\.librariesChanged\) \{[\s\S]*updateFolderIndex\?\.\(folders,\s*\{/);
    assert.match(source, /optimizeMetadata:\s*true/);
    assert.match(source, /forceMetadata:\s*false/);
    assert.match(source, /mode:\s*'smart'/);
});
