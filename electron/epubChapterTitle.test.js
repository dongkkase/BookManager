import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chapterBodyTitle, createProject, paragraph, renderChapterBody, inspectProject } from './epubEditor/model.js';
import { epubTextEntries } from './epubEditor/package.js';
import { parseEpubXml, descendants, attr } from './epubEditor/epubImportXml.js';
import { EpubEditorService } from './epubEditor/service.js';

const heading = (text, id = 'n_title', level = 3) => ({ type: 'heading', attrs: { id, level }, content: [{ type: 'text', text }] });
const chapter = content => ({ ...createProject().chapters[0], title: '#0. 게임 소개', content: { type: 'doc', content } });

test('matching opening headings replace generated chapter titles without changing source nodes or links', () => {
    const project = createProject();
    const title = heading('#0. 게임 소개');
    title.content[0].marks = [{ type: 'bold' }];
    const current = chapter([title, paragraph('Body'), { type: 'paragraph', content: [{ type: 'text', text: 'Back', marks: [{ type: 'link', attrs: { href: `epub:${project.chapters[0].id}#n_title` } }] }] }]);
    current.id = project.chapters[0].id;
    project.chapters = [current];
    const before = structuredClone(current);
    assert.equal(chapterBodyTitle(current), title);
    const html = renderChapterBody(current, project);
    assert.doesNotMatch(html, /class="chapter-title"/);
    assert.match(html, /<h3 id="n_title"><strong>#0\. 게임 소개<\/strong><\/h3>/);
    assert.match(html, /href="[^\"]+#n_title"/);
    assert.deepEqual(current, before);
    assert.deepEqual(inspectProject(project).filter(issue => issue.severity === 'error'), []);
});

test('opening title detection tolerates blank paragraphs, whitespace and Unicode composition', () => {
    const title = heading(' #0.\u00a0 게임   소개 '.normalize('NFD'));
    const current = chapter([paragraph(), paragraph(' \t\n'), { type: 'paragraph', content: [{ type: 'hardBreak' }] }, title]);
    assert.equal(chapterBodyTitle(current), title);
});

test('different titles, ordinary paragraphs and later headings keep the generated chapter title', () => {
    const project = createProject();
    for (const blocks of [[paragraph('Body')], [paragraph('#0. 게임 소개')], [heading('A different heading')], [paragraph('Before'), heading('#0. 게임 소개')]]) {
        const current = chapter(blocks);
        assert.equal(chapterBodyTitle(current), null);
        assert.match(renderChapterBody(current, project), /<h1 class="chapter-title">#0\. 게임 소개<\/h1>/);
    }
});

test('EPUB navigation omits only the matching opening heading and retains subsection anchors', () => {
    const project = createProject();
    project.chapters = [chapter([heading('#0. 게임 소개'), heading('Section', 'n_section', 4), heading('#0. 게임 소개', 'n_later', 3)])];
    const current = project.chapters[0];
    current.tocTitle = 'Introduction';
    const nav = parseEpubXml(Buffer.from(epubTextEntries(project).find(entry => entry.name === 'EPUB/nav.xhtml').data));
    const toc = descendants(nav, 'nav').find(node => attr(node, 'epub:type') === 'toc');
    assert.deepEqual(descendants(toc, 'a').map(node => [node.textContent, attr(node, 'href')]), [
        ['Introduction', `text/${current.id}.xhtml`],
        ['Section', `text/${current.id}.xhtml#n_section`],
        ['#0. 게임 소개', `text/${current.id}.xhtml#n_later`],
    ]);
});

test('existing projects and repeated EPUB imports retain one opening title without removing editable headings', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-chapter-title-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const created = await service.create(1, 'blank', 'ko');
    created.project.chapters = [chapter([heading('#0. 게임 소개'), paragraph('Body')])];
    created.project.cover.mode = 'none';
    await service.write(1, created.sessionId, created.project, path.join(root, 'saved.bmepub'), 'save', 'save');
    let state = await service.open(1, path.join(root, 'saved.bmepub'), 'open');
    assert.deepEqual(state.project.chapters, created.project.chapters);
    for (let index = 0; index < 2; index += 1) {
        const exported = path.join(root, `round-${index}.epub`);
        await service.write(1, state.sessionId, state.project, exported, 'export', `export-${index}`);
        state = await service.importEpub(1, exported, `import-${index}`);
        const current = state.project.chapters[0];
        assert.equal(current.content.content.filter(node => node.type === 'heading').length, 1);
        assert.ok(chapterBodyTitle(current));
        assert.doesNotMatch(renderChapterBody(current, state.project), /class="chapter-title"/);
    }
});
