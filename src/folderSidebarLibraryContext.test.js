import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./components/folder/FolderSidebar.jsx', import.meta.url)), 'utf8');

test('탐색기 트리의 라이브러리 루트는 라이브러리 컨텍스트 메뉴를 연다', () => {
    assert.match(source, /isLibraryRoot:\s*true/);
    assert.match(source, /if\s*\(node\.isLibraryRoot\)\s*{[\s\S]*onLibraryContextMenu\?\.\(event,\s*node\.path\)/);
    assert.match(source, /onFolderContextMenu\?\.\(event,\s*node\.path,\s*siblings\.map/);
});
