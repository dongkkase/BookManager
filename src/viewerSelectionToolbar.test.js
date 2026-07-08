import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from './utils/i18n.js';

const viewerSource = readFileSync(fileURLToPath(new URL('./ViewerApp.jsx', import.meta.url)), 'utf8');
const viewerCss = readFileSync(fileURLToPath(new URL('./styles/viewer.css', import.meta.url)), 'utf8');
const viewerWindowSource = readFileSync(fileURLToPath(new URL('../electron/viewerWindow.js', import.meta.url)), 'utf8');

function callbackSource(name) {
    const match = viewerSource.match(new RegExp(`const ${name} = useCallback\\([\\s\\S]*?\\n  \\}, \\[`));
    return match?.[0] || '';
}

test('텍스트 선택 후 플로팅 툴바를 표시한다', () => {
    assert.match(viewerSource, /const TEXT_SELECTION_PAGE_SELECTOR/);
    assert.match(viewerSource, /function selectionFocusPoint/);
    assert.match(viewerSource, /const showTextSelectionToolbar = useCallback/);
    assert.match(viewerSource, /selectionMenu\.kind === 'text-selection'/);
    assert.match(viewerSource, /window\.requestAnimationFrame\(\(\) => \{\s*showTextSelectionToolbar/);
});

test('선택 툴바는 요청된 텍스트 액션을 제공한다', () => {
    assert.match(viewerSource, /const searchBookFromSelection = useCallback/);
    assert.match(viewerSource, /const openSelectionDictionary = useCallback/);
    assert.match(viewerSource, /const openLookupWindow = useCallback/);
    assert.match(viewerSource, /setLookupPanel\(\{/);
    assert.match(viewerSource, /dict\.naver\.com\/search\.dict\?query=/);
    assert.match(viewerSource, /www\.google\.com\/search\?q=/);
    assert.match(viewerSource, /const openSelectionTranslation = useCallback/);
    assert.match(viewerSource, /translate\.google\.com\/\?sl=auto/);
    assert.match(viewerSource, /www\.deepl\.com\/translator#auto/);
    assert.match(viewerSource, /void openLookupWindow\(url, title\)/);
    assert.match(viewerSource, /const speakSelectionText = useCallback/);
    assert.match(viewerSource, /new window\.SpeechSynthesisUtterance\(text\)/);
});

test('선택 툴바 스타일과 다국어 문구를 제공한다', () => {
    assert.match(viewerCss, /\.viewer-selection-toolbar \{/);
    assert.match(viewerCss, /\.viewer-selection-menu-list \{/);
    assert.match(viewerCss, /bottom:\s*calc\(100% - 1px\)/);
    assert.match(viewerCss, /top:\s*calc\(100% - 1px\)/);
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [
            'viewer.context.search_in_book',
            'viewer.context.dictionary_search',
            'viewer.context.translate',
            'viewer.context.tts_selection',
            'viewer.context.selection_toolbar',
            'viewer.lookup.title',
            'viewer.lookup.loading',
            'viewer.lookup.open_failed',
        ]) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
});

test('선택 사전과 번역은 외부 브라우저 대신 우측 슬라이드 패널을 사용한다', () => {
    assert.match(viewerSource, /function ViewerLookupPanel/);
    assert.match(viewerSource, /<webview/);
    assert.match(viewerSource, /className="viewer-lookup-panel"/);
    assert.match(viewerSource, /<ViewerLookupPanel lookup=\{lookupPanel\} onClose=\{\(\) => setLookupPanel\(null\)\} \/>/);
    assert.match(viewerCss, /\.viewer-lookup-panel \{/);
    assert.match(viewerCss, /right:\s*0/);
    assert.match(viewerCss, /animation:\s*viewerLookupSlideIn/);
    assert.match(viewerCss, /\.viewer-lookup-webview \{/);
    assert.match(viewerWindowSource, /webviewTag:\s*true/);
    assert.doesNotMatch(viewerSource, /window\.viewerAPI\.openLookup/);
    assert.doesNotMatch(viewerWindowSource, /ipcMain\.handle\('viewer:openLookup'/);
});

test('선택 사전과 번역을 열어도 선택 영역과 플로팅 툴바를 유지한다', () => {
    const dictionarySource = callbackSource('openSelectionDictionary');
    const translationSource = callbackSource('openSelectionTranslation');
    assert.match(dictionarySource, /void openLookupWindow\(url, title\)/);
    assert.match(translationSource, /void openLookupWindow\(url, title\)/);
    assert.doesNotMatch(dictionarySource, /setSelectionMenu\(null\)|clearNativeSelection\(\)/);
    assert.doesNotMatch(translationSource, /setSelectionMenu\(null\)|clearNativeSelection\(\)/);
    assert.match(viewerSource, /\.viewer-context-menu, \.viewer-selection-toolbar, \.viewer-lookup-panel/);
    assert.match(viewerSource, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
});

test('Esc는 옵션, 도움말, 목차 패널을 뷰어 창보다 먼저 닫는다', () => {
    assert.match(viewerSource, /event\.key === 'Escape' && \(settingsOpen \|\| navigationPanelOpen \|\| helpOpen\)/);
    assert.match(viewerSource, /setSettingsOpen\(false\);[\s\S]*?setNavigationPanelOpen\(false\);[\s\S]*?setHelpOpen\(false\);[\s\S]*?return;/);
    assert.match(viewerSource, /else if \(event\.key === 'Escape'\) \{[\s\S]*?window\.viewerAPI\?\.closeWindow\?\.\(\)/);
    for (const language of ['ko', 'en', 'ja']) {
        assert.notEqual(translate('viewer.help.shortcut_escape', language), 'viewer.help.shortcut_escape');
    }
});
