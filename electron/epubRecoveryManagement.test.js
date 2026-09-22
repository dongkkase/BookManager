import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { EpubEditorService } from './epubEditor/service.js';
import { registerEpubEditorIpc } from './epubEditor/ipc.js';
import { assetFilename, paragraph, validateProject } from './epubEditor/model.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const font = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(16)]);

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-recovery-management-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const state = await service.create(1, 'essay', 'ko');
    state.project.metadata.title = '나의 원고';
    state.project.revision = 7;
    return { root, service, ...state, directory: path.join(service.root, state.sessionId) };
}

async function addAssets(f) {
    const imageFile = path.join(f.root, '표지.png');
    const fontFile = path.join(f.root, '본문.otf');
    await fs.writeFile(imageFile, png);
    await fs.writeFile(fontFile, font);
    const image = (await f.service.addAsset(1, f.sessionId, imageFile, 'image')).asset;
    const fontAsset = (await f.service.addAsset(1, f.sessionId, fontFile, 'font')).asset;
    const audioBytes = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)])));
    const audioFile = path.join(f.root, '낭독.mp3');
    await fs.writeFile(audioFile, audioBytes);
    const audio = (await f.service.addAsset(1, f.sessionId, audioFile, 'audio')).asset;
    f.project.assets = [image, audio, fontAsset];
    f.project.style.font = `font-${fontAsset.id}`;
    f.project.commonCss = 'p { color: #123456; }';
    f.project.chapters[0].css = 'p { text-align: center; }';
    f.project.chapters[0].content.content = [
        paragraph('이미지, 오디오와 글꼴을 포함한 본문'),
        { type: 'image', attrs: { assetId: image.id, alt: '표지', caption: '이미지 설명', width: 80, align: 'center' } },
        { type: 'audio', attrs: { assetId: audio.id, title: '낭독', kind: 'background', loop: true } },
    ];
    f.project.cover = { ...f.project.cover, mode: 'image', assetId: image.id };
    return new Map([[image.id, png], [audio.id, audioBytes], [fontAsset.id, font]]);
}

async function closeFixture(f) {
    await f.service.recovery(1, f.sessionId, f.project);
    await f.service.close(1, f.sessionId);
}

test('recovery duplicate copies all content and assets independently and clears saved identity', async t => {
    const f = await fixture(t);
    const assets = await addAssets(f);
    const savedPath = path.join(f.root, '원본.bmepub');
    await f.service.write(1, f.sessionId, f.project, savedPath, 'save', 'original-save');
    const originalFile = await fs.readFile(savedPath);
    await closeFixture(f);
    const originalRecovery = await fs.readFile(path.join(f.directory, 'recovery.json'));
    const result = await f.service.duplicateRecovery(2, f.sessionId, 'ko');
    assert.equal(result.projects.length, 2);
    assert.ok(result.projects.some(item => item.id === result.duplicatedId && item.title === '나의 원고 (복사본)' && item.savedPath === null));
    assert.notEqual(result.duplicatedId, f.sessionId);
    assert.equal(f.service.sessions.size, 0);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'recovery.json')), originalRecovery);
    const data = JSON.parse(await fs.readFile(path.join(f.service.root, result.duplicatedId, 'recovery.json'), 'utf8'));
    assert.equal(data.savedPath, null);
    assert.equal(data.savedHash, null);
    assert.equal(data.savedRevision, -1);
    assert.equal(data.project.revision, 0);
    assert.notEqual(data.project.id, f.project.id);
    assert.notEqual(data.project.metadata.identifier, f.project.metadata.identifier);
    assert.deepEqual(data.project, {
        ...f.project, id: data.project.id, revision: 0,
        metadata: { ...f.project.metadata, title: '나의 원고 (복사본)', identifier: data.project.metadata.identifier },
    });
    for (const asset of f.project.assets) {
        const copy = path.join(f.service.root, result.duplicatedId, 'assets', assetFilename(asset));
        const source = path.join(f.directory, 'assets', assetFilename(asset));
        assert.notEqual((await fs.stat(copy)).ino, (await fs.stat(source)).ino);
    }
    await f.service.deleteRecovery(f.sessionId);
    assert.deepEqual(await fs.readFile(savedPath), originalFile);
    const restored = await f.service.restore(3, result.duplicatedId);
    assert.deepEqual(restored.project, data.project);
    for (const asset of restored.project.assets) assert.deepEqual((await f.service.asset(3, restored.sessionId, asset.id)).data, assets.get(asset.id));
});

