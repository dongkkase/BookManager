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
const viewerDropdownSource = viewerSource.match(/function ViewerDropdown[\s\S]*?\n}\n\nfunction ZoomControl/)?.[0] || '';
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
    assert.match(viewerSource, /const ttsPageWindow = useMemo/);
    assert.match(viewerSource, /const currentTtsText = ttsPageWindow\[0\]\?\.text \|\| ''/);
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

test('TTS 텍스트는 괄호 안의 내용과 특수문자를 제거한다', () => {
    const normalizationSource = viewerSource.match(
        /const TTS_BRACKETED_TEXT_PATTERN[\s\S]*?\n}\n\nfunction systemVoiceMatchesLanguage/,
    )?.[0].replace(/\n\nfunction systemVoiceMatchesLanguage$/, '') || '';
    const normalizeTtsTextForTest = Function(`${normalizationSource}\nreturn normalizeTtsText;`)();

    assert.equal(
        normalizeTtsTextForTest('본문 (생략 [중첩 내용]) 계속 #@$ 😀 끝.'),
        '본문 계속 끝.',
    );
    assert.equal(
        normalizeTtsTextForTest('앞【생략】뒤 {제외} Hello, world! C++'),
        '앞 뒤 Hello, world! C',
    );
    assert.equal(
        normalizeTtsTextForTest('「대화」와 《책 제목》'),
        '대화 와 책 제목',
    );
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

test('TTS 메뉴는 음성 드롭다운 안에서 시스템, Supertonic, OpenAI, Google 음성을 그룹으로 제공한다', () => {
    assert.match(viewerSource, /const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'/);
    assert.match(viewerSource, /const SUPERTONIC_TTS_VOICES = \[/);
    for (const [id, label] of [
        ['M1', 'Alex'],
        ['M2', 'James'],
        ['M3', 'Robert'],
        ['M4', 'Sam'],
        ['M5', 'Daniel'],
        ['F1', 'Sarah'],
        ['F2', 'Lily'],
        ['F3', 'Jessica'],
        ['F4', 'Olivia'],
        ['F5', 'Emily'],
    ]) {
        assert.match(viewerSource, new RegExp(`\\{ id: '${id}', label: '${label}' \\}`));
    }
    assert.match(viewerSource, /const OPENAI_TTS_VOICES = \[/);
    assert.match(viewerSource, /const GOOGLE_TTS_VOICES = \[/);
    assert.match(viewerSource, /labelKey: 'viewer\.tts\.google_voice_ko'/);
    assert.match(viewerSource, /engine: 'system'/);
    assert.match(viewerSource, /supertonicVoice: 'M1'/);
    assert.match(viewerSource, /openaiVoice: 'marin'/);
    assert.match(viewerSource, /googleVoice: 'ko-KR'/);
    assert.match(viewerSource, /function splitTtsTextIntoChunks/);
    assert.match(ttsControlSource, /settings\.engine === 'openai'/);
    assert.match(ttsControlSource, /settings\.engine === 'google'/);
    assert.match(ttsControlSource, /settings\.engine === 'supertonic'/);
    assert.doesNotMatch(ttsControlSource, /viewer\.tts\.engine', '엔진'/);
    assert.match(ttsControlSource, /voice_group_system/);
    assert.match(ttsControlSource, /voice_group_supertonic/);
    assert.match(ttsControlSource, /voice_group_openai/);
    assert.match(ttsControlSource, /voice_group_google/);
    assert.match(ttsControlSource, /const \[ttsApiKeyState, setTtsApiKeyState\]/);
    assert.match(ttsControlSource, /hasTtsOpenAiKey/);
    assert.match(ttsControlSource, /hasTtsGoogleKey/);
    assert.match(ttsControlSource, /getSupertonicModelStatus/);
    assert.match(ttsControlSource, /onSupertonicModelStatus/);
    assert.match(ttsControlSource, /tts_openai_key/);
    assert.match(ttsControlSource, /tts_google_key/);
    assert.match(ttsControlSource, /apiKeyRequiredOption\(`openai:\$\{settings\.openaiVoice\}`\)/);
    assert.match(ttsControlSource, /apiKeyRequiredOption\(`google:\$\{settings\.googleVoice\}`\)/);
    assert.match(ttsControlSource, /viewer\.tts\.api_key_required/);
    assert.match(ttsControlSource, /viewer\.tts\.supertonic_model_required/);
    assert.match(ttsControlSource, /id: `supertonic:\$\{voice\.id\}`/);
    assert.match(ttsControlSource, /id: `openai:\$\{voice\.id\}`/);
    assert.match(ttsControlSource, /id: `google:\$\{voice\.id\}`/);
    assert.match(ttsControlSource, /id: `system:\$\{voice\.voiceURI \|\| voice\.name\}`/);
    assert.match(ttsControlSource, /voice\.startsWith\('openai:'\)/);
    assert.match(ttsControlSource, /voice\.startsWith\('google:'\)/);
    assert.match(ttsControlSource, /voice\.startsWith\('supertonic:'\)/);
    assert.match(viewerSource, /window\.viewerAPI\?\.createSupertonicTts/);
    assert.match(viewerSource, /window\.viewerAPI\?\.createOpenAiTts/);
    assert.match(viewerSource, /window\.viewerAPI\?\.createGoogleTts/);
    assert.match(viewerSource, /viewer\.tts\.openai_key_missing/);
    assert.match(viewerSource, /viewer\.tts\.google_key_missing/);
    assert.match(viewerPreloadSource, /createOpenAiTts:\s*options => ipcRenderer\.invoke\('api:openaiTts', options\)/);
    assert.match(viewerPreloadSource, /createGoogleTts:\s*options => ipcRenderer\.invoke\('api:googleTts', options\)/);
    assert.match(viewerPreloadSource, /createSupertonicTts:\s*options => ipcRenderer\.invoke\('api:supertonicTts', options\)/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('api:supertonicTts'/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('api:openaiTts'/);
    assert.match(ipcHandlersSource, /ipcMain\.handle\('api:googleTts'/);
    assert.match(ipcHandlersSource, /tts_openai_key/);
    assert.match(ipcHandlersSource, /tts_google_key/);
    assert.match(ipcHandlersSource, /requestBufferPost\('https:\/\/api\.openai\.com\/v1\/audio\/speech'/);
    assert.match(ipcHandlersSource, /texttospeech\.googleapis\.com\/v1\/text:synthesize/);
    assert.match(ipcHandlersSource, /GOOGLE_TTS_OAUTH_SCOPE = 'https:\/\/www\.googleapis\.com\/auth\/cloud-platform'/);
    assert.match(ipcHandlersSource, /requestFormPost\(credential\.tokenUri/);
    assert.match(ipcHandlersSource, /Authorization:\s*`Bearer \$\{accessToken\}`/);
    assert.match(ipcHandlersSource, /GOOGLE_TTS_OAUTH_REQUIRED/);
    assert.match(ipcHandlersSource, /GOOGLE_TTS_CREDENTIAL_INVALID/);
    assert.match(ipcHandlersSource, /OPENAI_TTS_FALLBACK_MODEL = 'tts-1'/);
    assert.match(ipcHandlersSource, /normalizeOpenAiTtsError/);
    assert.match(ipcHandlersSource, /normalizeGoogleTtsError/);
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [
            'viewer.tts.voice_group_system',
            'viewer.tts.voice_group_supertonic',
            'viewer.tts.voice_group_openai',
            'viewer.tts.voice_group_google',
            'viewer.tts.voice_preview',
            'viewer.tts.google_voice_ko',
            'viewer.tts.google_voice_en',
            'viewer.tts.google_voice_ja',
            'viewer.tts.api_key_required',
            'viewer.tts.supertonic_model_required',
            'viewer.tts.supertonic_loading',
            'viewer.tts.supertonic_model_missing',
            'viewer.tts.supertonic_model_invalid',
            'viewer.tts.supertonic_error_detail',
            'viewer.tts.supertonic_unsupported',
            'viewer.tts.openai_loading',
            'viewer.tts.openai_key_missing',
            'viewer.tts.openai_invalid_key',
            'viewer.tts.openai_quota',
            'viewer.tts.openai_error_detail',
            'viewer.tts.openai_unsupported',
            'viewer.tts.google_loading',
            'viewer.tts.google_key_missing',
            'viewer.tts.google_invalid_key',
            'viewer.tts.google_oauth_required',
            'viewer.tts.google_auth_failed',
            'viewer.tts.google_quota',
            'viewer.tts.google_error_detail',
            'viewer.tts.google_unsupported',
        ]) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
});

test('TTS 음성 목록은 그룹과 그룹 안의 음성을 역순으로 표시한다', () => {
    const combinedOptionsSource = ttsControlSource.match(
        /const combinedVoiceOptions = useMemo\(\(\) => \[[\s\S]*?\n  \], \[googleVoiceOptions/,
    )?.[0] || '';

    assert.match(
        combinedOptionsSource,
        /google-voices[\s\S]*?\[\.\.\.googleVoiceOptions\]\.reverse\(\)[\s\S]*?openai-voices[\s\S]*?\[\.\.\.openAiVoiceOptions\]\.reverse\(\)[\s\S]*?supertonic-voices[\s\S]*?\[\.\.\.supertonicVoiceOptions\]\.reverse\(\)[\s\S]*?system-voices[\s\S]*?\[\.\.\.systemVoiceOptions\]\.reverse\(\)/,
    );
});

test('TTS 음성 목록은 설정 언어별 문장으로 각 음성을 미리 들려준다', () => {
    const previewTextMapSource = viewerSource.match(/const TTS_VOICE_PREVIEW_TEXT = \{[\s\S]*?\n\};/)?.[0] || '';
    const previewTextFunctionSource = viewerSource.match(/function ttsVoicePreviewText[\s\S]*?\n}/)?.[0] || '';
    const previewTextForTest = Function(`${previewTextMapSource}\n${previewTextFunctionSource}\nreturn ttsVoicePreviewText;`)();

    assert.equal(previewTextForTest('ko-KR'), '안녕하세요! 오늘 하루 어떠세요?');
    assert.equal(previewTextForTest('en_US'), 'Hello! How are you today?');
    assert.equal(previewTextForTest('ja-JP'), 'こんにちは！今日はどうですか？');
    assert.match(viewerSource, /function ttsVoicePreviewText\(language = 'ko'\)/);
    assert.match(viewerDropdownSource, /onPreview, previewingValue = '', previewTitle = ''/);
    assert.match(viewerDropdownSource, /className={`viewer-dropdown-option-preview/);
    assert.match(viewerDropdownSource, /onClick=\{\(\) => onPreview\(option\.id\)\}/);
    assert.match(ttsControlSource, /const previewText = ttsVoicePreviewText\(language\)/);
    assert.match(ttsControlSource, /new window\.SpeechSynthesisUtterance\(previewText\)/);
    assert.match(ttsControlSource, /utterance\.lang = previewVoice\?\.lang \|\| language/);
    assert.match(ttsControlSource, /speakDetachedRemoteTts\(previewText, previewSettings, onToast, language\)/);
    assert.match(ttsControlSource, /previewTitle=\{viewerText\('viewer\.tts\.voice_preview', '음성 미리듣기'\)\}/);
    assert.match(ttsControlSource, /onPreview=\{handleVoicePreview\}/);
    assert.match(viewerCss, /\.viewer-dropdown-option-preview \{/);
});

test('TTS 속도 변경은 재생 중인 시스템 발화와 원격 오디오에 즉시 적용한다', () => {
    assert.match(viewerSource, /function applyTtsAudioPlaybackRate\(audio, rate\)/);
    assert.match(viewerSource, /audio\.defaultPlaybackRate = normalizedRate/);
    assert.match(viewerSource, /audio\.playbackRate = normalizedRate/);
    assert.equal((viewerSource.match(/speed: 1,/g) || []).length, 3);
    assert.match(ttsControlSource, /set: setSystemTts/);
    assert.match(ttsControlSource, /ttsRateRef\.current = nextRate/);
    assert.match(ttsControlSource, /setSystemTts\.rate\(nextRate\)/);
    assert.match(ttsControlSource, /applyTtsAudioPlaybackRate\(openAiAudioRef\.current, nextRate\)/);
    assert.match(ttsControlSource, /applyTtsAudioPlaybackRate\(detachedRemoteTtsAudio, nextRate\)/);
    assert.match(ttsControlSource, /systemRateRestartTimerRef\.current = window\.setTimeout/);
    assert.match(ttsControlSource, /onChange=\{event => handleTtsRateChange\(Number\(event\.target\.value\)\)\}/);
});

test('원격 TTS는 재생 중 다음 세 텍스트 페이지를 미리 생성하고 캐시로 연속 재생한다', () => {
    assert.match(viewerSource, /const REMOTE_TTS_PREFETCH_PAGE_LIMIT = 3/);
    assert.match(viewerSource, /speakablePages\.length < REMOTE_TTS_PREFETCH_PAGE_LIMIT \+ 1/);
    assert.match(viewerSource, /if \(!text\) continue;\s*speakablePages\.push\(\{ pageIndex: targetPageIndex, text \}\)/);
    assert.match(viewerSource, /const ttsPrefetchPages = useMemo\(\(\) => ttsPageWindow\.slice\(1\)/);
    assert.match(viewerSource, /prefetchPages=\{ttsPrefetchPages\}/);
    assert.match(ttsControlSource, /const remoteTtsPageCacheRef = useRef\(new Map\(\)\)/);
    assert.match(ttsControlSource, /const remoteTtsPagePromiseRef = useRef\(new Map\(\)\)/);
    assert.match(ttsControlSource, /prefetchPages\s*\.slice\(0, REMOTE_TTS_PREFETCH_PAGE_LIMIT\)/);
    assert.match(ttsControlSource, /if \(!settings\.autoAdvance \|\| !isRemoteTtsEngine\(settings\.engine\)\) return/);
    assert.match(ttsControlSource, /if \(!isOpenAiPlaying\) return;\s*void prefetchRemoteTtsPages\(\)/);
    assert.match(ttsControlSource, /const cachedPage = remoteTtsPageCacheRef\.current\.get\(cacheKey\)/);
    assert.match(ttsControlSource, /const pendingPage = remoteTtsPagePromiseRef\.current\.get\(cacheKey\)/);
    assert.match(ttsControlSource, /const currentPageAudio = await loadRemoteTtsPageAudio\(targetPage\)/);
    assert.match(ttsControlSource, /remoteTtsPageHandoffRef\.current\.add\(nextPage\.pageIndex\)/);
    assert.match(ttsControlSource, /onMoveToPageRef\.current\?\.\(nextPage\.pageIndex\);\s*targetPage = nextPage/);
    assert.match(ttsControlSource, /isRemoteEngine \? 0 : 80/);
});

test('TTS는 이미지 전용 페이지에서 다음 텍스트 페이지로 이동해 재생한다', () => {
    assert.match(ttsControlSource, /const nextSpeakablePage = normalizedPrefetchPages\.find\(page => page\.pageIndex > pageIndex\) \|\| null/);
    assert.match(ttsControlSource, /const hasPlayableText = hasText \|\| Boolean\(nextSpeakablePage\)/);
    assert.match(ttsControlSource, /const initialPage = hasText \? \{ pageIndex, text: speechText \} : nextSpeakablePage/);
    assert.match(ttsControlSource, /onMoveToPage\?\.\(nextSpeakablePage\.pageIndex\)/);
    assert.match(viewerSource, /onMoveToPage=\{goPageIndex\}/);
});

test('시스템 TTS 음성 목록과 선택 음성은 현재 BookManager 언어로 제한한다', () => {
    assert.match(viewerSource, /function systemVoiceMatchesLanguage\(voice, language\)/);
    assert.match(viewerSource, /replaceAll\('_', '-'\)/);
    assert.match(ttsControlSource, /availableVoices\.filter\(voice => systemVoiceMatchesLanguage\(voice, language\)\)/);
    assert.match(ttsControlSource, /voices\.filter\(voice => systemVoiceMatchesLanguage\(voice, language\)\)/);
    assert.match(ttsControlSource, /\.\.\.matchingSystemVoices\.map\(voice => \(\{/);
    assert.doesNotMatch(ttsControlSource, /\.\.\.voices\.map\(voice => \(\{/);
    assert.match(viewerSource, /systemVoiceMatchesLanguage\(voice, viewerLanguage\)/);
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
    assert.match(ttsControlSource, /const isTtsActive = \(isRemoteEngine \? openAiState\.status !== 'idle' : state\.isPlaying \|\| state\.isPaused\)/);
    assert.match(ttsControlSource, /const shouldRestart = isActivelyPlaying/);
    assert.match(ttsControlSource, /setPendingPlayAfterPageMove\(shouldRestart\)/);
    assert.match(ttsControlSource, /stopCurrentTtsWithoutAutoAdvance\(\)/);
});
