import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectRandomResource } from './resourceSelection.js';

test('선택한 트레이 이미지만 드래그 이미지로 표시한다', () => {
    const source = fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'resourcePolicy.js'),
        'utf8',
    );
    assert.match(source, /draganddrop\.png/);
    assert.doesNotMatch(source, /draganddrop[123]\.png/);

    const resources = ['tray'];
    assert.equal(selectRandomResource(resources, () => 0), 'tray');
    assert.equal(selectRandomResource(resources, () => 0.5), 'tray');
    assert.equal(selectRandomResource(resources, () => 0.999), 'tray');
});
