import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerSource = fs.readFileSync(path.join(root, 'src/components/viewer/AudiobookViewer.jsx'), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `${startMarker} 시작 지점을 찾을 수 없습니다.`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `${endMarker} 끝 지점을 찾을 수 없습니다.`);
    return source.slice(start, end + endMarker.length);
}

test('오디오북 재생 설정은 톱니바퀴 아이콘으로 툴바 맨 오른쪽에 표시한다', () => {
    const toolbarSource = sourceBetween(
        viewerSource,
        '<header className="audiobook-toolbar">',
        '</header>',
    );
    const actionsSource = sourceBetween(
        toolbarSource,
        '<div className="audiobook-toolbar-actions">',
        '</div>',
    );
    assert.match(actionsSource, /title=\{t\('settings'\)\}[\s\S]*?icon="gear"/);
    assert.match(actionsSource, /title=\{t\('settings'\)\}[\s\S]*?\/>\s*<\/div>$/);
});

test('오디오북 툴바에는 별도 닫기 버튼을 표시하지 않는다', () => {
    const toolbarSource = sourceBetween(
        viewerSource,
        '<header className="audiobook-toolbar">',
        '</header>',
    );

    assert.doesNotMatch(toolbarSource, /title=\{t\('close'\)\}/);
    assert.doesNotMatch(toolbarSource, /icon="xmark"/);
    assert.doesNotMatch(toolbarSource, /onClick=\{closeViewer\}/);
});
