import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    audioSessionMatchesSuccessfulPath,
    normalizeAudioViewerMetadataPath,
} from './audioViewerMetadataRefresh.js';

test('성공한 실제 경로가 현재 오디오 세션과 같을 때만 메타데이터 갱신 대상으로 판단한다', () => {
    const currentPath = path.resolve('/library', '눈물을 마시는 새.m4b');
    const normalizedSuccessPath = normalizeAudioViewerMetadataPath(currentPath.normalize('NFC'));
    const session = {
        type: 'audio',
        filePath: currentPath.normalize('NFD'),
    };

    assert.equal(audioSessionMatchesSuccessfulPath(session, [normalizedSuccessPath]), true);
    assert.equal(audioSessionMatchesSuccessfulPath(session, ['/library/other.m4b']), false);
    assert.equal(audioSessionMatchesSuccessfulPath({ ...session, type: 'epub' }, [normalizedSuccessPath]), false);
});

test('Windows 오디오 경로 비교는 대소문자와 구분자 차이를 정규화한다', () => {
    const session = {
        type: 'audio',
        filePath: 'C:\\Audio\\BOOK.M4B',
    };

    assert.equal(audioSessionMatchesSuccessfulPath(session, ['c:/audio/book.m4b'], 'win32'), true);
    assert.equal(audioSessionMatchesSuccessfulPath(session, ['c:/audio/book-2.m4b'], 'win32'), false);
});

test('저장 성공 알림은 열린 오디오 세션의 메타데이터만 갱신하고 재생 소스와 상태를 유지한다', () => {
    const viewerWindowSource = fs.readFileSync(new URL('./viewerWindow.js', import.meta.url), 'utf8');
    const preloadSource = fs.readFileSync(new URL('./viewerPreload.cjs', import.meta.url), 'utf8');
    const viewerSource = fs.readFileSync(
        new URL('../src/components/viewer/AudiobookViewer.jsx', import.meta.url),
        'utf8',
    );
    const ipcSource = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');
    const refreshManagerSource = viewerWindowSource.match(
        /const refreshAudioMetadata = async successfulPaths => \{[\s\S]*?\n    \};/,
    )?.[0] || '';
    const refreshRendererSource = viewerSource.match(
        /useEffect\(\(\) => window\.viewerAPI\?\.onAudioMetadataRefresh[\s\S]*?\n    \}\), \[session\?\.id\]\);/,
    )?.[0] || '';

    assert.match(refreshManagerSource, /audioSessionMatchesSuccessfulPath\(session, successfulPaths\)/);
    assert.match(refreshManagerSource, /sessions\.getAudioData\(sessionId\)/);
    assert.match(refreshManagerSource, /webContents\.send\('viewer:audio-metadata-refresh'/);
    assert.doesNotMatch(refreshManagerSource, /sendSession|focusContextWindow|setContextSession|audioPlaybackState|miniPlayerActive/);
    assert.match(preloadSource, /onAudioMetadataRefresh:[\s\S]*?'viewer:audio-metadata-refresh'/);
    assert.match(refreshRendererSource, /setAudioData\(current =>/);
    assert.match(refreshRendererSource, /documentUrl: current\?\.documentUrl \|\| payload\.audioData\.documentUrl/);
    assert.doesNotMatch(refreshRendererSource, /\.play\(|\.pause\(|currentTime|playbackRate|volume|muted/);
    assert.match(ipcSource, /result\?\.stats\?\.successPaths[\s\S]*?hooks\.onMetadataSaveSuccess\(successfulPaths\)/);
});
