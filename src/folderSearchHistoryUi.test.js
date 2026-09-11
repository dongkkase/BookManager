import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8');
const componentSource = source.slice(source.indexOf('const FolderSearchInput'), source.indexOf('\nfunction FolderTab('));
const compiled = transformSync(`${componentSource}\nmodule.exports = FolderSearchInput;`, { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
const childrenOf = node => [node?.props?.children].flat(Infinity).filter(child => child && typeof child === 'object');
const nodes = node => node ? [node, ...childrenOf(node).flatMap(nodes)] : [];
const textContent = node => Array.isArray(node) ? node.map(textContent).join('') : node && typeof node === 'object' ? textContent(node.props.children) : node == null || typeof node === 'boolean' ? '' : String(node);

function fixture(history = []) {
    const originalDocument = globalThis.document;
    const listeners = new Map();
    const slots = [];
    const calls = { searches: [], clears: 0, removals: [], historyClears: 0, focus: null };
    let cursor = 0;
    let effects = [];
    let tree;
    const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
    const react = {
        memo: component => component,
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }];
        },
        useRef(initial) {
            const index = cursor++;
            return slots[index] ??= { current: initial };
        },
        useId() {
            const index = cursor++;
            return `search-history-${index}`;
        },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) {
                const previous = slots[index];
                slots[index] = { deps };
                effects.push(() => {
                    previous?.cleanup?.();
                    slots[index].cleanup = effect();
                });
            }
        },
    };
    globalThis.document = {
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        removeEventListener: (type, callback) => listeners.get(type)?.delete(callback),
    };
    const module = { exports: {} };
    new Function('module', 'React', 'useState', 'useRef', 'useEffect', 'FaIcon', 'SlidingSearchPlaceholder', compiled)(
        module, react, react.useState, react.useRef, react.useEffect, 'Icon', 'Placeholder',
    );
    const props = {
        inputRef: { current: null },
        searchHistory: [...history],
        onApplyQuery: query => calls.searches.push(query),
        onClearQuery: () => { calls.clears += 1; },
        onRemoveSearchHistory: query => {
            calls.removals.push(query);
            props.searchHistory = props.searchHistory.filter(item => item !== query);
        },
        onClearSearchHistory: () => {
            calls.historyClears += 1;
            props.searchHistory = [];
        },
        searchPlaceholder: 'Search books',
        clearLabel: 'Clear search',
        searchLabel: 'Search',
        historyLabel: 'Recent searches',
        historyEmptyLabel: 'No recent searches',
        historyDeleteLabel: 'Delete history',
        historyClearLabel: 'Clear history',
    };
    const matches = (node, selector) => selector.startsWith('.') ? (node.props.className || '').split(' ').includes(selector.slice(1)) : node.type === selector;
    const attach = (node, parent = null) => {
        node.parent = parent;
        node.tagName = typeof node.type === 'string' ? node.type.toUpperCase() : '';
        node.value = node.props.value;
        node.contains = candidate => nodes(node).includes(candidate);
        node.querySelectorAll = selector => nodes(node).filter(candidate => matches(candidate, selector));
        node.querySelector = selector => node.querySelectorAll(selector)[0];
        node.closest = selector => matches(node, selector) ? node : parent?.closest(selector);
        node.focus = () => { calls.focus = node; };
        if (node.props.ref) node.props.ref.current = node;
        childrenOf(node).forEach(child => attach(child, node));
    };
    const render = () => {
        cursor = 0;
        tree = module.exports(props);
        attach(tree);
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
    };
    render();
    const find = predicate => nodes(tree).find(predicate);
    const input = () => find(node => node.type === 'input');
    const dropdown = () => find(node => node.props.role === 'region');
    const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || textContent(node) === label));
    const open = () => { input().props.onFocus(); render(); };
    return {
        calls,
        props,
        render,
        input,
        dropdown,
        button,
        open,
        form: () => tree,
        type: text => { input().props.onChange({ target: { value: text } }); render(); },
        pointerDown: target => [...(listeners.get('pointerdown') || [])].forEach(callback => callback({ target })),
        listenerCount: () => [...listeners.values()].reduce((count, set) => count + set.size, 0),
        close: () => { slots.forEach(slot => slot.cleanup?.()); globalThis.document = originalDocument; },
    };
}

function keyEvent(key, target, nativeEvent = {}) {
    return {
        key,
        target,
        nativeEvent,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
    };
}

test('typing does not search, and submitting uses the trimmed current input value', () => {
    const value = fixture(['previous query']);
    try {
        value.open();
        value.type('  typed query  ');
        assert.deepEqual(value.calls.searches, []);
        assert.deepEqual(value.props.searchHistory, ['previous query']);
        value.input().value = '  latest DOM value  ';
        const event = keyEvent('Enter', value.input());
        value.form().props.onSubmit(event);
        value.render();
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(value.calls.searches, ['latest DOM value']);
        assert.equal(value.input().props.value, 'latest DOM value');
        assert.equal(value.dropdown(), undefined);
    } finally { value.close(); }
});

