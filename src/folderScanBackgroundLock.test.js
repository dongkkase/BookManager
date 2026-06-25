import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./hooks/useFolderScan.js', import.meta.url)), 'utf8');

test('fastInitial 백그라운드 보강 스캔은 앱 잠금 상태를 만들지 않는다', () => {
    assert.match(source, /const fastInitial = options\.fastInitial === true/);
    assert.doesNotMatch(source, /backgroundScanning/);
    assert.doesNotMatch(source, /emitStatusState\('folder'/);
    assert.match(source, /background:\s*true/);
    assert.match(source, /skipCoverExtraction:\s*true/);
    assert.match(source, /reportTaskProgress:\s*false/);
    assert.match(source, /return \{[\s\S]*scanning,/);
});
