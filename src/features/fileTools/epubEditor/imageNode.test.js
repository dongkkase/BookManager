import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { history } from '@tiptap/pm/history';
import { createImageExtension, imageAlignmentPatch, imageTextWrapPatch } from './imageNode.js';
import { createProject, paragraph, renderChapterBody, validateProject } from '../../../../electron/epubEditor/model.js';
import { convertImageWidth } from '../../../../electron/epubEditor/imageSizing.js';

const asset = { id: 'a_picture', kind: 'image', extension: 'png', mime: 'image/png', size: 68, name: 'picture.png' };
const image = attrs => ({ type: 'image', attrs: { assetId: asset.id, width: 100, align: 'center', alt: '', ...attrs } });
const resolveAsset = id => id === asset.id ? 'blob:picture' : '';

function fixture(t, attrs = {}) {
    const extension = createImageExtension(resolveAsset);
    const editor = new Editor({ element: null, extensions: [StarterKit, extension], content: { type: 'doc', content: [image(attrs), paragraph('본문')] } });
    editor.registerPlugin(history());
    editor.commands.setNodeSelection(0);
    t.after(() => editor.destroy());
    return { editor, extension };
}

test('existing images keep their alignment and gain a disabled wrapping default', t => {
    const { editor } = fixture(t, { align: 'right', width: 80, caption: '기존 설명' });
    assert.deepEqual(editor.getAttributes('image'), { assetId: asset.id, alt: '', caption: '기존 설명', width: 80, widthUnit: '%', align: 'right', decorative: false, textWrap: 'none' });
    const project = createProject();
    project.assets = [asset];
    project.chapters[0].content = { type: 'doc', content: [image({ width: 80, align: 'right' })] };
    validateProject(project);
    assert.match(renderChapterBody(project.chapters[0], project), /width:80%;margin:0 0 0 auto/);
    assert.doesNotMatch(renderChapterBody(project.chapters[0], project), /data-text-wrap|float:/);
});

for (const side of ['left', 'right']) {
    test(`text wrapping to the ${side} leaves space, preserves caption and undoes as one edit`, t => {
        const { editor } = fixture(t, { caption: '그림 설명', alt: '대체 설명' });
        const before = editor.getJSON();
        const patch = imageTextWrapPatch(editor.getAttributes('image'), side);
        assert.equal(editor.commands.updateAttributes('image', patch), true);
        assert.equal(editor.getAttributes('image').textWrap, side);
        assert.equal(editor.getAttributes('image').width, 50);
        assert.equal(editor.getAttributes('image').caption, '그림 설명');
        assert.equal(editor.commands.undo(), true);
        assert.deepEqual(editor.getJSON(), before);
        assert.equal(editor.commands.redo(), true);
        assert.equal(editor.getAttributes('image').textWrap, side);
        assert.deepEqual(imageTextWrapPatch(editor.getAttributes('image'), side), { textWrap: 'none' });
        editor.commands.updateAttributes('image', imageAlignmentPatch('left'));
        assert.equal(editor.getAttributes('image').align, 'left');
        assert.equal(editor.getAttributes('image').textWrap, 'none');
        assert.equal(imageTextWrapPatch({ width: 30 }, side).width, 30);
    });
}

test('image clipboard HTML preserves wrapping, captions and decorative semantics', t => {
    const { editor, extension } = fixture(t, { width: 40, textWrap: 'left', decorative: true, alt: 'ignored', caption: '설명 <>&' });
    const html = extension.config.renderHTML({ node: editor.state.doc.firstChild });
    assert.equal(html[1]['data-text-wrap'], 'left');
    assert.match(html[1].style, /float:right/);
    assert.deepEqual(html[2], ['img', { src: 'blob:picture', alt: '', role: 'presentation' }]);
    assert.deepEqual(html[3], ['figcaption', {}, '설명 <>&']);
    const rule = extension.config.parseHTML()[0];
    const attributes = { 'data-asset-id': asset.id, 'data-width': '40', 'data-align': 'right', 'data-text-wrap': 'left', 'data-decorative': 'true' };
    const element = { getAttribute: name => attributes[name] ?? null, querySelector: selector => selector === 'img' ? { getAttribute: () => '' } : { textContent: '설명 <>&' } };
    const parsed = rule.getAttrs(element);
    assert.equal(parsed.textWrap, 'left');
    assert.equal(parsed.caption, '설명 <>&');
    assert.equal(parsed.width, 40);
    assert.equal(parsed.decorative, true);
    attributes['data-text-wrap'] = 'url(evil)';
    assert.equal(rule.getAttrs(element).textWrap, 'none');
    attributes['data-asset-id'] = 'a_missing';
    assert.equal(rule.getAttrs(element), false);
});

