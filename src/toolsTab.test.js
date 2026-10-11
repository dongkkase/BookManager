import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as fileTools from './fileTools.js';
import * as appShell from './appShell.js';

const compiled = transformSync(fs.readFileSync(new URL('./tabs/ToolsTab.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', target: 'es2022' }).code;
const nodes = node => node && typeof node === 'object'
    ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
    const originalWindow = globalThis.window;
    const originalCustomEvent = globalThis.CustomEvent;
    const slots = [];
    const listeners = new Map();
    const telemetry = [];
    const props = { config: { folder_cover_editor_options: { backup: true } }, saveConfig() {}, t: key => key, onOpenTab() {}, showToast() {} };
    let cursor = 0;
    let effects = [];
    let tree;
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, properties, ...children) => ({ type, props: { ...properties, children } }),
        Suspense: 'Suspense',
        lazy: load => ({ load }),
        useState(initial) {
            const index = cursor++;
            slots[index] ??= { value: initial };
            return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }];
        },
        useRef(initial) { return slots[cursor++] ??= { current: initial }; },
        useCallback(callback, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: callback, deps };
            return slots[index].value;
        },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!slots[index] || !same(slots[index].deps, deps)) {
                const previous = slots[index];
                slots[index] = { deps };
                effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
            }
        },
    };
    globalThis.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
    globalThis.window = {
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
        removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
        dispatchEvent(event) { for (const callback of [...(listeners.get(event.type) || [])]) callback(event); },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'exports', compiled)(name => {
        if (name === 'react') return react;
        if (name === '../fileTools') return fileTools;
        if (name === '../appShell') return appShell;
        if (name === '../telemetry.js') return { trackTelemetry: (...args) => telemetry.push(args) };
        if (name === '../components/FaIcon') return { FaIcon: 'FaIcon' };
        if (name.endsWith('.css')) return {};
        throw new Error(`Unexpected import ${name}`);
    }, module, module.exports);
    const render = () => {
        cursor = 0;
        effects = [];
        tree = module.exports.default(props);
        effects.forEach(effect => effect());
    };
    render();
    t.after(() => {
        slots.forEach(slot => slot.cleanup?.());
        globalThis.window = originalWindow;
        globalThis.CustomEvent = originalCustomEvent;
    });
    return {
        props,
        telemetry,
        tool: () => nodes(tree).find(node => node.type?.load),
        async flush() { await tick(); render(); },
        async catalog(toolId) {
            await nodes(tree).find(node => node.props?.tool?.id === toolId).props.onOpenTool(toolId);
            render();
        },
        async action(detail) {
            window.dispatchEvent(new CustomEvent('bookmanager:action', { detail: { activeTab: 'tools', action: 'load-paths', ...detail } }));
            await tick();
            render();
        },
    };
}

test('표지 편집의 명시 요청과 후속 드롭은 설정·여러 파일·추가/교체 요청을 전달한다', async t => {
    const app = fixture(t);
    await app.action({ paths: ['/books/ignored.cbz'] });
    assert.equal(app.tool(), undefined);
    await app.action({ toolId: 'cover-editor', paths: ['/books/a.cbz', '/books/b.epub'], mode: 'replace', source: 'folder' });
    assert.match(String(app.tool().type.load), /coverEditor/);
    assert.equal(app.tool().props.config, app.props.config);
    assert.equal(app.tool().props.saveConfig, app.props.saveConfig);
    assert.deepEqual(app.tool().props.openRequest, { paths: ['/books/a.cbz', '/books/b.epub'], mode: 'replace', source: 'folder', token: 1 });
    let leaves = 0;
    app.tool().props.registerBeforeLeave(() => { leaves += 1; return false; });
    await app.action({ action: 'drop-paths', paths: ['/books/c.pdf'] });
    assert.deepEqual(app.tool().props.openRequest, { paths: ['/books/c.pdf'], mode: 'append', token: 2 });
    assert.equal(leaves, 0);
    assert.deepEqual(app.telemetry, [['tool_opened', { tool: 'cover-editor', source: 'navigation' }]]);
});

test('다른 도구를 열기 전 비동기 이탈 보호가 완료되어야 하며 거절되면 편집을 유지한다', async t => {
    const app = fixture(t);
    await app.catalog('epub-editor');
    let allow;
    const cleanup = app.tool().props.registerBeforeLeave(() => new Promise(resolve => { allow = resolve; }));
    await app.action({ toolId: 'cover-editor', paths: ['/books/a.cbz'] });
    assert.match(String(app.tool().type.load), /epubEditor/);
    allow(false);
    await app.flush();
    assert.match(String(app.tool().type.load), /epubEditor/);
    await app.action({ toolId: 'cover-editor', paths: ['/books/a.cbz'] });
    allow(true);
    await app.flush();
    cleanup();
    assert.match(String(app.tool().type.load), /coverEditor/);
    assert.equal(app.tool().props.openRequest.token, 1);
    assert.deepEqual(app.telemetry.map(item => item[1].tool), ['epub-editor', 'cover-editor']);
});

test('목적 도구가 없는 전달은 활성 텍본 정리기를 유지하며 표지 편집 전환은 보호된다', async t => {
    const app = fixture(t);
    await app.catalog('text-cleaner');
    await app.action({ action: 'drop-paths', paths: ['/books/ignored.cbz', '/books/read.txt'] });
    assert.match(String(app.tool().type.load), /TextCleanerTool/);
    assert.equal(app.tool().props.openRequest.path, '/books/read.txt');
    await app.action({ toolId: 'cover-editor', paths: ['/books/a.cbz'] });
    const cleanup = app.tool().props.registerBeforeLeave(() => false);
    await app.action({ toolId: 'text-cleaner', paths: ['/books/next.txt'] });
    assert.match(String(app.tool().type.load), /coverEditor/);
    cleanup();
    await app.action({ toolId: 'text-cleaner', paths: ['/books/next.txt'] });
    assert.match(String(app.tool().type.load), /TextCleanerTool/);
    assert.equal(app.tool().props.openRequest.path, '/books/next.txt');
});
