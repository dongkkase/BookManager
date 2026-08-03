import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appStyles = readFileSync(new URL('./styles/App.css', import.meta.url), 'utf8');
const metadataStyles = readFileSync(new URL('./styles/MetadataTab.css', import.meta.url), 'utf8');

test('환경 설정과 메타데이터 검색 API 팝업은 배경을 10px 흐리게 표시한다', () => {
    assert.match(appStyles, /\.modal-overlay\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(appStyles, /\.modal-overlay\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
    assert.match(metadataStyles, /\.meta-api-dialog-backdrop::before\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(metadataStyles, /\.meta-api-dialog-backdrop::before\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
});
