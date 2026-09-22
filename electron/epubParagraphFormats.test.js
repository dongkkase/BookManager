import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { MAX_PARAGRAPH_FORMAT_BYTES, normalizeParagraphFormat, paragraphFormatCss } from './epubEditor/paragraphFormats.js';
import { createProject, validateProject } from './epubEditor/model.js';

const sample = { name: '장 제목', base: 'heading2', fontSize: 28, color: '#123456', alignment: 'center' };
async function setup(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-paragraph-formats-'));
    const service = new EpubEditorService(root);
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, service };
}

test('paragraph format CRUD persists across books and service restarts', async t => {
    const { root, service } = await setup(t);
    assert.deepEqual(await service.paragraphFormats(), { version: 1, revision: 0, formats: [] });
    let library = await service.changeParagraphFormat(sample, 0);
    const id = library.selectedId;
    assert.match(id, /^pf_/);
    const first = await service.create(1, 'blank', 'ko');
    const second = await service.create(2, 'blank', 'ko');
    await service.close(1, first.sessionId);
    await service.close(2, second.sessionId);
    const restarted = new EpubEditorService(root);
    t.after(() => restarted.dispose());
    assert.deepEqual((await restarted.paragraphFormats()).formats, library.formats);
    library = await restarted.changeParagraphFormat({ ...sample, id, name: ' 새 제목 ', fontSize: 32 }, library.revision);
    assert.equal(library.formats[0].name, '새 제목');
    assert.equal((await service.paragraphFormats()).formats[0].fontSize, 32);
    library = await service.changeParagraphFormat({ id }, library.revision, true);
    assert.equal(library.formats.length, 0);
    assert.equal((await restarted.paragraphFormats()).formats.length, 0);
    assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('concurrent edits, duplicate names and missing formats cannot overwrite the library', async t => {
    const { service } = await setup(t);
    const results = await Promise.allSettled([service.changeParagraphFormat(sample, 0), service.changeParagraphFormat({ ...sample, name: 'Other' }, 0)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PARAGRAPH_FORMAT_CONFLICT');
    const library = await service.paragraphFormats();
    await assert.rejects(service.changeParagraphFormat({ ...sample, name: ` ${library.formats[0].name} ` }, library.revision), { code: 'PARAGRAPH_FORMAT_NAME_EXISTS' });
    await assert.rejects(service.changeParagraphFormat({ id: library.formats[0].id }, 0, true), { code: 'PARAGRAPH_FORMAT_CONFLICT' });
    await assert.rejects(service.changeParagraphFormat({ ...sample, id: 'pf_00000000-0000-0000-0000-000000000000' }, library.revision), { code: 'PARAGRAPH_FORMAT_MISSING' });
    assert.deepEqual(await service.paragraphFormats(), library);
});

test('invalid and unsafe format values are rejected without changing storage or accepting invalid project attributes', async t => {
    const { service } = await setup(t);
    const id = 'pf_00000000-0000-0000-0000-000000000001';
    for (const patch of [{ name: '' }, { name: 'x'.repeat(81) }, { description: 'x'.repeat(241) }, { base: 'script' }, { font: 'url(file:///tmp/font)' }, { fontSize: 9 }, { fontSize: 72.5 }, { color: '#123456;display:none' }, { backgroundColor: 'url(x)' }, { lineHeight: Infinity }, { spaceBefore: -1 }, { spaceAfter: 6 }, { bold: 'true' }, { alignment: 'invalid' }, { indentLevel: 9 }, { firstLineIndent: -4 }, { id: '../outside' }, { css: 'p{}' }]) {
        await assert.rejects(service.changeParagraphFormat({ ...sample, ...patch }, 0), { code: 'PARAGRAPH_FORMAT_INVALID' });
        const project = createProject();
        project.chapters[0].content.content[0].attrs = { paragraphFormat: { ...sample, id, ...patch } };
        assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
    }
    assert.equal((await service.paragraphFormats()).revision, 0);
    assert.equal(paragraphFormatCss({ name: 'Plain' }), '');
    const project = createProject();
    project.chapters[0].content.content = [{ type: 'horizontalRule', attrs: { paragraphFormat: normalizeParagraphFormat({ ...sample, id }, true) } }];
    assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
});

test('corrupt or oversized storage is preserved, and the library enforces its entry limit', async t => {
    const { root, service } = await setup(t);
    const file = path.join(root, 'paragraph-formats.json');
    for (const data of ['{bad JSON', JSON.stringify({ version: 1, revision: 0, formats: [sample] }), ' '.repeat(MAX_PARAGRAPH_FORMAT_BYTES + 1)]) {
        await fs.writeFile(file, data);
        await assert.rejects(service.changeParagraphFormat(sample, 0), { code: 'PARAGRAPH_FORMAT_LIBRARY_INVALID' });
        assert.equal(await fs.readFile(file, 'utf8'), data);
    }
    const formats = Array.from({ length: 100 }, (_, index) => normalizeParagraphFormat({ ...sample, id: `pf_00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, name: `Format ${index}` }, true));
    await fs.writeFile(file, JSON.stringify({ version: 1, revision: 100, formats }));
    await assert.rejects(service.changeParagraphFormat(sample, 100), { code: 'PARAGRAPH_FORMAT_LIMIT' });
    assert.equal((await service.changeParagraphFormat({ ...formats[0], name: 'Renamed' }, 100)).formats.length, 100);
});

test('paragraph format IPC exposes list, save, delete and structured conflict errors', async t => {
    const { root } = await setup(t);
    let handler;
    const sender = new EventEmitter();
    Object.assign(sender, { id: 41, isDestroyed: () => false, send: () => {} });
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (name, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null }, dialog: {} });
    t.after(() => controller.dispose());
    assert.equal((await handler({ sender }, { action: 'paragraphFormatList' })).revision, 0);
    const saved = await handler({ sender }, { action: 'paragraphFormatSave', format: sample, revision: 0 });
    assert.equal(saved.ok, true);
    const stale = await handler({ sender }, { action: 'paragraphFormatDelete', formatId: saved.selectedId, revision: 0 });
    assert.equal(stale.error.code, 'PARAGRAPH_FORMAT_CONFLICT');
    const removed = await handler({ sender }, { action: 'paragraphFormatDelete', formatId: saved.selectedId, revision: saved.revision });
    assert.equal(removed.ok, true);
    assert.deepEqual(removed.formats, []);
});
