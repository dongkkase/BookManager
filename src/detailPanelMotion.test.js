import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./components/folder/DetailPanel.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;

function fixture(initialReducedMotion = false) {
    const slots = [];
    let cursor = 0;
    let dirty = false;
    let reducedMotion = initialReducedMotion;
    let selectedFile = { full_path: '/books/first.cbz' };
    let tree;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
        memo: component => component,
        useCallback: callback => callback,
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
            return [slots[index].value, value => {
                slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
                dirty = true;
            }];
        },
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
        if (name === 'react') return react;
        if (name === '../../hooks/useReducedMotion') return { useReducedMotion: () => reducedMotion };
        if (name === '../../metadata/metadataTypes') return { resolveBookType: () => 'comic' };
        return {};
    });
    const render = () => {
        for (let pass = 0; pass < 10; pass += 1) {
            cursor = 0;
            dirty = false;
            tree = module.exports.DetailPanel({ selectedFile });
            if (!dirty) return tree.props.children;
        }
        assert.fail('Detail panel state did not settle');
    };
    render();
    return {
        layers: () => tree.props.children,
        select(path) { selectedFile = { full_path: path }; return render(); },
        setReducedMotion(value) { reducedMotion = value; return render(); },
        finish(layer) { layer.props.onExited(layer.props.id); return render(); },
    };
}

test('reduced motion replaces detail content without retaining an outgoing layer', () => {
    const value = fixture(true);
    for (const path of ['/books/second.cbz', '/books/third.cbz']) {
        const layers = value.select(path);
        assert.equal(layers.length, 1);
        assert.equal(layers[0].props.outgoing, false);
        assert.equal(layers[0].props.children.props.selectedFile.full_path, path);
    }
});

test('switching to reduced motion removes all previous detail layers immediately', () => {
    const value = fixture();
    value.select('/books/second.cbz');
    value.select('/books/third.cbz');
    const outgoing = value.layers()[1];
    assert.equal(value.layers().length, 3);
    value.setReducedMotion(true);
    assert.equal(value.layers().length, 1);
    assert.equal(value.layers()[0].props.children.props.selectedFile.full_path, '/books/third.cbz');
    value.finish(outgoing);
    assert.equal(value.layers().length, 1, 'A stale exit event cannot remove the active detail');
});

test('full motion retains the old detail until exit and can be restored after reduced mode', () => {
    const value = fixture(true);
    value.select('/books/second.cbz');
    value.setReducedMotion(false);
    value.select('/books/third.cbz');
    assert.equal(value.layers().length, 2);
    assert.equal(value.layers()[1].props.outgoing, true);
    value.finish(value.layers()[1]);
    assert.equal(value.layers().length, 1);
});
