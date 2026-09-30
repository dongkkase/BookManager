import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EpubEditorService } from './epubEditor/service.js';
import { createChapter, createProject, createProjectValidator, paragraph, validateProject } from './epubEditor/model.js';
import { projectChanges, applyProjectChanges } from './epubEditor/projectChanges.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'epub-incremental-'));
    const service = new EpubEditorService(root);
    const initial = await service.create(1, 'essay', 'ko');
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const directory = path.join(root, initial.sessionId);
    return { root, service, initial, directory };
}

const edit = (project, index = 0) => ({ ...project, revision: project.revision + 1, chapters: project.chapters.map((chapter, i) => i === index ? { ...chapter, content: { type: 'doc', content: [paragraph('수정한 본문 <>&')] } } : chapter) });
const manifest = async directory => JSON.parse(await fs.readFile(path.join(directory, 'recovery.json'), 'utf8'));

test('incremental recovery writes only edited chapters and restores content, order, metadata and deletions after restart', async t => {
    const { service, initial, directory, root } = await fixture(t);
    const first = await manifest(directory);
    const changed = edit(initial.project, 1);
    const patch = projectChanges(initial.project, changed);
    assert.equal(patch.chapters.length, 1);
    assert.deepEqual(applyProjectChanges(initial.project, patch), changed);
    await service.recovery(1, initial.sessionId, undefined, patch);
    const second = await manifest(directory);
    assert.equal(first.chapterFiles[0], second.chapterFiles[0]);
    assert.equal(first.chapterFiles[2], second.chapterFiles[2]);
    assert.notEqual(first.chapterFiles[1], second.chapterFiles[1]);
    assert.equal((await fs.readdir(path.join(directory, 'chapters'))).length, 3);
    const next = { ...changed, revision: 2, metadata: { ...changed.metadata, title: '새 제목' }, chapters: [changed.chapters[2], changed.chapters[1], createChapter('새 장')] };
    await service.recovery(1, initial.sessionId, undefined, projectChanges(changed, next));
    const third = await manifest(directory);
    assert.equal(third.chapterFiles[0], second.chapterFiles[2]);
    assert.equal(third.chapterFiles[1], second.chapterFiles[1]);
    const metadataOnly = { ...next, revision: 3, commonCss: 'p { color: #123456; }' };
    await service.recovery(1, initial.sessionId, undefined, projectChanges(next, metadataOnly));
    assert.deepEqual((await manifest(directory)).chapterFiles, third.chapterFiles);
    await service.close(1, initial.sessionId);
    const reopened = new EpubEditorService(root);
    t.after(() => reopened.dispose());
    assert.deepEqual((await reopened.restore(2, initial.sessionId)).project, metadataOnly);
});

test('invalid deltas, stale revisions and different owners cannot replace recovery data', async t => {
    const { service, initial, directory } = await fixture(t);
    const next = edit(initial.project);
    const patch = projectChanges(initial.project, next);
    const original = await fs.readFile(path.join(directory, 'recovery.json'));
    await assert.rejects(service.recovery(2, initial.sessionId, undefined, patch), { code: 'SESSION_CLOSED' });
    await assert.rejects(service.recovery(1, initial.sessionId, undefined, { ...patch, baseRevision: 10 }), { code: 'RECOVERY_CONFLICT' });
    for (const broken of [
        { ...patch, chapterIds: [...patch.chapterIds, patch.chapterIds[0]] },
        { ...patch, chapterIds: ['c_missing'] },
        { ...patch, project: { ...patch.project, id: 'p_other' } },
        { ...patch, chapters: [patch.chapters[0], patch.chapters[0]] },
        { ...patch, chapters: [{ ...patch.chapters[0], content: { type: 'script' } }] },
    ]) await assert.rejects(service.recovery(1, initial.sessionId, undefined, broken), { code: 'INVALID_PROJECT' });
    const unsafe = structuredClone(patch);
    unsafe.chapters[0].content.content[0].content[0].marks = [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }];
    await assert.rejects(service.recovery(1, initial.sessionId, undefined, unsafe), { code: 'INVALID_LINK' });
    assert.deepEqual(await fs.readFile(path.join(directory, 'recovery.json')), original);
    assert.equal(service.session(initial.sessionId, 1).project.revision, 0);
});

