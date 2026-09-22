import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';

async function runImageRenderingChecks() {
    let checks = 0;
    const check = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };
    const makeCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
    const png = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const decode = async result => {
        check(result.blob.type === 'image/png', 'Rendered output must be an actual PNG blob');
        const bitmap = await createImageBitmap(result.blob);
        check(bitmap.width === result.width && bitmap.height === result.height, 'PNG dimensions must match renderer dimensions');
        const canvas = makeCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const pixel = (image, x, y) => Array.from(image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    const samePixels = (first, second) => first.width === second.width && first.height === second.height && first.pixels.every((value, index) => value === second.pixels[index]);
    const colorIs = (image, x, y, expected, message) => check(pixel(image, x, y).every((value, index) => Math.abs(value - expected[index]) <= 1), message + ': ' + pixel(image, x, y));
    const differsInside = (first, second, rect) => {
        let sum = 0;
        let count = 0;
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) {
                sum += Math.abs(first.pixels[(y * first.width + x) * 4] - second.pixels[(y * second.width + x) * 4]);
                count += 1;
            }
        }
        return sum / count;
    };
    const outsidePreserved = (edited, original) => {
        for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
            if (x >= 32 && x < 96 && y >= 24 && y < 72) continue;
            const offset = (y * original.width + x) * 4;
            if (original.pixels.slice(offset, offset + 4).some((value, channel) => value !== edited.pixels[offset + channel])) return false;
        }
        return true;
    };
    const red = [230, 30, 40, 255];
    const green = [20, 210, 60, 255];
    const blue = [30, 70, 230, 255];
    const yellow = [240, 190, 20, 255];
    const canvas = makeCanvas(128, 96);
    const context = canvas.getContext('2d');
    for (const [index, color] of [red, green, blue, yellow].entries()) {
        context.fillStyle = 'rgb(' + color.slice(0, 3).join(',') + ')';
        context.fillRect(index % 2 * 64, Math.floor(index / 2) * 48, 64, 48);
    }
    const source = await png(canvas);
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const renderer = await createImageEditRenderer(source);
    let checkerRenderer;
    try {
        const initial = createImageEditSettings(renderer.width, renderer.height);
        const original = await decode(await renderer.render(initial));
        colorIs(original, 10, 10, red, 'The original upper-left quadrant must remain red');
        const rotated = await decode(await renderer.render(transformImageEditSettings(initial, 'rotate')));
        check(rotated.width === 96 && rotated.height === 128, 'A quarter turn must swap output dimensions');
        colorIs(rotated, 10, 10, blue, 'Clockwise rotation maps the lower-left quadrant to upper-left');
        colorIs(rotated, 80, 10, red, 'Clockwise rotation maps upper-left to upper-right');
        colorIs(rotated, 10, 100, yellow, 'Clockwise rotation maps lower-right to lower-left');
        colorIs(rotated, 80, 100, green, 'Clockwise rotation maps upper-right to lower-right');
        const horizontal = await decode(await renderer.render(transformImageEditSettings(initial, 'flipX')));
        colorIs(horizontal, 10, 10, green, 'Horizontal flip must swap the upper quadrants');
        const vertical = await decode(await renderer.render(transformImageEditSettings(initial, 'flipY')));
        colorIs(vertical, 10, 10, blue, 'Vertical flip must swap the left quadrants');
        const combined = await decode(await renderer.render(transformImageEditSettings(transformImageEditSettings(initial, 'flipX'), 'rotate')));
        colorIs(combined, 10, 10, yellow, 'A rotation after a horizontal flip must retain displayed transform order');
        const cropSettings = { ...initial, crop: { x: 0, y: 0, width: 0.5, height: 0.5 }, width: 64, height: 48 };
        const croppedRotated = await decode(await renderer.render(transformImageEditSettings(cropSettings, 'rotate')));
        check(croppedRotated.width === 48 && croppedRotated.height === 64, 'Rotating a crop must swap only its output dimensions');
        colorIs(croppedRotated, 20, 30, red, 'Rotating a crop must keep the same source pixels selected');
        const cropped = await decode(await renderer.render({ ...cropSettings, crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 } }));
        colorIs(cropped, 20, 20, green, 'Normalized crop must select the intended source quadrant');
        const resized = await decode(await renderer.render({ ...initial, width: 32, height: 24 }));
        check(resized.width === 32 && resized.height === 24, 'Resize must produce exact requested PNG dimensions');
        colorIs(resized, 3, 3, red, 'Resizing must preserve quadrant colors');
        colorIs(resized, 27, 18, yellow, 'Resizing must preserve distant source pixels');
        const gray = await decode(await renderer.render({ ...initial, filter: 'grayscale' }));
        for (const [x, y] of [[10, 10], [90, 10], [10, 70], [90, 70]]) {
            const color = pixel(gray, x, y);
            check(color[0] === color[1] && color[1] === color[2] && color[3] === 255, 'Grayscale must be baked into PNG channels');
        }
        const warmer = await decode(await renderer.render({ ...initial, temperature: 70, brightness: 10 }));
        check(pixel(warmer, 10, 10)[0] > pixel(original, 10, 10)[0] && pixel(warmer, 10, 10)[2] < pixel(original, 10, 10)[2], 'Temperature and brightness must modify output pixels');
        const checker = makeCanvas(128, 96);
        const checkerContext = checker.getContext('2d');
        for (let y = 0; y < 96; y += 4) for (let x = 0; x < 128; x += 4) {
            checkerContext.fillStyle = ((x + y) / 4) % 2 ? '#ffffff' : '#000000';
            checkerContext.fillRect(x, y, 4, 4);
        }
        checkerRenderer = await createImageEditRenderer(await png(checker));
        const checkerSettings = createImageEditSettings(128, 96);
        const checkerOriginal = await decode(await checkerRenderer.render(checkerSettings));
        const region = { id: 'privacy', x: 0.25, y: 0.25, width: 0.5, height: 0.5, shape: 'rectangle', mode: 'mosaic', strength: 100 };
        const mosaic = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [region] }));
        check(outsidePreserved(mosaic, checkerOriginal), 'Rectangular mosaic must preserve every pixel outside its region');
        check(differsInside(mosaic, checkerOriginal, { x: 40, y: 32, width: 48, height: 32 }) > 40, 'Mosaic must replace checker detail inside the region');
        const weakMosaic = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [{ ...region, strength: 1 }] }));
        check(differsInside(weakMosaic, mosaic, { x: 40, y: 32, width: 48, height: 32 }) > 20, 'Mosaic strength must change actual block pixels');
        const ellipse = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [{ ...region, shape: 'ellipse' }] }));
        check(outsidePreserved(ellipse, checkerOriginal), 'Elliptical mosaic must preserve every pixel outside its bounding rectangle');
        colorIs(ellipse, 33, 25, pixel(checkerOriginal, 33, 25), 'Pixels in the rectangle but outside the ellipse must remain unchanged');
        check(differsInside(ellipse, checkerOriginal, { x: 56, y: 40, width: 16, height: 16 }) > 40, 'Elliptical mosaic must modify its center');
        const blur = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [{ ...region, mode: 'blur' }] }));
        const weakBlur = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [{ ...region, mode: 'blur', strength: 1 }] }));
        check(outsidePreserved(blur, checkerOriginal), 'Blur must preserve every pixel outside its region');
        check(differsInside(blur, checkerOriginal, { x: 40, y: 32, width: 48, height: 32 }) > 40, 'Blur must remove fine detail inside its region');
        check(differsInside(blur, weakBlur, { x: 40, y: 32, width: 48, height: 32 }) > 10, 'Blur strength must change actual pixels');
        const ellipseBlur = await decode(await checkerRenderer.render({ ...checkerSettings, regions: [{ ...region, mode: 'blur', shape: 'ellipse' }] }));
        colorIs(ellipseBlur, 33, 25, pixel(checkerOriginal, 33, 25), 'Elliptical blur must not affect the bounding rectangle corners');
        const rounded = await decode(await renderer.render({ ...initial, border: { preset: 'rounded', radius: 20 } }));
        check(pixel(rounded, 0, 0)[3] === 0 && pixel(rounded, 64, 48)[3] === 255, 'Rounded borders must write transparent corners while preserving opaque image content');
        const squareCorners = await decode(await renderer.render({ ...initial, border: { preset: 'rounded', radius: 0 } }));
        check(samePixels(squareCorners, original), 'A zero corner radius must preserve square corners and the complete original image');
        const defaultCorners = await decode(await renderer.render({ ...initial, border: { preset: 'rounded' } }));
        check(pixel(defaultCorners, 0, 0)[3] === 0 && pixel(defaultCorners, 64, 48)[3] === 255, 'The explicit default corner radius must produce rounded corners');
        const framed = await decode(await renderer.render({ ...initial, border: { preset: 'white', width: 8, color: '#112233' } }));
        colorIs(framed, 0, 0, [17, 34, 51, 255], 'Frame color must be baked into the PNG');
        for (const border of IMAGE_BORDER_PRESETS) {
            const tiny = await decode(await renderer.render({ ...initial, width: 1, height: 1, border: { preset: border.id, width: 12, radius: 12 } }));
            check(tiny.width === 1 && tiny.height === 1, 'Every border must support the minimum output size: ' + border.id);
        }
        const cropPreview = await decode(await renderer.render({ ...cropSettings, width: 20, height: 10, border: { preset: 'white', width: 12, color: '#112233' } }, { maxDimension: 64, cropPreview: true }));
        check(cropPreview.width === 64 && cropPreview.height === 48, 'Crop preview must show the full transformed source, ignoring crop and resize');
        colorIs(cropPreview, 2, 2, red, 'Crop preview must omit border pixels');
        const reset = await decode(await renderer.render(createImageEditSettings(128, 96)));
        check(samePixels(reset, original), 'Resetting settings must restore the exact original image pixels');
        const currentSourceBytes = new Uint8Array(await source.arrayBuffer());
        check(sourceBytes.length === currentSourceBytes.length && sourceBytes.every((value, index) => value === currentSourceBytes[index]), 'Editing must not mutate the original image blob');
        const completionOrder = [];
        const previews = Array.from({ length: 20 }, (_, index) => renderer.render({ ...initial, brightness: index }, { maxDimension: 64 }).then(result => {
            completionOrder.push('preview-' + index);
            return { index, width: result.width };
        }, error => ({ index, code: error.code })));
        const final = renderer.render({ ...initial, width: 80, height: 60 }).then(result => { completionOrder.push('final'); return result; });
        const previewResults = await Promise.all(previews);
        const finalOutput = await decode(await final);
        check(previewResults.filter(result => result.code === 'IMAGE_EDIT_SUPERSEDED').length === 18, 'Rapid preview changes must discard all but the active and latest preview');
        check(previewResults[0].width === 64 && previewResults[19].width === 64, 'The active and latest previews must both finish successfully');
        check(completionOrder.join(',') === 'preview-0,final,preview-19', 'Final output must be prioritized over queued preview work');
        check(finalOutput.width === 80 && finalOutput.height === 60, 'Final render must retain its dimensions despite concurrent preview requests');
        const pending = renderer.render(initial);
        renderer.destroy();
        const destroyedCode = await pending.then(() => '', error => error.code);
        check(destroyedCode === 'IMAGE_EDIT_CLOSED', 'Closing the editor must stop active worker rendering');
        return { checks, supersededPreviews: 18, originalWidth: original.width, originalHeight: original.height, borders: IMAGE_BORDER_PRESETS.length };
    } finally {
        checkerRenderer?.destroy();
        renderer.destroy();
    }
}

