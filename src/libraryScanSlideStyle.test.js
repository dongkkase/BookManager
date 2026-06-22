import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));

function cssBlock(source, selector) {
    const start = source.indexOf(selector);
    assert.notEqual(start, -1, `${selector} block must exist`);
    const open = source.indexOf('{', start);
    const close = source.indexOf('}', open);
    return source.slice(open + 1, close);
}

test('라이브러리 스캔 슬라이드는 레일 무한 반복 대신 새 카드 진입 애니메이션을 사용한다', () => {
    const styles = readFileSync(path.join(srcRoot, 'styles/App.css'), 'utf8');
    const queueSource = readFileSync(path.join(srcRoot, 'hooks/useLockScanQueue.js'), 'utf8');
    const railBlock = cssBlock(styles, '.app-library-scan-rail');
    const cardBlock = cssBlock(styles, '.app-library-scan-card');

    assert.doesNotMatch(railBlock, /animation\s*:/);
    assert.match(cardBlock, /app-library-scan-card-enter\s+520ms/);
    assert.match(styles, /@keyframes app-library-scan-card-enter/);
    assert.match(queueSource, /LIBRARY_SCAN_SLIDE_INTERVAL_MS\s*=\s*900/);
});

test('라이브러리 인덱싱 단계는 카드 대신 작업 이미지를 표시한다', () => {
    const styles = readFileSync(path.join(srcRoot, 'styles/App.css'), 'utf8');
    const appSource = readFileSync(path.join(srcRoot, 'App.jsx'), 'utf8');
    const overlaySource = readFileSync(path.join(srcRoot, 'components/AppLockOverlay.jsx'), 'utf8');

    assert.match(appSource, /lockIsLibraryIndexing/);
    assert.match(overlaySource, /app-library-indexing-image/);
    assert.match(overlaySource, /workingAnimation/);
    assert.match(styles, /\.app-library-scan-stage\.is-indexing/);
    assert.match(styles, /\.app-library-indexing-image/);
});
