import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'ipcHandlers.js'), 'utf8');
const folderScanSource = readFileSync(path.join(root, 'tasks', 'folderScanTask.js'), 'utf8');

test('metadataOnly 최적화는 기존 인덱스 목록을 사용하고 인덱싱 스캔과 분리된다', () => {
    assert.match(source, /const metadataOnly = shouldOptimizeMetadata && options\.metadataOnly === true/);
    assert.match(source, /if \(metadataOnly\) \{[\s\S]*await db\.getTargetIndex\(folder\)/);
    assert.match(source, /metadataTargetsByFolder\.set\(folder,\s*targets\)/);
    assert.match(source, /\} else \{[\s\S]*scanArchivePaths\(/);
});

test('라이브러리 메타데이터 추출은 제한된 병렬 처리와 분리된 강제 재처리 옵션을 사용한다', () => {
    assert.match(source, /const DEFAULT_LIBRARY_METADATA_CONCURRENCY/);
    assert.match(source, /const MAX_LIBRARY_METADATA_CONCURRENCY/);
    assert.match(source, /const metadataConcurrency = resolveLibraryMetadataConcurrency\(options\)/);
    assert.match(source, /options\.metadataConcurrency \?\? options\.maxThreads \?\? options\.max_threads/);
    assert.match(source, /metadataConcurrency:\s*options\.metadataConcurrency \?\? options\.max_threads \?\? config\.max_threads/);
    assert.match(source, /await Promise\.all\([\s\S]*Array\.from\(/);
    assert.match(source, /const forceMetadata = mode === 'force'[\s\S]*options\.forceMetadata === true/);
    assert.match(source, /const skipMetadataCoverExtraction = options\.skipCoverExtraction === true/);
    assert.match(source, /force:\s*forceMetadata/);
    assert.match(source, /skipCoverExtraction:\s*skipMetadataCoverExtraction/);
    assert.match(source, /skipCoverExtraction,\s*[\r\n\s]*lang,/);
});

test('7z 계열 메타데이터 전용 추출은 전체 목록 조회 없이 ComicInfo를 직접 읽는다', () => {
    assert.match(folderScanSource, /if \(options\.skipCoverExtraction\) \{[\s\S]*\['e', '-so', '-ssc-', '-r', filePath, 'ComicInfo\.xml'\]/);
});
