import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

test('만화책 뷰어 이미지는 브라우저 기본 이미지 드래그를 시작하지 않는다', () => {
    assert.match(viewerSource, /className=\{imageClassName\}[\s\S]*draggable=\{false\}/);
    assert.match(viewerSource, /onDragStart=\{event => event\.preventDefault\(\)\}/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*-webkit-user-drag: none;/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*user-select: none;/);
});
