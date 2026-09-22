import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { builtinContentTemplates, prepareTemplateContent, validateContentTemplate, templateAssetIds, TEMPLATE_CHAPTER, MAX_TEMPLATE_BYTES } from './epubEditor/contentTemplates.js';
import { paragraph, inspectProject, assetFilename, walkDocument } from './epubEditor/model.js';

const sample = () => ({ name: '나의 인용', description: '인용과 출처', content: { type: 'doc', content: [paragraph('인용문'), paragraph('출처')] }, assets: [] });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const mp3 = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYyLjEyLjEwMgAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAykAWlpaWlpaWlpaWlpaWlpaWnt7e3t7e3t7e3t7e3t7e3t7nJycnJycnJycnJycnJycnL29vb29vb29vb29vb29vb293t7e3t7e3t7e3t7e3t7e3t7/////////////////////AAAAAExhdmM2Mi4yOAAAAAAAAAAAAAAAACQCowAAAAAAAAMp//YTsAAAAAAAAAAAAAAAAAD/80DEABQgXpBfTxgAAafbb/hD0PQ9D0PV8dsVhpkHELBzg5xDy5qN/EpR5EBAMQfB8/lOXP8o6c6fOcu/hjl3850+7KAmD4Pg+D4IAgCAIAMHw+XD4IBioBg/wQ6VvUSgwwYEAYEAgP/zQsQKFvEaqZ+aUAIAE0i42ioDybiYcMFMsYMoGg4LPgjkkMTOpw2IZ/QDQBIBX8JQDQBb8QINoNorf4ihFEI9Hv/isIoRRCLIiSL+DQlCQNN/yoSBoShIGhL//Oh1xelFVTEgAHDAX//zQMQKFaiOHAHfEAAByMB7CbjA+QeQwfEC8MFzDoDFTxNo3UUp3MWYEEyIOBMBDAPDAfwI4wEMAHMAoAITADQA4vOJAANn///68AY3/Ufc3/L//Z///7f/ShKq645JBn3CpOMrEQbi//NCxA4RoFZYf10QAqDphmEJiANhj0DR94TxkCIIoCAOARABBtrG/Yqg4kPp1DGMZ7Gtasq/1VfR2/+noln9f5Htt2f+uqwFA2HA4HA4BAwANrYl6bQOog7s8oJlS8xo9LwyTEHhHfF4//NAxCMcecKdvZqYAi0MIgtS4yaJPgeSAKNDQuV0TcDWAGzob959k3Cw4Miiyg1d+m9xCUcoUEMaR397vuMsPkjCBEqRhS///KZMFImyYOF8uGH/8uCAOGQwBDMKewBAWud8uqXZXwb/80LEDBMI2kAJ2EgAWB3wAmtosMqZiUnYCXBLMtstFIlgtJDVG4KwoFFQyysimIQRJrZyUrQilq4+UvFCesKgt1//4ixEo9UeZlvPdKpMQU1FNC4wqqqqqqqqqqqqqqqqqqqqqqqqqqo=', 'base64');
async function setup(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-templates-'));
    const service = new EpubEditorService(root);
    const session = await service.create(1, 'blank', 'ko');
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return { root, service, ...session };
}

test('ten built-in layouts are valid editable EPUB documents in all three languages', () => {
    for (const language of ['ko', 'en', 'ja']) {
        const templates = builtinContentTemplates(language);
        assert.equal(templates.length, 10);
        assert.equal(new Set(templates.map(item => item.id)).size, 10);
        for (const item of templates) validateContentTemplate({ ...item, id: undefined });
    }
});