test('recovery deletion removes only the selected workspace and keeps saved project and exported EPUB', async t => {
    const f = await fixture(t);
    const savedPath = path.join(f.root, '원본.bmepub');
    const exportedPath = path.join(f.root, '배포.epub');
    await f.service.write(1, f.sessionId, f.project, savedPath, 'save', 'save-original');
    await f.service.write(1, f.sessionId, f.project, exportedPath, 'export', 'export-original');
    const saved = await fs.readFile(savedPath);
    const exported = await fs.readFile(exportedPath);
    await closeFixture(f);
    const copy = await f.service.duplicateRecovery(2, f.sessionId, 'en');
    const result = await f.service.deleteRecovery(f.sessionId);
    assert.deepEqual(result.projects.map(item => item.id), [copy.duplicatedId]);
    await assert.rejects(fs.stat(f.directory), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(savedPath), saved);
    assert.deepEqual(await fs.readFile(exportedPath), exported);
    await assert.rejects(f.service.deleteRecovery(f.sessionId), { code: 'RECOVERY_MISSING' });
});

test('duplicate labels follow UI language without changing book language and remain unique', async t => {
    const f = await fixture(t);
    await closeFixture(f);
    const copies = await Promise.all([f.service.duplicateRecovery(2, f.sessionId, 'en'), f.service.duplicateRecovery(3, f.sessionId, 'en'), f.service.duplicateRecovery(4, f.sessionId, 'ja')]);
    const titles = [];
    for (const copy of copies) {
        const result = await f.service.restore(2, copy.duplicatedId);
        titles.push(result.project.metadata.title);
        assert.equal(result.project.metadata.language, 'ko');
        await f.service.close(2, copy.duplicatedId);
    }
    assert.deepEqual(titles, ['나의 원고 (Copy)', '나의 원고 (Copy 2)', '나의 원고 (コピー)']);
});

test('maximum-length titles still produce valid duplicate projects', async t => {
    const f = await fixture(t);
    f.project.metadata.title = '가'.repeat(2000);
    await closeFixture(f);
    const copy = await f.service.duplicateRecovery(2, f.sessionId, 'ko');
    const { project } = await f.service.restore(2, copy.duplicatedId);
    assert.equal(project.metadata.title.length, 2000);
    assert.ok(project.metadata.title.endsWith(' (복사본)'));
    validateProject(project);
});

test('duplicate title truncation preserves supplementary Unicode characters', async t => {
    const f = await fixture(t);
    f.project.metadata.title = '\u{1f600}'.repeat(1000);
    await closeFixture(f);
    const copy = await f.service.duplicateRecovery(2, f.sessionId, 'en');
    const { project } = await f.service.restore(2, copy.duplicatedId);
    assert.ok(project.metadata.title.length <= 2000);
    assert.equal(project.metadata.title.isWellFormed(), true);
    assert.ok(project.metadata.title.endsWith(' (Copy)'));
    validateProject(project);
});

test('active recoveries reject deletion, duplication and restore for every owner', async t => {
    const f = await fixture(t);
    const before = await fs.readFile(path.join(f.directory, 'recovery.json'));
    for (const owner of [1, 2]) {
        await assert.rejects(f.service.duplicateRecovery(owner, f.sessionId, 'ko'), { code: 'PROJECT_BUSY' });
        await assert.rejects(f.service.restore(owner, f.sessionId), { code: 'PROJECT_BUSY' });
    }
    await assert.rejects(f.service.deleteRecovery(f.sessionId), { code: 'PROJECT_BUSY' });
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'recovery.json')), before);
    assert.equal(f.service.sessions.size, 1);
});

