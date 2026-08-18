import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const viewerWindowSource = readFileSync(path.join(root, 'viewerWindow.js'), 'utf8');
const viewerPreloadSource = readFileSync(path.join(root, 'viewerPreload.cjs'), 'utf8');
const mainPreloadSource = readFileSync(path.join(root, 'preload.cjs'), 'utf8');
const mainPreloadEsmSource = readFileSync(path.join(root, 'preload.js'), 'utf8');
const mainSource = readFileSync(path.join(root, 'main.js'), 'utf8');

function sourceSection(source, start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
    assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('리더와 오디오 뷰어는 독립 singleton context로 분기된다', () => {
    assert.match(viewerWindowSource, /const viewerContexts = \{[\s\S]*?reader:\s*\{[\s\S]*?kind:\s*'reader'[\s\S]*?audio:\s*\{[\s\S]*?kind:\s*'audio'/);
    assert.match(viewerWindowSource, /session\?\.type === 'audio' \? viewerContexts\.audio : viewerContexts\.reader/);
    assert.match(viewerWindowSource, /const existingWindow = activeViewerWindow\(context\)/);

    const openViewerSource = sourceSection(
        viewerWindowSource,
        'const openViewer = async filePath =>',
        'const viewerContextForSessionRequest',
    );
    assert.match(openViewerSource, /const context = contextForSession\(session\)/);
    assert.match(openViewerSource, /focusContextWindow\(context, session\)/);
    assert.match(openViewerSource, /sendSession\(context, session\)/);
});

test('각 뷰어의 초기 세션과 후속 이동은 sender context에 남는다', () => {
    assert.match(viewerWindowSource, /BrowserWindow\.fromWebContents\(sender\)/);
    assert.match(viewerWindowSource, /ipcMain\.handle\('viewer:getCurrentSession',[\s\S]*?viewerContextForSender\(event\.sender\)[\s\S]*?context\.currentSession \|\| sessions\.current\(context\.kind\)/);

    const adjacentSource = sourceSection(
        viewerWindowSource,
        'const openAdjacentViewer = async',
        'const openAudioQueueItem = async',
    );
    assert.match(adjacentSource, /viewerContextForCurrentSessionRequest\(event, sessionId\)/);
    assert.match(adjacentSource, /preserveMiniPlayer:\s*true/);
    assert.match(adjacentSource, /preserveCloseRequest:\s*true/);
    assert.doesNotMatch(adjacentSource, /sendSession/);

    const queueSource = sourceSection(
        viewerWindowSource,
        'const openAudioQueueItem = async',
        "ipcMain.handle('viewer:open'",
    );
    assert.match(queueSource, /viewerContextForCurrentSessionRequest\(event, sessionId\)/);
    assert.match(queueSource, /preserveMiniPlayer:\s*true/);
    assert.match(queueSource, /preserveCloseRequest:\s*true/);
    assert.doesNotMatch(queueSource, /sendSession/);
});

test('창 콜백과 저장 상태는 리더와 오디오 context를 섞지 않는다', () => {
    assert.match(viewerWindowSource, /const viewerWindow = new BrowserWindow/);
    assert.match(viewerWindowSource, /context\.window !== viewerWindow/);
    assert.match(viewerWindowSource, /context\.pendingSession[\s\S]*?context\.currentSession[\s\S]*?sessions\.current\(context\.kind\)/);
    assert.match(viewerWindowSource, /kind === 'audio' \? 'audio_viewer' : 'viewer'/);
    assert.match(viewerWindowSource, /serializeViewerWindowState\(viewerWindow, context\.kind\)/);
});

test('닫히는 창은 재사용 대상에서 즉시 제외하고 이전 closed 이벤트가 새 창을 지우지 않는다', () => {
    assert.match(viewerWindowSource, /closingWindows:\s*new Set\(\)/);

    const activeWindowSource = sourceSection(
        viewerWindowSource,
        'const activeViewerWindow = context =>',
        'const viewerContextForSender',
    );
    assert.match(activeWindowSource, /!context\.closingWindows\.has\(context\.window\)/);

    const closeSource = sourceSection(
        viewerWindowSource,
        'const handleViewerWindowClose = event =>',
        "if (process.platform !== 'darwin')",
    );
    assert.match(closeSource, /saveViewerWindowState\(\)/);
    assert.match(closeSource, /context\.kind === 'audio' && !context\.allowClose[\s\S]*?event\.preventDefault\(\)[\s\S]*?requestViewerClose\(context, viewerWindow\)/);
    assert.match(closeSource, /context\.closingWindows\.add\(viewerWindow\)/);
    assert.match(viewerWindowSource, /viewerWindow\.on\('close', handleViewerWindowClose\)/);
    assert.match(viewerWindowSource, /viewerWindow\.on\('closed',[\s\S]*?context\.closingWindows\.delete\(viewerWindow\)[\s\S]*?if \(context\.window !== viewerWindow\) return/);
});

test('세션 데이터 IPC는 sender 뷰어 종류와 요청 세션 종류를 검증한다', () => {
    assert.match(viewerWindowSource, /if \(!senderContext\)[\s\S]*?throw new Error\('Viewer window was not found\.'/);
    assert.match(viewerWindowSource, /if \(senderContext !== expectedContext\)[\s\S]*?throw new Error\('Viewer session does not belong to this window\.'/);
    const handlers = [
        ['viewer:listComicPages', 'viewer:getComicPage', 'listComicPages'],
        ['viewer:getComicPage', 'viewer:getDocumentData', 'getComicPage'],
        ['viewer:getDocumentData', 'viewer:getAudioData', 'getDocumentData'],
        ['viewer:getAudioData', 'viewer:listAudioQueue', 'getAudioData'],
        ['viewer:listAudioQueue', 'viewer:getText', 'listAudioQueue'],
        ['viewer:getText', 'viewer:getEpubText', 'getText'],
        ['viewer:getEpubText', 'viewer:getConfig', 'getEpubText'],
    ];
    for (const [channel, nextChannel, method] of handlers) {
        const handlerSource = sourceSection(
            viewerWindowSource,
            `ipcMain.handle('${channel}'`,
            `ipcMain.handle('${nextChannel}'`,
        );
        assert.match(handlerSource, /viewerContextForSessionRequest\(event, sessionId\)/, channel);
        assert.match(handlerSource, new RegExp(`sessions\\.${method}\\(sessionId`), channel);
    }
});

test('인접권과 오디오 큐 이동은 현재 세션에서 온 요청만 허용한다', () => {
    assert.match(
        viewerWindowSource,
        /const viewerContextForCurrentSessionRequest[\s\S]*?context\.currentSession\?\.id !== sessionId[\s\S]*?Viewer session is no longer current/,
    );
});

test('뷰어 닫기와 메인 창 종료는 audio 확인 흐름 또는 강제 종료 범위로 닫는다', () => {
    assert.match(viewerPreloadSource, /closeWindow:\s*\(\) => ipcRenderer\.invoke\('viewer:closeWindow'\)/);
    assert.match(viewerWindowSource, /ipcMain\.handle\('viewer:closeWindow',[\s\S]*?viewerContextForSender\(event\.sender\)[\s\S]*?requestViewerClose\(context, targetWindow\)/);
    assert.match(viewerWindowSource, /closeAllWindows:\s*\(options = \{\}\) =>[\s\S]*?options\.force === true[\s\S]*?forceCloseViewerContext\(context\)/);
    assert.match(mainSource, /mainWindow\.on\('closed',[\s\S]*?viewerController\?\.closeAllWindows\?\.\(\{ force: true \}\)/);
    assert.match(mainSource, /app\.on\('before-quit',[\s\S]*?event\.preventDefault\(\)[\s\S]*?appQuitRequested = true[\s\S]*?mainWindow\.close\(\)/);
    assert.match(mainSource, /!shouldProceedWithExit\(result\.response\)[\s\S]*?appQuitRequested = false/);
    assert.match(mainSource, /configManager\?\.updateConfig[\s\S]*?viewerController\?\.prepareForAppQuit\?\.\(\)[\s\S]*?allowWindowClose = true/);
    assert.match(mainSource, /if \(allowAppQuit\) return;[\s\S]*?allowAppQuit = true[\s\S]*?app\.quit\(\)/);
});

test('오디오 닫기 요청은 single-flight 다이얼로그에서 전환, 닫기, 취소를 처리한다', () => {
    const requestSource = sourceSection(
        viewerWindowSource,
        'const requestViewerClose = (context, window) =>',
        'const sendSession =',
    );
    assert.match(requestSource, /if \(context\.closeDialogPromise\) return context\.closeDialogPromise/);
    assert.match(requestSource, /createAudiobookCloseDialogOptions\(language\)/);
    assert.match(requestSource, /resolveAudiobookCloseAction\(result\.response\)/);
    assert.match(requestSource, /context\.closeRequestVersion === requestedVersion/);
    assert.match(requestSource, /transferAudioContextToMiniPlayer\(context, window\)/);
    assert.match(requestSource, /forceCloseViewerContext\(context\)/);

    const transferSource = sourceSection(
        viewerWindowSource,
        'const transferAudioContextToMiniPlayer =',
        'const requestViewerClose =',
    );
    assert.match(transferSource, /context\.miniPlayerActive = true/);
    assert.match(transferSource, /window\.hide\(\)/);
    assert.match(transferSource, /sendAudioMiniPlayerState\(context, 'show'\)/);
    assert.match(transferSource, /focusMainAppWindow\(\)/);
});

test('오디오 재생 상태 IPC는 audio sender와 현재 session을 검증하고 정적, 동적 상태를 분리한다', () => {
    assert.match(viewerWindowSource, /audioTrackState:\s*null/);
    assert.match(viewerWindowSource, /audioPlaybackState:\s*null/);
    assert.match(viewerWindowSource, /context !== viewerContexts\.audio \|\| session\?\.type !== 'audio'/);
    assert.match(viewerWindowSource, /String\(state\.sessionId \|\| ''\) !== session\.id/);
    assert.match(viewerWindowSource, /ipcMain\.on\('viewer:audio-track-state',[\s\S]*?sanitizeAudioTrackState/);
    assert.match(viewerWindowSource, /ipcMain\.on\('viewer:audio-playback-state',[\s\S]*?sanitizeAudioPlaybackState/);
    assert.match(viewerPreloadSource, /publishAudioMiniTrack:[\s\S]*?viewer:audio-track-state/);
    assert.match(viewerPreloadSource, /publishAudioMiniPlayback:[\s\S]*?viewer:audio-playback-state/);
    assert.match(viewerPreloadSource, /onAudioMiniPlayerCommand:[\s\S]*?viewer:audio-mini-command/);
});

test('메인 창은 미니플레이어 상태 조회, 변경 구독, 제어만 허용된 sender 범위에서 수행한다', () => {
    assert.match(mainSource, /getMainWindow:\s*\(\) => mainWindow/);
    for (const preloadSource of [mainPreloadSource, mainPreloadEsmSource]) {
        assert.match(preloadSource, /getAudioMiniPlayerState:[\s\S]*?viewer:getAudioMiniPlayerState/);
        assert.match(preloadSource, /onAudioMiniPlayerState:[\s\S]*?viewer:audio-mini-state/);
        assert.match(preloadSource, /controlAudioMiniPlayer:[\s\S]*?viewer:controlAudioMiniPlayer/);
    }
    assert.match(viewerWindowSource, /if \(!mainWindowForSender\(event\?\.sender\)\)[\s\S]*?only available from the main window/);
    assert.match(viewerWindowSource, /String\(command\?\.sessionId \|\| ''\) !== sessionId/);
    assert.match(viewerWindowSource, /if \(type === 'restore'\)[\s\S]*?clearAudioMiniPlayer\(context\)[\s\S]*?window\.show\(\)/);
    assert.match(viewerWindowSource, /if \(type === 'close'\)[\s\S]*?forceCloseViewerContext\(context\)/);
    assert.match(viewerWindowSource, /\['play', 'pause', 'seek'\]\.includes\(type\)/);
    assert.match(viewerWindowSource, /const payload = \{ type, sessionId \}/);
    assert.match(viewerWindowSource, /window\.webContents\.send\('viewer:audio-mini-command', payload\)/);
});

test('숨긴 오디오 창은 throttling 없이 유지하고 명시적 열기와 종료에서 미니 상태를 정리한다', () => {
    assert.match(viewerWindowSource, /backgroundThrottling:\s*context\.kind !== 'audio'/);
    assert.match(viewerWindowSource, /wasMiniPlayerActive && preserveMiniPlayer[\s\S]*?sendAudioMiniPlayerState\(context, 'show'\)/);
    assert.match(viewerWindowSource, /if \(context\.kind === 'audio'\) clearAudioMiniPlayer\(context\)[\s\S]*?window\.show\(\)/);
    assert.match(viewerWindowSource, /webContents\.on\('render-process-gone',[\s\S]*?clearAudioMiniPlayer\(context\)/);
    assert.match(viewerWindowSource, /viewerWindow\.on\('closed',[\s\S]*?clearAudioMiniPlayer\(context\)/);
});