test('templates retain body edits, names and descriptions across restarts and support deletion', async t => {
    const { root, service, sessionId } = await setup(t);
    assert.deepEqual(await service.contentTemplates(), { version: 1, revision: 0, templates: [] });
    let library = await service.saveContentTemplate(1, sessionId, sample(), 0);
    const id = library.selectedId;
    assert.match(id, /^tpl_/);
    const changed = { ...library.templates[0], name: '수정된 인용', description: '새 설명', content: { type: 'doc', content: [paragraph('새 본문')] } };
    library = await service.saveContentTemplate(1, sessionId, changed, library.revision);
    const reopened = new EpubEditorService(root);
    t.after(() => reopened.dispose());
    assert.deepEqual((await reopened.contentTemplates()).templates[0], changed);
    await service.deleteContentTemplate(id, library.revision);
    assert.equal((await reopened.contentTemplates()).templates.length, 0);
    assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('stale concurrent mutations and insertions fail without overwriting templates', async t => {
    const { service, sessionId } = await setup(t);
    const results = await Promise.allSettled([service.saveContentTemplate(1, sessionId, sample(), 0), service.saveContentTemplate(1, sessionId, { ...sample(), name: '다른 창' }, 0)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'TEMPLATE_CONFLICT');
    const library = await service.contentTemplates();
    await assert.rejects(service.deleteContentTemplate(library.templates[0].id, 0), { code: 'TEMPLATE_CONFLICT' });
    await assert.rejects(service.importContentTemplate(1, sessionId, library.templates[0].id, 0), { code: 'TEMPLATE_CONFLICT' });
    await assert.rejects(service.saveContentTemplate(1, sessionId, { ...sample(), name: ` ${library.templates[0].name} ` }, library.revision), { code: 'TEMPLATE_NAME_EXISTS' });
});

test('formatted selections save, edit and import with mixed non-font marks intact', async t => {
    const { service, sessionId } = await setup(t);
    const marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'highlight', attrs: { preset: 'yellowMarker' } }, { type: 'superscript' }, { type: 'textStyle', attrs: { color: '#123456', backgroundColor: '#ffeedd' } }, { type: 'inlineStyle', attrs: { preset: 'small' } }, { type: 'link', attrs: { href: 'https://example.com' } }];
    const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockStyle: 'note' }, content: [{ type: 'text', text: '선택한 서식', marks }] }] };
    let library = await service.saveContentTemplate(1, sessionId, { ...sample(), content }, 0);
    const stored = library.templates[0];
    assert.deepEqual(stored.content, content);
    library = await service.saveContentTemplate(1, sessionId, { ...stored, name: '수정한 서식' }, library.revision);
    const target = await service.create(2, 'blank', 'ko');
    const imported = await service.importContentTemplate(2, target.sessionId, stored.id, library.revision);
    assert.deepEqual(imported.content, content);
});

test('invalid, oversized and missing-reference templates never enter storage', async t => {
    const { service, sessionId } = await setup(t);
    for (const [patch, code] of [
        [{ name: ' ' }, 'TEMPLATE_INVALID'], [{ name: 'x'.repeat(81) }, 'TEMPLATE_INVALID'], [{ description: 'x'.repeat(241) }, 'TEMPLATE_INVALID'],
        [{ id: '../../outside' }, 'TEMPLATE_INVALID'], [{ content: { type: 'doc', content: [paragraph('x'.repeat(MAX_TEMPLATE_BYTES))] } }, 'TEMPLATE_TOO_LARGE'],
        [{ content: { type: 'doc', content: [{ type: 'script' }] } }, 'INVALID_DOCUMENT'],
        [{ content: { type: 'doc', content: [{ type: 'image', attrs: { assetId: 'a_missing', width: 100, align: 'center' } }] } }, 'ASSET_MISSING'],
        [{ content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } }, 'INVALID_LINK'],
    ]) await assert.rejects(service.saveContentTemplate(1, sessionId, { ...sample(), ...patch }, 0), { code });
    assert.equal((await service.contentTemplates()).revision, 0);
    await assert.rejects(service.saveContentTemplate(2, sessionId, sample(), 0), { code: 'SESSION_CLOSED' });
});

test('corrupt storage is preserved rather than replaced during save or delete', async t => {
    const { root, service, sessionId } = await setup(t);
    const file = path.join(root, 'content-templates.json');
    for (const data of ['{invalid', JSON.stringify({ version: 99, revision: 0, templates: [] }), JSON.stringify({ version: 1, revision: 0, templates: [sample()] })]) {
        await fs.writeFile(file, data);
        await assert.rejects(service.saveContentTemplate(1, sessionId, sample(), 0), { code: 'TEMPLATE_LIBRARY_INVALID' });
        await assert.rejects(service.deleteContentTemplate('tpl_missing', 0), { code: 'TEMPLATE_LIBRARY_INVALID' });
        assert.equal(await fs.readFile(file, 'utf8'), data);
    }
});

