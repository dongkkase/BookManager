import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));

test('공통 스타일은 키보드 focus와 disabled 상호작용을 명확히 표시한다', () => {
    const styles = readFileSync(path.join(srcRoot, 'styles/global.css'), 'utf8');
    assert.match(styles, /button:focus-visible/);
    assert.match(styles, /outline:\s*2px solid/);
    assert.match(styles, /button:disabled[\s\S]*pointer-events:\s*none/);
    assert.match(styles, /\[role="button"\]:not\(\[aria-disabled="true"\]\)[\s\S]*cursor:\s*pointer/);
});

test('주요 모달은 dialog semantics와 modal focus 정책을 사용한다', () => {
    const settings = readFileSync(path.join(srcRoot, 'components/SettingsModal.jsx'), 'utf8');
    const resultLog = readFileSync(path.join(srcRoot, 'components/ResultLogDialog.jsx'), 'utf8');
    const missing = readFileSync(path.join(srcRoot, 'components/folder/MissingVolumesDialog.jsx'), 'utf8');
    for (const source of [settings, resultLog, missing]) {
        assert.match(source, /role="dialog"/);
        assert.match(source, /aria-modal="true"/);
        assert.match(source, /useModalAccessibility/);
    }
});

test('작업 실행 함수는 동기 잠금으로 빠른 중복 실행을 막는다', () => {
    for (const filename of ['OrganizerTab.jsx', 'RenamerTab.jsx', 'MetadataTab.jsx']) {
        const source = readFileSync(path.join(srcRoot, 'tabs', filename), 'utf8');
        assert.match(source, /LockRef\.current/);
    }
});
