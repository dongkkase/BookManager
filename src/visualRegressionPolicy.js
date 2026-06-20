import zlib from 'node:zlib';

export const VISUAL_BASELINE_GROUPS = Object.freeze([
  {
    id: 'folder',
    label: '폴더 탭',
    pathIncludes: '1. 폴더 메뉴',
    expectedCount: 9,
  },
  {
    id: 'organizer',
    label: '구조 정리 탭',
    pathIncludes: '2. 압축 파일 구조 정리',
    expectedCount: 5,
  },
  {
    id: 'renamer',
    label: '내부 이름 변경 탭',
    pathIncludes: '3. 내부 파일명 변경',
    expectedCount: 4,
  },
  {
    id: 'metadata',
    label: '메타데이터 탭',
    pathIncludes: '4. 메타데이터 관리',
    expectedCount: 9,
  },
  {
    id: 'sharing',
    label: '공유 서버 탭',
    pathIncludes: '5. 공유 서버',
    expectedCount: 2,
  },
  {
    id: 'release',
    label: '릴리즈 탭',
    pathIncludes: '6. 업데이트 및 릴리즈 노트',
    expectedCount: 1,
  },
  {
    id: 'settings',
    label: '환경설정',
    pathIncludes: '환경 설정',
    expectedCount: 3,
  },
]);

export const VISUAL_CAPTURE_SCALES = Object.freeze([1, 1.25]);

export const VISUAL_REQUIRED_CAPTURE_COUNT = Object.freeze(
  VISUAL_BASELINE_GROUPS.reduce((total, group) => total + group.expectedCount, 0) * VISUAL_CAPTURE_SCALES.length,
);

export const VISUAL_STYLE_CONTRACTS = Object.freeze([
  {
    file: 'src/styles/global.css',
    fragments: [
      '::-webkit-scrollbar',
      '::-webkit-scrollbar-thumb:hover',
      ':focus-visible',
      '--bg-primary: #1e1e1e',
      '--accent-primary: #007acc',
      '--spacing-sm: 8px',
    ],
  },
  {
    file: 'src/styles/App.css',
    fragments: [
      '.app-container',
      'overflow: hidden',
      '.top-btn:hover:not(:disabled)',
      '.result-log-continue',
    ],
  },
  {
    file: 'src/styles/FolderTab.css',
    fragments: [
      '.folder-resizer-vertical:hover',
      '.dropdown-menu-up',
      '.dropdown-item:hover',
      '.goto-path-input:focus',
      'border-left: 1px dashed #666',
    ],
  },
  {
    file: 'src/styles/OrganizerTab.css',
    fragments: [
      '.organizer-tab',
      ':hover',
      'overflow',
    ],
  },
  {
    file: 'src/styles/RenamerTab.css',
    fragments: [
      '.renamer-tab',
      ':hover',
      'overflow',
    ],
  },
  {
    file: 'src/styles/MetadataTab.css',
    fragments: [
      '.metadata-tab',
      '.meta-api-dialog',
      ':hover',
      'overflow',
    ],
  },
  {
    file: 'src/styles/SharingTab.css',
    fragments: [
      '.sharing-tab',
      '.sharing-log-console',
      'white-space: pre-wrap',
      ':hover',
    ],
  },
  {
    file: 'src/styles/ReleaseTab.css',
    fragments: [
      '.release-tab',
      '.release-card',
      'white-space: pre-line',
      'overflow',
    ],
  },
]);

export function normalizeVisualPath(value = '') {
  return String(value).normalize('NFC');
}

export function matchVisualGroup(filePath, groups = VISUAL_BASELINE_GROUPS) {
  const normalized = normalizeVisualPath(filePath);
  return groups.find(group => normalized.includes(group.pathIncludes)) || null;
}

function readChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function bytesPerPixel(colorType) {
  if (colorType === 6) return 4;
  if (colorType === 2) return 3;
  throw new Error(`Unsupported PNG color type for visual regression: ${colorType}`);
}

