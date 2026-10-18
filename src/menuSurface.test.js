import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./components/MenuSurface.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(initialProps = {}, initialParentOpen = true) {
    const slots = [];
    const frames = new Map();
    const timers = new Map();
    const animations = [];
    const forwardedRef = { current: null };
    let cursor = 0;
    let effects = [];
    let dirty = false;
    let mounted = true;
    let staleUpdates = 0;
    let now = 0;
    let nextId = 1;
    let parentOpen = initialParentOpen;
    let props = { open: true, children: 'Menu', ...initialProps };
    let result;
    let div;
    const node = {
        style: {}, activeAnimation: null,
        animate(keyframes, options) {
            const animation = {
                keyframes: copy(keyframes), options: copy(options), cancelled: false,
                visual: { ...keyframes[0] },
                finish() {
                    if (this.cancelled) return;
                    this.visual = { ...this.keyframes.at(-1) };
                    this.onfinish?.({ target: this });
                },
                cancel() {
                    this.cancelled = true;
                    if (node.activeAnimation === this) node.activeAnimation = null;
                },
            };
            animations.push(animation);
            node.activeAnimation = animation;
            return animation;
        },
    };
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        createElement(type, elementProps, ...children) {
            return { type, props: { ...elementProps, children: children.length === 1 ? children[0] : children } };
        },
        createContext(value) { return { value, Provider: Symbol('Provider') }; },
        forwardRef(render) { return render; },
        useContext() { return parentOpen; },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: initial };
            return [slots[index].value, value => {
                if (!mounted) staleUpdates += 1;
                if (!Object.is(slots[index].value, value)) dirty = true;
                slots[index].value = value;
            }];
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { dependencies, callback };
            return slots[index].callback;
        },
        useLayoutEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
                const previous = slots[index];
                const current = { dependencies, effect };
                slots[index] = current;
                effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
            }
        },
    };
    const module = { exports: {} };
    const window = {
        requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        getComputedStyle(target) {
            return { opacity: '1', scale: 'none', translate: 'none', ...target.style, ...target.activeAnimation?.visual };
        },
    };
    vm.runInNewContext(compiled, {
        module, exports: module.exports, window,
        require(name) {
            if (name === 'react') return react;
            assert.equal(name, '../styles/MenuSurface.css');
            return {};
        },
    });

    function render() {
        do {
            cursor = 0;
            dirty = false;
            result = module.exports.MenuSurface(props, forwardedRef);
            const nextDiv = result?.props.children;
            if (div?.props.ref !== nextDiv?.props.ref) {
                div?.props.ref(null);
                nextDiv?.props.ref(node);
            }
            div = nextDiv;
            if (div) node.style = div.props.style;
            const pending = effects;
            effects = [];
            pending.forEach(effect => effect());
        } while (dirty);
        return div;
    }
    render();
    return {
        node, forwardedRef, animations,
        div: () => div,
        contextOpen: () => result?.props.value,
        pending: () => ({ frames: frames.size, timers: timers.size }),
        staleUpdates: () => staleUpdates,
        update(update) { props = { ...props, ...update }; return render(); },
        setParentOpen(value) { parentOpen = value; return render(); },
        finishAnimation(animation = animations.at(-1)) {
            animation?.finish();
            if (dirty) render();
        },
        replayEffects() {
            const layoutEffects = slots.filter(slot => slot.effect);
            layoutEffects.forEach(slot => slot.cleanup?.());
            layoutEffects.forEach(slot => { slot.cleanup = slot.effect(); });
            if (dirty) render();
        },
        runFrames() {
            const pending = [...frames.entries()];
            pending.forEach(([id, callback]) => { frames.delete(id); callback(); });
            if (dirty) render();
        },
        advance(milliseconds) {
            now += milliseconds;
            for (const [id, timer] of [...timers.entries()]) {
                if (timer.at > now) continue;
                timers.delete(id);
                timer.callback();
            }
            if (dirty) render();
        },
        unmount() {
            mounted = false;
            slots.forEach(slot => slot.cleanup?.());
            div?.props.ref(null);
        },
    };
}

test('first-open layout measurements remain unscaled and caller transforms/ref are preserved', () => {
    const value = fixture({ origin: 'bottom right', style: { left: 10, transform: 'translateY(-100%)' } });
    assert.equal(value.forwardedRef.current, value.node);
    assert.equal(value.div().props.style.transform, 'translateY(-100%)');
    assert.equal(value.div().props.style.transformOrigin, 'bottom right');
    assert.deepEqual(value.animations[0].keyframes, [{ opacity: '0' }, { opacity: '0' }]);
    value.runFrames();
    const entrance = value.animations.at(-1);
    assert.equal(entrance.options.duration, 170);
    assert.deepEqual(entrance.keyframes[0], { opacity: '0', translate: '0px -4px', scale: '0.98' });
    assert.equal('transform' in entrance.keyframes[0], false);
    value.unmount();
});

