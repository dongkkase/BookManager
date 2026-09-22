import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseMediaUrl } from './epubEditor/authoring.js';
import { createProject, paragraph, validateProject, inspectProject } from './epubEditor/model.js';
import { EpubEditorService } from './epubEditor/service.js';
import { listZipEntries, readZipEntry } from './core/zipArchive.js';
import { editorMediaRequestHeaders, installEditorMediaHeaders } from './epubEditor/mediaHeaders.js';

test('installed app identifies only its own YouTube player requests and preserves existing web referrers', () => {
    const request = { webContentsId: 12, resourceType: 'subFrame', url: 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw', requestHeaders: { Accept: 'text/html' } };
    assert.deepEqual(editorMediaRequestHeaders(request, 12, 'com.bookmanager.app'), { Accept: 'text/html', Referer: 'https://com.bookmanager.app/' });
    assert.deepEqual(request.requestHeaders, { Accept: 'text/html' });
    for (const patch of [{ webContentsId: 99 }, { resourceType: 'xhr' }, { url: 'https://example.com/embed/jNQXAC9IVRw' }, { url: 'https://www.youtube-nocookie.com.evil.test/embed/jNQXAC9IVRw' }, { url: 'https://www.youtube-nocookie.com/other' }]) assert.equal(editorMediaRequestHeaders({ ...request, ...patch }, 12, 'com.bookmanager.app'), request.requestHeaders);
    const local = { ...request, requestHeaders: { referer: 'file:///private/book/index.html', Accept: 'text/html' } };
    assert.deepEqual(editorMediaRequestHeaders(local, 12, 'com.bookmanager.app'), { Accept: 'text/html', Referer: 'https://com.bookmanager.app/' });
    const web = { ...request, requestHeaders: { Referer: 'http://127.0.0.1:5173/' } };
    assert.equal(editorMediaRequestHeaders(web, 12, 'com.bookmanager.app'), web.requestHeaders);
    let callback;
    installEditorMediaHeaders({ id: 12, session: { webRequest: { onBeforeSendHeaders: (filter, listener) => { assert.deepEqual(filter.urls, ['https://www.youtube-nocookie.com/embed/*']); callback = listener; } } } }, 'com.bookmanager.app');
    callback(request, result => assert.equal(result.requestHeaders.Referer, 'https://com.bookmanager.app/'));
});

test('media URLs normalize supported providers and timestamps while rejecting untrusted frames', () => {
    for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) assert.equal(parseMediaUrl(url).embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    assert.equal(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s').embed.endsWith('?start=90'), true);
    assert.equal(parseMediaUrl('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789');
    assert.equal(parseMediaUrl('https://vimeo.com/123456789/a1b2c3d4e5').embed, 'https://player.vimeo.com/video/123456789?h=a1b2c3d4e5');
    for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ', 'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/short', '<iframe src=x>', 'https://youtube.com/watch?v=dQw4w9WgXcQ"', 'https://youtu.be/dQw4w9WgXcQ\nextra', 'https://vimeo.com/123456?h=javascript:', 'https://youtube.com:8080/watch?v=dQw4w9WgXcQ']) assert.equal(parseMediaUrl(value), null, value);
});

test('project validation rejects unsupported style values and malformed media without breaking old projects', () => {
    const project = createProject();
    validateProject(project);
    for (const node of [
        { ...paragraph('x'), attrs: { blockStyle: 'evil' } },
        { type: 'heading', attrs: { level: 7 }, content: [{ type: 'text', text: 'x' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight', attrs: { preset: 'evil' } }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { backgroundColor: 'url(x)' } }] }] },
        { type: 'media', attrs: { url: 'https://evil.test/embed', title: 'x' } },
    ]) { project.chapters[0].content.content = [node]; assert.throws(() => validateProject(project)); }
});

test('new authoring features survive recovery, save and reopen and export valid EPUB fallbacks', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookmanager-authoring-'));
    const service = new EpubEditorService(path.join(root, 'work'));
    t.after(async () => { await service.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    const { project, sessionId } = await service.create(1, 'blank', 'ko');
    project.chapters[0].content.content = [
        { type: 'heading', attrs: { level: 6, id: 'n_heading', blockStyle: 'subtitle' }, content: [{ type: 'text', text: '작은 제목' }] },
        { type: 'paragraph', attrs: { blockStyle: 'note' }, content: [{ type: 'text', text: '© 🧑‍💻 👍🏽', marks: [{ type: 'superscript' }, { type: 'highlight', attrs: { preset: 'greenMarker' } }, { type: 'inlineStyle', attrs: { preset: 'keyboard' } }, { type: 'textStyle', attrs: { color: '#123456', backgroundColor: '#ffeedd' } }] }, { type: 'text', text: '2', marks: [{ type: 'subscript' }] }] },
        { type: 'media', attrs: { id: 'n_media', url: 'https://youtu.be/dQw4w9WgXcQ?t=90', title: 'Video <title> & test' } },
    ];
    project.revision++;
    await service.recovery(1, sessionId, project);
    const saved = path.join(root, 'authoring.bmepub');
    await service.write(1, sessionId, project, saved, 'save', 'save');
    const reopened = await service.open(2, saved, 'open');
    assert.deepEqual(reopened.project, project);
    const exported = path.join(root, 'authoring.epub');
    await service.write(2, reopened.sessionId, reopened.project, exported, 'export', 'export');
    const bytes = await fs.readFile(exported);
    const entries = listZipEntries(bytes);
    const read = name => readZipEntry(bytes, entries.find(entry => entry.name === name)).toString();
    const xhtml = read(`EPUB/text/${project.chapters[0].id}.xhtml`);
    assert.match(xhtml, /<h6[^>]*class="bm-style-subtitle"/);
    assert.match(xhtml, /<sup>/);
    assert.match(xhtml, /<sub>2<\/sub>/);
    assert.match(xhtml, /background-color:#ffeedd/);
    assert.match(xhtml, /bm-highlight-greenMarker/);
    assert.match(xhtml, /© 🧑‍💻 👍🏽/);
    assert.match(xhtml, /Video &lt;title&gt; &amp; test/);
    assert.match(xhtml, /href="https:\/\/www.youtube.com\/watch\?v=dQw4w9WgXcQ&amp;t=90"/);
    assert.doesNotMatch(xhtml, /<iframe|<script|<oembed/);
    assert.match(read('EPUB/styles/book.css'), /\.bm-style-note/);
    assert.match(read('EPUB/nav.xhtml'), /#n_heading/);
    project.chapters[0].content.content = [project.chapters[0].content.content[2]];
    assert.equal(inspectProject(project).some(issue => issue.code === 'CHAPTER_EMPTY'), false);
});
