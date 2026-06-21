import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, 'ipcHandlers.js'), 'utf8');

test('metadataOnly 최적화는 기존 인덱스 목록을 사용하고 인덱싱 스캔과 분리된다', () => {
    assert.match(source, /const metadataOnly = shouldOptimizeMetadata && options\.metadataOnly === true/);
    assert.match(source, /if \(metadataOnly\) \{[\s\S]*await db\.getTargetIndex\(folder\)/);
    assert.match(source, /metadataTargetsByFolder\.set\(folder,\s*targets\)/);
    assert.match(source, /\} else \{[\s\S]*scanArchivePaths\(/);
});
