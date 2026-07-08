import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from './utils/i18n.js';

const viewerSource = readFileSync(fileURLToPath(new URL('./ViewerApp.jsx', import.meta.url)), 'utf8');
const viewerCss = readFileSync(fileURLToPath(new URL('./styles/viewer.css', import.meta.url)), 'utf8');
const viewerPreloadSource = readFileSync(fileURLToPath(new URL('../electron/viewerPreload.cjs', import.meta.url)), 'utf8');
const ipcHandlersSource = readFileSync(fileURLToPath(new URL('../electron/ipcHandlers.js', import.meta.url)), 'utf8');
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
    assert.doesNotMatch(ttsControlSource, /viewer-tts-status|ttsStatusLabel|pageLabel/);
    assert.match(viewerSource, /document\.querySelector\('\.viewer-tts-menu'\)/);
    assert.match(viewerCss, /\.viewer-tts-control \{/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*position:\s*fixed/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*left:\s*50%/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*width:\s*max-content/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*transform:\s*translateX\(-50%\)/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*display:\s*flex/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*flex-wrap:\s*nowrap/);
    assert.match(viewerCss, /\.viewer-tts-actions \{/);
    assert.match(viewerCss, /grid-template-columns:\s*repeat\(7, 30px\)/);
    assert.match(ttsControlSource, /const \[rateOpen, setRateOpen\]/);
    assert.match(ttsControlSource, /className="viewer-tts-rate-popover"/);
    assert.match(ttsControlSource, /buttonIcon="language"/);
    assert.match(ttsControlSource, /aria-pressed=\{settings\.autoAdvance\}/);
    assert.match(ttsControlSource, /<FaIcon name="clock" \/>/);
    assert.match(ttsControlSource, /<FaIcon name="anglesRight" \/>/);
    assert.match(ttsControlSource, /className="viewer-tts-progress"/);
    assert.match(ttsControlSource, /<FaIcon name="spinner" className="viewer-tts-progress-spinner" \/>/);
    assert.match(ttsControlSource, /remoteTtsProgressLabel/);
    assert.match(viewerCss, /\.viewer-tts-rate-popover \{/);
    assert.match(viewerCss, /writing-mode:\s*vertical-lr/);
    assert.match(viewerCss, /\.viewer-tts-actions \.viewer-dropdown-menu \{[\s\S]*position:\s*absolute/);
    assert.match(viewerCss, /\.viewer-tts-actions \.viewer-dropdown-menu \{[\s\S]*top:\s*calc\(100% \+ 8px\)/);
    assert.match(viewerCss, /\.viewer-tts-progress \{/);
    assert.match(viewerCss, /\.viewer-tts-progress-spinner \{/);
    assert.match(viewerCss, /@keyframes viewerTtsSpin/);
    assert.match(viewerCss, /\.viewer-dropdown-button\.is-icon-only \{/);
    assert.match(viewerCss, /\.viewer-dropdown-group \{/);
});

test('TTS 메뉴는 음성 드롭다운 안에서 시스템, OpenAI, Google 음성을 그룹으로 제공한다', () => {
    assert.match(viewerSource, /const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'/);
    assert.match(viewerSource, /const OPENAI_TTS_VOICES = \[/);
    assert.match(viewerSource, /const GOOGLE_TTS_VOICES = \[/);
    assert.match(viewerSource, /labelKey: 'viewer\.tts\.google_voice_ko'/);
    assert.match(viewerSource, /engine: 'system'/);
    assert.match(viewerSource, /openaiVoice: 'marin'/);
    assert.match(viewerSource, /googleVoice: 'ko-KR'/);
    assert.match(viewerSource, /function splitTtsTextIntoChunks/);
    assert.match(ttsControlSource, /settings\.engine === 'openai'/);
    assert.match(ttsControlSource, /settings\.engine === 'google'/);
    assert.doesNotMatch(ttsControlSource, /viewer\.tts\.engine', '엔진'/);
    assert.match(ttsControlSource, /voice_group_system/);
    assert.match(ttsControlSource, /voice_group_openai/);
    assert.match(ttsControlSource, /voice_group_google/);
    assert.match(ttsControlSource, /const \[ttsApiKeyState, setTtsApiKeyState\]/);
    assert.match(ttsControlSource, /hasTtsOpenAiKey/);
    assert.match(ttsControlSource, /hasTtsGoogleKey/);
    assert.match(ttsControlSource, /tts_openai_key/);
    assert.match(ttsControlSource, /tts_google_key/);
    assert.match(ttsControlSource, /apiKeyRequiredOption\(`openai:\$\{settings\.openaiVoice\}`\)/);
    assert.match(ttsControlSource, /apiKeyRequiredOption\(`google:\$\{settings\.googleVoice\}`\)/);
    assert.match(ttsControlSource, /viewer\.tts\.api_key_required/);
    assert.match(ttsControlSource, /id: `openai:\$\{voice\.id\}`/);
    assert.match(ttsControlSource, /id: `google:\$\{voice\.id\}`/);
    assert.match(ttsControlSource, /id: `system:\$\{voice\.voiceURI \|\| voice\.name\}`/);
    assert.match(ttsControlSource, /voice\.startsWith\('openai:'\)/);
    assert.match(ttsControlSource, /voice\.startsWith\('google:'\)/);
    assert.match(viewerSource, /window\.viewerAPI\?\.createOpenAiTts/);
    assert.match(viewerSource, /window\.viewerAPI\?\.createGoogleTts/);
    assert.match(viewerSource, /viewer\.tts\.openai_key_missing/);
    assert.match(viewerSource, /viewer\.tts\.google_key_missing/);
    assert.match(viewerPreloadSource, /createOpenAiTts:\s*options => ipcRenderer\.invoke\('api:openaiTts', options\)/);
    assert.match(viewerPreloadSource, /createGoogleTts:\s*options => ipcRenderer\.invoke\('api:googleTts', options\)/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('api:openaiTts'/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('api:googleTts'/);
    assert.match(ipcHandlersSource, /tts_openai_key/);
    assert.match(ipcHandlersSource, /tts_google_key/);
    assert.match(ipcHandlersSource, /requestBufferPost\('https:\/\/api\.openai\.com\/v1\/audio\/speech'/);
    assert.match(ipcHandlersSource, /texttospeech\.googleapis\.com\/v1\/text:synthesize/);
    assert.match(ipcHandlersSource, /OPENAI_TTS_FALLBACK_MODEL = 'tts-1'/);
    assert.match(ipcHandlersSource, /normalizeOpenAiTtsError/);
    assert.match(ipcHandlersSource, /normalizeGoogleTtsError/);
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [
            'viewer.tts.voice_group_system',
            'viewer.tts.voice_group_openai',
            'viewer.tts.voice_group_google',
            'viewer.tts.google_voice_ko',
            'viewer.tts.google_voice_en',
            'viewer.tts.google_voice_ja',
            'viewer.tts.api_key_required',
            'viewer.tts.openai_loading',
            'viewer.tts.openai_key_missing',
            'viewer.tts.openai_invalid_key',
            'viewer.tts.openai_quota',
            'viewer.tts.openai_error_detail',
            'viewer.tts.openai_unsupported',
            'viewer.tts.google_loading',
            'viewer.tts.google_key_missing',
            'viewer.tts.google_invalid_key',
            'viewer.tts.google_quota',
            'viewer.tts.google_error_detail',
            'viewer.tts.google_unsupported',
        ]) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
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
    assert.match(ttsControlSource, /const isTtsActive = isRemoteEngine \? openAiState\.status !== 'idle' : state\.isPlaying \|\| state\.isPaused/);
    assert.match(ttsControlSource, /const shouldRestart = isActivelyPlaying/);
    assert.match(ttsControlSource, /setPendingPlayAfterPageMove\(shouldRestart\)/);
    assert.match(ttsControlSource, /stopCurrentTtsWithoutAutoAdvance\(\)/);
});
