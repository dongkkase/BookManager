import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('일반 폴더 스캔은 앱 전역 락 상태를 만들지 않는다', () => {
    assert.match(source, /if \(data\?\.task === 'folder:scan'\) \{\s*return;\s*\}/);
    assert.match(source, /detail:\s*\{\s*tabId:\s*'folder',\s*isWorking:\s*preparingDuplicates\s*\}/);
    assert.doesNotMatch(source, /task:\s*'folder:scan'[\s\S]{0,200}phase:\s*'executing'/);
    assert.doesNotMatch(source, /const isFolderWorking = scanning \|\| preparingDuplicates/);
});