test('closing retains contents and coordinates until actual animation completion, not a wall-clock timeout', () => {
    const value = fixture({ children: 'Retained menu', className: 'original', style: { left: 120, top: 80 }, title: 'original title' });
    value.runFrames();
    value.update({ open: false, children: null, className: '', style: { left: 0, top: 0 }, title: undefined });
    assert.equal(value.div().props.children, 'Retained menu');
    assert.equal(value.div().props.className, 'menu-surface original');
    assert.equal(value.div().props.title, 'original title');
    assert.equal(value.div().props.style.left, 120);
    assert.equal(value.div().props.style.top, 80);
    assert.equal(value.div().props.inert, '');
    assert.equal(value.div().props['aria-hidden'], true);
    assert.equal(value.div().props['data-menu-state'], 'closing');
    assert.equal(value.animations.at(-1).options.duration, 140);
    value.advance(139);
    assert.ok(value.div());
    value.advance(361);
    assert.ok(value.div());
    assert.deepEqual(value.pending(), { frames: 0, timers: 0 });
    value.finishAnimation();
    assert.equal(value.div(), undefined);
    assert.equal(value.forwardedRef.current, null);
    assert.deepEqual(value.pending(), { frames: 0, timers: 0 });
    value.unmount();
});

test('reopening during exit continues the current visual state and cancels stale removal', () => {
    const value = fixture();
    value.runFrames();
    value.update({ open: false });
    const exit = value.animations.at(-1);
    const queuedFinish = exit.onfinish;
    exit.visual = { opacity: '0.4', translate: '0px 1px', scale: '0.99' };
    value.advance(50);
    value.update({ open: true, children: 'Reopened', style: { left: 240 } });
    assert.equal(exit.cancelled, true);
    assert.equal(exit.onfinish, null);
    queuedFinish();
    assert.equal(value.div().props.inert, undefined);
    assert.equal(value.div().props['aria-hidden'], undefined);
    assert.deepEqual(value.animations.at(-1).keyframes[0], exit.visual);
    value.runFrames();
    assert.deepEqual(value.animations.at(-1).keyframes[0], exit.visual);
    value.advance(200);
    assert.equal(value.div().props.children, 'Reopened');
    assert.equal(value.div().props.style.left, 240);
    assert.deepEqual(value.pending(), { frames: 0, timers: 0 });
    value.unmount();
});

test('closing before the first frame cancels entrance and reopening after removal starts fresh', () => {
    const value = fixture();
    value.update({ open: false });
    const animationCount = value.animations.length;
    value.runFrames();
    assert.equal(value.animations.length, animationCount);
    value.advance(140);
    value.finishAnimation();
    value.update({ open: true });
    assert.deepEqual(value.animations.at(-1).keyframes[0], { opacity: '0' });
    value.unmount();
});

test('StrictMode effect replay preserves the initial scale and slide entrance', () => {
    const value = fixture();
    value.replayEffects();
    assert.deepEqual(value.animations.at(-1).keyframes[0], { opacity: '0' });
    assert.deepEqual(value.pending(), { frames: 1, timers: 0 });
    value.runFrames();
    assert.deepEqual(value.animations.at(-1).keyframes[0], { opacity: '0', translate: '0px -4px', scale: '0.98' });
    value.unmount();
});

test('parent closing propagates through context even when a portal submenu still requests open', () => {
    const value = fixture({ open: true });
    value.setParentOpen(false);
    assert.equal(value.contextOpen(), false);
    assert.equal(value.div().props.inert, '');
    value.advance(140);
    value.finishAnimation();
    assert.equal(value.div(), undefined);
    value.setParentOpen(true);
    assert.ok(value.div());
    assert.equal(value.contextOpen(), true);
    value.unmount();
});

test('open content and positioning updates do not replay entrance and remain available during exit', () => {
    const value = fixture();
    value.runFrames();
    const animationCount = value.animations.length;
    value.update({ children: 'Updated', style: { left: 60, transformOrigin: 'bottom left' } });
    assert.equal(value.animations.length, animationCount);
    value.update({ open: false, children: null, style: undefined });
    assert.equal(value.div().props.children, 'Updated');
    assert.equal(value.div().props.style.left, 60);
    assert.equal(value.div().props.style.transformOrigin, 'bottom left');
    value.unmount();
});

test('initially closed menus render nothing and unmount cleans frames, timers and animations', () => {
    const initiallyClosed = fixture({ open: false });
    assert.equal(initiallyClosed.div(), undefined);
    assert.equal(initiallyClosed.animations.length, 0);
    initiallyClosed.unmount();
    for (const closeFirst of [false, true]) {
        const value = fixture();
        if (closeFirst) value.update({ open: false });
        const queuedFinish = value.animations.at(-1)?.onfinish;
        value.unmount();
        queuedFinish?.();
        value.runFrames();
        value.advance(500);
        assert.deepEqual(value.pending(), { frames: 0, timers: 0 });
        assert.ok(value.animations.every(animation => animation.cancelled));
        assert.ok(value.animations.every(animation => animation.onfinish == null));
        assert.equal(value.forwardedRef.current, null);
        assert.equal(value.staleUpdates(), 0);
    }
});

test('browsers without WAAPI remove the closed menu after the 140ms fallback and cancel it on reopen', () => {
    const value = fixture();
    value.node.animate = undefined;
    value.update({ open: false });
    assert.equal(value.pending().timers, 1);
    value.advance(139);
    assert.ok(value.div());
    value.update({ open: true });
    value.advance(200);
    assert.ok(value.div());
    assert.equal(value.pending().timers, 0);
    value.update({ open: false });
    value.advance(140);
    assert.equal(value.div(), undefined);
    assert.equal(value.forwardedRef.current, null);
    value.unmount();
});
