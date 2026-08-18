import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audiobookViewerSource = fs.readFileSync(
    path.join(root, 'src/components/viewer/AudiobookViewer.jsx'),
    'utf8',
);
const viewerAppSource = fs.readFileSync(path.join(root, 'src/ViewerApp.jsx'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} 시작 지점을 찾을 수 없습니다.`);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(end, -1, `${endMarker} 끝 지점을 찾을 수 없습니다.`);
    return source.slice(start, end);
}

test('오디오북 닫기 요청은 재생을 먼저 멈추지 않고 최신 상태를 발행한 뒤 native close를 요청한다', () => {
    const closeSource = sourceBetween(
        audiobookViewerSource,
        'const closeViewer = useCallback(() => {',
        'const openQueueItem = useCallback',
    );

    assert.match(closeSource, /publishAudioMiniPlayback\(\);[\s\S]*?onClose\?\.\(\);/);
    assert.doesNotMatch(closeSource, /audioRef\.current\?\.pause\(\)/);
    assert.doesNotMatch(closeSource, /savePlaybackState\(\)/);
    assert.match(closeSource, /\}, \[onClose, publishAudioMiniPlayback\]\);/);
});

test('오디오북은 트랙 고정 정보와 동적 재생 정보를 분리해 발행한다', () => {
    const trackPublishCalls = audiobookViewerSource.match(
        /window\.viewerAPI\?\.publishAudioMiniTrack\?\.\(/g,
    ) || [];
    const playbackPublishCalls = audiobookViewerSource.match(
        /window\.viewerAPI\?\.publishAudioMiniPlayback\?\.\(/g,
    ) || [];

    assert.equal(trackPublishCalls.length, 1);
    assert.equal(playbackPublishCalls.length, 1);
    const trackSource = sourceBetween(
        audiobookViewerSource,
        'window.viewerAPI?.publishAudioMiniTrack?.({',
        '});',
    );
    const playbackSource = sourceBetween(
        audiobookViewerSource,
        'const publishAudioMiniPlayback = useCallback(() => {',
        'useEffect(() => {',
    );

    for (const key of ['sessionId', 'fileName', 'title', 'artist', 'artworkDataUrl']) {
        assert.match(trackSource, new RegExp(`\\b${key}\\b`), key);
    }
    for (const key of [
        'sessionId',
        'positionSeconds',
        'durationSeconds',
        'playing',
        'playbackRate',
        'volume',
        'muted',
    ]) {
        assert.match(playbackSource, new RegExp(`\\b${key}\\b`), key);
    }
    const dependencySource = playbackSource.match(/\}, \[([^\]]*)\]\);/)?.[1] || '';
    for (const dependency of [
        'currentTime',
        'effectiveDuration',
        'playing',
        'playbackRate',
        'volume',
        'muted',
        'session?.id',
    ]) {
        assert.ok(dependencySource.includes(dependency), dependency);
    }
    assert.match(
        audiobookViewerSource,
        /useEffect\(\(\) => \{[\s\S]*?publishAudioMiniPlayback\(\);[\s\S]*?\}, \[[^\]]*publishAudioMiniPlayback[^\]]*\]\);/,
    );
});

test('숨겨진 오디오북 뷰어는 미니 플레이어의 재생, 일시정지, 탐색 명령을 처리한다', () => {
    const commandSource = sourceBetween(
        audiobookViewerSource,
        'useEffect(() => window.viewerAPI?.onAudioMiniPlayerCommand',
        'const infoRows = useMemo',
    );

    assert.match(commandSource, /command\?\.type === 'play'[\s\S]*?\.play\(\)/);
    assert.match(commandSource, /command\?\.type === 'pause'[\s\S]*?\.pause\(\)/);
    assert.match(
        commandSource,
        /command\?\.type === 'seek'[\s\S]*?(?:seekTo\(command\??\.positionSeconds\)|currentTime\s*=\s*[^;]*command\??\.positionSeconds)/,
    );
    assert.match(commandSource, /command\?\.sessionId[\s\S]*?command\.sessionId !== session\?\.id/);
    assert.match(
        commandSource,
        /useEffect\(\(\) => window\.viewerAPI\?\.onAudioMiniPlayerCommand\?\.\([\s\S]*?\), \[seekTo, session\?\.id\]\);/,
    );
});

test('ViewerApp은 오디오북 닫기를 viewer native close API에 직접 위임한다', () => {
    const audiobookSource = sourceBetween(
        viewerAppSource,
        "if (session?.type === 'audio') {",
        'return (\n    <div className={appClassName}',
    );

    assert.match(audiobookSource, /<AudiobookViewer/);
    assert.match(audiobookSource, /onClose=\{\(\) => window\.viewerAPI\?\.closeWindow\?\.\(\)\}/);
});
