import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

async function checkSurface(moduleUrl, fontUrl) {
    const { app, BrowserWindow, protocol } = require('electron');
    const assert = require('node:assert/strict');
    const fs = require('node:fs/promises');
    app.setPath('userData', __dirname);
    protocol.registerSchemesAsPrivileged([{ scheme: 'bookmanager-document', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
    await app.whenReady();
    const { createEpubCurlSurface } = await import(moduleUrl);
    const font = await fs.readFile(new URL(fontUrl));
    const source = 'bookmanager-document://session/current/asset/font.ttf';
    const hits = [];
    const surface = createEpubCurlSurface({ getDocumentAssetFromRequest: async url => {
        hits.push(url);
        return { buffer: font, mime: 'font/ttf' };
    } });
    const html = `<!doctype html><style>
        @font-face{font-family:Fixture;src:url("${source}")}
        html{overflow:hidden;scroll-behavior:smooth}body{margin:0;width:320px;height:90px;display:flex}
        section{flex:none;width:160px;height:90px;background:#ff3020}
        section+section{background:#29c926;color:black;font:22px Fixture}
    </style><section></section><section><p>한글 글꼴</p></section>`;
    const doc = { html, width: 160, height: 90, backgroundColor: 'white' };
    const page = { documentIndex: 0, scrollLeft: 160, scrollTop: 0 };
    try {
        const [first] = await surface.capture('current', [doc], [page]);
        assert.equal(first.format, 'rgba');
        assert.deepEqual([...first.bytes.subarray(0, 4)], [41, 201, 38, 255], 'The first readback contains the requested column with its marker removed');
        let ink = 0;
        for (let i = 0; i < first.bytes.length; i += 4) {
            if (first.bytes[i] < 20 && first.bytes[i + 1] < 64 && first.bytes[i + 2] < 20) ink += 1;
        }
        assert.ok(ink > 30, 'The first new surface contains painted embedded-font glyphs');
        await surface.capture('current', [{ ...doc, html: html.replace('글꼴', '다음') }], [page]);
        assert.deepEqual(hits, [source], 'The second chapter reuses the current book font bytes');
        const bundled = 'bookmanager-document://session/current/bundled-font/Jua-Regular.ttf';
        const captureFont = url => surface.capture('current', [{ ...doc, html: html.replace(source, url) }], [page]);
        const [appFont] = await captureFont(bundled);
        assert.deepEqual(appFont.bytes, first.bytes, 'The bundled alias paints the exact embedded Jua glyphs');
        const optimized = {
            ...doc, mode: 'optimized', html: html.replace('<style>', '<style data-curl-fonts>')
                .replace('html{overflow', '</style><style data-curl-layout>html{overflow')
                .replace('url("' + source + '")', 'url("' + bundled + '") format("truetype")'),
        };
        const [optimizedPage] = await surface.capture('current', [optimized], [page]);
        assert.deepEqual(optimizedPage.bytes, first.bytes);
        const shell = BrowserWindow.getAllWindows()[0].webContents;
        await shell.executeJavaScript(`
            window.savedFrame = [...window.chapterFrames.values()].at(-1);
            window.savedChapter = savedFrame.contentDocument;
            window.savedFace = [...savedChapter.fonts][0];
        `);
        const changed = { ...optimized, html: optimized.html.replace('#29c926', '#c02040').replace('글꼴', '다음') };
        const [changedPage] = await surface.capture('current', [changed], [page]);
        assert.deepEqual([...changedPage.bytes.subarray(0, 4)], [192, 32, 64, 255]);
        assert.equal(await shell.executeJavaScript(`
            const current = [...window.chapterFrames.values()].at(-1).contentDocument;
            current === savedChapter && [...current.fonts][0] === savedFace && savedFace.status === 'loaded' &&
                current.body.textContent === '한글 다음' && current.styleSheets.length === 2 &&
                !current.head.querySelector('[data-curl-layout]').textContent.includes('#29c926')
        `), true, 'A new page retains the decoded FontFace and replaces the previous body and layout');
        await surface.capture('current', [{ ...changed, height: 91 }], [page]);
        assert.equal(await shell.executeJavaScript('savedFrame.isConnected'), false, 'Resize releases the old mirror frame');
        await assert.rejects(surface.capture('current', [{ ...optimized, html: optimized.html.replace(bundled, fontUrl) }], [page]), /Invalid optimized EPUB font source/);
        for (const denied of [
            bundled.replace('Jua-Regular.ttf', 'unlisted.ttf'),
            bundled.replace('Jua-Regular.ttf', '..%2fJua-Regular.ttf'),
            bundled.replace('/current/', '/other/'),
            fontUrl,
        ]) {
            await assert.rejects(captureFont(denied), /font unavailable/);
        }
        assert.deepEqual(hits, [source], 'Bundled and refused requests never reach the book archive');
        await assert.rejects(surface.capture('new', [doc], [page]));
        assert.deepEqual(hits, [source], 'A new session cannot read the previous book font');
    } finally { surface.dispose(); }
    assert.equal(BrowserWindow.getAllWindows().length, 0);
}

test('a cold EPUB curl capture includes the requested column and font, scopes assets and releases the hidden window', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        return t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run Electron.');
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-curl-surface-'));
    try {
        const entry = path.join(directory, 'fixture.cjs');
        const args = [new URL('./viewerCurlSurface.js', import.meta.url).href, new URL('../src/fonts/Jua-Regular.ttf', import.meta.url).href];
        await fs.writeFile(entry, `(${checkSurface})(...${JSON.stringify(args)}).then(() => require('electron').app.exit(0)).catch(error => { console.error(error); require('electron').app.exit(1); });`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        await promisify(execFile)(createRequire(import.meta.url)('electron'), [entry], { env, timeout: 25000 });
    } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 }); }
});
