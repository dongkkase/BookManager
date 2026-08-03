import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metadataSource = readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');
const metadataStyles = readFileSync(new URL('./styles/MetadataTab.css', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('./components/SettingsModal.jsx', import.meta.url), 'utf8');
const ipcSource = readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
const preloadCjsSource = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');

test('선택한 책의 표지를 AI 제목 식별 IPC로 전달한다', () => {
    assert.match(metadataSource, /sourceFilePath=\{activeItem\?\.filepath \|\| ''\}/);
    assert.match(metadataSource, /sourceCoverDataUrl=\{activeItem\?\.coverDataUrl \|\| ''\}/);
    assert.match(metadataSource, /identifyMetadataCoverTitles/);
    assert.match(ipcSource, /ipcMain\.handle\('api:identifyCoverTitles'/);
    assert.match(ipcSource, /loadMetadataCover\(options\.filePath/);
    assert.match(preloadSource, /identifyMetadataCoverTitles:[\s\S]*api:identifyCoverTitles/);
    assert.match(preloadCjsSource, /identifyMetadataCoverTitles:[\s\S]*api:identifyCoverTitles/);
});

test('AI 제목 후보는 검색어 combobox에서 선택 즉시 검색한다', () => {
    assert.match(metadataSource, /role="combobox"/);
    assert.match(metadataSource, /role="listbox"/);
    assert.match(metadataSource, /meta_ai_title_native/);
    assert.match(metadataSource, /meta_ai_title_english/);
    assert.match(metadataSource, /meta_ai_title_korean/);
    assert.match(metadataSource, /selectAiTitleCandidate[\s\S]*runSearch\(1, candidate\.query\)/);
    assert.match(metadataStyles, /\.meta-ai-title-options\s*\{/);
    assert.match(metadataStyles, /\.meta-ai-title-option\.active/);
});

test('동일 표지는 검색어 힌트와 무관하게 AI 식별 캐시를 재사용한다', () => {
    assert.match(ipcSource, /const cacheKey = `\$\{provider\}:\$\{model\}:\$\{COVER_TITLE_PROMPT_VERSION\}:\$\{thumbnail\.hash\}`/);
    assert.doesNotMatch(ipcSource, /titleHint/);
    assert.doesNotMatch(metadataSource, /titleHint:/);
});

test('Gemini와 OpenAI 모두 표지 판독 후 웹 검색으로 제목을 검증한다', () => {
    const geminiVerificationSource = ipcSource.match(
        /async function verifyCoverWithGemini[\s\S]*?async function identifyCoverTitlesFromImage/
    )?.[0] || '';

    assert.match(ipcSource, /observeCoverWithGemini/);
    assert.match(ipcSource, /verifyCoverWithGemini/);
    assert.match(ipcSource, /tools: \[\{ google_search: \{\} \}\]/);
    assert.doesNotMatch(geminiVerificationSource, /responseMimeType/);
    assert.match(ipcSource, /observeCoverWithOpenAi/);
    assert.match(ipcSource, /verifyCoverWithOpenAi/);
    assert.match(ipcSource, /https:\/\/api\.openai\.com\/v1\/responses/);
    assert.match(ipcSource, /tools: \[\{ type: 'web_search' \}\]/);
    assert.match(ipcSource, /tool_choice: 'required'/);
    assert.match(ipcSource, /api_cover_title_verification_failed/);
});

test('AI 원제 찾기 버튼을 검색 컨트롤 맨 앞에 배치하고 높이를 통일한다', () => {
    assert.match(metadataSource, /meta-api-search-controls">\s*<button[\s\S]*?className="meta-ai-title-btn"[\s\S]*?<select value=\{dialogApi\}/);
    assert.match(metadataStyles, /\.meta-api-search-controls > select,[\s\S]*?\.meta-api-search-controls > \.meta-ai-title-combobox,[\s\S]*?\.meta-api-search-controls > button\s*\{[\s\S]*?height: var\(--control-height-lg\)/);
    assert.match(metadataStyles, /\.meta-ai-title-input\s*\{[\s\S]*?height: 100%/);
});

test('환경설정은 AI 표지 제목 검색용 제공자와 API Key만 표시한다', () => {
    assert.match(settingsSource, /t\('ai_cover_search_group'\)/);
    assert.match(settingsSource, /aiProvider = localConfig\.api_keys\?\.ai_provider === 'OpenAI'/);
    assert.match(settingsSource, /aiKeyField = aiProvider === 'OpenAI' \? 'ai_openai_key' : 'ai_gemini_key'/);
    assert.match(settingsSource, /renderSecretInput\(\s*aiKeyField/);
    assert.doesNotMatch(settingsSource, /ai_trans_enabled|ai_trans_enable/);
    assert.doesNotMatch(ipcSource, /ai_trans_enabled/);
});

test('AniList·Comic Vine·Amazon 검색은 자동 원제 변환 없이 입력한 제목을 그대로 사용한다', () => {
    assert.doesNotMatch(ipcSource, /identifyOriginalTitles|NamuWiki|titleCandidates/);
    assert.match(ipcSource, /results = await searchAnilist\(query, page\)/);
    assert.match(ipcSource, /results = await searchAmazon\(query, page\)/);
    assert.match(ipcSource, /results = await searchVine\(query, apiKeys\.vine \|\| '', page\)/);
});