function unfilterScanline(filterType, current, previous, bpp) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bpp ? current[index - bpp] : 0;
    const up = previous ? previous[index] : 0;
    const upLeft = previous && index >= bpp ? previous[index - bpp] : 0;
    let predictor = 0;

    if (filterType === 1) predictor = left;
    else if (filterType === 2) predictor = up;
    else if (filterType === 3) predictor = Math.floor((left + up) / 2);
    else if (filterType === 4) {
      const estimate = left + up - upLeft;
      const distanceLeft = Math.abs(estimate - left);
      const distanceUp = Math.abs(estimate - up);
      const distanceUpLeft = Math.abs(estimate - upLeft);
      predictor = distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
    } else if (filterType !== 0) {
      throw new Error(`Unsupported PNG filter type for visual regression: ${filterType}`);
    }

    current[index] = (current[index] + predictor) & 0xff;
  }
}

export function decodePngPixels(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('PNG input must be a Buffer');
  }
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Visual regression input must be a PNG file');
  }

  const chunks = readChunks(buffer);
  const ihdr = chunks.find(chunk => chunk.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('PNG is missing IHDR');

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);
  const compression = ihdr.readUInt8(10);
  const filter = ihdr.readUInt8(11);
  const interlace = ihdr.readUInt8(12);

  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('Visual regression only supports non-interlaced 8-bit PNG screenshots');
  }

  const bpp = bytesPerPixel(colorType);
  const inflated = zlib.inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let targetOffset = 0;
  let previous = null;

  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    const current = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    unfilterScanline(filterType, current, previous, bpp);

    for (let column = 0; column < width; column += 1) {
      const source = column * bpp;
      rgba[targetOffset] = current[source];
      rgba[targetOffset + 1] = current[source + 1];
      rgba[targetOffset + 2] = current[source + 2];
      rgba[targetOffset + 3] = bpp === 4 ? current[source + 3] : 255;
      targetOffset += 4;
    }

    previous = current;
  }

  return { width, height, pixels: rgba };
}

export function comparePngBuffers(baselineBuffer, actualBuffer, options = {}) {
  const pixelThreshold = options.pixelThreshold ?? 0;
  const baseline = decodePngPixels(baselineBuffer);
  const actual = decodePngPixels(actualBuffer);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      dimensionsMatch: false,
      width: { baseline: baseline.width, actual: actual.width },
      height: { baseline: baseline.height, actual: actual.height },
      comparedPixels: 0,
      diffPixels: 0,
      diffRatio: 1,
      maxChannelDelta: 255,
    };
  }

  let diffPixels = 0;
  let maxChannelDelta = 0;
  const comparedPixels = baseline.width * baseline.height;
  for (let offset = 0; offset < baseline.pixels.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(baseline.pixels[offset + channel] - actual.pixels[offset + channel]);
      if (delta > maxChannelDelta) maxChannelDelta = delta;
      if (delta > pixelThreshold) pixelChanged = true;
    }
    if (pixelChanged) diffPixels += 1;
  }

  return {
    dimensionsMatch: true,
    width: { baseline: baseline.width, actual: actual.width },
    height: { baseline: baseline.height, actual: actual.height },
    comparedPixels,
    diffPixels,
    diffRatio: comparedPixels === 0 ? 0 : diffPixels / comparedPixels,
    maxChannelDelta,
  };
}

export function buildVisualCaptureMatrix(groups = VISUAL_BASELINE_GROUPS, scales = VISUAL_CAPTURE_SCALES) {
  return groups.flatMap(group =>
    Array.from({ length: group.expectedCount }, (_, index) =>
      scales.map(scale => ({
        groupId: group.id,
        label: group.label,
        scenario: index + 1,
        scale,
      })),
    ).flat(),
  );
}

export function summarizeVisualComparison(results) {
  const failed = results.filter(result => !result.dimensionsMatch || result.diffPixels > 0);
  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failures: failed.map(result => ({
      groupId: result.groupId,
      scenario: result.scenario,
      scale: result.scale,
      dimensionsMatch: result.dimensionsMatch,
      diffPixels: result.diffPixels,
      diffRatio: result.diffRatio,
      maxChannelDelta: result.maxChannelDelta,
    })),
  };
}
