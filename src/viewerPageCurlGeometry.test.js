import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import {
    createPageCurlBackMesh,
    createPageCurlFoldContext,
    createPageCurlFrontCurveMesh,
    createPageCurlFrontMesh,
    createPageCurlReceiverLightingMesh,
    getPageCurlSurfaceElevation,
    mapPageCurlCurvedPoint,
} from './viewerPageCurlGeometry.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const frame = { x: 500, y: 20, width: 500, height: 700 };
const backFrame = { x: 40, y: 40, width: 460, height: 660 };
const foldAt = (progress, options = {}) => createPageCurlFoldContext({
    frame, progress, cornerSide: 1, sideSign: 1, touchY: 620, landsOnTargetFrame: true, ...options,
});

test('곡면은 종이 폭에 제한된 원통 곡률을 사용하고 드래그 모서리 가까이 더 들어 올린다', () => {
    const fold = foldAt(0.4);
    assert.ok(fold.arcLength > 0 && fold.arcLength <= frame.width * 0.28);
    close(getPageCurlSurfaceElevation(0, fold.arcLength), 0, 'Stationary paper height');
    close(getPageCurlSurfaceElevation(fold.arcLength / 2, fold.arcLength), fold.arcLength / Math.PI, 'Half curl height');
    close(getPageCurlSurfaceElevation(fold.arcLength, fold.arcLength), fold.arcLength * 2 / Math.PI, 'Back paper height');
    const first = mapPageCurlCurvedPoint({ x: fold.cornerX, y: frame.y }, frame, fold);
    const last = mapPageCurlCurvedPoint({ x: fold.cornerX, y: frame.y + frame.height }, frame, fold);
    const middle = mapPageCurlCurvedPoint({ x: fold.cornerX, y: frame.y + frame.height / 2 }, frame, fold);
    assert.ok(Math.hypot(middle.x - (first.x + last.x) / 2, middle.y - (first.y + last.y) / 2) > 0.1,
        'The curled edge must bow instead of becoming a flat CSS rotation');
});

test('좌우 방향과 위아래 모서리는 같은 접힘을 대칭으로 만든다', () => {
    for (const progress of [0.05, 0.28, 0.5, 0.8, 0.9, 0.97]) {
        const right = foldAt(progress);
        const leftFrame = { ...frame, x: 0 };
        const left = foldAt(progress, { frame: leftFrame, sideSign: -1 });
        close(left.midpointX, 1000 - right.midpointX, 'Horizontal fold position');
        close(left.normalX, -right.normalX, 'Horizontal normal');
        close(left.midpointY, right.midpointY, 'Horizontal symmetry height');
        const top = foldAt(progress, { cornerSide: -1, touchY: 120 });
        close(top.midpointX, right.midpointX, 'Vertical symmetry x');
        close(top.midpointY, 740 - right.midpointY, 'Vertical fold position');
        close(top.normalY, -right.normalY, 'Vertical normal');
    }
});

test('단면과 두 페이지의 모든 진행 단계에서 텍스처와 조명 좌표가 유효하다', () => {
    for (const spread of [false, true]) {
        for (const sideSign of [-1, 1]) {
            for (const cornerSide of [-1, 1]) {
                for (const progress of [0, 0.00001, 0.1, 0.28, 0.5, 0.82, 0.9, 0.97, 0.98, 1]) {
                    const fold = foldAt(progress, { sideSign, cornerSide, landsOnTargetFrame: spread });
                    const back = spread ? backFrame : frame;
                    const meshes = [
                        createPageCurlFrontMesh(frame, fold, spread),
                        createPageCurlFrontCurveMesh(frame, back, fold, spread),
                        createPageCurlBackMesh(frame, back, fold, spread),
                    ];
                    for (const mesh of meshes) {
                        assert.equal(mesh.vertices.length, mesh.textures.length);
                        for (const point of [...mesh.vertices, ...mesh.textures]) {
                            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
                        }
                    }
                    const lighting = createPageCurlReceiverLightingMesh(frame, back, fold, spread);
                    assert.ok(lighting.receiverShadowVisibility >= 0 && lighting.receiverShadowVisibility <= 1);
                    for (const vertices of [lighting.receiverShadowVertices, lighting.stationaryCreaseShadowVertices, lighting.movingCreaseReflectionVertices]) {
                        for (const point of vertices) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
                    }
                }
            }
        }
    }
});