test('recovery operations reject invalid ids and linked workspace directories', async t => {
    const f = await fixture(t);
    await closeFixture(f);
    for (const id of [undefined, null, {}, '../work', f.directory, `s_${'-'.repeat(36)}`, `${f.sessionId}/..`]) {
        for (const action of [() => f.service.deleteRecovery(id), () => f.service.duplicateRecovery(2, id), () => f.service.restore(2, id)]) await assert.rejects(action(), { code: 'INVALID_PROJECT' });
    }
    const linkedId = `s_${randomUUID()}`;
    const linkedDirectory = path.join(f.service.root, linkedId);
    await fs.symlink(f.directory, linkedDirectory, 'dir');
    for (const action of [() => f.service.deleteRecovery(linkedId), () => f.service.duplicateRecovery(2, linkedId), () => f.service.restore(2, linkedId)]) await assert.rejects(action(), { code: 'INVALID_PROJECT' });
    assert.equal((await f.service.recoveries()).length, 1);
    assert.equal((await fs.lstat(linkedDirectory)).isSymbolicLink(), true);
    assert.equal((await fs.stat(f.directory)).isDirectory(), true);
});

test('linked recovery files, asset directories and asset files cannot be duplicated or restored', async t => {
    for (const target of ['recovery', 'assets', 'asset']) {
        await t.test(target, async t => {
            const f = await fixture(t);
            await addAssets(f);
            await closeFixture(f);
            const item = target === 'recovery' ? path.join(f.directory, 'recovery.json') : target === 'assets' ? path.join(f.directory, 'assets') : path.join(f.directory, 'assets', assetFilename(f.project.assets[0]));
            const outside = path.join(f.root, `outside-${target}`);
            await fs.rename(item, outside);
            await fs.symlink(outside, item, target === 'assets' ? 'dir' : 'file');
            const code = target === 'asset' ? 'ASSET_MISSING' : 'INVALID_PROJECT';
            await assert.rejects(f.service.duplicateRecovery(2, f.sessionId), { code });
            await assert.rejects(f.service.restore(2, f.sessionId), { code });
            await f.service.deleteRecovery(f.sessionId);
            assert.ok(await fs.stat(outside));
        });
    }
});

test('missing assets prevent incomplete copies while damaged recoveries remain deletable', async t => {
    const f = await fixture(t);
    await addAssets(f);
    await closeFixture(f);
    await fs.unlink(path.join(f.directory, 'assets', assetFilename(f.project.assets[0])));
    await assert.rejects(f.service.duplicateRecovery(2, f.sessionId), { code: 'ASSET_MISSING' });
    assert.deepEqual((await f.service.recoveries()).map(item => item.id), [f.sessionId]);
    await fs.writeFile(path.join(f.directory, 'recovery.json'), '{broken');
    await assert.rejects(f.service.duplicateRecovery(2, f.sessionId), { code: 'INVALID_PROJECT' });
    assert.deepEqual(await f.service.deleteRecovery(f.sessionId), { projects: [] });
});

test('partial asset-copy and recovery-write failures remove only the new incomplete workspace', async t => {
    for (const failure of ['copy', 'persist']) {
        await t.test(failure, async t => {
            const f = await fixture(t);
            await addAssets(f);
            await closeFixture(f);
            const before = await fs.readFile(path.join(f.directory, 'recovery.json'));
            const diskFailure = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            let copied = 0;
            if (failure === 'copy') {
                const original = fs.copyFile;
                t.mock.method(fs, 'copyFile', async (...args) => {
                    copied += 1;
                    if (copied === 2) throw diskFailure;
                    return original(...args);
                });
            } else t.mock.method(f.service, 'persist', async () => { throw diskFailure; });
            await assert.rejects(f.service.duplicateRecovery(2, f.sessionId), { code: 'ENOSPC' });
            if (failure === 'copy') assert.equal(copied, 2);
            assert.deepEqual(await fs.readdir(f.service.root), [f.sessionId]);
            assert.deepEqual(await fs.readFile(path.join(f.directory, 'recovery.json')), before);
            assert.equal(f.service.sessions.size, 0);
        });
    }
});

test('missing recovery documents report a stale list entry and remain removable', async t => {
    const f = await fixture(t);
    await closeFixture(f);
    await fs.unlink(path.join(f.directory, 'recovery.json'));
    await assert.rejects(f.service.duplicateRecovery(2, f.sessionId), { code: 'RECOVERY_MISSING' });
    await assert.rejects(f.service.restore(2, f.sessionId), { code: 'RECOVERY_MISSING' });
    assert.deepEqual(await f.service.deleteRecovery(f.sessionId), { projects: [] });
});

