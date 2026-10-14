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
    createPageCurlFrontSurfaceColors,
    createPageCurlReceiverLightingMesh,
    createPageCurlSurfaceLightingTextures,
    getPageCurlLocalArcLength,
    getPageCurlReceiverShadowBlur,
    getPageCurlSurfaceElevation,
    mapPageCurlCurvedPoint,
} from './viewerPageCurlGeometry.js';

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
const frame = { x: 500, y: 20, width: 500, height: 700 };
const backFrame = { x: 40, y: 40, width: 460, height: 660 };
const foldAt = (progress, options = {}) => createPageCurlFoldContext({
    frame, progress, cornerSide: 1, sideSign: 1, touchY: 620, landsOnTargetFrame: true, ...options,
});

test('곡면은 종이 폭에 제한된 하나의 원통으로 연결되고 높이가 다시 꺼지지 않는다', () => {
    const fold = foldAt(0.4);
    assert.ok(fold.arcLength > 0 && fold.arcLength <= frame.width * 0.28);
    close(getPageCurlSurfaceElevation(0, fold.arcLength), 0, 'Stationary paper height');
    close(getPageCurlSurfaceElevation(fold.arcLength / 2, fold.arcLength), fold.arcLength / Math.PI, 'Half curl height');
    close(getPageCurlSurfaceElevation(fold.arcLength, fold.arcLength), fold.arcLength * 2 / Math.PI, 'Back paper height');
    const arc = getPageCurlLocalArcLength({ x: fold.cornerX, y: fold.cornerY }, frame, fold);
    close(arc, fold.arcLength * 0.8, 'Shared cylinder arc');
    const margin = (fold.arcLength - arc) / 2;
    const tangent = { x: -fold.normalY, y: fold.normalX };
    const sourceAt = (depth, along = 0) => ({
        x: fold.midpointX - fold.normalX * depth + tangent.x * along,
        y: fold.midpointY - fold.normalY * depth + tangent.y * along,
    });
    const mappedAt = depth => mapPageCurlCurvedPoint(sourceAt(depth), frame, fold);
    let previousLift = -1;
    for (let step = 0; step <= 20; step += 1) {
        const depth = margin + arc * step / 20;
        const source = sourceAt(depth);
        const mapped = mappedAt(depth);
        const offset = mapPageCurlCurvedPoint(sourceAt(depth, 60), frame, fold);
        close(offset.x - mapped.x, tangent.x * 60, 'Cylinder longitudinal x');
        close(offset.y - mapped.y, tangent.y * 60, 'Cylinder longitudinal y');
        const lift = (mapped.x - source.x) * tangent.x + (mapped.y - source.y) * tangent.y;
        assert.ok(lift >= previousLift - 1e-7, 'The roll must rise monotonically into its back plane');
        previousLift = lift;
    }
    close(previousLift, arc * 2 / Math.PI * 0.3, 'Projected back height');
    const epsilon = 0.0001;
    for (const boundary of [margin, margin + arc]) {
        const before = mappedAt(boundary - epsilon);
        const at = mappedAt(boundary);
        const after = mappedAt(boundary + epsilon);
        assert.ok(Math.hypot(after.x - 2 * at.x + before.x, after.y - 2 * at.y + before.y) / epsilon < 0.00001,
            'The cylinder must meet both flat surfaces with a continuous tangent');
    }
});