test('image editor worker renders transforms, effects, privacy regions, borders, and bounded preview queues into PNG pixels', async t => {
    if (process.env.BOOKMANAGER_RENDERER_TESTS !== '1' || (process.platform === 'linux' && !process.env.DISPLAY)) {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 with a display to run the isolated Electron renderer.');
        return;
    }
    const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-image-render-test-')));
    let server;
    try {
        const enginePath = `/@fs/${path.join(projectRoot, 'src/features/fileTools/epubEditor/imageEditing.js')}`;
        await fs.writeFile(path.join(directory, 'fixture.js'), `import { createImageEditRenderer, createImageEditSettings, transformImageEditSettings, IMAGE_BORDER_PRESETS } from ${JSON.stringify(enginePath)};\nwindow.imageEditTests = (${runImageRenderingChecks.toString()})();`);
        await fs.writeFile(path.join(directory, 'index.html'), '<script type="module" src="/fixture.js"></script>');
        server = await createServer({
            configFile: false, root: directory, cacheDir: path.join(directory, '.vite'), logLevel: 'error',
            server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [directory, projectRoot] } },
        });
        await server.listen();
        await fs.writeFile(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 800, height: 700, webPreferences: { backgroundThrottling: false } });
    await window.loadURL(${JSON.stringify(`http://127.0.0.1:${server.httpServer.address().port}/`)});
    const result = await window.webContents.executeJavaScript('window.imageEditTests');
    console.log('IMAGE_EDIT_RESULT=' + JSON.stringify(result));
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
            const timeout = setTimeout(() => { child.kill(); reject(new Error('Image editing renderer timed out: ' + result)); }, 45000);
            child.once('error', error => { clearTimeout(timeout); reject(error); });
            child.once('close', code => { clearTimeout(timeout); resolve({ code, result }); });
        });
        assert.equal(output.code, 0, output.result);
        const match = output.result.match(/IMAGE_EDIT_RESULT=(.+)/);
        assert.ok(match, output.result);
        const report = JSON.parse(match[1]);
        assert.ok(report.checks >= 100, JSON.stringify(report));
        assert.equal(report.supersededPreviews, 18);
        assert.equal(report.borders, 8);
        t.diagnostic(JSON.stringify(report));
    } finally {
        await server?.close();
        await fs.rm(directory, { recursive: true, force: true });
    }
});
