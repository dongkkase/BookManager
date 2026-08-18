import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const miniPlayerSource = fs.readFileSync(
    path.join(root, 'src/components/AudiobookMiniPlayer.jsx'),
    'utf8',
);
const appStyles = fs.readFileSync(path.join(root, 'src/styles/App.css'), 'utf8');

test('메인 앱은 미니플레이어 상태를 조회하고 이벤트 구독을 해제한다', () => {
    assert.match(appSource, /getAudioMiniPlayerState/);
    assert.match(appSource, /onAudioMiniPlayerState\?\.\(handleMiniPlayerState\)/);
    assert.match(appSource, /reduceAudioMiniPlayerState/);
    assert.match(appSource, /typeof removeMiniPlayerListener === 'function'/);
    assert.match(appSource, /removeMiniPlayerListener\(\)/);
});

test('미니플레이어는 전역 하단 바의 맨 오른쪽에 렌더링한다', () => {
    const bottomBarStart = appSource.indexOf('<div className="app-bottom-bar">');
    const bottomBarEnd = appSource.indexOf('\n      </div>\n\n      {showSettings', bottomBarStart);
    assert.notEqual(bottomBarStart, -1);
    assert.notEqual(bottomBarEnd, -1);

    const bottomBarSource = appSource.slice(bottomBarStart, bottomBarEnd);
    assert.ok(bottomBarSource.indexOf('app-status-area') < bottomBarSource.indexOf('<AudiobookMiniPlayer'));
    assert.match(bottomBarSource, /<AudiobookMiniPlayer[\s\S]*?state=\{audioMiniPlayerState\}/);
});

test('미니플레이어는 탐색과 재생, 복귀, 재생 중지 제어를 제공한다', () => {
    assert.match(miniPlayerSource, /app-audio-mini-cover/);
    assert.match(miniPlayerSource, /<strong>\{title\}<\/strong>/);
    assert.match(miniPlayerSource, /type="range"/);
    assert.match(miniPlayerSource, /aria-valuetext=\{positionText\}/);
    assert.match(miniPlayerSource, /type: state\.playing \? 'pause' : 'play'/);
    assert.match(miniPlayerSource, /type: 'seek', positionSeconds/);
    assert.match(miniPlayerSource, /type: 'restore'/);
    assert.match(miniPlayerSource, /type: 'close'/);
    assert.match(miniPlayerSource, /sessionId:\s*state\?\.sessionId \|\| ''/);
    assert.match(miniPlayerSource, /aria-label=\{text\.region\}/);
});

test('미니플레이어는 하단 바 높이 안에 배치되고 전역 range 스타일을 초기화한다', () => {
    const playerRule = appStyles.match(/\.app-audio-mini-player\s*\{([^}]*)\}/)?.[1] || '';
    const rangeRule = appStyles.match(
        /\.app-audio-mini-player input\[type="range"\]\s*\{([^}]*)\}/,
    )?.[1] || '';

    assert.match(playerRule, /flex:\s*0 0 340px/);
    assert.match(playerRule, /min-width:\s*320px/);
    assert.match(playerRule, /max-width:\s*360px/);
    assert.match(playerRule, /height:\s*45px/);
    assert.match(rangeRule, /padding:\s*0/);
    assert.match(rangeRule, /border:\s*0/);
    assert.match(rangeRule, /background:\s*transparent/);
    assert.match(
        appStyles,
        /@media \(max-width: 1260px\)[\s\S]*?\.app-audio-mini-player\s*\{[\s\S]*?flex-basis:\s*320px/,
    );
});