test('empty caption inputs never serialize their editor placeholder', t => {
    const { editor, extension } = fixture(t);
    const html = extension.config.renderHTML({ node: editor.state.doc.firstChild });
    assert.equal(html.length, 3);
    assert.equal(JSON.stringify(html).includes('이미지를 설명해 보세요'), false);
    const project = createProject();
    project.assets = [asset];
    project.chapters[0].content = editor.getJSON();
    const output = renderChapterBody(project.chapters[0], project);
    assert.doesNotMatch(output, /figcaption|textarea|placeholder|이미지를 설명해 보세요/);
});

test('EPUB output wraps text on the requested side and escapes stored captions', () => {
    const project = createProject();
    project.assets = [asset];
    for (const [textWrap, float] of [['left', 'right'], ['right', 'left']]) {
        project.chapters[0].content = { type: 'doc', content: [image({ width: 45, textWrap, caption: '설명 <>&', alt: '기존 대체', decorative: true }), paragraph('본문')] };
        validateProject(project);
        const output = renderChapterBody(project.chapters[0], project);
        assert.match(output, new RegExp(`data-text-wrap="${textWrap}" style="width:45%;float:${float}`));
        assert.match(output, /<figcaption>설명 &lt;&gt;&amp;<\/figcaption>/);
        assert.match(output, /alt="" role="presentation"/);
    }
});

test('project validation rejects unsupported wrap and decorative values', () => {
    const project = createProject();
    project.assets = [asset];
    for (const attrs of [{ textWrap: 'center' }, { textWrap: 'float:right;position:fixed' }, { decorative: 'yes' }, { caption: 'x'.repeat(2001) }]) {
        project.chapters[0].content = { type: 'doc', content: [image(attrs)] };
        assert.throws(() => validateProject(project));
    }
});

test('pixel widths survive editing, clipboard serialization, wrapping and EPUB rendering', t => {
    const { editor, extension } = fixture(t, { width: 320, widthUnit: 'px', caption: 'Fixed size' });
    const before = editor.getJSON();
    editor.commands.updateAttributes('image', { width: 480 });
    assert.equal(editor.getAttributes('image').widthUnit, 'px');
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true);
    const attrs = editor.getAttributes('image');
    assert.deepEqual(imageTextWrapPatch(attrs, 'left'), { width: 480, textWrap: 'left' });
    const html = extension.config.renderHTML({ node: editor.state.doc.firstChild });
    assert.match(html[1].style, /width:480px;.*max-width:100%/);
    assert.equal(html[1]['data-width-unit'], 'px');
    const element = { getAttribute: name => html[1][name] ?? null, querySelector: selector => selector === 'img' ? { getAttribute: () => '' } : { textContent: 'Fixed size' } };
    const parsed = extension.config.parseHTML()[0].getAttrs(element);
    assert.equal(parsed.width, 480);
    assert.equal(parsed.widthUnit, 'px');
    const project = createProject();
    project.assets = [asset];
    project.chapters[0].content = editor.getJSON();
    validateProject(project);
    assert.match(renderChapterBody(project.chapters[0], project), /width:480px;.*max-width:100%/);
});

test('image unit conversion retains the displayed width and accepts small ornaments', () => {
    assert.deepEqual(convertImageWidth({ width: 50 }, 'px', 640), { width: 320, widthUnit: 'px' });
    assert.deepEqual(convertImageWidth({ width: 320, widthUnit: 'px' }, '%', 640), { width: 50, widthUnit: '%' });
    assert.deepEqual(convertImageWidth({ width: 1200, widthUnit: 'px' }, '%', 640), { width: 100, widthUnit: '%' });
    const project = createProject();
    project.assets = [asset];
    for (const attrs of [{ width: 8 }, { width: 1, widthUnit: '%' }, { width: 1, widthUnit: 'px' }, { width: 8192, widthUnit: 'px' }]) {
        project.chapters[0].content = { type: 'doc', content: [image(attrs)] };
        validateProject(project);
    }
    for (const attrs of [{ width: 0 }, { width: 101 }, { width: -1, widthUnit: 'px' }, { width: 8193, widthUnit: 'px' }, { width: Infinity, widthUnit: 'px' }, { width: '320', widthUnit: 'px' }, { widthUnit: 'px;position:fixed' }]) {
        project.chapters[0].content = { type: 'doc', content: [image(attrs)] };
        assert.throws(() => validateProject(project));
    }
});
