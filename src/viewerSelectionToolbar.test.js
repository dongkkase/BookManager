import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from './utils/i18n.js';
import { HIGHLIGHT_COLORS, highlightBackground } from './highlightColors.js';
import { runInNewContext } from 'node:vm';

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
    assert.match(viewerSource, /function speakDetachedRemoteTts/);
    assert.match(viewerSource, /isRemoteTtsEngine\(settings\.engine\)/);
    assert.match(viewerSource, /await speakDetachedRemoteTts\([\s\S]*?viewerLanguage,[\s\S]*?handleSelectionTtsPlaybackStart/);
    assert.match(viewerSource, /new window\.SpeechSynthesisUtterance\(text\)/);
});

test('선택 영역 TTS는 실제 재생 전까지 회전 로딩 아이콘을 표시한다', () => {
    assert.match(viewerSource, /const \[selectionTtsLoading, setSelectionTtsLoading\] = useState\(false\)/);
    assert.match(viewerSource, /if \(selectionTtsLoading\) return/);
    assert.match(viewerSource, /function playDetachedRemoteTtsAudio\([^)]*onPlaybackStart\)/);
    assert.match(viewerSource, /audio\.onplaying = notifyPlaybackStart/);
    assert.match(viewerSource, /playPromise\.then\(notifyPlaybackStart\)\.catch\(fail\)/);
    assert.match(viewerSource, /if \(playbackStarted\) return;[\s\S]*?onPlaybackStart\?\.\(\)/);
    assert.match(viewerSource, /if \(!playbackStarted && shouldStartPlayback\?\.\(\) === false\) return/);
    assert.match(viewerSource, /\(\) => selectionTtsRunRef\.current === runId/);
    assert.match(viewerSource, /utterance\.onstart = handleSelectionTtsPlaybackStart/);
    assert.match(viewerSource, /utterance\.onend = finishSelectionTtsLoading/);
    assert.match(viewerSource, /aria-busy=\{selectionTtsLoading\}/);
    assert.match(viewerSource, /disabled=\{selectionTtsLoading\}/);
    assert.match(viewerSource, /name=\{selectionTtsLoading \? 'spinner' : 'volumeHigh'\}/);
    assert.match(viewerSource, /className=\{selectionTtsLoading \? 'viewer-selection-tts-spinner' : ''\}/);
    assert.match(viewerCss, /\.viewer-selection-tts-spinner\s*\{[\s\S]*?animation:\s*viewerTtsSpin 0\.9s linear infinite/);
});

test('하이라이트는 색상을 선택해 저장하고 표시한다', () => {
    assert.match(viewerSource, /import \{ DEFAULT_HIGHLIGHT_COLOR, HIGHLIGHT_COLORS, normalizeHighlightColor \} from '\.\/highlightColors\.js'/);
    assert.match(viewerSource, /color: normalizeHighlightColor\(color\)/);
    assert.match(viewerSource, /className: `viewer-text-highlight is-\$\{color\}`/);
    assert.match(viewerSource, /className=\{`viewer-highlight-swatch is-\$\{color\.id\}`\}/);
    assert.match(viewerSource, /className=\{`viewer-highlight-swatch is-\$\{normalizeHighlightColor\(highlight\.color\)\}`\}/);
    assert.equal(HIGHLIGHT_COLORS.length, 10);
    for (const color of HIGHLIGHT_COLORS) {
        const selector = `.viewer-text-highlight.is-${color.id},\n.viewer-highlight-swatch.is-${color.id} {`;
        const block = viewerCss.slice(viewerCss.indexOf(selector)).split('}')[0];
        assert.ok(viewerCss.includes(selector), `본문과 도구에 ${color.id} 색상 제공`);
        assert.ok(block.includes(`--viewer-highlight-bg: ${highlightBackground(color.id)};`), `${color.id} 배경은 공유 팔레트와 일치`);
        assert.ok(block.includes(`--viewer-highlight-swatch: ${color.hex};`), `${color.id} 견본은 공유 팔레트와 일치`);
    }
    assert.match(viewerCss, /\.viewer-selection-colors\s*\{/);
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [...HIGHLIGHT_COLORS.map(color => color.labelKey), 'viewer.context.add_underline', 'viewer.context.add_strikethrough']) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
});

test('선택 툴바 스타일과 다국어 문구를 제공한다', () => {
    assert.match(viewerCss, /\.viewer-selection-toolbar \{/);
    assert.match(viewerCss, /\.viewer-selection-menu-list \{/);
    assert.match(viewerCss, /bottom:\s*calc\(100% - 1px\)/);
    assert.match(viewerCss, /top:\s*calc\(100% - 1px\)/);
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [
            'viewer.context.search_in_book',
            'viewer.context.search_google',
            'viewer.context.copy',
            'viewer.context.copy_success',
            'viewer.context.copy_failed',
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

test('뷰어 매뉴얼 컨텍스트 메뉴 탭은 하이라이트 항목을 별도로 안내하지 않는다', () => {
    const contextRowsSource = viewerSource.match(/const contextRows = \[[\s\S]*?\n  \];/)?.[0] || '';
    assert.match(contextRowsSource, /viewer\.help\.context_open/);
    assert.match(contextRowsSource, /viewer\.context\.comic_single_page/);
    assert.doesNotMatch(contextRowsSource, /viewer\.context\.add_highlight|viewer\.help\.context_highlight/);
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


test('두 줄 색상 도구는 측정한 크기로 화면 가장자리 안에 배치된다', () => {
    const source = viewerSource.match(/function selectionToolbarPosition\(point = \{\}, size = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(source);
    const position = runInNewContext(`${source}; selectionToolbarPosition`, {
        window: { innerWidth: 360, innerHeight: 280 },
        document: {},
        clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    });
    for (const point of [{ x: 1, y: 20 }, { x: 355, y: 130 }, { x: 180, y: 265 }]) {
        const result = position(point, { width: 300, height: 150 });
        const top = result.placement === 'below' ? result.y + 12 : result.y - 12 - 150;
        assert.ok(top >= 10, `top ${top}`);
        assert.ok(top + 150 <= 270, `bottom ${top + 150}`);
        assert.ok(result.x - 150 >= 10);
        assert.ok(result.x + 150 <= 350);
        assert.equal(result.anchorX, point.x);
        assert.equal(result.anchorY, point.y);
    }
    assert.equal(position({ x: 180, y: 20 }, { width: 300, height: 150 }).placement, 'below');
    assert.equal(position({ x: 180, y: 265 }, { width: 300, height: 150 }).placement, 'above');
    assert.match(viewerSource, /toolbar\.offsetWidth, height: toolbar\.offsetHeight/);
    assert.match(viewerSource, /ref=\{selectionToolbarRef\}/);
    assert.match(viewerSource, /kind: 'text-selection',\s*\.\.\.position/);
});
