import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from './utils/i18n.js';

const viewerSource = readFileSync(fileURLToPath(new URL('./ViewerApp.jsx', import.meta.url)), 'utf8');
const viewerCss = readFileSync(fileURLToPath(new URL('./styles/viewer.css', import.meta.url)), 'utf8');
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const ttsControlSource = viewerSource.match(/function ViewerTtsControls[\s\S]*?\n}\n\nfunction BookmarkEditor/)?.[0] || '';
const readerItemTtsTextSource = viewerSource.match(/function readerItemTtsText[\s\S]*?\n}\n\nfunction getPageEffectDirection/)?.[0] || '';

test('EPUB/TXT 뷰어는 tts-react 3 훅 기반 TTS 컨트롤을 제공한다', () => {
    assert.equal(packageJson.dependencies['tts-react'], '^3.0.7');
    assert.match(viewerSource, /import\s+\{\s*useTts\s*\}\s+from\s+['"]tts-react['"]/);
    assert.match(viewerSource, /function ViewerTtsControls/);
    assert.match(viewerSource, /markTextAsSpoken:\s*true/);
    assert.match(viewerSource, /state\.voices\?\.length > 0 \? state\.voices : availableVoices/);
});

test('TTS 컨트롤은 리더 문서에서만 표시되고 현재 페이지 텍스트를 사용한다', () => {
    assert.match(viewerSource, /const isReaderDocument = session\?\.type === 'epub' \|\| session\?\.type === 'text'/);
    assert.match(viewerSource, /const currentTtsText = useMemo/);
    assert.match(viewerSource, /readerItemTtsText\(flowItems\[index\]\)/);
    assert.match(viewerSource, /\{isReaderDocument && \(\s*<div className="viewer-tool-cluster viewer-tts-cluster"/);
});

test('뷰어 툴바 매뉴얼은 TTS 플로팅 메뉴 사용법을 안내한다', () => {
    assert.match(viewerSource, /text: 'TTS', title: viewerText\('viewer\.tts\.title', 'TTS'\)/);
    assert.match(viewerSource, /viewer\.help\.toolbar_tts/);
    for (const language of ['ko', 'en', 'ja']) {
        assert.notEqual(translate('viewer.help.toolbar_tts', language), 'viewer.help.toolbar_tts');
    }
});

test('TTS 텍스트는 페이지 말머리를 제외하고 본문만 사용한다', () => {
    assert.doesNotMatch(readerItemTtsTextSource, /parts\.push\(item\.title\)/);
    assert.match(readerItemTtsTextSource, /if \(Array\.isArray\(item\.blocks\) && item\.blocks\.length > 0\)/);
    assert.match(readerItemTtsTextSource, /if \(block\?\.text\) parts\.push\(block\.text\)/);
    assert.match(readerItemTtsTextSource, /else if \(item\.text\)/);
});

test('TTS 메뉴는 툴바 버튼으로 여는 중앙 상단 플로팅 패널이다', () => {
    assert.match(viewerSource, /viewer-tts-toggle-button/);
    assert.doesNotMatch(viewerSource, /<FaIcon name="towerBroadcast" \/>/);
    assert.match(viewerSource, /aria-haspopup="dialog"/);
    assert.match(viewerSource, /className="viewer-tts-actions"/);
    assert.match(viewerSource, /document\.querySelector\('\.viewer-tts-menu'\)/);
    assert.match(viewerCss, /\.viewer-tts-control \{/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*position:\s*fixed/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*left:\s*12px/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*right:\s*12px/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*margin:\s*0 auto/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*display:\s*flex/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*flex-wrap:\s*nowrap/);
    assert.match(viewerCss, /\.viewer-tts-actions \{/);
    assert.match(viewerCss, /\.viewer-tts-field \.viewer-dropdown \{/);
});

test('TTS 메뉴는 명시적으로 끄기 전까지 유지되고 스페이스바로 재생을 토글한다', () => {
    assert.doesNotMatch(ttsControlSource, /document\.addEventListener\('pointerdown'/);
    assert.match(ttsControlSource, /document\.addEventListener\('keydown', handleTtsKeyDown\)/);
    assert.match(ttsControlSource, /if \(event\.key === 'Escape'\)/);
    assert.match(viewerSource, /function isPlainSpaceKeyEvent/);
    assert.match(ttsControlSource, /isPlainSpaceKeyEvent\(event\)/);
    assert.match(ttsControlSource, /handlePlayPause\(\)/);
});

test('재생 중 페이지가 바뀌면 현재 TTS를 멈추고 새 페이지를 이어서 읽는다', () => {
    assert.match(ttsControlSource, /const previousTtsPageRef = useRef\(null\)/);
    assert.match(ttsControlSource, /previousPageIndex === pageIndex/);
    assert.match(ttsControlSource, /const shouldRestart = state\.isPlaying && !state\.isPaused/);
    assert.match(ttsControlSource, /setPendingPlayAfterPageMove\(shouldRestart\)/);
    assert.match(ttsControlSource, /stopWithoutAutoAdvance\(\)/);
});
