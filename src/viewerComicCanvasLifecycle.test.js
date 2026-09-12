import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { comicDownsampleTarget, paintComicDownsample } from './comicImageDownsample.js';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function ComicPageFrame({');
const end = source.indexOf('function ComicFlipBookAmbientPage({', start);
assert.ok(start >= 0 && end > start);
const compiled = transformSync(source.slice(start, end), { loader: 'jsx', target: 'es2022' }).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const sameDependencies = (left, right) => left && right && left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));

function canvasFixture() {
    let width = 300;
    let height = 150;
    const canvas = {
        bitmap: '',
        get width() { return width; },
        set width(value) { width = value; this.bitmap = ''; },
        get height() { return height; },
        set height(value) { height = value; this.bitmap = ''; },
        getContext() {
            return { drawImage: image => { canvas.bitmap = image.bitmap; } };
        },
    };
    return canvas;
}

function fixture() {
    const slots = [];
    const timers = new Map();
    const listeners = new Set();
    const observers = new Set();
    const pending = [];
    const canvas = canvasFixture();
    const image = { complete: true, naturalWidth: 1200, naturalHeight: 1800 };
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let tree;
    let timerSequence = 0;
    let updatesAfterUnmount = 0;
    const props = {
        page: { name: 'page.jpg', basename: 'page.jpg' }, index: 0,
        src: 'bookmanager-comic://test/first.jpg', viewMode: 'fit',
        imageClassName: 'viewer-comic-image', frameStyle: { width: '200px', height: '300px' },
        highQuality: true, qualityScale: 1, renderAmbientCanvas: false, onImageLoad() {},
    };
    const frame = {
        getBoundingClientRect: () => ({
            width: Number.parseFloat(props.frameStyle.width) * props.qualityScale,
            height: Number.parseFloat(props.frameStyle.height) * props.qualityScale,
        }),
    };
    const react = {
        createElement: (type, attributes, ...children) => ({ type, props: { ...attributes, children } }),
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: initial };
            return [slots[index].value, value => {
                if (!mounted) updatesAfterUnmount += 1;
                const next = typeof value === 'function' ? value(slots[index].value) : value;
                if (!Object.is(next, slots[index].value)) dirty = true;
                slots[index].value = next;
            }];
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
                slots[index] = { value: callback, dependencies };
            }
            return slots[index].value;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!sameDependencies(slots[index]?.dependencies, dependencies)) {
                effects.push({ index, effect, cleanup: slots[index]?.cleanup });
                slots[index] = { dependencies };
            }
        },
    };
    const window = {
        devicePixelRatio: 1,
        setTimeout(callback) { const id = ++timerSequence; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(_name, callback) { listeners.add(callback); },
        removeEventListener(_name, callback) { listeners.delete(callback); },
    };
    class ResizeObserver {
        constructor(callback) { this.callback = callback; observers.add(this); }
        observe() {}
        disconnect() { observers.delete(this); }
    }
    const renderDownsample = options => paintComicDownsample({
        ...options,
        createCanvas: canvasFixture,
        resizer: {
            resize(sourceImage, staging, { cancelToken }) {
                return new Promise((resolve, reject) => {
                    pending.push({
                        resolve() {
                            staging.bitmap = `${sourceImage.src}:${staging.width}x${staging.height}`;
                            resolve();
                        },
                        reject,
                    });
                    cancelToken.catch(reject);
                });
            },
        },
    });
    const Component = new Function('React', 'useRef', 'useState', 'useCallback', 'useEffect', 'window',
        'ResizeObserver', 'comicDownsampleTarget', 'paintComicDownsample', 'paintAmbientCanvasFromSource',
        'COMIC_HIGH_QUALITY_RENDER_DELAY_MS', `${compiled}; return ComicPageFrame;`)(
        react, react.useRef, react.useState, react.useCallback, react.useEffect, window,
        ResizeObserver, comicDownsampleTarget, renderDownsample, () => true, 120,
    );
    const attach = node => {
        if (!node || typeof node !== 'object') return;
        if (node.props.ref) {
            if (node.type === 'img') {
                image.src = node.props.src;
                node.props.ref.current = image;
            } else node.props.ref.current = node.type === 'canvas' ? canvas : frame;
        }
        node.props.children.flat(Infinity).forEach(attach);
    };
    const render = (changes = {}) => {
        Object.assign(props, changes);
        let iterations = 0;
        do {
            assert.ok(iterations++ < 20, 'Unexpected effect/render loop');
            cursor = 0;
            dirty = false;
            effects = [];
            tree = Component(props);
            attach(tree);
            const currentEffects = effects;
            currentEffects.forEach(effect => effect.cleanup?.());
            currentEffects.forEach(effect => { slots[effect.index].cleanup = effect.effect(); });
        } while (dirty);
    };
    render();
    return {
        canvas, pending,
        get ready() { return tree.props['data-high-quality-ready'] === 'true'; },
        get resourceCount() { return timers.size + observers.size + listeners.size; },
        get updatesAfterUnmount() { return updatesAfterUnmount; },
        render,
        async startRender() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
            await tick();
            render();
        },
        async complete(index = pending.length - 1) {
            pending[index].resolve();
            await tick();
            render();
        },
        unmount() {
            mounted = false;
            slots.forEach(slot => slot.cleanup?.());
        },
    };
}

