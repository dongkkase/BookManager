import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    IMPLEMENTATION_AUDIT_TARGETS,
    implementationAuditTargetCount,
} from './implementationAuditPolicy.js';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

test('16 구현 파일 감사 대상은 체크리스트의 28개 파일을 모두 추적한다', () => {
    assert.equal(implementationAuditTargetCount(), 28);

    const files = IMPLEMENTATION_AUDIT_TARGETS.map(target => target.file);
    assert.equal(new Set(files).size, files.length);
    assert.ok(files.includes('src/App.jsx'));
    assert.ok(files.includes('electron/ipcHandlers.js'));
    assert.ok(files.includes('electron/database/library_db.js'));
});

test('16 구현 파일 감사 대상은 실제 파일과 핵심 책임 단서를 가진다', () => {
    for (const target of IMPLEMENTATION_AUDIT_TARGETS) {
        const absolutePath = path.join(projectRoot, target.file);
        assert.ok(fs.existsSync(absolutePath), `${target.file} must exist`);
        assert.ok(target.scope, `${target.file} must describe an audit scope`);
        assert.ok(target.fragments.length >= 4, `${target.file} must have enough audit fragments`);

        const source = fs.readFileSync(absolutePath, 'utf8');
        for (const fragment of target.fragments) {
            assert.ok(
                source.includes(fragment),
                `${target.file} must include ${target.scope} fragment: ${fragment}`,
            );
        }
    }
});
