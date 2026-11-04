import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error('Native cursor fixture timed out: ' + output));
        }, 60000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
    });
}

test('macOS 커서 호환 모드가 포인터 모양을 유지하고 이탈·비활성·시트·종료 시 시스템 커서를 복원한다', async t => {
    if (process.platform !== 'darwin' || process.env.BOOKMANAGER_RENDERER_TESTS !== '1'
        || process.env.BOOKMANAGER_NATIVE_CURSOR_TESTS !== '1') {
        t.skip('Set BOOKMANAGER_RENDERER_TESTS=1 and BOOKMANAGER_NATIVE_CURSOR_TESTS=1 on macOS to allow native pointer input.');
        return;
    }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-cursor-compat-render-'));
    let originalPointer;
    const helperPath = path.join(directory, 'input');
    try {
        const helperSource = path.join(directory, 'input.m');
        await fs.writeFile(helperSource, `
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <unistd.h>
#include <sys/select.h>
static void dragMouse(CGEventSourceRef source, CGEventType type, double x, double y) {
    CGEventRef event = CGEventCreateMouseEvent(source, type, CGPointMake(x, y), kCGMouseButtonLeft);
    CGEventSetFlags(event, 0);
    if (type == kCGEventLeftMouseDown || type == kCGEventLeftMouseUp) CGEventSetIntegerValueField(event, kCGMouseEventClickState, 1);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
}
static void dragPhase(const char *name) {
    printf("%s\\n", name);
    fflush(stdout);
    fd_set descriptors;
    FD_ZERO(&descriptors);
    FD_SET(STDIN_FILENO, &descriptors);
    struct timeval timeout = { 2, 0 };
    if (select(1, &descriptors, NULL, NULL, &timeout) > 0) {
        char line[32];
        fgets(line, sizeof(line), stdin);
    }
}
static void dragTo(CGEventSourceRef source, double x, double y, double tx, double ty) {
    for (int step = 1; step <= 20; step++) {
        dragMouse(source, kCGEventLeftMouseDragged, x + (tx - x) * step / 20, y + (ty - y) * step / 20);
        usleep(25000);
    }
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) return 2;
        NSString *command = [NSString stringWithUTF8String:argv[1]];
        if ([command isEqualToString:@"check"]) return CGPreflightPostEventAccess() ? 0 : 77;
        if ([command isEqualToString:@"position"]) {
            CGEventRef event = CGEventCreate(NULL);
            CGPoint point = CGEventGetLocation(event);
            CFRelease(event);
            printf("{\\"x\\":%.6f,\\"y\\":%.6f,\\"pid\\":%d}\\n", point.x, point.y, NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);
            return 0;
        }
        if (!CGPreflightPostEventAccess()) return 77;
        CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
        CGEventSourceSetLocalEventsSuppressionInterval(source, 0);
        if ([command isEqualToString:@"drag"] && argc == 8) {
            double x = atof(argv[2]), y = atof(argv[3]), tx = atof(argv[4]), ty = atof(argv[5]);
            double outsideX = atof(argv[6]), outsideY = atof(argv[7]);
            dragMouse(source, kCGEventMouseMoved, x, y);
            usleep(100000);
            dragMouse(source, kCGEventLeftMouseDown, x, y);
            usleep(100000);
            dragTo(source, x, y, tx, ty);
            usleep(100000);
            dragPhase("drag-inside");
            dragTo(source, tx, ty, outsideX, outsideY);
            usleep(100000);
            dragPhase("drag-outside");
            CGEventRef escape = CGEventCreateKeyboardEvent(source, 53, true);
            CGEventPost(kCGHIDEventTap, escape);
            CFRelease(escape);
            usleep(50000);
            escape = CGEventCreateKeyboardEvent(source, 53, false);
            CGEventPost(kCGHIDEventTap, escape);
            CFRelease(escape);
            usleep(100000);
            dragMouse(source, kCGEventLeftMouseUp, outsideX, outsideY);
            usleep(100000);
            dragPhase("cancelled");
            dragMouse(source, kCGEventMouseMoved, x, y);
            usleep(100000);
            dragPhase("reentry");
        } else if ([command isEqualToString:@"release"] && argc == 4) {
            dragMouse(source, kCGEventLeftMouseUp, atof(argv[2]), atof(argv[3]));
        } else if ([command isEqualToString:@"key"] && argc == 3) {
            CGKeyCode key = (CGKeyCode)atoi(argv[2]);
            CGEventRef down = CGEventCreateKeyboardEvent(source, key, true);
            CGEventSetFlags(down, 0);
            CGEventPost(kCGHIDEventTap, down);
            usleep(50000);
            CGEventRef up = CGEventCreateKeyboardEvent(source, key, false);
            CGEventSetFlags(up, 0);
            CGEventPost(kCGHIDEventTap, up);
            CFRelease(down);
            CFRelease(up);
            usleep(50000);
        } else if (([command isEqualToString:@"move"] || [command isEqualToString:@"click"] || [command isEqualToString:@"restore"]) && argc >= 4) {
            CGPoint point = CGPointMake(atof(argv[2]), atof(argv[3]));
            CGEventRef move = CGEventCreateMouseEvent(source, kCGEventMouseMoved, point, kCGMouseButtonLeft);
            CGEventPost(kCGSessionEventTap, move);
            CFRelease(move);
            if ([command isEqualToString:@"click"]) {
                usleep(50000);
                CGEventRef down = CGEventCreateMouseEvent(source, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
                CGEventSetIntegerValueField(down, kCGMouseEventClickState, 1);
                CGEventSetFlags(down, 0);
                CGEventPost(kCGHIDEventTap, down);
                usleep(50000);
                CGEventRef up = CGEventCreateMouseEvent(source, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
                CGEventSetIntegerValueField(up, kCGMouseEventClickState, 1);
                CGEventSetFlags(up, 0);
                CGEventPost(kCGHIDEventTap, up);
                CFRelease(down);
                CFRelease(up);
                usleep(50000);
            }
            if ([command isEqualToString:@"restore"] && argc == 5) {
                [[NSRunningApplication runningApplicationWithProcessIdentifier:atoi(argv[4])] activateWithOptions:0];
            }
        } else {
            CFRelease(source);
            return 2;
        }
        CFRelease(source);
    }
    return 0;
}
`);
        const compiled = await run('clang', ['-fobjc-arc', '-framework', 'AppKit', '-framework', 'ApplicationServices', helperSource, '-o', helperPath]);
        assert.equal(compiled.code, 0, compiled.output);
        const permission = await run(helperPath, ['check']);
        if (permission.code === 77) {
            t.skip('Native pointer validation requires Accessibility permission for the test host.');
            return;
        }
        assert.equal(permission.code, 0, permission.output);
        const position = await run(helperPath, ['position']);
        assert.equal(position.code, 0, position.output);
        originalPointer = JSON.parse(position.output);
        const { buildMacCursorCompat } = require('./buildMacCursorCompat.cjs');
        const { outputPath: addonPath } = buildMacCursorCompat();
        const entry = path.join(directory, 'main.cjs');
        const captureDirectory = process.env.BOOKMANAGER_NATIVE_CURSOR_CAPTURE_DIR || '';
        await fs.writeFile(entry, `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, dialog, nativeImage, screen } = require('electron');
const execFileAsync = promisify(execFile);
const addon = require(${JSON.stringify(addonPath)});
const inputPath = ${JSON.stringify(helperPath)};
const captureDirectory = ${JSON.stringify(captureDirectory)};
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function input(...args) {
    if (args[0] === 'click' || args[0] === 'key') {
        const frontmost = JSON.parse((await execFileAsync(inputPath, ['position'])).stdout).pid;
        assert.equal(frontmost, process.pid, 'The native input fixture is not the foreground app');
    }
    return (await execFileAsync(inputPath, args.map(String))).stdout;
}
async function until(predicate, message) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await pause(20);
    }
    throw new Error(typeof message === 'function' ? await message() : message);
}
function released(state, message) {
    assert.equal(state.ownsHide, false, message + ': cursor remains hidden');
    assert.equal(state.overlayVisible, false, message + ': software cursor remains visible');
    assert.equal(state.hideCount, state.unhideCount, message + ': hide/unhide calls must balance');
}
async function captureCursor(name, point) {
    if (!captureDirectory) return;
    fs.mkdirSync(captureDirectory, { recursive: true });
    const base = path.join(captureDirectory, name);
    const region = [Math.round(point.x - 32), Math.round(point.y - 32), 96, 96].join(',');
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-R', region, base + '-without-native.png']);
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-C', '-R', region, base + '-with-native.png']);
    const without = nativeImage.createFromPath(base + '-without-native.png');
    const withCursor = nativeImage.createFromPath(base + '-with-native.png');
    assert.deepEqual(withCursor.getSize(), without.getSize(), name + ': capture dimensions changed');
    const left = without.toBitmap();
    const right = withCursor.toBitmap();
    let differentPixels = 0;
    let lightPixels = 0;
    for (let index = 0; index < left.length; index += 4) {
        if (Math.abs(left[index] - right[index]) + Math.abs(left[index + 1] - right[index + 1]) + Math.abs(left[index + 2] - right[index + 2]) > 24) differentPixels += 1;
        if (left[index] > 180 && left[index + 1] > 180 && left[index + 2] > 180) lightPixels += 1;
    }
    assert.ok(lightPixels > 10, name + ': the drawn cursor is missing from the screen');
    assert.ok(differentPixels <= 4, name + ': capturing the native cursor reveals a second cursor (' + differentPixels + ' pixels)');
}
app.whenReady().then(async () => {
    const original = JSON.parse(await input('position'));
    const { installMacCursorCompat } = await import(${JSON.stringify(new URL('./macCursorCompat.js', import.meta.url).href)});
    const controller = installMacCursorCompat({ app, BrowserWindow, enabled: true, env: {}, addon });
    let window;
    let other;
    try {
        assert.equal(controller.enabled, true);
        const area = screen.getPrimaryDisplay().workArea;
        const width = Math.min(600, area.width - 80);
        const height = Math.min(450, area.height - 80);
        window = new BrowserWindow({ x: area.x + Math.floor((area.width - width) / 2), y: area.y + Math.floor((area.height - height) / 2), width, height, show: false });
        const types = ['pointer', 'text', 'col-resize', 'zoom-in', 'zoom-out'];
        const html = '<body style="margin:0;height:100vh;display:grid;grid-template:repeat(2,1fr)/repeat(3,1fr);background:#263647;color:white">'
            + [...types, 'default'].map(type => '<div id="' + type + '" onclick="window.fixtureClicks=(window.fixtureClicks||0)+1" style="cursor:' + type + ';padding:16px">' + type + '</div>').join('') + '</body>';
        await window.loadURL('data:text/html,' + encodeURIComponent(html));
        await window.webContents.executeJavaScript('window.fixtureEvents=[]; for (const type of ["pointerdown","pointerup","mousedown","mouseup","click"]) document.addEventListener(type, event => window.fixtureEvents.push({type, x:event.clientX, y:event.clientY, button:event.button, target:event.target.id}), true);');
        window.show();
        app.focus({ steal: true });
        window.focus();
        await until(() => window.isFocused(), 'Fixture did not gain keyboard focus');
        const state = () => addon.inspect(window.id);
        await until(() => state().attached, 'Compatibility controller did not attach');
        const pointFor = async type => {
            const center = await window.webContents.executeJavaScript('(() => { const r = document.getElementById(' + JSON.stringify(type) + ').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
            const bounds = window.getContentBounds();
            return { x: bounds.x + center.x, y: bounds.y + center.y };
        };
        const hover = async type => {
            const point = await pointFor(type);
            await input('move', point.x, point.y);
            const nativeType = type === 'pointer' ? 'hand' : type;
            await until(() => state().active && state().ownsHide && state().overlayVisible && state().cursorType === nativeType, async () =>
                type + ': software cursor did not activate: ' + JSON.stringify({ state: state(), expected: point,
                    pointer: JSON.parse(await input('position')), fixturePid: process.pid, bounds: window.getContentBounds(),
                    hovered: await window.webContents.executeJavaScript('document.querySelector("div:hover")?.id') }));
            assert.equal(state().nativeOverlayHitTransparent, true, 'Cursor decoration must not intercept input');
            assert.equal(state().hideCount - state().unhideCount, 1, 'One active hide must be owned');
            await pause(120);
            return point;
        };
        for (const type of types) {
            const point = await hover(type);
            const hides = state().hideCount;
            for (const offset of [-18, 18, -9, 9, 0]) {
                await input('move', point.x + offset, point.y + offset);
                await pause(20);
                assert.equal(state().ownsHide, true, type + ': native cursor reappeared during movement');
                assert.equal(state().hideCount, hides, type + ': movement must not repeatedly hide the cursor');
            }
            await pause(120);
            await captureCursor(type, point);
        }
        const arrow = await pointFor('default');
        await input('move', arrow.x, arrow.y);
        await until(() => state().cursorType === 'pointer' && !state().ownsHide, 'The ordinary arrow must use the system cursor');
        const hides = state().hideCount;
        await input('move', arrow.x + 10, arrow.y);
        released(state(), 'Arrow movement');
        assert.equal(state().hideCount, hides, 'Moving the system arrow must not activate the overlay');
        await hover('text');
        const bounds = window.getContentBounds();
        await input('move', bounds.x - 25, bounds.y + bounds.height / 2);
        await until(() => !state().ownsHide && !state().overlayVisible, 'Leaving the window did not restore the cursor');
        released(state(), 'Pointer leave');
        const clickPoint = await hover('pointer');
        await input('click', clickPoint.x, clickPoint.y);
        try {
            await until(() => window.webContents.executeJavaScript('window.fixtureClicks === 1'), 'The fixture did not receive exactly one native click');
        } catch (error) {
            const before = await window.webContents.executeJavaScript('({count:window.fixtureClicks||0, events:window.fixtureEvents})');
            const nativeState = state();
            controller.detachWindow(window);
            await input('click', clickPoint.x, clickPoint.y);
            await pause(200);
            const after = await window.webContents.executeJavaScript('({count:window.fixtureClicks||0, events:window.fixtureEvents})');
            throw new Error(error.message + ': ' + JSON.stringify({point:clickPoint, before, afterWithoutCompatibility:after, nativeState}));
        }
        controller.suspendWindow(window, true);
        released(state(), 'Explicit suspension');
        controller.suspendWindow(window, false);
        await hover('pointer');
        other = new BrowserWindow({ x: area.x + 8, y: area.y + 8, width: 250, height: 150, show: false });
        await other.loadURL('data:text/html,Other fixture window');
        other.show();
        other.focus();
        await until(() => !state().ownsHide && !state().overlayVisible, 'Window blur did not restore the cursor');
        released(state(), 'Window blur');
        other.destroy();
        other = null;
        window.focus();
        await hover('text');
        const sheet = dialog.showMessageBox(window, { message: 'Native cursor sheet regression', buttons: ['Continue'], defaultId: 0 });
        await until(() => state().sheetSuspended, 'Native sheet did not suspend the compatibility cursor');
        released(state(), 'Native sheet');
        await input('key', 36);
        await sheet;
        await until(() => !state().sheetSuspended, 'Native sheet suspension did not clear');
        window.focus();
        await window.webContents.executeJavaScript('window.dragEvents=[]; const source=document.getElementById("pointer"); const target=document.getElementById("text"); source.draggable=true; source.ondragstart=event=>{event.dataTransfer.setData("text/plain","BookManager isolated drag fixture");event.dataTransfer.effectAllowed="copy";dragEvents.push(event.type);}; source.ondragend=event=>dragEvents.push(event.type); target.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect="copy";if(dragEvents.at(-1)!==event.type)dragEvents.push(event.type);};undefined;');
        const dragStart = await hover('pointer');
        const dragTarget = await pointFor('text');
        const outside = { x: bounds.x + bounds.width + 35, y: dragTarget.y };
        assert.equal(JSON.parse(await input('position')).pid, process.pid, 'The drag fixture is not the foreground app');
        const drag = spawn(inputPath, ['drag', dragStart.x, dragStart.y, dragTarget.x, dragTarget.y, outside.x, outside.y].map(String), { stdio: ['pipe', 'pipe', 'pipe'] });
        let pending = '';
        let checks = Promise.resolve();
        let dragFailure;
        let dragOutput = '';
        drag.stdin.on('error', () => {});
        drag.stderr.on('data', data => { dragOutput += data; });
        drag.stdout.on('data', data => {
            pending += data;
            let boundary;
            while ((boundary = pending.indexOf('\\n')) >= 0) {
                const phase = pending.slice(0, boundary);
                pending = pending.slice(boundary + 1);
                checks = checks.then(async () => {
                    try {
                        if (phase === 'reentry') {
                            await until(() => state().ownsHide && state().overlayVisible && !state().dragSuspended, 'Cancelling a drag did not restore compatibility on reentry');
                            await until(() => window.webContents.executeJavaScript('dragEvents.includes("dragend")'), 'Native drag cancellation did not reach the renderer');
                        } else {
                            released(state(), phase);
                            if (phase === 'drag-inside') {
                                assert.equal(state().dragSuspended, true, 'Native dragging must suspend compatibility');
                                assert.equal(await window.webContents.executeJavaScript('dragEvents.includes("dragstart") && dragEvents.includes("dragover")'), true, 'The fixture did not start a real HTML drag');
                            }
                        }
                    } catch (error) {
                        dragFailure ??= error;
                    } finally {
                        if (!drag.stdin.destroyed) drag.stdin.write('\\n');
                    }
                });
            }
        });
        try {
            const code = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => { drag.kill(); reject(new Error('Native drag fixture timed out')); }, 15000);
                drag.once('error', error => { clearTimeout(timeout); reject(error); });
                drag.once('exit', code => { clearTimeout(timeout); resolve(code); });
            });
            await checks;
            assert.equal(code, 0, dragOutput);
            if (dragFailure) throw dragFailure;
        } finally {
            await input('release', outside.x, outside.y);
        }
        await hover('zoom-in');
        const detached = addon.detach(window.id);
        released(detached, 'Detaching a hovered window');
        assert.equal(addon.inspect(window.id).attached, false);
        controller.detachWindow(window);
        controller.attachWindow(window);
        await hover('pointer');
        const id = window.id;
        window.destroy();
        window = null;
        assert.equal(addon.inspect(id).attached, false, 'Closing the window must detach native state');
        console.log('MAC_CURSOR_COMPAT_RENDER_OK');
    } finally {
        other?.destroy();
        window?.destroy();
        controller.dispose();
        await input('restore', original.x, original.y, original.pid);
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`);
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const output = await run(require('electron'), [entry], { env });
        assert.equal(output.code, 0, output.output);
        assert.match(output.output, /MAC_CURSOR_COMPAT_RENDER_OK/);
    } finally {
        if (originalPointer) {
            await run(helperPath, ['restore', String(originalPointer.x), String(originalPointer.y), String(originalPointer.pid)]);
        }
        await fs.rm(directory, { recursive: true, force: true });
    }
});
