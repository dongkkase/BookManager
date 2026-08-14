import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');
const i18nSource = fs.readFileSync(new URL('./utils/i18n.js', import.meta.url), 'utf8');

test('만화책 뷰어 이미지는 브라우저 기본 이미지 드래그를 시작하지 않는다', () => {
    assert.match(viewerSource, /className=\{imageClassName\}[\s\S]*draggable=\{false\}/);
    assert.match(viewerSource, /onDragStart=\{event => event\.preventDefault\(\)\}/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*-webkit-user-drag: none;/);
    assert.match(viewerCss, /\.viewer-comic-image \{[\s\S]*user-select: none;/);
});

test('만화 이미지는 배율이 변해도 부드러운 기본 보간을 사용한다', () => {
    const imageRule = viewerCss.match(/^\.viewer-comic-image\s*\{([^}]*)\}/m)?.[1] || '';

    assert.match(imageRule, /image-rendering:\s*auto/);
    assert.doesNotMatch(imageRule, /image-rendering:\s*(?:crisp-edges|pixelated|-webkit-optimize-contrast)/);
});

test('확대된 만화 이미지는 좌상단을 포함한 전체 영역으로 이동할 수 있다', () => {
    const stageRule = viewerCss.match(/\.viewer-comic-stage\s*\{([^}]*)\}/)?.[1] || '';
    const spreadRule = viewerCss.match(/\.viewer-spread-pair\s*\{([^}]*)\}/)?.[1] || '';

    assert.match(stageRule, /align-items:\s*safe center/);
    assert.match(stageRule, /justify-content:\s*safe center/);
    assert.match(spreadRule, /align-items:\s*safe center/);
    assert.match(spreadRule, /justify-content:\s*safe center/);
});

test('뷰어 공통 툴바는 Tab과 hover로 부드럽게 표시 상태를 전환한다', () => {
    assert.match(viewerSource, /import toolbarIcon from '\.\/images\/toolbar\.svg';/);
    assert.match(viewerSource, /const \[toolbarPinnedOpen, setToolbarPinnedOpen\] = useState\(true\);/);
    assert.match(viewerSource, /const toolbarVisible = toolbarPinnedOpen \|\| toolbarPeekOpen;/);
    assert.match(viewerSource, /event\.key === 'Tab'[\s\S]*toggleToolbarPinned\(\)/);
    assert.match(viewerSource, /className="viewer-toolbar-hover-zone"/);
    assert.match(viewerSource, /iconSrc=\{toolbarIcon\}[\s\S]*active=\{toolbarVisible\}/);
    assert.match(viewerCss, /\.viewer-app\.is-toolbar-hidden \.viewer-toolbar \{[\s\S]*transform: translateY/);
    assert.match(viewerCss, /\.viewer-toolbar-hover-zone \{/);
    assert.match(i18nSource, /hide_toolbar: '툴바 숨기기 \(Tab\)'/);
    assert.match(i18nSource, /hide_toolbar: 'Hide toolbar \(Tab\)'/);
    assert.match(i18nSource, /hide_toolbar: 'ツールバーを隠す \(Tab\)'/);
});
