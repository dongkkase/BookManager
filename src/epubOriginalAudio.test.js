import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('original EPUB audio proxies keep layout and delegate playback without loading media', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-audio-test-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import { applyEpubOriginalTheme, buildEpubOriginalDocument } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/epubOriginalDocument.js')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    for (let count = 0; count < 200; count += 1) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
const chapter = {
    name: 'OPS/chapter.xhtml', title: 'Audio fixture',
    audioTracks: [
        { id: 'voice-track', kind: 'inline', anchor: 'voice', title: 'VOICE_ONLY_LABEL', sources: [{ src: 'https://audio.invalid/voice.mp3', type: 'audio/mpeg' }] },
        { id: 'background-track', kind: 'inline', anchor: 'background', title: 'BACKGROUND_ONLY_LABEL', sources: [{ src: 'https://audio.invalid/background.mp3' }], loop: true },
        { id: 'hidden-track', kind: 'inline', anchor: 'hidden-control', title: 'HIDDEN_ONLY_LABEL', sources: [{ src: 'https://audio.invalid/hidden.mp3' }] },
    ],
    original: { layout: 'reflowable', resourceUrls: { 'OPS/voice.mp3': 'https://audio.invalid/voice.mp3' }, stylesheet: 'body{background-image:url(https://audio.invalid/voice.mp3)}', html: '<html><head><style>body{margin:0;font:16px/20px sans-serif}.page{height:320px;break-after:column}p{margin:0 0 12px}.hidden{display:none}</style></head><body><section class="page">첫 번째 본문</section><section class="page"><p id="voice-paragraph">두 번째 본문 <audio id="voice" data-bookmanager-audio-track="voice-track" controls autoplay onplay="window.audioRan=true" src="https://audio.invalid/voice.mp3"><source src="https://audio.invalid/fallback.ogg"/></audio></p><p id="background-paragraph">숨은 오디오 위치<audio id="background" autoplay loop src="https://audio.invalid/background.mp3"></audio></p><audio id="hidden-control" class="hidden" controls autoplay src="https://audio.invalid/hidden.mp3"></audio><audio id="unknown" controls src="https://audio.invalid/unknown.mp3"></audio><source src="https://audio.invalid/orphan.mp3"/><button onclick="window.audioRan=true">unsafe</button></section></body></html>' },
};
const built = new DOMParser().parseFromString(buildEpubOriginalDocument(chapter, { pageSize: { width: 240, height: 320 } }), 'text/html');
check(built.querySelectorAll('audio,source,video,track').length === 0, 'The original document must contain no media elements or sources');
check(!built.documentElement.outerHTML.includes('audio.invalid'), 'Audio resource URLs must remain exclusively in the parent playback engine');
check(!built.querySelector('[autoplay],[onplay],[onclick]'), 'Publisher autoplay and event attributes must not survive');
check(built.querySelectorAll('button').length === 2, 'Only registered visible-control proxies may be added');
check(built.getElementById('background')?.dataset.epubAudioId === 'background-track', 'Hidden audio keeps its stable anchor');
check(built.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("default-src 'none'"), 'Media remains blocked by the document CSP');

const requests = [];
const layouts = {};
let selections = 0;
let parentClicks = 0;
let parentPointers = 0;
let parentKeys = 0;
window.addEventListener('click', () => parentClicks += 1);
window.addEventListener('pointerdown', () => parentPointers += 1);
window.addEventListener('keydown', () => parentKeys += 1);
const root = createRoot(document.getElementById('root'));
const requestAudio = id => requests.push(id);
const render = (audioState, labels = { play: 'Play', pause: 'Pause', loading: 'Loading' }, enabled = true) => root.render(<>
    <div className="viewer-content"><EpubOriginalDocument chapter={chapter} pageSize={{ width: 240, height: 320 }} pageOffset={1}
        onLayout={layout => layouts.main = layout} onAudioRequest={enabled ? requestAudio : undefined}
        audioState={audioState} audioLabels={labels} onSelectionChange={() => selections += 1} /></div>
    <EpubOriginalDocument chapter={chapter} mode="measure" pageSize={{ width: 240, height: 320 }} onLayout={layout => layouts.measure = layout} />
</>);
window.audioProxyTests = (async () => {
    render({ trackId: '', status: 'idle' });
    await until(() => layouts.main && layouts.measure && [...document.querySelectorAll('iframe')].every(node => node.dataset.originalReady === 'true'), 'Audio proxy documents did not become ready');
    const iframe = document.querySelector('.viewer-content iframe');
    const documentBefore = iframe.contentDocument;
    const doc = documentBefore;
    const viewport = iframe.contentWindow;
    const button = doc.querySelector('button[data-epub-audio-id="voice-track"]');
    const beforeWidth = button.getBoundingClientRect().width;
    const beforeHeight = button.getBoundingClientRect().height;
    check(beforeWidth === 176 && beforeHeight === 32, 'Audio controls should have a compact fixed footprint');
    check(button.getAttribute('aria-label') === 'Play · VOICE_ONLY_LABEL', 'Playback labels are supplied by the parent');
    check(viewport.getComputedStyle(doc.getElementById('background')).display === 'none', 'Uncontrolled background audio must not create visible layout');
    check(viewport.getComputedStyle(doc.getElementById('hidden-control')).display === 'none', 'Publisher hidden control styles must survive');
    check(layouts.main.pageCount === layouts.measure.pageCount, 'Measurement and visible pages must reserve identical control space');
    check(layouts.main.anchors.voice === 1 && layouts.main.anchors.background === 1, 'Invisible audio anchors use their surrounding paragraph page');
    check(layouts.main.textByPage.every(text => !text.includes('ONLY_LABEL') && !text.includes('재생') && !text.includes('Play')), 'Audio proxy labels must not pollute page text, search, or TTS');
    check(document.querySelector('.is-measure iframe').contentDocument.querySelector('button').disabled, 'Measurement controls cannot trigger playback');
    const originalPageCount = layouts.main.pageCount;
    button.dispatchEvent(new viewport.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
    button.click();
    button.dispatchEvent(new viewport.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    button.dispatchEvent(new viewport.KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    button.dispatchEvent(new viewport.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    button.dispatchEvent(new viewport.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    button.dispatchEvent(new viewport.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    check(requests.join(',') === 'voice-track,voice-track,voice-track', 'Clicks, Enter, and Space delegate exactly one request each');
    check(parentClicks === 0 && parentPointers === 0 && parentKeys === 0, 'Audio buttons must not forward page navigation or fullscreen events');
    const range = doc.createRange();
    range.selectNodeContents(button.querySelector('.bookmanager-epub-audio-label'));
    viewport.getSelection().removeAllRanges();
    viewport.getSelection().addRange(range);
    await frame(); await frame();
    check(selections === 0, 'Selecting a control label must not open the reader selection toolbar');
    viewport.getSelection().removeAllRanges();
    render({ trackId: 'voice-track', status: 'playing' });
    await until(() => button.getAttribute('aria-pressed') === 'true', 'Playing state did not reach the proxy');
    check(button.getAttribute('aria-label') === 'Pause · VOICE_ONLY_LABEL', 'Playing controls offer pause');
    render({ trackId: 'voice-track', status: 'loading' });
    await until(() => button.getAttribute('aria-busy') === 'true', 'Loading state did not reach the proxy');
    check(iframe.contentDocument === documentBefore && layouts.main.pageCount === originalPageCount, 'Playback updates must not reload or repaginate the chapter');
    check(button.getBoundingClientRect().width === beforeWidth && button.getBoundingClientRect().height === beforeHeight, 'Playback labels must not alter pagination geometry');
    render({ trackId: 'background-track', status: 'playing' }, { play: '재생', pause: '일시정지', loading: '불러오는 중' });
    await until(() => button.getAttribute('aria-label') === '재생 · VOICE_ONLY_LABEL', 'Inactive track labels did not reset');
    check(button.getAttribute('aria-pressed') === 'false', 'Other playing tracks must not mark this control active');
    render({ trackId: '', status: 'idle' }, undefined, false);
    await until(() => button.disabled, 'A missing parent playback callback must disable the proxy');
    const priorRequests = requests.length;
    button.click();
    check(requests.length === priorRequests, 'Disabled controls cannot request playback');
    check([...document.querySelectorAll('iframe')].every(node => node.contentDocument.querySelectorAll('audio,source').length === 0), 'No live iframe may contain media elements');
    const paragraph = doc.getElementById('voice-paragraph');
    doc.body.style.setProperty('background-image', 'linear-gradient(white, beige)', 'important');
    paragraph.style.setProperty('color', '#123456', 'important');
    paragraph.style.setProperty('background-image', 'linear-gradient(white, white)', 'important');
    const originalPaper = viewport.getComputedStyle(doc.body).backgroundImage;
    const originalParagraph = viewport.getComputedStyle(paragraph).backgroundImage;
    const artwork = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    artwork.style.color = '#882244';
    const artworkPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    artworkPath.setAttribute('fill', 'currentColor');
    artwork.append(artworkPath);
    doc.body.append(artwork);
    const illustration = doc.createElement('div');
    illustration.style.backgroundImage = 'linear-gradient(red, blue)';
    doc.body.append(illustration);
    const originalArtwork = viewport.getComputedStyle(artworkPath).fill;
    const originalIllustration = viewport.getComputedStyle(illustration).backgroundImage;
    applyEpubOriginalTheme(doc, { bg: '#182029', fg: '#e7edf5' });
    check(viewport.getComputedStyle(paragraph).color === 'rgb(231, 237, 245)', 'Themes override publisher important text colors');
    check(viewport.getComputedStyle(doc.body).backgroundImage === 'none' && viewport.getComputedStyle(paragraph).backgroundImage === 'none', 'Publisher paper backgrounds must not obscure themed text');
    check(viewport.getComputedStyle(artworkPath).fill === originalArtwork && viewport.getComputedStyle(illustration).backgroundImage === originalIllustration, 'Themes preserve SVG colors and standalone CSS illustrations');
    doc.documentElement.style.setProperty('column-width', '240px', 'important');
    applyEpubOriginalTheme(doc, null);
    check(viewport.getComputedStyle(doc.body).backgroundImage === originalPaper && viewport.getComputedStyle(paragraph).backgroundImage === originalParagraph, 'Original mode restores publisher paper backgrounds');
    check(paragraph.style.getPropertyValue('color') === 'rgb(18, 52, 86)' && paragraph.style.getPropertyPriority('color') === 'important', 'Original mode restores inline colors and their priority');
    check(doc.documentElement.style.getPropertyValue('column-width') === '240px', 'Theme restoration preserves pagination styles added after applying a theme');
    check(iframe.contentDocument === documentBefore && requests.length === priorRequests, 'Appearance changes must not reload the iframe or request audio playback');
    const fixedChapter = { name: 'fixed.xhtml', original: { html: '<html><body><p>Fixed page</p></body></html>', stylesheet: '', resourceUrls: {}, layout: 'pre-paginated', viewport: { width: 400, height: 600 } } };
    let fixedReady = 0;
    const renderFixed = (mode, padding) => root.render(<EpubOriginalDocument chapter={fixedChapter} mode={mode} pageSize={{ width: 400, height: 600 }} appearance={{ horizontalPadding: padding, verticalPadding: padding }} onReady={() => fixedReady += 1} />);
    renderFixed('page', 0);
    await until(() => fixedReady > 0 && document.querySelector('iframe')?.dataset.originalReady === 'true', 'Fixed layout did not initialize');
    const fixedDocument = document.querySelector('iframe').contentDocument;
    renderFixed('scroll', 40);
    await until(() => fixedReady > 1 && document.querySelector('iframe')?.dataset.originalReady === 'true', 'Fixed layout scroll margins must become ready even when the source document is unchanged');
    check(document.querySelector('iframe').contentDocument === fixedDocument, 'Fixed layout mode and margin changes must reuse the loaded publisher document');
    renderFixed('scroll', 60);
    await until(() => fixedReady > 2 && document.querySelector('iframe')?.dataset.originalReady === 'true', 'Changing fixed scroll margins must reconnect layout readiness');
    check(document.querySelector('iframe').contentDocument === fixedDocument, 'Repeated fixed margin changes must not reload the iframe');
    root.unmount();
    return { requests, pageCount: originalPageCount, anchors: layouts.main.anchors, mediaElements: 0 };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { backgroundThrottling: false } });
    let audioRequests = 0;
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['*://audio.invalid/*'] }, (_details, callback) => { audioRequests += 1; callback({ cancel: true }); });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.audioProxyTests');
    if (audioRequests) throw new Error('An iframe attempted to load publisher audio: ' + audioRequests);
    console.log('EPUB_AUDIO_RESULT=' + JSON.stringify({ ...result, audioRequests }));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Audio proxy renderer timed out: ' + result)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_AUDIO_RESULT=(.+)/)[1]);
        assert.equal(report.audioRequests, 0);
        assert.equal(report.requests.length, 3);
        assert.equal(report.anchors.background, 1);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