test('embedded image, audio and font files travel to another book and survive source/template deletion', async t => {
    const { root, service, sessionId } = await setup(t);
    const imageFile = path.join(root, 'image.png');
    const fontFile = path.join(root, 'font.otf');
    const audioFile = path.join(root, 'sound.mp3');
    await fs.writeFile(audioFile, mp3);
    await fs.writeFile(imageFile, png);
    await fs.writeFile(fontFile, Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]));
    const image = (await service.addAsset(1, sessionId, imageFile)).asset;
    const font = (await service.addAsset(1, sessionId, fontFile)).asset;
    const audio = (await service.addAsset(1, sessionId, audioFile)).asset;
    const item = { ...sample(), content: { type: 'doc', content: [
        { type: 'image', attrs: { assetId: image.id, alt: '작은 이미지', width: 80, align: 'center', caption: '그림 설명' } },
        { type: 'audio', attrs: { assetId: audio.id, title: '효과음', kind: 'effect', loop: false } },
        { type: 'paragraph', content: [{ type: 'text', text: '글꼴', marks: [{ type: 'textStyle', attrs: { fontFamily: `font-${font.id}`, color: '#112233' } }] }] },
    ] } };
    let library = await service.saveContentTemplate(1, sessionId, item, 0);
    const stored = library.templates[0];
    assert.equal(stored.assets.length, 3);
    assert.ok(stored.assets.every(asset => ![image.id, audio.id, font.id].includes(asset.id)));
    assert.deepEqual(templateAssetIds(stored.content), new Set(stored.assets.map(asset => asset.id)));
    const originalDirectory = service.session(sessionId, 1).directory;
    await service.close(1, sessionId);
    await fs.rm(originalDirectory, { recursive: true });
    const target = await service.create(2, 'blank', 'ko');
    const imported = await service.importContentTemplate(2, target.sessionId, stored.id, library.revision);
    target.project.assets = imported.assets;
    target.project.chapters[0].content = prepareTemplateContent(imported.content, TEMPLATE_CHAPTER, target.project.chapters[0].id).content;
    target.project.revision++;
    assert.equal(inspectProject(target.project).some(issue => issue.severity === 'error'), false);
    await service.recovery(2, target.sessionId, target.project);
    library = await service.deleteContentTemplate(stored.id, library.revision);
    assert.deepEqual(await fs.readdir(path.join(root, 'template-assets')), []);
    const importedImage = imported.assets.find(asset => asset.kind === 'image');
    assert.deepEqual((await service.asset(2, target.sessionId, importedImage.id)).data, png);
    assert.deepEqual((await service.asset(2, target.sessionId, imported.assets.find(asset => asset.kind === 'audio').id)).data, mp3);
    const saved = path.join(root, 'target.bmepub');
    await service.write(2, target.sessionId, target.project, saved, 'save', 'save');
    const reopened = await service.open(3, saved, 'open');
    assert.deepEqual(reopened.project.chapters[0].content, target.project.chapters[0].content);
    await service.write(3, reopened.sessionId, reopened.project, path.join(root, 'target.epub'), 'export', 'export');
});

test('duplicated templates share immutable resources until the last reference is deleted', async t => {
    const { root, service, sessionId } = await setup(t);
    const file = path.join(root, 'image.png');
    await fs.writeFile(file, png);
    const { asset } = await service.addAsset(1, sessionId, file);
    let library = await service.saveContentTemplate(1, sessionId, { ...sample(), content: { type: 'doc', content: [{ type: 'image', attrs: { assetId: asset.id, width: 100, align: 'left', alt: 'image' } }] } }, 0);
    const first = library.templates[0];
    library = await service.saveContentTemplate(1, sessionId, { ...first, id: undefined, name: 'Copy' }, library.revision, first.id);
    const second = library.templates.find(item => item.id !== first.id);
    assert.equal(second.assets[0].id, first.assets[0].id);
    library = await service.deleteContentTemplate(first.id, library.revision);
    assert.deepEqual((await service.contentTemplateAsset(second.id, second.assets[0].id)).data, png);
    await service.saveContentTemplate(1, sessionId, { ...sample(), id: second.id, name: 'Now text only' }, library.revision);
    assert.deepEqual(await fs.readdir(path.join(root, 'template-assets')), []);
});

