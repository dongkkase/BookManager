import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';

const filename = fileURLToPath(new URL('./ViewerComicTiledPage.jsx', import.meta.url));
const bundled = buildSync({
    stdin: { contents: fs.readFileSync(filename, 'utf8'), sourcefile: filename, resolveDir: path.dirname(filename), loader: 'jsx' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react'],
}).outputFiles[0].text;
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundled)(createRequire(import.meta.url), compiled, compiled.exports);
const { comicTiledPageRange } = compiled.exports;

test('125000px 만화는 보이는 구간과 한 화면 앞뒤의 원본 타일만 선택한다', () => {
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 50000, visibleEnd: 51800, overscanPixels: 1800,
    }), { start: 23, end: 26, visibleStart: 24, visibleEnd: 25 });
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 0, visibleEnd: 1800, overscanPixels: 1800,
    }), { start: 0, end: 1, visibleStart: 0, visibleEnd: 0 });
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 123500, visibleEnd: 125000, overscanPixels: 1800,
    }), { start: 59, end: 61, visibleStart: 60, visibleEnd: 61 });
});

test('화면 밖 페이지는 가까운 끝 타일 하나를 준비하며 경계에서 빈 타일을 만들지 않는다', () => {
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: -5000, visibleEnd: -3000,
    }), { start: 0, end: 0, visibleStart: 0, visibleEnd: 0 });
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 150000, visibleEnd: 160000,
    }), { start: 61, end: 61, visibleStart: 61, visibleEnd: 61 });
    assert.deepEqual(comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 4096, visibleEnd: 6144,
    }), { start: 2, end: 2, visibleStart: 2, visibleEnd: 2 });
});

test('축소 보기의 선읽기만 8개 목표로 제한하고 실제 보이는 타일은 생략하지 않는다', () => {
    const bounded = comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 50000, visibleEnd: 57000, overscanPixels: 7000,
    });
    assert.deepEqual(bounded, { start: 22, end: 29, visibleStart: 24, visibleEnd: 27 });
    assert.equal(bounded.end - bounded.start + 1, 8);
    const visible = comicTiledPageRange({
        sourceHeight: 125000, visibleStart: 50000, visibleEnd: 68000, overscanPixels: 18000,
    });
    assert.deepEqual(visible, { start: 24, end: 33, visibleStart: 24, visibleEnd: 33 });
});

test('타일 범위는 원본의 마지막 짧은 조각과 빈 문서를 구분한다', () => {
    const tail = comicTiledPageRange({ sourceHeight: 125000, visibleStart: 124950, visibleEnd: 125000 });
    assert.equal(tail.start, 61);
    assert.equal(tail.end, 61);
    assert.equal(125000 - tail.end * 2048, 72);
    assert.deepEqual(comicTiledPageRange({ sourceHeight: 0 }), { start: 0, end: -1, visibleStart: 0, visibleEnd: -1 });
});
