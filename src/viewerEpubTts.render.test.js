import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('EPUB 낭독 주석은 원본 페이지와 선택 영역에서 원문을 유지하며 한 번 적용된다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-epub-tts-test-')));
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import EpubOriginalDocument from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/viewer/EpubOriginalDocument.jsx')}`)};
import { selectionEpubTtsText } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/viewerEpubTts.js')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
window.ttsTests = (async () => {
    const original = '원문 '.repeat(160);
    let layout;
    const chapter = {
        name: 'chapter.xhtml',
        original: { layout: 'reflowable', resourceUrls: {}, stylesheet: '', html: '<html><head><style>body{margin:0;font:16px/20px sans-serif}p{margin:0}</style></head><body><p><span data-bm-tts="replace" data-bm-tts-id="long" data-bm-tts-text="(씨++)">' + original + '</span>뒤</p><p id="selection">CPU <span data-bm-tts="replace" data-bm-tts-id="cpu" data-bm-tts-text="씨피유"><b>C</b></span><span data-bm-tts="replace" data-bm-tts-id="cpu" data-bm-tts-text="씨피유">PU</span> (설명 <span data-bm-tts="read" data-bm-tts-id="keep">C++</span>) <span data-bm-tts="skip" data-bm-tts-id="skip">생략</span></p></body></html>' },
    };
    createRoot(document.getElementById('root')).render(<EpubOriginalDocument chapter={chapter} pageSize={{width:240,height:160}} onLayout={value => { layout = value; }} />);
    for (let count = 0; count < 250 && !layout; count += 1) await frame();
    check(layout?.pageCount > 1, 'The original replacement must cross a physical page boundary');
    const spoken = layout.ttsByPage.join(' ');
    check((spoken.match(/씨\\+\\+/g) || []).length === 1, 'A replacement spanning pages must be spoken exactly once: ' + spoken);
    check(!spoken.includes('원문') && !spoken.includes('생략'), 'Replaced and skipped source must not be spoken');
    check(spoken.includes('(씨++)') && spoken.includes('C++'), 'Authored punctuation must survive normalization');
    const doc = document.querySelector('iframe').contentDocument;
    check(doc.body.textContent.includes(original), 'Pagination must preserve displayed source');
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById('selection'));
    const selection = doc.defaultView.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    check(selectionEpubTtsText(selection) === 'CPU 씨피유 C++', 'Selection must apply grouped annotations and protected brackets: ' + selectionEpubTtsText(selection));
    const optimized = document.createElement('div');
    optimized.dataset.bmTtsEdits = JSON.stringify([{start:0,end:3,mode:'replace',text:'(씨피유++)'}, {start:3,end:6,mode:'read'}]);
    optimized.textContent = 'CPU C++';
    document.body.append(optimized);
    const optimizedRange = document.createRange();
    optimizedRange.selectNodeContents(optimized);
    const optimizedSelection = window.getSelection();
    optimizedSelection.removeAllRanges();
    optimizedSelection.addRange(optimizedRange);
    check(selectionEpubTtsText(optimizedSelection) === '(씨피유++) C++', 'Split optimized pages must retain annotations in selections');
    return { pages: layout.pageCount, spoken };
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
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    const result = await window.webContents.executeJavaScript('window.ttsTests');
    console.log('EPUB_TTS_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('TTS renderer timed out: ' + result)); }, 30000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const report = JSON.parse(output.result.match(/EPUB_TTS_RESULT=(.+)/)[1]);
        assert.ok(report.pages > 1);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
