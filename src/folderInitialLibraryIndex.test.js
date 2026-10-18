import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./tabs/FolderTab.jsx', import.meta.url)), 'utf8');

test('라이브러리 작업의 메타데이터 단계와 진행 상태를 유지한다', () => {
    assert.match(source, /metadata-initial/);
    assert.match(source, /libraryPhaseRef\.current\s*=\s*libraryPhase/);
    assert.match(source, /libraryPhase:\s*libraryPhaseRef\.current\s*\|\|/);
});

test('라이브러리 작업은 하위 폴더 포함 초기화 옵션을 목록 갱신에 반영한다', () => {
    assert.match(source, /const shouldResetIncludeSubfolders\s*=\s*options\.resetIncludeSubfoldersOnComplete\s*===\s*true/);
    assert.match(source, /const nextIncludeSubfolders\s*=\s*optimizeMetadata[\s\S]*\?\s*\(shouldResetIncludeSubfolders\s*\?\s*false\s*:\s*true\)/);
    assert.match(source, /includeSubfolders:\s*nextIncludeSubfolders/);
    assert.match(source, /setIncludeSubfolders\(nextIncludeSubfolders\)/);
});

test('수동 메타데이터 최적화는 인덱싱 없이 기존 인덱스 목록만 처리하도록 요청한다', () => {
    assert.match(source, /metadataOnly:\s*optimizeMetadata\s*&&\s*!options\.showIndexingVisual/);
    assert.match(source, /const shouldForceMetadata = optimizeMetadata && \(/);
    assert.match(source, /typeof options\.forceMetadata === 'boolean'[\s\S]*: choice === 'force'/);
    assert.match(source, /forceMetadata:\s*shouldForceMetadata/);
    assert.match(source, /skipCoverExtraction:\s*false/);
});

test('폴더 스캔 진행 이벤트는 락 상태로 올리지 않는다', () => {
    assert.match(source, /if \(data\?\.task === 'folder:scan'\) \{\s*return;\s*\}/);
});
