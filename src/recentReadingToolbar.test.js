import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import * as recentReadingListState from './recentReadingListState.js';
import * as folderColumnLayout from './folderColumnLayout.js';
import { translate } from './utils/i18n.js';

const compiled = transformSync(fs.readFileSync(new URL('./components/folder/RecentReadingToolbar.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;
const module = { exports: {} };
const imports = {
    react: React,
    '../../recentReadingListState.js': recentReadingListState,
    '../../folderColumnLayout.js': folderColumnLayout,
};
new Function('module', 'exports', 'require', compiled)(module, module.exports, name => imports[name]);

function renderCount(kind, count, total, language) {
    const html = renderToStaticMarkup(React.createElement(module.exports.RecentReadingToolbar, {
        kind,
        options: recentReadingListState.defaultRecentListOptions(kind),
        extensions: [],
        count,
        total,
        t: (key, values) => translate(key, language, values),
    }));
    return html.match(/<span class="recent-list-result-count" role="status">([^<]+)<\/span>/)[1];
}

test('최근 목록이 1,000개 상한에 도달하면 표시 개수가 전체가 아닌 최신 목록 기준임을 안내한다', () => {
    for (const [language, expected] of [
        ['ko', '최근 1,000개 중 37개 표시'],
        ['en', 'Showing 37 from the latest 1,000 files'],
        ['ja', '最新1,000件のうち37件を表示'],
    ]) {
        for (const kind of ['recent-added', 'recent-updated']) {
            assert.equal(renderCount(kind, 37, 1000, language), expected);
            assert.equal(renderCount(kind, 1000, 1000, language), expected.replace('37', '1000'));
        }
    }
});

test('상한 미만 목록과 최근 읽음은 불러온 전체 개수와 필터 결과를 유지한다', () => {
    for (const language of ['ko', 'en', 'ja']) {
        for (const [kind, count, total] of [['recent-added', 37, 999], ['recent-updated', 0, 0], ['recent-reading', 12, 50]]) {
            assert.equal(renderCount(kind, count, total, language), translate('reading_lists.filtered_count', language, [count, total]));
        }
    }
});
