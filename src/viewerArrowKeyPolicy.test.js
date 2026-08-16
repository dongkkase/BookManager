import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
    normalizeViewerArrowKeyMode,
    viewerArrowKeyPageDelta,
} from './viewerArrowKeyPolicy.js';
import { translate } from './utils/i18n.js';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    assert.notEqual(startIndex, -1, `Missing source marker: ${startMarker}`);
    const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);
    assert.notEqual(endIndex, -1, `Missing source marker: ${endMarker}`);
    return source.slice(startIndex, endIndex);
}

test('좌우 방향키 정책은 읽기방향에 자연스럽게를 기본값으로 정규화한다', () => {
    assert.equal(normalizeViewerArrowKeyMode(), 'reading-natural');
    assert.equal(normalizeViewerArrowKeyMode('reading-natural'), 'reading-natural');
    assert.equal(normalizeViewerArrowKeyMode('ltr'), 'ltr');
    assert.equal(normalizeViewerArrowKeyMode('unsupported'), 'reading-natural');
});

test('자연스러운 방향키 정책은 RTL 읽기에서 좌우 이동을 반전한다', () => {
    const options = { mode: 'reading-natural', readingDirection: 'rtl' };

    assert.equal(viewerArrowKeyPageDelta('ArrowLeft', options), 1);
    assert.equal(viewerArrowKeyPageDelta('ArrowRight', options), -1);
});

test('LTR 읽기와 고정 LTR 정책은 왼쪽이 이전, 오른쪽이 다음으로 이동한다', () => {
    for (const options of [
        { mode: 'reading-natural', readingDirection: 'ltr' },
        { mode: 'ltr', readingDirection: 'ltr' },
        { mode: 'ltr', readingDirection: 'rtl' },
    ]) {
        assert.equal(viewerArrowKeyPageDelta('ArrowLeft', options), -1);
        assert.equal(viewerArrowKeyPageDelta('ArrowRight', options), 1);
    }
});

test('좌우 이외의 키는 좌우 방향키 정책에서 처리하지 않는다', () => {
    const options = { mode: 'reading-natural', readingDirection: 'rtl' };

    assert.equal(viewerArrowKeyPageDelta('ArrowUp', options), null);
    assert.equal(viewerArrowKeyPageDelta('ArrowDown', options), null);
    assert.equal(viewerArrowKeyPageDelta('PageUp', options), null);
    assert.equal(viewerArrowKeyPageDelta('PageDown', options), null);
});

test('뷰어 설정은 좌우 방향키 정책을 정규화해 저장하고 복원한다', () => {
    const normalizeSource = sourceBetween(
        viewerSource,
        'function normalizeReaderSettings(settings = {}) {',
        '\nfunction uniqueFontNames(',
    );
    const persistSource = sourceBetween(
        viewerSource,
        '  const persistState = useCallback(',
        '  const persistScrollState = useCallback(',
    );
    const loadSource = sourceBetween(
        viewerSource,
        '  const loadSession = useCallback(async nextSession => {',
        '  const loadComicPage = useCallback(',
    );

    assert.match(viewerSource, /arrowKeyMode:\s*'reading-natural'/);
    assert.match(normalizeSource, /arrowKeyMode:\s*normalizeViewerArrowKeyMode\(merged\.arrowKeyMode\)/);
    assert.match(persistSource, /readerSettings:\s*'readerSettings' in patch \? patch\.readerSettings : readerSettings/);
    assert.match(loadSource, /setReaderSettings\(normalizeReaderSettings\(savedPrefs\.readerSettings \|\| \{\}\)\)/);
});

