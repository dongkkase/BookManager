import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const viewerSource = readFileSync(fileURLToPath(new URL('./ViewerApp.jsx', import.meta.url)), 'utf8');
const viewerCss = readFileSync(fileURLToPath(new URL('./styles/viewer.css', import.meta.url)), 'utf8');
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

test('EPUB/TXT 뷰어는 tts-react 3 훅 기반 TTS 컨트롤을 제공한다', () => {
    assert.equal(packageJson.dependencies['tts-react'], '^3.0.7');
    assert.match(viewerSource, /import\s+\{\s*useTts\s*\}\s+from\s+['"]tts-react['"]/);
    assert.match(viewerSource, /function ViewerTtsControls/);
    assert.match(viewerSource, /markTextAsSpoken:\s*true/);
    assert.match(viewerSource, /state\.voices\?\.length > 0 \? state\.voices : availableVoices/);
});

test('TTS 컨트롤은 리더 문서에서만 표시되고 현재 페이지 텍스트를 사용한다', () => {
    assert.match(viewerSource, /const isReaderDocument = session\?\.type === 'epub' \|\| session\?\.type === 'text'/);
    assert.match(viewerSource, /const currentTtsText = useMemo/);
    assert.match(viewerSource, /readerItemTtsText\(flowItems\[index\]\)/);
    assert.match(viewerSource, /\{isReaderDocument && \(\s*<div className="viewer-tool-cluster viewer-tts-cluster"/);
});

test('TTS 메뉴 스타일은 툴바 안에서 독립 팝업으로 배치된다', () => {
    assert.match(viewerCss, /\.viewer-tts-control \{/);
    assert.match(viewerCss, /\.viewer-tts-menu \{[\s\S]*position:\s*absolute/);
    assert.match(viewerCss, /\.viewer-tts-field select \{/);
});
