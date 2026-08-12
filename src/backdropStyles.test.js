import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appStyles = readFileSync(new URL('./styles/App.css', import.meta.url), 'utf8');
const folderStyles = readFileSync(new URL('./styles/FolderTab.css', import.meta.url), 'utf8');
const metadataStyles = readFileSync(new URL('./styles/MetadataTab.css', import.meta.url), 'utf8');
const multiRenameStyles = readFileSync(new URL('./styles/MultiRenameDialog.css', import.meta.url), 'utf8');

test('주요 모달은 반투명 배경을 10px 흐리게 표시한다', () => {
    assert.match(appStyles, /\.modal-overlay\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(appStyles, /\.modal-overlay\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
    assert.match(folderStyles, /\.folder-dialog-backdrop\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.46\)[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(folderStyles, /\.folder-dialog-backdrop\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
    assert.match(metadataStyles, /\.meta-api-dialog-backdrop::before\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(metadataStyles, /\.meta-api-dialog-backdrop::before\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
    assert.match(multiRenameStyles, /\.folder-dialog-backdrop\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0,\s*0\.5\)[^}]*backdrop-filter:\s*blur\(10px\)/);
    assert.match(multiRenameStyles, /\.folder-dialog-backdrop\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(10px\)/);
});