test('asset-copy failures roll back files and leave the previous library and project catalog intact', async t => {
    const { root, service, sessionId } = await setup(t);
    const file = path.join(root, 'image.png');
    await fs.writeFile(file, png);
    const first = (await service.addAsset(1, sessionId, file)).asset;
    const second = (await service.addAsset(1, sessionId, file)).asset;
    const item = { ...sample(), content: { type: 'doc', content: [first, second].map(asset => ({ type: 'image', attrs: { assetId: asset.id, width: 100, align: 'center' } })) } };
    const library = await service.saveContentTemplate(1, sessionId, item, 0);
    const stored = library.templates[0];
    await fs.unlink(path.join(root, 'template-assets', assetFilename(stored.assets[1])));
    const target = await service.create(2, 'blank', 'ko');
    await assert.rejects(service.importContentTemplate(2, target.sessionId, stored.id, library.revision), { code: 'ASSET_MISSING' });
    assert.equal(service.session(target.sessionId, 2).catalog.size, 0);
    assert.deepEqual(await fs.readdir(service.session(target.sessionId, 2).assetDirectory), []);
    const before = await fs.readFile(path.join(root, 'content-templates.json'), 'utf8');
    await fs.unlink(path.join(service.session(sessionId, 1).assetDirectory, assetFilename(second)));
    await assert.rejects(service.saveContentTemplate(1, sessionId, { ...item, name: 'Failed copy' }, library.revision), { code: 'ASSET_MISSING' });
    assert.equal(await fs.readFile(path.join(root, 'content-templates.json'), 'utf8'), before);
    assert.deepEqual(await fs.readdir(path.join(root, 'template-assets')), [assetFilename(stored.assets[0])]);
});

test('repeated insertion regenerates anchors and footnotes while retaining portable links', () => {
    const content = { type: 'doc', content: [
        { type: 'heading', attrs: { id: 'n_heading', level: 2 }, content: [{ type: 'text', text: '제목' }] },
        { type: 'paragraph', content: [
            { type: 'text', text: 'inside', marks: [{ type: 'link', attrs: { href: 'epub:c_source#n_heading' } }] },
            { type: 'text', text: 'outside', marks: [{ type: 'link', attrs: { href: 'epub:c_other#n_heading' } }] },
            { type: 'text', text: 'web', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
            { type: 'footnote', attrs: { id: 'n_note', text: '각주 내용' } },
        ] },
    ] };
    const prepared = prepareTemplateContent(content, 'c_source');
    assert.equal(prepared.removedLinks, 1);
    validateContentTemplate({ ...sample(), content: prepared.content });
    const a = prepareTemplateContent(prepared.content, TEMPLATE_CHAPTER, 'c_target').content;
    const b = prepareTemplateContent(prepared.content, TEMPLATE_CHAPTER, 'c_target').content;
    const ids = new Set();
    for (const item of [a, b]) {
        assert.equal(item.content[1].content[0].marks[0].attrs.href, `epub:c_target#${item.content[0].attrs.id}`);
        assert.equal(item.content[1].content[1].marks.length, 0);
        assert.equal(item.content[1].content[2].marks[0].attrs.href, 'https://example.com');
        walkDocument(item, node => { if (node.attrs?.id) { assert.equal(ids.has(node.attrs.id), false); ids.add(node.attrs.id); } });
    }
    assert.equal(content.content[0].attrs.id, 'n_heading');
});

test('IPC supports template CRUD and import with session ownership and structured conflicts', async t => {
    const { root } = await setup(t);
    let handler;
    const sender = new EventEmitter();
    Object.assign(sender, { id: 41, isDestroyed: () => false, send: () => {} });
    const controller = registerEpubEditorIpc({ ipcMain: { handle: (name, fn) => { handler = fn; } }, app: { getPath: () => root }, BrowserWindow: { fromWebContents: () => null }, dialog: {} });
    t.after(() => controller.dispose());
    const session = await handler({ sender }, { action: 'create', template: 'blank', language: 'ko' });
    const saved = await handler({ sender }, { action: 'templateSave', sessionId: session.sessionId, template: sample(), revision: 0 });
    assert.equal(saved.ok, true);
    const imported = await handler({ sender }, { action: 'templateImport', sessionId: session.sessionId, templateId: saved.selectedId, revision: saved.revision });
    assert.equal(imported.ok, true);
    const conflict = await handler({ sender }, { action: 'templateDelete', templateId: saved.selectedId, revision: 0 });
    assert.equal(conflict.error.code, 'TEMPLATE_CONFLICT');
    const removed = await handler({ sender }, { action: 'templateDelete', templateId: saved.selectedId, revision: saved.revision });
    assert.equal(removed.templates.length, 0);
});
