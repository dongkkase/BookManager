import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('마우스 가운데 버튼은 본문과 원본 EPUB에서 전체화면을 한 번 전환한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-middle-click-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ViewerApp from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/ViewerApp.jsx')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const chapter = {
    name: 'chapter.xhtml', title: 'Middle click fixture', text: 'Selectable content',
    audioTracks: [{ id: 'voice', kind: 'inline', anchor: 'voice', title: 'Audio', sources: [] }],
    original: {
        layout: 'reflowable', resourceUrls: {}, stylesheet: '',
        html: '<html><body><p id="text">Selectable content</p><a href="https://example.invalid"><span>External link</span></a><audio id="voice" controls></audio></body></html>',
    },
};
let loadSession;
let toggles = 0;
let externalLinks = 0;
window.viewerAPI = {
    getCurrentSession: async () => null,
    onLoadSession: callback => { loadSession = callback; return () => {}; },
    getEpubText: async () => ({ chapters: [chapter], toc: [], fonts: [] }),
    listBundledFonts: async () => [], listSystemFonts: async () => [],
    toggleFullscreen: async () => ({ fullscreen: ++toggles % 2 === 1 }),
    openExternal: async () => { externalLinks += 1; },
};
const root = createRoot(document.getElementById('root'));
async function until(predicate, message) {
    const deadline = performance.now() + 15000;
    while (performance.now() < deadline) {
        if (predicate()) return;
        await frame();
    }
    throw new Error(message);
}
function clickButton(target, button = 1) {
    const viewport = target.ownerDocument.defaultView;
    const events = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', button === 0 ? 'click' : 'auxclick']) {
        const EventClass = type.startsWith('pointer') ? viewport.PointerEvent : viewport.MouseEvent;
        const event = new EventClass(type, {
            bubbles: true, cancelable: true, button,
            buttons: type.endsWith('down') ? [1, 4, 2][button] : 0,
            pointerId: 1, pointerType: 'mouse', isPrimary: true,
            clientX: 100, clientY: 100,
        });
        target.dispatchEvent(event);
        events.push(event);
    }
    return events;
}
function expectMiddleClick(target, label) {
    const before = toggles;
    const events = clickButton(target);
    check(events[1].defaultPrevented, label + ': mousedown must prevent browser autoscroll');
    check(events[4].defaultPrevented, label + ': auxclick must prevent the browser default');
    check(toggles === before + 1, label + ': one button press must toggle exactly once');
}
window.middleClickTests = (async () => {
    const results = [];
    for (const flowMode of ['single', 'scroll']) {
        const session = { id: flowMode, filePath: '/fixture/' + flowMode + '.epub', fileName: flowMode, type: 'epub', preview: true };
        localStorage.setItem('bookmanager-viewer-prefs:epub', JSON.stringify({
            flowMode, slideNavOpen: false, readerSettings: { epubStyle: 'original', pageEffect: 'none' },
        }));
        loadSession = null;
        root.render(<ViewerApp key={flowMode} />);
        await until(() => loadSession, 'Viewer did not subscribe to sessions');
        await loadSession(session);
        await until(() => !document.querySelector('.viewer-app').classList.contains('is-initial-render-loading')
            && document.querySelector('.viewer-content iframe')?.dataset.originalReady === 'true', 'Original EPUB did not become ready');
        const content = document.querySelector('.viewer-content');
        expectMiddleClick(content, flowMode + ' content');
        expectMiddleClick(content, flowMode + ' exit fullscreen');
        const beforeOtherButtons = toggles;
        for (const button of [0, 2]) {
            const events = clickButton(content, button);
            check(!events[1].defaultPrevented, 'Left and right mousedown must preserve their default behavior');
        }
        content.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }));
        check(toggles === beforeOtherButtons, 'Other buttons and wheel rotation must not toggle fullscreen');
        for (const markup of [
            '<button><span>Button label</span></button>',
            '<a href="#"><span>Link label</span></a>',
            '<input value="Text"/>',
            '<div contenteditable="true"><span>Editable text</span></div>',
            '<div class="viewer-epub-inline-media"><span>Media control</span></div>',
        ]) {
            const holder = document.createElement('div');
            holder.innerHTML = markup;
            content.append(holder);
            const target = holder.querySelector('span, input');
            const before = toggles;
            const events = clickButton(target);
            check(toggles === before && !events[1].defaultPrevented && !events[4].defaultPrevented, 'Interactive children must preserve middle-click behavior: ' + markup);
            holder.remove();
        }
        const iframe = content.querySelector('iframe');
        const doc = iframe.contentDocument;
        const text = doc.getElementById('text');
        const selection = iframe.contentWindow.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(text);
        selection.removeAllRanges();
        selection.addRange(range);
        expectMiddleClick(text, flowMode + ' original EPUB');
        check(selection.toString() === 'Selectable content', 'Middle click must retain the selected EPUB text');
        selection.removeAllRanges();
        const beforeFrameControls = toggles;
        for (const target of [doc.querySelector('a span'), doc.querySelector('button span')]) {
            check(target, 'Original EPUB must include nested link and audio controls');
            const events = clickButton(target);
            check(!events[1].defaultPrevented && !events[4].defaultPrevented, 'Original EPUB controls must retain default middle-click behavior');
        }
        check(toggles === beforeFrameControls, 'Original EPUB links and audio controls must not toggle fullscreen');
        const primaryEvents = clickButton(text, 0);
        check(!primaryEvents[0].defaultPrevented && !primaryEvents[1].defaultPrevented, 'Original EPUB primary-button text selection must remain available');
        let forwardedLinkDowns = 0;
        const recordLinkDown = () => { forwardedLinkDowns += 1; };
        iframe.addEventListener('pointerdown', recordLinkDown);
        const link = doc.querySelector('a span');
        const beforeLinks = externalLinks;
        clickButton(link, 0);
        iframe.removeEventListener('pointerdown', recordLinkDown);
        check(forwardedLinkDowns === 0 && externalLinks === beforeLinks + 1, 'An EPUB link must open without starting a parent page drag');
        for (const dragState of ['pending', 'true']) {
            content.dataset.curlDragging = dragState;
            const events = clickButton(text, 0);
            check(events[0].defaultPrevented && events[1].defaultPrevented, 'An active page edge drag must prevent native EPUB text selection: ' + dragState);
        }
        delete content.dataset.curlDragging;
        content.dataset.curlSuppressClick = String(Date.now() + 60000);
        clickButton(link, 0);
        check(externalLinks === beforeLinks + 1, 'Releasing a page drag over an EPUB link must not open the link');
        const image = doc.createElement('img');
        image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
        doc.body.append(image);
        clickButton(image, 0);
        await frame();
        check(!document.querySelector('.viewer-image-lightbox-backdrop'), 'Releasing a page drag over an EPUB image must not open its preview');
        image.remove();
        content.dataset.curlSuppressClick = String(Date.now() - 1);
        clickButton(link, 0);
        check(externalLinks === beforeLinks + 2, 'EPUB links must work after page drag click suppression expires');
        delete content.dataset.curlSuppressClick;
        results.push({ flowMode, toggles });
    }
    root.unmount();
    return results;
})();
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.jsx"></script>');
        server = await createServer({
            configFile: false,
            root: directory,
            cacheDir: path.join(directory, '.vite'),
            logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.middleClickTests');
    console.log('MIDDLE_CLICK_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Middle click renderer timed out: ' + result)); }, 60000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/MIDDLE_CLICK_RESULT=(.+)/)[1]);
        assert.deepEqual(report, [{ flowMode: 'single', toggles: 3 }, { flowMode: 'scroll', toggles: 6 }]);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
