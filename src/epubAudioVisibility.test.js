import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB audio follows visible document fragments rather than stale page metadata', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-audio-visibility-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import { mapEpubAudioTracks, visibleEpubAudioTracks } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/epubAudioContext.js')}`)};
import { useEpubAudioContext } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/useEpubAudioContext.js')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
async function until(predicate, message) {
    for (let count = 0; count < 200; count += 1) {
        if (predicate()) return;
        await tick();
    }
    throw new Error(message);
}
const audio = (id, anchor = 'sound') => ({ id, kind: 'inline', anchor, sources: [{ src: 'https://audio.invalid/' + id + '.wav' }] });
const chapter = {
    name: 'one.xhtml', audioTracks: [audio('one')],
    original: { layout: 'reflowable', resourceUrls: {}, stylesheet: '', html: '<html><head><style>body{margin:0;font:16px/20px sans-serif}.leaf{height:400px;break-after:column}p{margin:0}</style></head><body><section class="leaf">Before audio</section><section class="leaf"><p>Audio here <audio id="sound" controls src="voice.wav"></audio></p></section><section class="leaf">After audio</section></body></html>' },
};
const otherChapter = { ...chapter, name: 'two.xhtml', audioTracks: [audio('two')] };
const pages = [{ name: chapter.name, anchors: ['sound'] }, { name: chapter.name }, { name: chapter.name }, { name: otherChapter.name, anchors: ['sound'] }];
const mapping = mapEpubAudioTracks([chapter, otherChapter], pages);
const container = document.getElementById('content');
const rootRef = { current: container };
const root = createRoot(container);
let readyCount = 0;
let observed = [];
let lastPlaylist = [];
function Probe({ pageIndex, flowMode }) {
    const tracks = useEpubAudioContext({ rootRef, mapping, enabled: true, sessionKey: 'test', flowMode, pageIndex });
    useLayoutEffect(() => { lastPlaylist = tracks; observed.push({ pageIndex, ids: tracks.map(track => track.id) }); });
    return null;
}
const render = async (index, flowMode = 'single', scale = 1) => { root.render(<>
    {[index, ...(flowMode === 'spread' ? [index + 1] : [])].map(pageIndex => <article key={pageIndex} data-reader-page-index={pageIndex} data-reader-index={pageIndex}>
        <EpubOriginalDocument chapter={chapter} pageOffset={pageIndex} mode={flowMode === 'scroll' ? 'scroll' : 'page'}
            pageSize={{ width: 360, height: 480 }} scale={scale} appearance={{ verticalPadding: 40, horizontalPadding: 40 }} onReady={() => readyCount += 1} onAudioRequest={() => {}} />
    </article>)}
    <Probe pageIndex={index} flowMode={flowMode} />
</>); await tick(); await tick(); };
const ready = () => [...container.querySelectorAll('iframe')].length > 0 && [...container.querySelectorAll('iframe')].every(frame => frame.dataset.originalReady === 'true');
const visible = (pageIndex, flowMode = 'single') => visibleEpubAudioTracks(container, mapping, { pageIndex, flowMode }).map(track => track.id);
window.visibilityTests = (async () => {
    await render(0);
    await until(ready, 'The first page did not load');
    check(visible(0).length === 0, 'Stale metadata must not start audio from an offscreen iframe column');
    await render(1);
    await until(() => ready() && visible(1).join() === 'one', 'The actual control page must play even when metadata points to another page');
    await until(() => lastPlaylist[0]?.id === 'one', 'The hook did not publish the visible cue');
    observed = [];
    await render(0);
    await until(() => observed.some(item => item.pageIndex === 0), 'The hook did not render the next page');
    check(observed.filter(item => item.pageIndex === 0).every(item => item.ids.length === 0), 'A new page must never reuse the previous page playlist');
    await until(ready, 'The first page did not reload');
    await render(0, 'spread');
    await until(() => ready() && visible(0, 'spread').join() === 'one', 'Two-page mode should play only the visible chapter cue');
    const secondPage = container.querySelector('[data-reader-page-index="1"]');
    secondPage.dataset.curlVisible = 'false';
    check(visible(0, 'spread').length === 0, 'Hidden page-curl leaves must not play audio');
    delete secondPage.dataset.curlVisible;
    const secondFrame = secondPage.querySelector('iframe');
    secondFrame.dataset.originalReady = 'false';
    check(visible(0, 'spread').length === 0, 'Unready document layouts must not play audio');
    secondFrame.dataset.originalReady = 'true';
    await render(0, 'single', 1.5);
    await until(ready, 'Zoomed page did not load');
    check(visible(0).length === 0, 'Zoom and outer margins must still clip the following column');
    await render(0, 'scroll');
    container.style.height = '260px';
    await until(ready, 'Scroll document did not load');
    check(visible(0, 'scroll').length === 0, 'An audio cue below the scroll viewport must remain silent');
    const scrollFrame = container.querySelector('iframe');
    const control = scrollFrame.contentDocument.getElementById('sound');
    container.scrollTop = scrollFrame.getBoundingClientRect().top - container.getBoundingClientRect().top + control.getBoundingClientRect().top - 30;
    check(visible(0, 'scroll').join() === 'one', 'Scrolling the actual cue into view must activate it');
    container.style.height = '900px';
    container.scrollTop = 0;
    for (const natural of [false, true]) {
        const prefix = natural ? 'line<br>'.repeat(15) + 'Book line ends here' : 'Current page text';
        const suffix = natural ? ' FOLLOWING text continues on a new page.' : '<span style="display:block;break-before:column">Next page text</span>';
        const boundaryChapter = {
            name: 'boundary.xhtml',
            audioTracks: [audio('background', 'hidden'), { ...audio('narration', 'empty'), kind: 'overlay' }],
            original: { layout: 'reflowable', resourceUrls: {}, stylesheet: '', html: '<html><head><style>body{margin:0;font:16px/20px monospace}p{margin:0;orphans:1;widows:1}</style></head><body><p>' + prefix + '<audio id="hidden"></audio><a id="empty" style="font-size:0;line-height:0"></a>' + suffix + '</p></body></html>' },
        };
        const boundaryMapping = mapEpubAudioTracks([boundaryChapter], [{ name: boundaryChapter.name }, { name: boundaryChapter.name, anchors: ['hidden', 'empty'] }]);
        for (const pageIndex of [0, 1, 0]) {
            root.render(<article key={String(natural)} data-reader-page-index={pageIndex}>
                <EpubOriginalDocument chapter={boundaryChapter} pageOffset={pageIndex} pageSize={{ width: 320, height: 400 }}
                    appearance={{ verticalPadding: 40, horizontalPadding: 40 }} onReady={() => readyCount += 1} />
            </article>);
            await tick(); await tick();
            await until(ready, 'The boundary page did not load');
            const cues = visibleEpubAudioTracks(container, boundaryMapping, { pageIndex, flowMode: 'single' }).map(track => track.id);
            check(cues.join() === (pageIndex === 0 ? 'background,narration' : ''), 'Page-end audio must play on its own page, not the following text page: ' + JSON.stringify({ natural, pageIndex, cues }));
        }
    }
    const storyChapter = {
        name: 'story.xhtml', audioTracks: [{ ...audio('story', 'stored-audio'), triggerAnchors: ['scene'] }],
        original: { layout: 'reflowable', resourceUrls: {}, stylesheet: '', html: '<html><head><style>body{margin:0;font:16px/20px monospace}.leaf{height:320px;break-after:column}p{margin:0}</style></head><body><section class="leaf"><p id="scene" data-story-sound="stored-audio">The scene that should play audio</p></section><section class="leaf">Unrelated following page<audio id="stored-audio"></audio></section></body></html>' },
    };
    const storyMapping = mapEpubAudioTracks([storyChapter], [{ name: storyChapter.name, anchors: ['scene'] }, { name: storyChapter.name, anchors: ['stored-audio'] }]);
    for (const pageIndex of [0, 1, 0]) {
        root.render(<article key="story" data-reader-page-index={pageIndex}>
            <EpubOriginalDocument chapter={storyChapter} pageOffset={pageIndex} pageSize={{ width: 320, height: 400 }}
                appearance={{ verticalPadding: 40, horizontalPadding: 40 }} onReady={() => readyCount += 1} />
        </article>);
        await tick(); await tick();
        await until(ready, 'The declared story cue page did not load');
        const cues = visibleEpubAudioTracks(container, storyMapping, { pageIndex, flowMode: 'single' }).map(track => track.id);
        check(cues.join() === (pageIndex === 0 ? 'story' : ''), 'A declared scene must trigger sound independently of the audio storage page: ' + JSON.stringify({ pageIndex, cues }));
    }
    root.unmount();
    container.style.height = '480px';
    container.scrollTop = 0;
    container.innerHTML = '<article data-reader-page-index="0" data-reader-index="0" style="height:1200px"><p>Duplicated metadata without a control</p></article>';
    check(visible(0).length === 0 && visible(0, 'scroll').length === 0, 'Missing optimized anchors must not fall back to the whole page');
    container.querySelector('article').insertAdjacentHTML('beforeend', '<button data-epub-anchor="sound" style="display:block;margin-top:650px">Play</button>');
    check(visible(0, 'scroll').length === 0, 'Optimized cues outside the scroll viewport must remain silent');
    container.scrollTop = 550;
    check(visible(0, 'scroll').join() === 'one', 'Optimized cues must follow the visible control');
    return { readyCount, checks: 13 };
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>body{margin:0}#content{width:1180px;height:900px;overflow:auto;display:flex;align-items:flex-start}article{flex:none}</style><div id="content"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1200, height: 940, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`)});
    const result = await window.webContents.executeJavaScript('window.visibilityTests');
    console.log('EPUB_VISIBILITY_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Audio visibility renderer timed out: ' + result)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        assert.ok(output.result.includes('EPUB_VISIBILITY_RESULT='), output.result);
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