test('incomplete listing metadata does not prevent managing other recoveries', async t => {
    const f = await fixture(t);
    await closeFixture(f);
    const incomplete = await f.service.create(2, 'blank', 'ko');
    await f.service.close(2, incomplete.sessionId);
    const file = path.join(f.service.root, incomplete.sessionId, 'recovery.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    data.updatedAt = null;
    await fs.writeFile(file, JSON.stringify(data));
    assert.deepEqual((await f.service.recoveries()).map(item => item.id), [f.sessionId]);
    const copy = await f.service.duplicateRecovery(2, f.sessionId);
    const removed = await f.service.deleteRecovery(f.sessionId);
    assert.deepEqual(removed.projects.map(item => item.id), [copy.duplicatedId]);
    assert.ok(await fs.stat(file));
});

test('duplicate, delete and restore requests serialize around the same recovery', async t => {
    const f = await fixture(t);
    await addAssets(f);
    await closeFixture(f);
    const [copy, deleted] = await Promise.all([f.service.duplicateRecovery(2, f.sessionId), f.service.deleteRecovery(f.sessionId)]);
    assert.deepEqual(deleted.projects.map(item => item.id), [copy.duplicatedId]);
    const [restored, deleteBusy, duplicateBusy] = await Promise.allSettled([
        f.service.restore(3, copy.duplicatedId),
        f.service.deleteRecovery(copy.duplicatedId),
        f.service.duplicateRecovery(4, copy.duplicatedId),
    ]);
    assert.equal(restored.status, 'fulfilled');
    assert.equal(deleteBusy.reason.code, 'PROJECT_BUSY');
    assert.equal(duplicateBusy.reason.code, 'PROJECT_BUSY');
    await f.service.close(3, copy.duplicatedId);
    const [removed, restoreMissing] = await Promise.allSettled([f.service.deleteRecovery(copy.duplicatedId), f.service.restore(4, copy.duplicatedId)]);
    assert.equal(removed.status, 'fulfilled');
    assert.equal(restoreMissing.reason.code, 'RECOVERY_MISSING');
});

test('IPC recovery actions return refreshed lists, duplicate identity and actionable errors', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-recovery-ipc-'));
    let handler;
    const controller = registerEpubEditorIpc({
        ipcMain: { handle: (_channel, callback) => { handler = callback; } },
        app: { getPath: () => root },
        BrowserWindow: { fromWebContents: () => null },
        dialog: {},
    });
    t.after(async () => { await controller.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: () => {} });
    const other = Object.assign(new EventEmitter(), { id: 2, isDestroyed: () => false, send: () => {} });
    const invoke = (request, source = sender) => handler({ sender: source }, request);
    const source = await invoke({ action: 'create', template: 'blank', language: 'en' });
    for (const action of ['recoveryDelete', 'recoveryDuplicate']) {
        const busy = await invoke({ action, id: source.sessionId }, other);
        assert.equal(busy.ok, false);
        assert.equal(busy.error.code, 'PROJECT_BUSY');
    }
    await invoke({ action: 'close', sessionId: source.sessionId });
    const copy = await invoke({ action: 'recoveryDuplicate', id: source.sessionId, language: 'ja' }, other);
    assert.equal(copy.ok, true);
    assert.equal(copy.projects.length, 2);
    assert.ok(copy.projects.some(item => item.id === copy.duplicatedId && item.title === 'Untitled book (コピー)'));
    const removed = await invoke({ action: 'recoveryDelete', id: source.sessionId });
    assert.equal(removed.ok, true);
    assert.deepEqual(removed.projects.map(item => item.id), [copy.duplicatedId]);
    const restored = await invoke({ action: 'restore', id: copy.duplicatedId }, other);
    assert.equal(restored.ok, true);
    assert.equal(restored.project.metadata.title, 'Untitled book (コピー)');
    const invalid = await invoke({ action: 'recoveryDelete', id: '../outside' });
    assert.equal(invalid.error.code, 'INVALID_PROJECT');
});
