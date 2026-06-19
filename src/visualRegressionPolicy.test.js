import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  VISUAL_BASELINE_GROUPS,
  VISUAL_CAPTURE_SCALES,
  VISUAL_REQUIRED_CAPTURE_COUNT,
  buildVisualCaptureMatrix,
  comparePngBuffers,
  VISUAL_STYLE_CONTRACTS,
  matchVisualGroup,
  normalizeVisualPath,
  summarizeVisualComparison,
} from './visualRegressionPolicy.js';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const baselineRoot = path.join(projectRoot, 'old_project', 'ui_screenshot');

function walkPngFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkPngFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(fullPath);
  }
  return files.sort((left, right) => normalizeVisualPath(left).localeCompare(normalizeVisualPath(right)));
}

function pngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${filePath} must be a PNG file`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pngChunk(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(0, 0);
  return Buffer.concat([header, data, crc]);
}

function makePng({ width, height, pixels }) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const rowLength = width * 4;
  const raw = Buffer.alloc((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (rowLength + 1);
    raw[rawOffset] = 0;
    pixels.copy(raw, rawOffset + 1, row * rowLength, (row + 1) * rowLength);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('15.3 기준 스크린샷 manifest는 모든 탭과 설정 화면을 포함한다', () => {
  const files = walkPngFiles(baselineRoot);
  assert.equal(files.length, 32);

  for (const group of VISUAL_BASELINE_GROUPS) {
    const matched = files.filter(filePath => matchVisualGroup(filePath)?.id === group.id);
    assert.equal(matched.length, group.expectedCount, `${group.label} baseline count`);
    assert.deepEqual(
      matched.map(filePath => path.basename(filePath)),
      Array.from({ length: group.expectedCount }, (_, index) => `${index + 1}.png`),
    );
  }
});

test('15.3 기준 스크린샷은 캡처 재현에 필요한 창 크기를 보존한다', () => {
  const files = walkPngFiles(baselineRoot);
  const dimensions = files.map(filePath => ({ filePath, ...pngDimensions(filePath) }));

  assert.ok(dimensions.every(item => item.width > 0 && item.height > 0));
  assert.ok(dimensions.some(item => item.width === 2566 && item.height === 1398));
  assert.ok(dimensions.some(item => item.width === 508 && item.height === 876));
  assert.ok(dimensions.filter(item => item.width >= 1400 && item.height >= 1000).length >= 25);
  assert.deepEqual(VISUAL_CAPTURE_SCALES, [1, 1.25]);
});

test('15.3 비교 대상 시각 속성은 CSS 계약으로 고정한다', () => {
  for (const contract of VISUAL_STYLE_CONTRACTS) {
    const source = fs.readFileSync(path.join(projectRoot, contract.file), 'utf8');
    for (const fragment of contract.fragments) {
      assert.ok(
        source.includes(fragment),
        `${contract.file} must include visual contract fragment: ${fragment}`,
      );
    }
  }
});

test('15.3 현재 캡처 매트릭스는 기준 32장과 100%/125% 배율을 모두 요구한다', () => {
  const matrix = buildVisualCaptureMatrix();

  assert.equal(matrix.length, VISUAL_REQUIRED_CAPTURE_COUNT);
  assert.equal(VISUAL_REQUIRED_CAPTURE_COUNT, 64);
  assert.equal(matrix.filter(item => item.scale === 1).length, 32);
  assert.equal(matrix.filter(item => item.scale === 1.25).length, 32);
  assert.deepEqual(
    matrix.filter(item => item.groupId === 'settings').map(item => `${item.scenario}@${item.scale}`),
    ['1@1', '1@1.25', '2@1', '2@1.25', '3@1', '3@1.25'],
  );
});

test('15.3 PNG 비교는 크기와 픽셀 차이를 기록한다', () => {
  const baselinePixels = Buffer.from([
    0, 0, 0, 255,
    255, 255, 255, 255,
    20, 40, 60, 255,
    80, 100, 120, 255,
  ]);
  const changedPixels = Buffer.from([
    0, 0, 0, 255,
    250, 255, 255, 255,
    20, 40, 60, 255,
    80, 100, 120, 255,
  ]);
  const baseline = makePng({ width: 2, height: 2, pixels: baselinePixels });
  const changed = makePng({ width: 2, height: 2, pixels: changedPixels });
  const differentSize = makePng({ width: 1, height: 2, pixels: baselinePixels.subarray(0, 8) });

  const exact = comparePngBuffers(baseline, baseline);
  assert.equal(exact.dimensionsMatch, true);
  assert.equal(exact.diffPixels, 0);
  assert.equal(exact.diffRatio, 0);

  const pixelDiff = comparePngBuffers(baseline, changed);
  assert.equal(pixelDiff.dimensionsMatch, true);
  assert.equal(pixelDiff.diffPixels, 1);
  assert.equal(pixelDiff.diffRatio, 0.25);
  assert.equal(pixelDiff.maxChannelDelta, 5);

  const sizeDiff = comparePngBuffers(baseline, differentSize);
  assert.equal(sizeDiff.dimensionsMatch, false);
  assert.equal(sizeDiff.diffRatio, 1);
});

test('15.3 비교 요약은 실패 화면과 차이 수치를 보존한다', () => {
  const summary = summarizeVisualComparison([
    { groupId: 'folder', scenario: 1, scale: 1, dimensionsMatch: true, diffPixels: 0, diffRatio: 0, maxChannelDelta: 0 },
    { groupId: 'metadata', scenario: 7, scale: 1.25, dimensionsMatch: true, diffPixels: 12, diffRatio: 0.01, maxChannelDelta: 44 },
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.failures, [
    {
      groupId: 'metadata',
      scenario: 7,
      scale: 1.25,
      dimensionsMatch: true,
      diffPixels: 12,
      diffRatio: 0.01,
      maxChannelDelta: 44,
    },
  ]);
});
