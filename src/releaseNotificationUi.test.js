import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { releaseNotificationKey } from './releaseNotificationPolicy.js';
import { parseReleaseMarkdown } from './releasePolicy.js';

const compiled = transformSync(fs.readFileSync(new URL('./tabs/ReleaseTab.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' }).code;
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];

function fixture() {
    const slots = [];
    const effects = [];
    let cursor = 0;
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
            return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
        },
        useMemo: factory => factory(),
        useEffect: effect => effects.push(effect),
    };
    const listeners = new Map();
    const document = { visibilityState: 'visible', addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
    const mocks = {
        react,
        '../components/FaIcon': { FaIcon: 'FaIcon' },
        '../releasePolicy': { parseReleaseMarkdown },
        '../releaseNotificationPolicy': { releaseNotificationKey },
        '../styles/ReleaseTab.css': {},
    };
    const module = { exports: {} };
    new Function('module', 'exports', 'require', 'document', compiled)(module, module.exports, name => mocks[name], document);
    const items = [{ id: 'new', name: 'v3.9.1', date: '2026-09-15', publishedAt: '2026-09-15T00:00:00Z', body: 'New content' }];
    const viewed = [];
    const props = { t: key => key, isActive: true, releases: items, loading: false, loadError: '', unread: items, onViewed: items => viewed.push(items) };
    const render = updates => {
        Object.assign(props, updates);
        cursor = 0;
        const tree = module.exports.ReleaseTab(props);
        for (const effect of effects.splice(0)) effect();
        return nodes(tree);
    };
    return { render, viewed, document, listeners, items };
}

test('hidden tabs, loading screens and failed requests never mark releases as read', () => {
    const f = fixture();
    f.render({ isActive: false });
    f.render({ isActive: true, loading: true });
    f.render({ loading: false, loadError: 'Offline' });
    f.document.visibilityState = 'hidden';
    f.render({ loadError: '' });
    assert.equal(f.viewed.length, 0);
    f.document.visibilityState = 'visible';
    f.listeners.get('visibilitychange')();
    assert.deepEqual(f.viewed, [f.items]);
});

test('new article highlighting remains for the current visit after the tab badge is cleared', () => {
    const f = fixture();
    f.render();
    assert.deepEqual(f.viewed, [f.items]);
    let tree = f.render({ unread: [] });
    assert.ok(tree.find(node => node.type === 'article').props.className.includes('is-new'));
    assert.equal(tree.filter(node => node.props.className === 'release-new-badge').length, 1);
    f.render({ isActive: false });
    tree = f.render({ isActive: true });
    assert.equal(tree.find(node => node.type === 'article').props.className, 'release-card');
});