test('좌우와 위아래 책넘김의 잡힌 모서리는 높이 투영 후에도 드래그 위치를 유지한다', () => {
    for (const spread of [false, true]) {
        for (const sideSign of [-1, 1]) {
            for (const cornerSide of [-1, 1]) {
                for (const progress of [0.01, 0.08, 0.28, 0.5, 0.8, 0.9, 0.97]) {
                    const fold = foldAt(progress, { sideSign, cornerSide, landsOnTargetFrame: spread });
                    const corner = mapPageCurlCurvedPoint({ x: fold.cornerX, y: fold.cornerY }, frame, fold);
                    close(corner.x, fold.dragX, 'Held corner x');
                    close(corner.y, fold.dragY, 'Held corner y');
                }
            }
        }
    }
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

test('다른 크기의 페이지에 착지하는 동안 앞뒷면 경계와 조명 기준선이 일치한다', () => {
    for (const sideSign of [-1, 1]) {
        for (const cornerSide of [-1, 1]) {
            for (const progress of [0.28, 0.5, 0.83, 0.9, 0.92]) {
                const fold = foldAt(progress, { sideSign, cornerSide });
                const front = createPageCurlFrontCurveMesh(frame, backFrame, fold, true);
                const back = createPageCurlBackMesh(frame, backFrame, fold, true);
                const lighting = createPageCurlSurfaceLightingTextures(front.textures, frame, backFrame, fold, true, front.vertices);
                const depthAt = source => -((source.x - fold.midpointX) * fold.normalX
                    + (source.y - fold.midpointY) * fold.normalY);
                const creaseIndexes = front.textures.flatMap((source, index) => (
                    Math.abs(depthAt(source) - fold.arcLength / 2) < 1e-6 ? [index] : []
                ));
                assert.ok(creaseIndexes.length >= 2, 'The front mesh must sample its shared crease explicitly');
                for (const index of creaseIndexes) {
                    const vertex = front.vertices[index];
                    close(lighting[index].x, 0, 'Rendered crease lighting origin');
                    assert.ok(back.vertices.some(point => Math.hypot(point.x - vertex.x, point.y - vertex.y) < 1e-6),
                        'The front and back meshes must share the same rendered crease');
                }
            }
        }
    }
});

test('곡면 조명 좌표는 삼각형 안에서 연속적인 선형장을 유지한다', () => {
    const fold = foldAt(0.9);
    const vertices = [{ x: 200, y: 100 }, { x: 380, y: 300 }, { x: 120, y: 550 }];
    vertices.push({
        x: vertices.reduce((sum, point) => sum + point.x, 0) / 3,
        y: vertices.reduce((sum, point) => sum + point.y, 0) / 3,
    });
    const textures = vertices.map(point => ({ ...point }));
    const lighting = createPageCurlSurfaceLightingTextures(textures, frame, backFrame, fold, true, vertices);
    close(lighting[3].x, (lighting[0].x + lighting[1].x + lighting[2].x) / 3, 'Triangle lighting interpolation');
    assert.ok(Math.max(...lighting.map(point => point.x)) - Math.min(...lighting.map(point => point.x)) > 0.1,
        'The lighting field must retain a visible gradient');
});

test('앞면 음영은 평면을 보존하고 착지한 그림자는 접촉 두께로 줄어든다', () => {
    const fold = foldAt(0.4);
    const mesh = createPageCurlFrontCurveMesh(frame, backFrame, fold, true);
    const unlit = createPageCurlFrontSurfaceColors(mesh, frame, backFrame, fold, true, 0);
    assert.ok(unlit.every(color => color === 'rgb(255, 255, 255)'));
    const colors = createPageCurlFrontSurfaceColors(mesh, frame, backFrame, fold, true, 1);
    const channels = colors.map(color => {
        const match = color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
        assert.ok(match, 'Surface colors must be opaque to avoid doubled strip shading');
        assert.equal(match[1], match[2]);
        assert.equal(match[1], match[3]);
        return Number(match[1]);
    });
    assert.ok(channels.some(channel => channel < 255), 'The curved front must receive shade');
    assert.ok(channels.every(channel => channel >= Math.round(255 * 0.78) && channel <= 255));
    const flatIndexes = mesh.textures.flatMap((source, index) => {
        const depth = -((source.x - fold.midpointX) * fold.normalX + (source.y - fold.midpointY) * fold.normalY);
        return depth <= fold.arcLength * 0.1 ? [index] : [];
    });
    assert.ok(flatIndexes.length > 0, 'The fixture must include the flat front extension');
    assert.ok(flatIndexes.every(index => channels[index] === 255), 'The flat front must keep its original color');
    close(getPageCurlReceiverShadowBlur(frame.width, foldAt(0.98), true), 1, 'Landed contact blur');
    assert.ok(getPageCurlReceiverShadowBlur(frame.width, fold, true) > 1,
        'Raised paper must cast a softer shadow than landed paper');
});

test('실제 Canvas의 양방향 책넘김은 원본 화면과 캔버스 수명을 보존하고 곡면에 틈을 남기지 않는다', async t => {
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
const createdCanvases = [];
const createElement = document.createElement.bind(document);
document.createElement = (tag, ...args) => {
    const element = createElement(tag, ...args);
    if (tag === 'canvas') createdCanvases.push(element);
    return element;
};
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
    for (const spread of [false, true]) for (const ratio of [1, 2]) for (const side of ['left', 'right']) for (const corner of ['top', 'bottom']) {
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
            const canvasCount = createdCanvases.length;
            const started = performance.now();
            drawPageCurlFrame(context, { current, target, side, corner, touchY: height * (corner === 'top' ? 0.14 : 0.86), progress, width, height, spread });
            const elapsed = performance.now() - started;
            check(createdCanvases.slice(canvasCount).every(surface => surface.width === 0 && surface.height === 0), 'Lighting canvases must be released after each frame');
            check(context.filter === 'none' && context.globalAlpha === 1 && context.globalCompositeOperation === 'source-over', 'Lighting must restore the drawing context');
            check(context.getTransform().a === ratio && context.getTransform().d === ratio, 'Lighting must preserve pixel scaling');
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            if (progress === 0 || progress === 1) {
                expectedContext.clearRect(0, 0, width, height);
                for (const entry of progress === 0 ? current : target) expectedContext.drawImage(entry.image, entry.frame.x, entry.frame.y, entry.frame.width, entry.frame.height);
                const comparison = expectedContext.getImageData(0, 0, expected.width, expected.height).data;
                check(pixels.every((value, index) => value === comparison[index]), [spread, ratio, side, progress, 'endpoint differs'].join('/'));
            } else {
                let whitePixels = 0;
                let transparentPixels = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index] > 190 && pixels[index + 1] > 190 && pixels[index + 2] > 190) whitePixels += 1;
                    if (pixels[index + 3] !== 255) transparentPixels += 1;
                }
                check(whitePixels === 0, [spread, ratio, side, corner, progress, 'white gaps', whitePixels].join('/'));
                check(transparentPixels === 0, [spread, ratio, side, corner, progress, 'transparent gaps', transparentPixels].join('/'));
            }
            measurements.push({ spread, ratio, side, corner, progress, elapsed });
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
        assert.equal(measurements.length, 128);
        t.diagnostic(`Canvas cases: ${measurements.length}; slowest draw: ${Math.max(...measurements.map(item => item.elapsed)).toFixed(1)} ms`);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
