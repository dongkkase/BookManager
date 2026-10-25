import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8');

function fragment(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, startMarker);
    return source.slice(start, end);
}

const compiled = transformSync([
    fragment('function splitTagValues(', 'function pickMetadataFields('),
    fragment('function TagInput(', 'function MetadataSearchDialog('),
    'module.exports = TagInput;',
].join('\n'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
const nodes = node => node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];

function fixture(value = '') {
    const slots = [];
    const changes = [];
    const input = { value: '', focus: () => {} };
    let cursor = 0;
    let tree;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, update => {
                slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
            }];
        },
        useRef(initial) {
            const index = cursor++;
            return slots[index] ??= { current: initial };
        },
        useMemo: factory => factory(),
        useCallback: callback => callback,
    };
    const module = { exports: {} };
    new Function('module', 'React', 'useState', 'useRef', 'useMemo', 'useCallback', compiled)(
        module, react, react.useState, react.useRef, react.useMemo, react.useCallback,
    );
    const props = {
        value,
        onChange: next => {
            changes.push(next);
            props.value = next;
        },
    };
    const inputProps = () => nodes(tree).find(node => node.type === 'input').props;
    const render = () => {
        cursor = 0;
        tree = module.exports(props);
        inputProps().ref.current = input;
        input.value = inputProps().value;
    };
    render();
    return {
        changes,
        input,
        draft: () => inputProps().value,
        tags: () => nodes(tree).filter(node => node.props?.className === 'meta-tag-chip-text')
            .map(node => node.props.children.join('')),
        type(next) {
            input.value = next;
            inputProps().onChange({ target: input, currentTarget: input });
            render();
        },
        startComposition() {
            inputProps().onCompositionStart?.({ target: input, currentTarget: input });
        },
        endComposition(next, renderNow = true) {
            input.value = next;
            inputProps().onCompositionEnd?.({ target: input, currentTarget: input });
            if (renderNow) render();
        },
        key(key, nativeEvent = {}) {
            const event = {
                key, nativeEvent, target: input, currentTarget: input, defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; },
            };
            inputProps().onKeyDown(event);
            render();
            return event;
        },
        blur() {
            inputProps().onBlur({ target: input, currentTarget: input });
            render();
        },
    };
}

test('Korean composition confirmation does not create a tag before the next Enter', () => {
    const h = fixture();
    h.startComposition();
    h.type('아오이 유우');
    h.key('Enter', { isComposing: true });
    assert.deepEqual(h.changes, []);
    assert.deepEqual(h.tags(), []);
    assert.equal(h.draft(), '아오이 유우');
    h.endComposition('아오이 유우');
    h.key('Enter');
    assert.deepEqual(h.changes, ['아오이 유우']);
    assert.deepEqual(h.tags(), ['아오이 유우']);
    assert.equal(h.draft(), '');
    h.blur();
    assert.deepEqual(h.changes, ['아오이 유우']);
});

test('composition ref protects Enter when the browser omits its composing flag', () => {
    const h = fixture();
    h.startComposition();
    h.type('아오이 유');
    h.key('Enter');
    assert.deepEqual(h.changes, []);
    assert.equal(h.draft(), '아오이 유');
    h.endComposition('아오이 유우');
    assert.equal(h.draft(), '아오이 유우');
    h.key('Enter');
    assert.deepEqual(h.tags(), ['아오이 유우']);
});

test('key code 229 after composition end does not commit or clear the completed name', () => {
    const h = fixture();
    h.startComposition();
    h.type('아오이 유');
    h.endComposition('아오이 유우');
    h.key('Enter', { keyCode: 229 });
    assert.deepEqual(h.changes, []);
    assert.equal(h.draft(), '아오이 유우');
    h.key('Enter');
    assert.deepEqual(h.tags(), ['아오이 유우']);
});

test('native composing events protect Enter and Backspace even without a composition start event', () => {
    const h = fixture('Existing');
    h.key('Backspace', { isComposing: true });
    assert.deepEqual(h.tags(), ['Existing']);
    assert.deepEqual(h.changes, []);
    h.type('아오이 유우');
    h.key('Enter', { isComposing: true });
    assert.deepEqual(h.changes, []);
    assert.equal(h.draft(), '아오이 유우');
});

test('Backspace during composition cannot remove an existing tag', () => {
    const h = fixture('Existing');
    h.startComposition();
    h.key('Backspace');
    assert.deepEqual(h.tags(), ['Existing']);
    assert.deepEqual(h.changes, []);
    h.endComposition('');
    h.key('Backspace');
    assert.deepEqual(h.tags(), []);
    assert.deepEqual(h.changes, ['']);
});

test('ordinary Enter, comma and blur commit the latest DOM value and deduplicate tags', () => {
    for (const trigger of ['Enter', ',', 'blur']) {
        const h = fixture('Existing');
        h.type('stale draft');
        h.input.value = ' Existing, 아오이 유우, 아오이 유우 ';
        if (trigger === 'blur') h.blur();
        else assert.equal(h.key(trigger).defaultPrevented, true);
        assert.deepEqual(h.tags(), ['Existing', '아오이 유우']);
        assert.deepEqual(h.changes, ['Existing, 아오이 유우']);
        assert.equal(h.draft(), '');
    }
});

test('blur immediately after composition end commits its final DOM value before a render', () => {
    const h = fixture('Existing');
    h.startComposition();
    h.type('아오이 유');
    h.endComposition('아오이 유우', false);
    h.blur();
    assert.deepEqual(h.tags(), ['Existing', '아오이 유우']);
    assert.deepEqual(h.changes, ['Existing, 아오이 유우']);
    assert.equal(h.draft(), '');
});

test('blur during composition waits for the final composed name and commits it once', () => {
    const h = fixture('Existing');
    h.startComposition();
    h.type('아오이 유');
    h.blur();
    assert.deepEqual(h.tags(), ['Existing']);
    assert.deepEqual(h.changes, []);
    assert.equal(h.draft(), '아오이 유');
    h.endComposition('아오이 유우');
    assert.deepEqual(h.tags(), ['Existing', '아오이 유우']);
    assert.deepEqual(h.changes, ['Existing, 아오이 유우']);
    assert.equal(h.draft(), '');
    h.blur();
    assert.deepEqual(h.changes, ['Existing, 아오이 유우']);
});
