import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterXhtml, createProject, duplicateChapter, inspectProject, validateProject } from './epubEditor/model.js';
import { prepareTemplateContent, remapTemplateAssets, templateAssetIds } from './epubEditor/contentTemplates.js';

const settings = { id: 'ar_rain', assetId: 'a_sound', title: '빗소리 <>&"', kind: 'background', loop: true, controls: false, volume: 0.35 };
const marked = (text, attrs = settings, marks = []) => ({ type: 'text', text, marks: [{ type: 'audioRange', attrs: { ...attrs } }, ...marks] });

function fixture() {
    const project = createProject();
    project.assets.push({ id: 'a_sound', name: 'rain.mp3', kind: 'audio', mime: 'audio/mpeg', extension: 'mp3', size: 1 });
    project.chapters[0].content = { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '앞 ' }, marked('첫 번째 문장', settings, [{ type: 'bold' }])] },
        { type: 'paragraph', content: [marked('이어지는 문장'), { type: 'hardBreak', marks: [{ type: 'audioRange', attrs: { ...settings } }] }, marked('마지막 문장'), { type: 'text', text: ' 뒤' }] },
    ] };
    return project;
}

test('text audio ranges export one sound with every text fragment while preserving formatting', () => {
    const project = fixture();
    assert.doesNotThrow(() => validateProject(project));
    const before = structuredClone(project);
    const html = chapterXhtml(project.chapters[0], project);
    assert.equal((html.match(/<audio\b/g) || []).length, 1);
    assert.equal((html.match(/<span data-bookmanager-audio-range="ar_rain">/g) || []).length, 4);
    assert.match(html, /data-bookmanager-audio-range="ar_rain"><strong>첫 번째 문장<\/strong>/);
    assert.match(html, /<audio hidden="hidden" preload="none" loop="loop"/);
    assert.match(html, /data-bookmanager-audio-volume="0.35"/);
    assert.match(html, /title="빗소리 &lt;&gt;&amp;&quot;"/);
    assert.doesNotMatch(html, /autoplay|ee-audio-range|data-audio-range-label/);
    assert.deepEqual(project, before);
});

test('range validation rejects invalid metadata and conflicting settings for one range', () => {
    for (const patch of [{ id: '' }, { assetId: '' }, { volume: -0.1 }, { volume: NaN }, { volume: '0.5' }, { controls: 'false' }, { loop: 1 }, { title: '\u0000' }, { kind: 'other' }]) {
        const project = fixture();
        project.chapters[0].content.content[0].content[1].marks[0].attrs = { ...settings, ...patch };
        assert.throws(() => validateProject(project));
    }
    const inconsistent = fixture();
    inconsistent.chapters[0].content.content[1].content[0].marks[0].attrs.volume = 0.2;
    assert.throws(() => validateProject(inconsistent), { code: 'INVALID_DOCUMENT' });
    const duplicate = fixture();
    duplicate.chapters[0].content.content[0].content[1].marks.push({ type: 'audioRange', attrs: { ...settings } });
    assert.throws(() => validateProject(duplicate), { code: 'INVALID_DOCUMENT' });
    const missing = fixture();
    missing.assets = [];
    assert.ok(inspectProject(missing).some(issue => issue.code === 'AUDIO_MISSING'));
});

test('range identities and assets follow chapter duplication and independent template insertions', () => {
    const project = fixture();
    const chapter = duplicateChapter(project.chapters[0]);
    const first = chapter.content.content[0].content[1].marks[0].attrs;
    const second = chapter.content.content[1].content[0].marks[0].attrs;
    assert.notEqual(first.id, settings.id);
    assert.equal(first.id, second.id);
    assert.equal(first.assetId, settings.assetId);
    assert.deepEqual([...templateAssetIds(chapter.content)], ['a_sound']);
    const remapped = remapTemplateAssets(chapter.content, new Map([['a_sound', 'a_imported']]));
    assert.deepEqual([...templateAssetIds(remapped)], ['a_imported']);
    const one = prepareTemplateContent(remapped).content;
    const two = prepareTemplateContent(remapped).content;
    assert.notEqual(one.content[0].content[1].marks[0].attrs.id, two.content[0].content[1].marks[0].attrs.id);
    assert.equal(one.content[0].content[1].marks[0].attrs.id, one.content[1].content[0].marks[0].attrs.id);
    assert.equal(one.content[0].content[1].marks[0].attrs.volume, 0.35);
    assert.equal(project.chapters[0].content.content[0].content[1].marks[0].attrs.id, settings.id);
});
