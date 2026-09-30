import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DIVIDER_STYLES } from './epubEditor/dividers.js';
import { createProject, paragraph, validateProject, renderChapterBody, chapterXhtml, bookCss } from './epubEditor/model.js';
import { EpubEditorService } from './epubEditor/service.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';

test('divider validation preserves legacy rules and rejects unsupported designs and misplaced attributes', () => {
    const project = createProject();
    project.chapters[0].content.content = [{ type: 'horizontalRule' }];
    validateProject(project);
    assert.match(renderChapterBody(project.chapters[0], project), /<hr \/>/);
    for (const value of ['unknown', '__proto__', 'solid" onclick="x', {}, 1]) {
        project.chapters[0].content.content = [{ type: 'horizontalRule', attrs: { dividerStyle: value } }];
        assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
    }
    project.chapters[0].content.content = [{ ...paragraph('text'), attrs: { dividerStyle: 'solid' } }];
    assert.throws(() => validateProject(project), { code: 'INVALID_DOCUMENT' });
});

test('all divider designs survive recovery, save, reopen and EPUB export with shared preview styles', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-dividers-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const { sessionId, project } = await service.create(1, 'blank', 'ko');
    project.chapters[0].content.content = [paragraph('Before'), ...Object.keys(DIVIDER_STYLES).map(dividerStyle => ({ type: 'horizontalRule', attrs: { id: `n_${dividerStyle}`, dividerStyle } })), paragraph('After')];
    project.revision += 1;
    validateProject(project);
    await service.recovery(1, sessionId, project);
    const saved = path.join(root, 'dividers.bmepub');
    await service.write(1, sessionId, project, saved, 'save', 'save');
    await service.close(1, sessionId);
    const recovered = await service.restore(2, sessionId);
    assert.deepEqual(recovered.project, project);
    const reopened = await service.open(3, saved, 'open');
    assert.deepEqual(reopened.project, project);
    const exported = path.join(root, 'dividers.epub');
    await service.write(3, reopened.sessionId, reopened.project, exported, 'export', 'export');
    const bytes = await fs.readFile(exported);
    const entries = listZipEntries(bytes);
    const read = name => readZipEntry(bytes, entries.find(entry => entry.name === name)).toString();
    const xhtml = read(`EPUB/text/${project.chapters[0].id}.xhtml`);
    const css = read('EPUB/styles/book.css');
    assert.equal(css, bookCss(project));
    assert.equal(xhtml, chapterXhtml(project.chapters[0], project));
    const preview = chapterXhtml(project.chapters[0], project, { inlineStyles: true });
    for (const [key, preset] of Object.entries(DIVIDER_STYLES)) {
        assert.match(xhtml, new RegExp(`<${preset.symbol ? 'div' : 'hr'} id="n_${key}" class="bm-divider bm-divider-${key}"`));
        assert.ok(css.includes(`.bm-divider-${key}{`));
        assert.ok(preview.includes(`.bm-divider-${key}{`));
        if (preset.symbol) assert.ok(xhtml.includes(`role="separator"><span aria-hidden="true">${preset.symbol}</span></div>`));
    }
    assert.doesNotMatch(xhtml, /data-divider|ProseMirror|contenteditable/);
});
