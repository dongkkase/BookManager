import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EpubEditorService } from './epubEditor/service.js';
import { paragraph, newId } from './epubEditor/model.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

test('paragraph and hanging indentation persist through recovery, project reopening and EPUB output', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-indent-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const session = await service.create(1, 'blank', 'ko');
    const { project } = session;
    project.style.indent = 1;
    project.revision += 1;
    project.chapters[0].content.content = [
        { ...paragraph('기존 책 스타일'), attrs: { id: newId() } },
        { ...paragraph('문단 들여쓰기'), attrs: { id: newId(), indentLevel: 2, firstLineIndent: 1 } },
        { ...paragraph('첫 줄 내어쓰기'), attrs: { id: newId(), indentLevel: 0, firstLineIndent: -1 } },
        { ...paragraph('첫 줄 없음'), attrs: { id: newId(), firstLineIndent: 0 } },
    ];
    await service.recovery(1, session.sessionId, project);
    const projectPath = path.join(root, 'indent.bmepub');
    await service.write(1, session.sessionId, project, projectPath, 'save', 'save');
    await service.close(1, session.sessionId);
    const reopened = await service.open(1, projectPath, 'open');
    assert.deepEqual(reopened.project.chapters[0].content, project.chapters[0].content);
    assert.equal(reopened.project.style.indent, 1);
    const epub = path.join(root, 'indent.epub');
    await service.write(1, reopened.sessionId, reopened.project, epub, 'export', 'export');
    const buffer = await fs.readFile(epub);
    const entry = listZipEntries(buffer).find(item => item.name === `EPUB/text/${project.chapters[0].id}.xhtml`);
    const xhtml = readZipEntry(buffer, entry).toString();
    assert.match(xhtml, /margin-left:4em;text-indent:1em/);
    assert.match(xhtml, /margin-left:1em;text-indent:-1em/);
    assert.match(xhtml, /text-indent:0em/);
});
