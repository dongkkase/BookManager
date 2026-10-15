import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

test('isolated image optimization preserves PNG alpha, resizes JPEG, and cancels without decoding', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') return t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run Electron image checks.');
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'epub-optimizer-images-')));
    try {
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const { createImageProcessor } = await import(${JSON.stringify(new URL('./epubOptimizer/imageProcessor.js', import.meta.url).href)});
    const processor = createImageProcessor({ BrowserWindow });
    const fixture = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await fixture.loadURL('data:text/html,<title>Image test</title>');
    const original = await fixture.webContents.executeJavaScript(
        '(async () => { const canvas = new OffscreenCanvas(512, 256); const c = canvas.getContext("2d"); c.fillStyle = "rgba(255,0,0,0.5)"; c.fillRect(0,0,256,256); const png = await canvas.convertToBlob(); return Array.from(new Uint8Array(await png.arrayBuffer())); })()'
    );
    const png = await processor.transform({ data: original, mimeType: 'image/png', settings: { quality: 82, maxDimension: 256 } });
    const result = await fixture.webContents.executeJavaScript(
        '(async () => { const image = await createImageBitmap(new Blob([new Uint8Array(' + JSON.stringify([...png]) + ')], {type:"image/png"})); const c = new OffscreenCanvas(image.width,image.height).getContext("2d"); c.drawImage(image,0,0); return {width:image.width,height:image.height,red:Array.from(c.getImageData(20,20,1,1).data),empty:Array.from(c.getImageData(220,20,1,1).data)}; })()'
    );
    assert.equal(result.width, 256); assert.equal(result.height, 128);
    assert.equal(result.red[0], 255); assert.ok(Math.abs(result.red[3] - 128) <= 1); assert.equal(result.empty[3], 0);
    const jpegInput = await fixture.webContents.executeJavaScript(
        '(async () => { const canvas = new OffscreenCanvas(800,400); const c = canvas.getContext("2d"); c.fillStyle="blue"; c.fillRect(0,0,800,400); const blob=await canvas.convertToBlob({type:"image/jpeg",quality:1}); return Array.from(new Uint8Array(await blob.arrayBuffer())); })()'
    );
    const jpeg = await processor.transform({ data: jpegInput, mimeType: 'image/jpeg', settings: { quality: 60, maxDimension: 400 } });
    assert.equal(jpeg[0], 255); assert.equal(jpeg[1], 216); assert.ok(jpeg.length < jpegInput.length);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(processor.transform({ data: original, mimeType: 'image/png' }, controller.signal), { code: 'TASK_CANCELLED' });
    processor.dispose();
    const { writePackage } = await import(${JSON.stringify(new URL('./epubEditor/package.js', import.meta.url).href)});
    const { EpubOptimizerService } = await import(${JSON.stringify(new URL('./epubOptimizer/service.js', import.meta.url).href)});
    const filePath = ${JSON.stringify(path.join(directory, 'images.epub'))};
    await writePackage(filePath, [
        { name:'mimetype', data:'application/epub+zip', store:true },
        { name:'META-INF/container.xml', data:'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', store:true },
        { name:'book.opf', data:'<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="body" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="body"/></spine></package>', store:true },
        { name:'chapter.xhtml', data:'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Images</title></head><body><img src="image.jpg" alt="Blue"/></body></html>', store:true },
        { name:'image.jpg', data:Buffer.from(jpegInput), store:true },
    ]);
    const before = await fs.readFile(filePath);
    let transformed = 0;
    const service = new EpubOptimizerService({ createProcessor: () => {
        const decoder = createImageProcessor({ BrowserWindow });
        return { dispose: () => decoder.dispose(), transform: (...args) => { transformed++; return decoder.transform(...args); } };
    } });
    const inspected = await service.run(1, { action:'inspect', filePath, operationId:'inspect' });
    assert.equal(transformed, 0);
    const optimized = await service.run(1, { action:'optimize', filePath, operationId:'run', expectedFingerprint:inspected.fingerprint, settings:{maxDimension:400,jpegQuality:60} });
    assert.equal(optimized.status, 'saved'); assert.ok(optimized.savedBytes > 0); assert.equal(transformed, 1);
    assert.deepEqual(await fs.readFile(filePath), before);
    const after = await service.run(1, {action:'inspect',filePath:optimized.outputPath,operationId:'verify'});
    assert.equal(after.resources.find(resource => resource.name === 'image.jpg').width, 400);
    await service.dispose(); fixture.destroy();
    console.log('EPUB_IMAGE_OK'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let text = '';
            child.stdout.on('data', data => { text += data; });
            child.stderr.on('data', data => { text += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Image optimizer timed out: ' + text)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, text }); });
        });
        assert.equal(output.code, 0, output.text);
        assert.match(output.text, /EPUB_IMAGE_OK/);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
