import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerSource = fs.readFileSync(path.join(root, 'src/components/viewer/AudiobookViewer.jsx'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src/ViewerApp.jsx'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'electron/viewerPreload.cjs'), 'utf8');
const windowSource = fs.readFileSync(path.join(root, 'electron/viewerWindow.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'electron/servers/webServer.js'), 'utf8');

test('오디오북 뷰어는 데스크톱과 웹에서 메타데이터, 큐, 스트리밍 API를 사용한다', () => {
    assert.match(appSource, /nextSession\.type !== 'audio'/);
    assert.match(appSource, /getAudioData: sessionId => fetchWebViewerJson/);
    assert.match(appSource, /listAudioQueue: sessionId => fetchWebViewerJson/);
    assert.match(preloadSource, /getAudioData: sessionId => ipcRenderer\.invoke\('viewer:getAudioData'/);
    assert.match(preloadSource, /listAudioQueue: sessionId => ipcRenderer\.invoke\('viewer:listAudioQueue'/);
    assert.match(windowSource, /ipcMain\.handle\('viewer:getAudioData'/);
    assert.match(serverSource, /\/api\/viewer\/audio-data\/\:sessionId/);
    assert.match(serverSource, /\/api\/viewer\/audio-queue\/\:sessionId/);
});

test('오디오북 뷰어는 재생 위치와 초 단위 북마크를 공통 뷰어 키에 저장한다', () => {
    assert.match(viewerSource, /bookmanager-viewer-state:/);
    assert.match(viewerSource, /bookmanager-viewer-bookmarks:/);
    assert.match(viewerSource, /positionSeconds:/);
    assert.match(viewerSource, /durationSeconds:/);
    assert.match(viewerSource, /playbackRate:/);
    assert.match(viewerSource, /timeSeconds:/);
    assert.match(viewerSource, /window\.setInterval\(saveCapturedPlaybackState, 5000\)/);
    assert.match(viewerSource, /window\.addEventListener\('beforeunload', handleBeforeUnload\)/);
    assert.match(viewerSource, /Number\(audio\.readyState\) > 0/);
    assert.match(viewerSource, /fallbackPosition/);
    assert.match(appSource, /if \(!session \|\| session\.type === 'audio'\) return/);
});

test('오디오북 뷰어는 핵심 재생 제어와 종료 후 연속 재생을 제공한다', () => {
    assert.match(viewerSource, /PLAYBACK_RATES = \[0\.75, 1, 1\.25, 1\.5, 1\.75, 2\]/);
    assert.match(viewerSource, /SLEEP_MINUTES = \[5, 10, 15, 30, 45, 60, 120\]/);
    assert.match(viewerSource, /panel === 'playlist'/);
    assert.match(viewerSource, /panel === 'bookmarks'/);
    assert.match(viewerSource, /panel === 'settings'/);
    assert.match(viewerSource, /panel === 'info'/);
    assert.match(viewerSource, /if \(continuousPlayback && session\?\.adjacent\?\.hasNext\)/);
    assert.match(viewerSource, /moveAdjacent\(1, true\)/);
    assert.match(viewerSource, /event\.code === 'Space'/);
    assert.match(viewerSource, /onPointerCancel=/);
});
