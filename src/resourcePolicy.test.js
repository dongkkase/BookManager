import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { selectRandomResource } from './resourceSelection.js';

test('세 종류의 원본 드래그 이미지를 선택 대상으로 사용한다', () => {
    const source = fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), 'resourcePolicy.js'),
        'utf8',
    );
    assert.match(source, /draganddrop1\.png/);
    assert.match(source, /draganddrop2\.png/);
    assert.match(source, /draganddrop3\.png/);

    const resources = ['one', 'two', 'three'];
    assert.equal(selectRandomResource(resources, () => 0), 'one');
    assert.equal(selectRandomResource(resources, () => 0.5), 'two');
    assert.equal(selectRandomResource(resources, () => 0.999), 'three');
});
