import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const compiled = transformSync(fs.readFileSync(new URL('./components/AppLockOverlay.jsx', import.meta.url), 'utf8'), {
    loader: 'jsx', format: 'cjs', target: 'es2022',
}).code;
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];

test('working and indexing overlays replace animated imagery while keeping the current task visible', () => {
    let reducedMotion = false;
    const module = { exports: {} };
    const mocks = {
        react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
        './CoverArtwork': { CoverArtwork: 'CoverArtwork' },
        '../hooks/useReducedMotion': { useReducedMotion: () => reducedMotion },
        '../images/app.png': 'static-app.png',
        '../images/rainbow cat remix.gif': 'animated-cat.gif',
    };
    new Function('module', 'exports', 'require', compiled)(module, module.exports, name => mocks[name]);
    for (const useLibraryScanSlide of [false, true]) {
        const props = {
            isAppLocked: true, useLibraryScanSlide, lockIsLibraryIndexing: true, lockThumbnailItems: [],
            lockAriaLabel: 'Processing', lockCurrentItem: '/books/book.cbz', lockCurrentItemName: 'book.cbz', lockMessage: 'Processing 2/5',
        };
        for (const reduced of [false, true, false]) {
            reducedMotion = reduced;
            const tree = module.exports.AppLockOverlay(props);
            const elements = nodes(tree);
            assert.equal(elements.find(node => node.type === 'img').props.src, reduced ? 'static-app.png' : 'animated-cat.gif');
            assert.equal(tree.props.role, 'status');
            assert.ok(elements.some(node => node.props.children?.includes('Processing 2/5')));
            assert.ok(elements.some(node => node.props.children?.includes('book.cbz')));
        }
    }
});