test('착지가 끝나면 다른 크기의 도착 페이지와 뒷면 텍스처가 정확히 겹친다', () => {
    const start = createPageCurlFrontMesh(frame, foldAt(0), true);
    assert.deepEqual(start.vertices, start.textures);
    for (const progress of [0.98, 0.99, 1]) {
        const fold = foldAt(progress);
        const back = createPageCurlBackMesh(frame, backFrame, fold, true);
        assert.deepEqual(back.vertices, back.textures, 'Landed text must not be mirrored');
        assert.equal(Math.min(...back.vertices.map(point => point.x)), backFrame.x);
        assert.equal(Math.max(...back.vertices.map(point => point.x)), backFrame.x + backFrame.width);
        assert.equal(Math.min(...back.vertices.map(point => point.y)), backFrame.y);
        assert.equal(Math.max(...back.vertices.map(point => point.y)), backFrame.y + backFrame.height);
        const front = createPageCurlFrontMesh(frame, fold, true);
        assert.ok(front.vertices.every(point => point.x === fold.cornerX && point.y === fold.cornerY));
    }
});

test('실제 Canvas의 첫 화면과 마지막 화면은 원본과 같고 중간 곡면에는 흰 삼각형 틈이 없다', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 to run the isolated Electron renderer.');
        return;
    }
    if (process.platform === 'linux' && !process.env.DISPLAY) {
        t.skip('Electron renderer requires a display.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-page-curl-test-'));
    try {
        const renderer = `
import { drawPageCurlFrame } from './src/viewerPageCurlRenderer.js';
const canvas = document.createElement('canvas');
const expected = document.createElement('canvas');
const check = (value, message) => { if (!value) throw new Error(message); };
const texture = (color, width, height) => {
    const image = document.createElement('canvas');
    image.width = width; image.height = height;
    const context = image.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    return image;
};
window.testDone = (async () => {
    const measurements = [];
    for (const spread of [false, true]) for (const ratio of [1, 2]) for (const side of ['left', 'right']) {
        const width = spread ? 640 : 320;
        const height = 420;
        const makePages = colors => colors.map((color, index) => ({ image: texture(color, 320 * ratio, height * ratio), frame: { x: index * 320, y: 0, width: 320, height } }));
        const current = makePages(spread ? ['#123447', '#20354a'] : ['#20354a']);
        const target = makePages(spread ? ['#174731', '#352347'] : ['#352347']);
        canvas.width = expected.width = width * ratio;
        canvas.height = expected.height = height * ratio;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const expectedContext = expected.getContext('2d', { willReadFrequently: true });
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        expectedContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        for (const progress of [0, 0.08, 0.28, 0.5, 0.82, 0.92, 0.98, 1]) {
            context.clearRect(0, 0, width, height);
            const started = performance.now();
            drawPageCurlFrame(context, { current, target, side, progress, width, height, spread });
            const elapsed = performance.now() - started;
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            if (progress === 0 || progress === 1) {
                expectedContext.clearRect(0, 0, width, height);
                for (const entry of progress === 0 ? current : target) expectedContext.drawImage(entry.image, entry.frame.x, entry.frame.y, entry.frame.width, entry.frame.height);
                const comparison = expectedContext.getImageData(0, 0, expected.width, expected.height).data;
                check(pixels.every((value, index) => value === comparison[index]), [spread, ratio, side, progress, 'endpoint differs'].join('/'));
            } else {
                let whitePixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] > 190 && pixels[index + 1] > 190 && pixels[index + 2] > 190) whitePixels += 1;
                }
                check(whitePixels === 0, [spread, ratio, side, progress, 'white gaps', whitePixels].join('/'));
            }
            measurements.push({ spread, ratio, side, progress, elapsed });
        }
    }
    return measurements;
})();
`;
        await build({ stdin: { contents: renderer, resolveDir: process.cwd() }, bundle: true, outfile: path.join(directory, 'renderer.js'), logLevel: 'silent' });
        await fs.writeFile(path.join(directory, 'index.html'), '<script src="renderer.js"></script>');
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    try {
        await window.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});
        const result = await window.webContents.executeJavaScript('window.testDone');
        process.stdout.write('PAGE_CURL_RESULT=' + JSON.stringify(result) + '\\n');
        app.exit(0);
    } catch (error) {
        process.stderr.write(String(error.stack || error));
        app.exit(1);
    }
});
`);
        const require = createRequire(import.meta.url);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const result = await new Promise((resolve, reject) => {
            const child = spawn(require('electron'), [path.join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', data => { output += data; });
            child.stderr.on('data', data => { output += data; });
            const timer = setTimeout(() => { child.kill(); reject(new Error('Page curl test timed out: ' + output)); }, 25000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
        });
        assert.equal(result.code, 0, result.output || `Electron exited with signal ${result.signal}`);
        const payload = result.output.match(/PAGE_CURL_RESULT=(.+)/)?.[1];
        assert.ok(payload, result.output);
        const measurements = JSON.parse(payload);
        assert.equal(measurements.length, 64);
        t.diagnostic(`Canvas cases: ${measurements.length}; slowest draw: ${Math.max(...measurements.map(item => item.elapsed)).toFixed(1)} ms`);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
