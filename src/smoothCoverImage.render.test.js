import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

test('고품질 썸네일은 원본 정보와 요청 옵션을 유지하고 화면 배율·변환·이미지 교체를 처리한다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('..', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'smooth-cover-render-')));
    const captureDirectory = process.env.BOOKMANAGER_SMOOTH_COVER_CAPTURE_DIR;
    if (captureDirectory) await fs.mkdir(captureDirectory, { recursive: true });
    let server;
    try {
        await fs.writeFile(path.join(directory, 'fixture.jsx'), `
import React, { createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SmoothCoverImage } from ${JSON.stringify(`/@fs/${path.join(projectRoot, 'src/components/SmoothCoverImage.jsx')}`)};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const pause = duration => new Promise(resolve => setTimeout(resolve, duration));
async function until(predicate, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) { if (predicate()) return; await pause(20); }
    throw new Error(message);
}
function sourceImage(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 1800;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#ffffff'; context.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 24) {
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x + 350, canvas.height); context.stroke();
    }
    context.fillStyle = '#111827'; context.fillRect(70, 100, 1060, 360);
    context.fillStyle = '#ffffff'; context.font = 'bold 110px serif'; context.fillText('SAMPLE BOOK', 120, 250);
    context.font = '60px sans-serif'; context.fillText('Lines and small type', 120, 365);
    return canvas.toDataURL('image/png');
}
const red = sourceImage('#cc2222');
const blue = sourceImage('#2255cc');
const green = sourceImage('#22aa44');
window.smoothCoverOriginal = red;
let displayRatio = 2;
Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => displayRatio });
const NativeImage = window.Image;
const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
const offscreenRequests = [];
const heldLoads = [];
let holdSource = '';
window.Image = function(...args) {
    const image = new NativeImage(...args);
    Object.defineProperty(image, 'src', {
        configurable: true,
        get() { return sourceDescriptor.get.call(image); },
        set(value) {
            offscreenRequests.push({ src: value, crossOrigin: image.crossOrigin, referrerPolicy: image.referrerPolicy });
            const start = () => sourceDescriptor.set.call(image, value);
            if (holdSource === value) heldLoads.push(start);
            else start();
        },
    });
    return image;
};
window.Image.prototype = NativeImage.prototype;
const root = createRoot(document.getElementById('root'));
const forwardedRef = createRef();
const loads = [];
let errors = 0;
function render(src, width = 120, scale = 1) {
    root.render(<div style={{ width: width + 'px', transform: 'scale(' + scale + ')', transformOrigin: 'top left' }}>
        <SmoothCoverImage ref={forwardedRef} src={src} alt="Thumbnail" crossOrigin="anonymous" referrerPolicy="no-referrer"
            style={{ display: 'block', width: width + 'px', height: width * 1.5 + 'px', objectFit: 'contain' }}
            onLoad={event => loads.push([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])}
            onError={() => { errors += 1; }} />
    </div>);
}
const image = () => document.querySelector('#root img');
const isResampled = width => {
    const current = image();
    return current?.getAttribute('src')?.startsWith('blob:') && current.complete
        && current.naturalWidth === Math.ceil(width * devicePixelRatio)
        && current.naturalHeight === Math.ceil(width * 1.5 * devicePixelRatio);
};
function dominantColor() {
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(image(), 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
}
window.runSmoothCoverTests = async () => {
    render(red);
    await until(() => isResampled(120), 'High-resolution source did not produce a correctly sized thumbnail');
    check(devicePixelRatio === 2, 'Fixture must exercise a high-density display');
    check(forwardedRef.current === image() && forwardedRef.current instanceof HTMLImageElement, 'Forwarded ref must expose the displayed image');
    check(JSON.stringify(loads) === '[[1200,1800]]', 'Resampling replaced the original dimensions in the public load callback');
    check(offscreenRequests.some(request => request.src === red && request.crossOrigin === 'anonymous' && request.referrerPolicy === 'no-referrer'),
        'Background source loading did not preserve CORS and referrer options');
    displayRatio = 1;
    window.dispatchEvent(new Event('resize'));
    await until(() => isResampled(120), 'Moving to a standard-density display did not recalculate the thumbnail');
    displayRatio = 2;
    window.dispatchEvent(new Event('resize'));
    await until(() => isResampled(120), 'Moving back to a high-density display did not restore device-resolution pixels');
    render(red, 160);
    await until(() => isResampled(160), 'Resizing the thumbnail did not update its device-resolution pixels');
    check(loads.length === 1 && errors === 0, 'A resized image fired an extra public load or error callback');

    render(blue, 120, 0.1);
    await until(() => isResampled(120), 'An animated parent caused the thumbnail to be generated at the smaller transformed size');
    check(image().getBoundingClientRect().width < 13, 'Fixture must render inside a scaled parent');
    check(loads.length === 2 && loads[1][0] === 1200 && loads[1][1] === 1800, 'Changing source did not report its original dimensions exactly once');
    render(blue, 120, 1);
    await pause(180);
    check(isResampled(120), 'Restoring the parent size kept an undersized thumbnail');

    holdSource = green;
    render(green);
    await until(() => heldLoads.length === 1, 'Old source preprocessing did not enter the delayed state');
    render(blue);
    await until(() => isResampled(120) && dominantColor()[2] > dominantColor()[0], 'The latest selected image did not become visible');
    const selectedSource = image().getAttribute('src');
    holdSource = '';
    heldLoads.splice(0).forEach(release => release());
    await pause(200);
    check(image().getAttribute('src') === selectedSource && dominantColor()[2] > dominantColor()[1],
        'A late old source replaced the newest selected image');
    check(errors === 0, 'Canceling an old image must not show a load error');

    const beforeFallbackErrors = errors;
    image().dispatchEvent(new Event('error'));
    await until(() => image()?.getAttribute('src') === blue && image().complete && image().naturalWidth === 1200,
        'A resized-image failure did not restore its original source');
    check(errors === beforeFallbackErrors, 'A resized-image failure incorrectly rejected a valid original image');
    let fallbackErrors = 0;
    function ErrorFallback() {
        const [failed, setFailed] = useState(false);
        return <SmoothCoverImage src={failed ? blue : 'data:image/png;base64,bm90LWFuLWltYWdl'} alt={failed ? 'Fallback' : 'Invalid image'}
            style={{ width: '120px', height: '180px' }} onError={() => { fallbackErrors += 1; setFailed(true); }} />;
    }
    root.render(<ErrorFallback />);
    await until(() => image()?.alt === 'Fallback' && image().complete && image().naturalWidth > 0, 'An invalid source did not allow the caller to display its fallback');
    check(fallbackErrors === 1, 'The invalid original source should notify the caller once');
    render(red);
    await until(() => isResampled(120), 'Final cover preview did not settle');
    window.Image = NativeImage;
    return { deviceResolution: true, originalLoadDimensions: true, requestOptions: true, forwardedRef: true,
        transformedLayout: true, sourceReplacement: true, resizedFailureFallback: true, sourceFailureFallback: true };
};
`);
        await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:20px}img{max-width:none}</style></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            resolve: { alias: { react: path.join(projectRoot, 'node_modules/react'), 'react-dom': path.join(projectRoot, 'node_modules/react-dom') } },
            server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/`;
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 800, height: 700, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
    await window.loadURL(${JSON.stringify(fixtureUrl)});
    window.webContents.focus();
    const result = await window.webContents.executeJavaScript('window.runSmoothCoverTests()');
    const captureDirectory = ${JSON.stringify(captureDirectory || null)};
    if (captureDirectory) {
        const original = await window.webContents.executeJavaScript('window.smoothCoverOriginal');
        await fs.writeFile(path.join(captureDirectory, 'smooth-cover-original.png'), Buffer.from(original.split(',')[1], 'base64'));
        const screenshot = await window.webContents.capturePage({ x: 12, y: 12, width: 136, height: 196 });
        await fs.writeFile(path.join(captureDirectory, 'smooth-cover-thumbnail.png'), screenshot.toPNG());
    }
    console.log('SMOOTH_COVER_RESULT=' + JSON.stringify(result));
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await new Promise((resolve, reject) => {
            const child = spawn(createRequire(import.meta.url)('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let result = '';
            child.stdout.on('data', data => { result += data; });
            child.stderr.on('data', data => { result += data; });
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Smooth cover renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const payload = output.result.match(/SMOOTH_COVER_RESULT=(.+)/)?.[1];
        assert.ok(payload, output.result);
        assert.deepEqual(JSON.parse(payload), {
            deviceResolution: true, originalLoadDimensions: true, requestOptions: true, forwardedRef: true,
            transformedLayout: true, sourceReplacement: true, resizedFailureFallback: true, sourceFailureFallback: true,
        });
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