test('failed recovery manifest commit preserves old chapter files and revision and can be retried', async t => {
    const { service, initial, directory } = await fixture(t);
    const file = path.join(directory, 'recovery.json');
    const files = await fs.readdir(path.join(directory, 'chapters'));
    const next = edit(initial.project);
    const patch = projectChanges(initial.project, next);
    await fs.rename(file, `${file}.previous`);
    await fs.mkdir(file);
    await assert.rejects(service.recovery(1, initial.sessionId, undefined, patch));
    assert.equal(service.session(initial.sessionId, 1).project.revision, 0);
    assert.deepEqual(await fs.readdir(path.join(directory, 'chapters')), files);
    await fs.rmdir(file);
    await fs.rename(`${file}.previous`, file);
    assert.deepEqual((await service.readRecovery(initial.sessionId)).project, initial.project);
    await service.recovery(1, initial.sessionId, undefined, patch);
    assert.deepEqual((await service.readRecovery(initial.sessionId)).project, next);
});

test('legacy full recovery files remain readable and migrate on the next edit', async t => {
    const { service, initial, directory } = await fixture(t);
    await service.close(1, initial.sessionId);
    await fs.writeFile(path.join(directory, 'recovery.json'), JSON.stringify({ project: initial.project, savedPath: null, savedHash: null, savedRevision: -1, updatedAt: new Date().toISOString() }));
    const restored = await service.restore(2, initial.sessionId);
    assert.deepEqual(restored.project, initial.project);
    const next = edit(restored.project);
    await service.recovery(2, initial.sessionId, undefined, projectChanges(restored.project, next));
    assert.equal((await manifest(directory)).recoveryVersion, 2);
    assert.deepEqual((await service.readRecovery(initial.sessionId)).project, next);
});

test('recovery chapter references reject traversal, symlinks and missing data', async t => {
    const { service, initial, directory } = await fixture(t);
    await service.close(1, initial.sessionId);
    const original = await manifest(directory);
    const file = path.join(directory, 'recovery.json');
    await fs.writeFile(file, JSON.stringify({ ...original, chapterFiles: ['../outside.json'] }));
    await assert.rejects(service.restore(2, initial.sessionId), { code: 'INVALID_PROJECT' });
    await fs.writeFile(file, JSON.stringify(original));
    const chapter = path.join(directory, 'chapters', original.chapterFiles[0]);
    await fs.rename(chapter, `${chapter}.original`);
    await fs.symlink(`${chapter}.original`, chapter);
    await assert.rejects(service.restore(2, initial.sessionId), { code: 'INVALID_PROJECT' });
    await fs.unlink(chapter);
    await assert.rejects(service.restore(2, initial.sessionId), { code: 'ENOENT' });
});

test('cached project validation reuses unchanged chapters and validates replacements and global constraints', () => {
    const project = createProject('essay');
    let serializations = 0;
    const content = project.chapters[1].content;
    Object.defineProperty(content, 'toJSON', { value() { serializations += 1; return { type: this.type, content: this.content }; } });
    const validate = createProjectValidator();
    validate(project);
    assert.equal(serializations, 1);
    validate(edit(project));
    assert.equal(serializations, 1);
    const bad = edit(project);
    bad.chapters[0].content.content[0].content[0].marks = [{ type: 'unknown' }];
    assert.throws(() => validate(bad), { code: 'INVALID_DOCUMENT' });
    assert.throws(() => validateProject(bad), { code: 'INVALID_DOCUMENT' });
    assert.throws(() => validate({ ...project, chapters: [...project.chapters, project.chapters[0]] }), { code: 'INVALID_PROJECT' });
});
