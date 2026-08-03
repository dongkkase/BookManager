import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ipcSource = readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../src/utils/i18nData.js', import.meta.url), 'utf8');

test('Google Books HTTP 오류는 API 응답 메시지를 유지하고 키 문자열을 숨긴다', () => {
    assert.match(ipcSource, /apiMessage = parsed\?\.error\?\.message \|\| parsed\?\.message/);
    assert.match(ipcSource, /replace\(\/\\bAIza/);
    assert.match(ipcSource, /new Error\(`HTTP \$\{res\.statusCode\}\$\{apiMessage/);
});

test('만료된 Google Books API 키는 환경설정 안내로 변환한다', () => {
    assert.match(ipcSource, /api key expired[\s\S]*api_google_books_key_expired/i);
    assert.match(i18nSource, /"api_google_books_key_expired"/);
});
