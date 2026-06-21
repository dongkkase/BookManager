import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('라이브러리 최초 등록 자동 작업은 메타데이터와 썸네일 추출까지 실행한다', () => {
    assert.match(source, /pendingInitialLibraryIndexRef\.current\s*=\s*folderPath/);
    assert.match(source, /runLibraryIndexAction\(folderPath,\s*true,\s*{[\s\S]*mode:\s*'smart'[\s\S]*skipPrompt:\s*true/);
    assert.match(source, /showIndexingVisual:\s*true/);
    assert.match(source, /metadata-initial/);
    assert.match(source, /libraryPhaseRef\.current\s*=\s*libraryPhase/);
    assert.match(source, /libraryPhase:\s*libraryPhaseRef\.current\s*\|\|/);
});

test('수동 메타데이터 최적화는 인덱싱 없이 기존 인덱스 목록만 처리하도록 요청한다', () => {
    assert.match(source, /metadataOnly:\s*optimizeMetadata\s*&&\s*!options\.showIndexingVisual/);
});

test('폴더 스캔 진행 이벤트는 락 상태로 올리지 않는다', () => {
    assert.match(source, /if \(data\?\.task === 'folder:scan'\) \{\s*return;\s*\}/);
});