test('같은 만화의 크기와 배율 변경은 기존 HQ 캔버스를 유지한 뒤 완성된 결과로 교체한다', async t => {
    const f = fixture();
    t.after(() => f.unmount());
    await f.startRender();
    await f.complete();
    const previous = f.canvas.bitmap;
    assert.equal(f.ready, true);
    assert.equal(f.canvas.width, 200);

    f.render({ frameStyle: { width: '300px', height: '450px' }, qualityScale: 1.5 });
    assert.equal(f.ready, true);
    assert.equal(f.canvas.bitmap, previous);
    assert.equal(f.canvas.width, 200);
    await f.startRender();
    assert.equal(f.canvas.bitmap, previous);

    f.render({ frameStyle: { width: '350px', height: '525px' }, qualityScale: 2 });
    assert.equal(f.ready, true);
    assert.equal(f.canvas.bitmap, previous);
    await f.startRender();
    await f.complete(1);
    assert.equal(f.canvas.bitmap, previous, 'Cancelled resize replaced the current bitmap');
    await f.complete(2);
    assert.equal(f.ready, true);
    assert.equal(f.canvas.width, 700);
    assert.equal(f.canvas.height, 1050);
    assert.notEqual(f.canvas.bitmap, previous);
});

test('만화 원본 교체와 HQ 비활성화는 기존 캔버스를 해제하며 다시 활성화하면 복구한다', async t => {
    const f = fixture();
    t.after(() => f.unmount());
    await f.startRender();
    await f.complete();
    f.render({ src: 'bookmanager-comic://test/second.jpg' });
    assert.equal(f.ready, false);
    assert.equal(f.canvas.width, 1);
    assert.equal(f.canvas.bitmap, '');
    await f.startRender();
    await f.complete();
    assert.match(f.canvas.bitmap, /second\.jpg/);

    f.render({ highQuality: false });
    assert.equal(f.ready, false);
    assert.equal(f.canvas.width, 1);
    assert.equal(f.resourceCount, 0);
    f.render({ highQuality: true });
    await f.startRender();
    await f.complete();
    assert.equal(f.ready, true);
});

test('만화 프레임 해제는 진행 중인 HQ 작업과 캔버스를 정리한다', async () => {
    const f = fixture();
    await f.startRender();
    await f.complete();
    f.render({ qualityScale: 2 });
    await f.startRender();
    f.unmount();
    await tick();
    f.pending[1].resolve();
    await tick();
    assert.equal(f.canvas.width, 1);
    assert.equal(f.canvas.height, 1);
    assert.equal(f.canvas.bitmap, '');
    assert.equal(f.resourceCount, 0);
    assert.equal(f.updatesAfterUnmount, 0);
});

test('원본 크기 이상으로 확대하면 기존 동작대로 HQ 축소 대신 원본 이미지를 사용한다', async t => {
    const f = fixture();
    t.after(() => f.unmount());
    await f.startRender();
    await f.complete();
    f.render({ qualityScale: 6 });
    assert.equal(f.ready, true);
    await f.startRender();
    assert.equal(f.ready, false);
    assert.equal(f.canvas.width, 1);
    assert.equal(f.pending.length, 1);
});
