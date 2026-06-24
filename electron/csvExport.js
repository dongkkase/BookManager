import path from 'path';

export function resolveCsvExportPath(filePath = '', pathModule = path) {
  const targetPath = String(filePath || '');
  return pathModule.extname(targetPath).toLowerCase() === '.csv'
    ? targetPath
    : `${targetPath}.csv`;
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsvContent(headers = [], rows = [], lineEnding = '\r\n') {
  const safeHeaders = Array.isArray(headers) ? headers : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const lines = [
    safeHeaders.map(escapeCsvCell).join(','),
    ...safeRows.map(row => (Array.isArray(row) ? row : []).map(escapeCsvCell).join(',')),
  ];
  return `\uFEFF${lines.join(lineEnding)}${lineEnding}`;
}