test('IME confirmation Enter is protected and the completed query can be submitted', () => {
    const value = fixture();
    try {
        for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
            const event = keyEvent('Enter', value.input(), nativeEvent);
            value.input().props.onKeyDown(event);
            assert.equal(event.defaultPrevented, true);
        }
        value.input().props.onCompositionStart();
        const composingEnter = keyEvent('Enter', value.input());
        value.input().props.onKeyDown(composingEnter);
        value.form().props.onSubmit(composingEnter);
        assert.equal(composingEnter.defaultPrevented, true);
        assert.deepEqual(value.calls.searches, []);
        value.input().props.onCompositionEnd({ currentTarget: { value: '  한국어 검색  ' } });
        value.render();
        const enter = keyEvent('Enter', value.input());
        value.input().props.onKeyDown(enter);
        assert.equal(enter.defaultPrevented, false);
        value.form().props.onSubmit(enter);
        value.render();
        assert.deepEqual(value.calls.searches, ['한국어 검색']);
    } finally { value.close(); }
});

test('selecting recent history fills and searches immediately, including the same query again', () => {
    const value = fixture(['latest query', 'older query']);
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            value.open();
            assert.equal(value.button('older query').props.type, 'button');
            value.button('older query').props.onClick();
            value.render();
            assert.equal(value.input().props.value, 'older query');
            assert.equal(value.dropdown(), undefined);
            assert.equal(value.calls.searches.length, attempt + 1);
        }
        assert.deepEqual(value.calls.searches, ['older query', 'older query']);
        assert.equal(value.calls.clears, 0);
    } finally { value.close(); }
});

test('individual and complete history deletion preserve the current search text and results', () => {
    const value = fixture(['latest query', 'older query']);
    try {
        value.type('current query');
        value.open();
        const remove = value.button('Delete history: latest query');
        assert.equal(remove.props.type, 'button');
        remove.props.onClick();
        value.render();
        assert.deepEqual(value.calls.removals, ['latest query']);
        assert.equal(value.button('latest query'), undefined);
        assert.ok(value.button('older query'));
        assert.equal(textContent(value.calls.focus), 'older query');
        value.button('Clear history').props.onClick();
        value.render();
        assert.equal(value.calls.historyClears, 1);
        assert.ok(textContent(value.dropdown()).includes('No recent searches'));
        assert.equal(value.input().props.value, 'current query');
        assert.deepEqual(value.calls.searches, []);
        assert.equal(value.calls.clears, 0);
    } finally { value.close(); }
});

test('history dismisses on Escape, outside pointer events, and leaving the search control', () => {
    const value = fixture(['query']);
    try {
        value.open();
        value.pointerDown(value.button('query'));
        value.render();
        assert.ok(value.dropdown());
        const escape = keyEvent('Escape', value.button('query'));
        value.dropdown().props.onKeyDown(escape);
        value.render();
        assert.equal(escape.defaultPrevented, true);
        assert.equal(escape.propagationStopped, true);
        assert.equal(value.dropdown(), undefined);
        assert.equal(value.calls.focus.type, 'input');
        assert.equal(value.listenerCount(), 0);
        value.input().props.onClick();
        value.render();
        assert.ok(value.dropdown());
        value.pointerDown({ tagName: 'MAIN' });
        value.render();
        assert.equal(value.dropdown(), undefined);
        value.open();
        value.form().props.onBlur({ currentTarget: value.form(), relatedTarget: value.button('query') });
        value.render();
        assert.ok(value.dropdown());
        value.form().props.onBlur({ currentTarget: value.form(), relatedTarget: null });
        value.render();
        assert.equal(value.dropdown(), undefined);
        assert.deepEqual(value.calls.searches, []);
    } finally { value.close(); }
});

test('keyboard navigation reaches recent searches and does not trigger folder shortcuts', () => {
    const value = fixture(['latest query', 'older query']);
    try {
        const down = keyEvent('ArrowDown', value.input());
        value.input().props.onKeyDown(down);
        value.render();
        assert.equal(down.defaultPrevented, true);
        assert.equal(down.propagationStopped, true);
        assert.equal(textContent(value.calls.focus), 'latest query');
        const next = keyEvent('ArrowDown', value.button('latest query'));
        value.dropdown().props.onKeyDown(next);
        assert.equal(textContent(value.calls.focus), 'older query');
        assert.equal(next.propagationStopped, true);
        for (const key of ['Delete', 'Enter', ' ']) {
            const event = keyEvent(key, value.button('Delete history: older query'));
            value.dropdown().props.onKeyDown(event);
            assert.equal(event.propagationStopped, true, key);
        }
        const submitKey = keyEvent('Enter', value.button('Search'));
        value.form().props.onKeyDown(submitKey);
        assert.equal(submitKey.propagationStopped, true);
        assert.deepEqual(value.calls.searches, []);
        assert.deepEqual(value.calls.removals, []);
    } finally { value.close(); }
});
