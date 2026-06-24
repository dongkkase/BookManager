import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildCsvContent,
  resolveCsvExportPath,
} from './csvExport.js';

test('CSV export paths keep existing CSV extensions on Windows', () => {
  assert.equal(
    resolveCsvExportPath('C:\\Users\\reader\\Desktop\\Library.CSV', path.win32),
    'C:\\Users\\reader\\Desktop\\Library.CSV',
  );
  assert.equal(
    resolveCsvExportPath('C:\\Users\\reader\\Desktop\\Library', path.win32),
    'C:\\Users\\reader\\Desktop\\Library.csv',
  );
});

test('CSV content is UTF-8 BOM encoded text with CRLF rows', () => {
  const content = buildCsvContent(
    ['제목', '작가', '메모'],
    [
      ['엠마, 01권', '모리 "카오루"', '첫 줄\n둘째 줄'],
      ['빈 값', null, undefined],
    ],
  );

  assert.equal(content.charCodeAt(0), 0xfeff);
  assert.match(content, /\r\n/);
  assert.equal(
    content,
    '\uFEFF"제목","작가","메모"\r\n"엠마, 01권","모리 ""카오루""","첫 줄\n둘째 줄"\r\n"빈 값","",""\r\n',
  );
});
