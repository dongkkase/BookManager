import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { BUILTIN_CSS_PRESETS, applyCssPreset, validateCssPreset, MAX_CSS_LENGTH } from './epubEditor/cssPresets.js';
import { inspectCss } from './epubEditor/css.js';

const sample = { name: '자주 쓰는 인용', description: '밝은 배경', css: 'blockquote { background-color: #f0f4f0; }' };
async function setup(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-css-presets-'));
    const service = new EpubEditorService(root);
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, service };
}

test('CSS presets persist across service restarts and projects, with durable rename and delete', async t => {
    const { root, service } = await setup(t);
    assert.deepEqual(await service.cssPresets(), { version: 1, revision: 0, presets: [] });
    let library = await service.changeCssPreset(sample, 0);
    const id = library.selectedId;
    assert.match(id, /^css_/);
    assert.equal(library.presets[0].css, sample.css);
    const first = await service.create(1, 'blank', 'ko');
    const second = await service.create(2, 'blank', 'ko');
    await service.close(1, first.sessionId);
    await service.close(2, second.sessionId);
    const reopened = new EpubEditorService(root);
    assert.deepEqual((await reopened.cssPresets()).presets, library.presets);
    library = await reopened.changeCssPreset({ ...sample, id, name: ' 새 인용 ', css: 'blockquote { margin: 2em; }' }, library.revision);
    assert.equal(library.presets[0].name, '새 인용');
    assert.equal(library.presets[0].id, id);
    assert.equal((await service.cssPresets()).presets[0].css, 'blockquote { margin: 2em; }');
    library = await service.changeCssPreset({ id }, library.revision, true);
    assert.equal(library.presets.length, 0);
    assert.equal((await reopened.cssPresets()).presets.length, 0);
    assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('concurrent preset updates reject stale revisions instead of overwriting another window', async t => {
    const { service } = await setup(t);
    const results = await Promise.allSettled([
        service.changeCssPreset(sample, 0),
        service.changeCssPreset({ ...sample, name: '다른 창의 프리셋' }, 0),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PRESET_CONFLICT');
    let library = await service.cssPresets();
    await assert.rejects(service.changeCssPreset({ ...sample, name: ` ${sample.name} ` }, library.revision), { code: 'PRESET_NAME_EXISTS' });
    await assert.rejects(service.changeCssPreset({ id: library.presets[0].id }, 0, true), { code: 'PRESET_CONFLICT' });
    await assert.rejects(service.changeCssPreset({ ...sample, id: 'css_00000000-0000-0000-0000-000000000000' }, library.revision), { code: 'PRESET_MISSING' });
    library = await service.changeCssPreset({ ...sample, name: '두 번째 프리셋' }, library.revision);
    assert.equal(library.presets.length, 2);
});

test('invalid CSS, external resources, invalid names and oversize drafts cannot enter the preset library', async t => {
    const { service } = await setup(t);
    for (const [patch, code] of [
        [{ name: '' }, 'PRESET_INVALID'], [{ name: 'x'.repeat(81) }, 'PRESET_INVALID'],
        [{ description: 'x'.repeat(241) }, 'PRESET_INVALID'], [{ css: '' }, 'PRESET_INVALID'],
        [{ css: 'p {' }, 'CSS_INVALID'], [{ css: 'p { color:; }' }, 'CSS_INVALID'],
        [{ css: '@import "https://example.com/style.css";' }, 'CSS_RESOURCE'],
        [{ css: 'p { background: url(https://example.com/a.png); }' }, 'CSS_RESOURCE'],
        [{ css: ' '.repeat(MAX_CSS_LENGTH) + 'p{}' }, 'PRESET_INVALID'],
        [{ id: '../outside' }, 'PRESET_INVALID'],
    ]) await assert.rejects(service.changeCssPreset({ ...sample, ...patch }, 0), { code });
    assert.equal((await service.cssPresets()).revision, 0);
});

test('corrupt preset storage is reported and never silently replaced with an empty library', async t => {
    const { root, service } = await setup(t);
    const file = path.join(root, 'css-presets.json');
    for (const content of ['{bad JSON', JSON.stringify({ version: 99, revision: 0, presets: [] }), JSON.stringify({ version: 1, revision: 0, presets: [sample] })]) {
        await fs.writeFile(file, content);
        await assert.rejects(service.cssPresets(), { code: 'PRESET_LIBRARY_INVALID' });
        await assert.rejects(service.changeCssPreset(sample, 0), { code: 'PRESET_LIBRARY_INVALID' });
        assert.equal(await fs.readFile(file, 'utf8'), content);
    }
});

test('built-in CSS is self-contained and append preserves existing code while replace is explicit', () => {
    for (const item of BUILTIN_CSS_PRESETS) {
        assert.equal(inspectCss(item.css).error, null, item.id);
        validateCssPreset({ name: item.id, description: '', css: item.css });
    }
    const original = '/* 기존 CSS */\np { color: #112233; }\n';
    assert.equal(applyCssPreset(original, sample.css), `${original.trimEnd()}\n\n${sample.css}`);
    assert.equal(applyCssPreset(original, sample.css, 'replace'), sample.css);
    assert.equal(applyCssPreset('', sample.css), sample.css);
    assert.throws(() => applyCssPreset('p {', sample.css), { code: 'CSS_INVALID' });
    assert.equal(applyCssPreset('p {', sample.css, 'replace'), sample.css);
    assert.throws(() => applyCssPreset('/*' + 'x'.repeat(MAX_CSS_LENGTH - 4) + '*/', sample.css), { code: 'CSS_TOO_LARGE' });
    assert.throws(() => applyCssPreset(original, '@import "bad.css";'), { code: 'CSS_RESOURCE' });
});

test('preset IPC exposes list, save and delete with structured errors', async t => {
    const { root } = await setup(t);
    let handler;
    const sender = new EventEmitter();
    Object.assign(sender, { id: 41, isDestroyed: () => false, send: () => {} });
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (name, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null }, dialog: {} });
    t.after(() => controller.dispose());
    assert.equal((await handler({ sender }, { action: 'cssPresetList' })).revision, 0);
    const saved = await handler({ sender }, { action: 'cssPresetSave', preset: sample, revision: 0 });
    assert.equal(saved.ok, true);
    const conflict = await handler({ sender }, { action: 'cssPresetDelete', presetId: saved.selectedId, revision: 0 });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, 'PRESET_CONFLICT');
    const removed = await handler({ sender }, { action: 'cssPresetDelete', presetId: saved.selectedId, revision: saved.revision });
    assert.equal(removed.ok, true);
    assert.equal(removed.presets.length, 0);
});