test('만화 뷰어 설정은 두 가지 좌우 방향키 정책을 제공한다', () => {
    const comicSettingsSource = sourceBetween(
        viewerSource,
        '      {showComicSettings && (',
        '      {showPdfSettings && (',
    );

    assert.match(viewerSource, /const ARROW_KEY_MODE_OPTIONS = \[/);
    assert.match(viewerSource, /\{ id: 'reading-natural',[^\n]*viewer\.option\.arrow_key_reading_natural/);
    assert.match(viewerSource, /\{ id: 'ltr',[^\n]*viewer\.option\.arrow_key_ltr/);
    assert.match(comicSettingsSource, /viewer\.settings\.arrow_key_mode/);
    assert.match(comicSettingsSource, /value=\{settings\.arrowKeyMode\}/);
    assert.match(comicSettingsSource, /options=\{ARROW_KEY_MODE_OPTIONS\}/);
    assert.match(comicSettingsSource, /onChange=\{arrowKeyMode => onChange\(\{ arrowKeyMode \}\)\}/);
    assert.equal(
        (viewerSource.match(/options=\{ARROW_KEY_MODE_OPTIONS\}/g) || []).length,
        1,
        '좌우 방향키 정책은 만화 뷰어 설정에만 표시해야 합니다.',
    );

    assert.equal(translate('viewer.option.arrow_key_reading_natural', 'ko'), '읽기방향에 자연스럽게');
    assert.equal(translate('viewer.option.arrow_key_ltr', 'ko'), '왼쪽에서 오른쪽');
    for (const language of ['ko', 'en', 'ja']) {
        for (const key of [
            'viewer.settings.arrow_key_mode',
            'viewer.option.arrow_key_reading_natural',
            'viewer.option.arrow_key_ltr',
        ]) {
            assert.notEqual(translate(key, language), key, `${language}:${key}`);
        }
    }
});

test('키보드 핸들러는 좌우 키만 정책에 위임하고 세로 키 동작은 유지한다', () => {
    const keyboardSource = sourceBetween(
        viewerSource,
        "      if (event.key === 'Escape' && (settingsOpen || navigationPanelOpen || helpOpen)) {",
        "      } else if (event.key === ']') {",
    );

    assert.match(
        keyboardSource,
        /viewerArrowKeyPageDelta\(event\.key,\s*\{\s*mode:\s*readerSettings\.arrowKeyMode,\s*readingDirection:\s*session\?\.type === 'comic' \? readingDirection : 'ltr',?\s*\}\)/,
    );
    assert.match(keyboardSource, /event\.key === 'ArrowDown' \|\| event\.key === 'PageDown'[\s\S]*movePage\(1\)/);
    assert.match(keyboardSource, /event\.key === 'ArrowUp' \|\| event\.key === 'PageUp'[\s\S]*movePage\(-1\)/);
});

test('툴바 좌우 페이지 버튼은 방향키와 같은 이동 정책과 버튼 상태를 사용한다', () => {
    const toolbarStateSource = sourceBetween(
        viewerSource,
        '  const previousPageDisabled =',
        '  const slideNavAvailable =',
    );
    const toolbarSource = sourceBetween(
        viewerSource,
        '          <div className="viewer-tool-cluster" aria-label={viewerText(\'viewer.toolbar.page_navigation\'',
        '          {supportsViewControls && (',
    );

    assert.match(
        toolbarStateSource,
        /const toolbarPageDirectionOptions = \{\s*mode: readerSettings\.arrowKeyMode,\s*readingDirection: session\?\.type === 'comic' \? readingDirection : 'ltr',\s*\};/,
    );
    assert.match(toolbarStateSource, /viewerArrowKeyPageDelta\('ArrowLeft', toolbarPageDirectionOptions\)/);
    assert.match(toolbarStateSource, /viewerArrowKeyPageDelta\('ArrowRight', toolbarPageDirectionOptions\)/);
    assert.match(
        toolbarStateSource,
        /const toolbarLeftPageButtonState = toolbarLeftPageDelta < 0\s*\? previousPageButtonState\s*:\s*nextPageButtonState/,
    );
    assert.match(
        toolbarStateSource,
        /const toolbarRightPageButtonState = toolbarRightPageDelta < 0\s*\? previousPageButtonState\s*:\s*nextPageButtonState/,
    );
    assert.match(
        toolbarSource,
        /title=\{toolbarLeftPageButtonState\.title\}[\s\S]*?icon="angleLeft"[\s\S]*?disabled=\{toolbarLeftPageButtonState\.disabled\}[\s\S]*?movePage\(toolbarLeftPageDelta\)/,
    );
    assert.match(
        toolbarSource,
        /title=\{toolbarRightPageButtonState\.title\}[\s\S]*?icon="angleRight"[\s\S]*?disabled=\{toolbarRightPageButtonState\.disabled\}[\s\S]*?movePage\(toolbarRightPageDelta\)/,
    );
});
