import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('모든 창이 닫히면 macOS에서도 앱 프로세스를 종료한다', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');

    assert.match(
        mainSource,
        /app\.on\('window-all-closed',\s*\(\)\s*=>\s*\{\s*app\.quit\(\);\s*\}\);/,
    );
    assert.doesNotMatch(mainSource, /window-all-closed[\s\S]{0,120}process\.platform\s*!==\s*'darwin'/);
});
