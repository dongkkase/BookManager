import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as activity from './readingActivityTracker.js';

const compiled = transformSync(readFileSync(new URL('./hooks/useReadingActivity.js', import.meta.url), 'utf8'), { format: 'cjs' }).code;

function fixture({ preview = false, supported = true, visualReading = true } = {}) {
    const slots = [];
    const timers = new Map();
    const records = [];
    let cursor = 0;
    let effects = [];
    let clock = 1_800_000_000_000;
    let timerId = 0;
    let props = { session: { id: 'one', preview }, ready: true, playing: false, visualReading };
    const equal = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        useRef: initial => slots[cursor++] ??= { current: initial },
        useCallback(callback, dependencies) {
            const index = cursor++;
            if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { dependencies, callback };
            return slots[index].callback;
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!slots[index] || !equal(slots[index].dependencies, dependencies)) {
                const previous = slots[index];
                const slot = { dependencies };
                slots[index] = slot;
                effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
            }
        },
    };
    const target = () => {
        const listeners = new Map();
        return {
            listeners,
            addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type).add(listener);
            },
            removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
            emit: type => listeners.get(type)?.forEach(listener => listener()),
        };
    };
    const window = {
        ...target(),
        viewerAPI: supported ? { recordReadingActivity: (sessionId, interval) => records.push({ sessionId, ...interval }) } : {},
        setInterval: callback => { const id = ++timerId; timers.set(id, callback); return id; },
        clearInterval: id => timers.delete(id),
    };
    const document = { ...target(), visibilityState: 'visible', hasFocus: () => true };
    const module = { exports: {} };
    vm.runInNewContext(compiled, {
        module, exports: module.exports, window, document,
        require(name) {
            if (name === 'react') return react;
            return {
                ...activity,
                createReadingActivityTracker: options => activity.createReadingActivityTracker({
                    ...options, now: () => clock, monotonicNow: () => clock, createId: () => `event-${records.length}`,
                }),
            };
        },
    });
    const render = patch => {
        props = { ...props, ...patch };
        cursor = 0;
        const result = module.exports.useReadingActivity(props);
        effects.splice(0).forEach(effect => effect());
        return result;
    };
    render();
    return {
        records, window, document, timers, render,
        advance: milliseconds => { clock += milliseconds; timers.forEach(callback => callback()); },
        close: () => slots.forEach(slot => slot.cleanup?.()),
        total: () => records.reduce((total, record) => total + record.endedAt - record.startedAt, 0),
    };
}

test('hook rerenders retain one timer and unmount flushes and removes every listener', () => {
    const value = fixture();
    value.advance(5_000);
    value.render({ ready: true });
    value.render({ ready: true });
    assert.equal(value.timers.size, 1);
    assert.ok([...value.window.listeners.values()].every(listeners => listeners.size === 1));
    value.advance(5_000);
    value.close();
    assert.equal(value.total(), 10_000);
    assert.equal(value.timers.size, 0);
    assert.ok([...value.window.listeners.values(), ...value.document.listeners.values()].every(listeners => listeners.size === 0));
});

test('blur and visibility flush foreground reading and focus restarts only future time', () => {
    const value = fixture();
    value.advance(5_000);
    value.window.emit('blur');
    assert.equal(value.total(), 5_000);
    value.advance(5_000);
    value.window.emit('focus');
    value.advance(5_000);
    value.document.visibilityState = 'hidden';
    value.document.emit('visibilitychange');
    value.advance(5_000);
    value.close();
    assert.equal(value.total(), 10_000);
});

test('session replacement closes the previous interval and preview sessions never subscribe', () => {
    const value = fixture();
    value.advance(5_000);
    value.render({ session: { id: 'two' }, ready: false });
    value.advance(5_000);
    value.render({ ready: true });
    value.advance(5_000);
    value.render({ session: { id: 'preview', preview: true } });
    value.advance(5_000);
    value.close();
    assert.equal(value.timers.size, 0);
    assert.deepEqual(value.records.map(record => record.sessionId), ['one', 'two']);
    assert.equal(value.total(), 10_000);
});

test('background audio keeps counting while paused and loading players remain excluded', () => {
    const value = fixture({ visualReading: false });
    value.advance(5_000);
    value.render({ playing: true });
    value.window.emit('blur');
    value.document.visibilityState = 'hidden';
    value.document.emit('visibilitychange');
    value.advance(5_000);
    value.render({ playing: false });
    value.advance(5_000);
    value.render({ playing: true, ready: false });
    value.advance(5_000);
    value.close();
    assert.equal(value.total(), 5_000);
});

test('unsupported web API and previews are inert', () => {
    for (const options of [{ supported: false }, { preview: true }]) {
        const value = fixture(options);
        value.advance(5_000);
        assert.doesNotThrow(value.render());
        value.close();
        assert.equal(value.total(), 0);
        assert.equal(value.timers.size, 0);
        assert.equal(value.window.listeners.size, 0);
    }
});
