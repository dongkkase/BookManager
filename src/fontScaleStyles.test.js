import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(target);
        }
        return /\.(?:css|jsx)$/.test(entry.name) ? [target] : [];
    });
}

test('CSS와 JSX의 글꼴 크기는 배율 변수만 사용한다', () => {
    const violations = [];
    for (const filename of sourceFiles(srcRoot)) {
        const source = readFileSync(filename, 'utf8');
        if (/font-size\s*:\s*\d+(?:\.\d+)?px/i.test(source)
            || /fontSize\s*:\s*['"]\d+(?:\.\d+)?px['"]/i.test(source)) {
            violations.push(path.relative(srcRoot, filename));
        }
    }
    assert.deepEqual(violations, []);
});

test('표, 체크박스, 아이콘 컨트롤은 공통 배율 변수를 사용한다', () => {
    const globalStyles = readFileSync(path.join(srcRoot, 'styles/global.css'), 'utf8');
    const folderStyles = readFileSync(path.join(srcRoot, 'styles/FolderTab.css'), 'utf8');
    const metadataStyles = readFileSync(path.join(srcRoot, 'styles/MetadataTab.css'), 'utf8');
    const iconSource = readFileSync(path.join(srcRoot, 'components/FaIcon.jsx'), 'utf8');

    assert.match(globalStyles, /--control-height:\s*28px/);
    assert.match(globalStyles, /--checkbox-size:\s*16px/);
    assert.match(folderStyles, /padding:\s*var\(--table-cell-y\)\s+6px/);
    assert.match(folderStyles, /\.view-icon-btn[\s\S]*width:\s*var\(--control-height\)/);
    assert.match(metadataStyles, /\.meta-choice input,[\s\S]*width:\s*var\(--checkbox-size\)/);
    assert.match(iconSource, /var\(--font-scale(?:,\s*1)?\)/);
});
