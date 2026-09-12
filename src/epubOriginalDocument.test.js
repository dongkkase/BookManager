import assert from 'node:assert/strict';
import test from 'node:test';
import { epubOriginalViewportMetrics, resolveEpubOriginalReference, resolveEpubOriginalResource, rewriteEpubOriginalCss, rewriteEpubOriginalViewportUnits } from './epubOriginalDocument.js';

const resources = {
    'OPS/Images/picture.jpg': 'bookmanager-document://session/OPS/Images/picture.jpg',
    'OPS/Fonts/book.woff2': 'bookmanager-document://session/OPS/Fonts/book.woff2',
    'OPS/Images/한글.jpg': '/api/viewer/epub-asset/session?asset=OPS%2FImages%2F%ED%95%9C%EA%B8%80.jpg',
};

test('original EPUB reader margins reduce the inner viewport without changing the outer page', () => {
    assert.deepEqual(epubOriginalViewportMetrics({ width: 400, height: 600 }, { horizontalPadding: 30, verticalPadding: 40 }), {
        outerWidth: 400, outerHeight: 600, horizontalPadding: 30, verticalPadding: 40, width: 340, height: 520, displayScale: 1,
    });
    const zoomed = epubOriginalViewportMetrics({ width: 400, height: 600 }, { horizontalPadding: 30, verticalPadding: 40 }, 1.5);
    assert.equal(zoomed.outerWidth, 600);
    assert.equal(zoomed.horizontalPadding, 30);
    assert.equal(zoomed.verticalPadding, 40);
    assert.equal(zoomed.width, 360);
    assert.equal(zoomed.height, 546);
});

test('reader margins preserve usable content in small windows and leave defaults unchanged', () => {
    const small = epubOriginalViewportMetrics({ width: 100, height: 120 }, { horizontalPadding: 80, verticalPadding: 80 });
    assert.equal(small.width, 40);
    assert.equal(small.height, 40);
    const original = epubOriginalViewportMetrics({ width: 400, height: 600 });
    assert.equal(original.width, 400);
    assert.equal(original.height, 600);
    assert.equal(original.horizontalPadding, 0);
    assert.equal(original.verticalPadding, 0);
    assert.equal(epubOriginalViewportMetrics({ width: 48, height: 600 }, undefined, 0.7).width, 48);
});

test('original EPUB links resolve parent paths and encoded anchors against the chapter', () => {
    assert.deepEqual(resolveEpubOriginalReference('../Text/next.xhtml#%ED%95%9C%EA%B8%80', 'OPS/Text/chapter.xhtml'), { entryName: 'OPS/Text/next.xhtml', anchor: '한글' });
    assert.deepEqual(resolveEpubOriginalReference('#note', 'OPS/Text/chapter.xhtml'), { entryName: 'OPS/Text/chapter.xhtml', anchor: 'note' });
    assert.equal(resolveEpubOriginalReference('javascript:alert(1)', 'OPS/Text/chapter.xhtml'), null);
    assert.equal(resolveEpubOriginalReference('//remote.test/a', 'OPS/Text/chapter.xhtml'), null);
});

test('original EPUB resources accept only mapped local assets or supported embedded images and fonts', () => {
    assert.equal(resolveEpubOriginalResource('../Images/picture.jpg', 'OPS/Text/chapter.xhtml', resources), resources['OPS/Images/picture.jpg']);
    assert.equal(resolveEpubOriginalResource('../Images/%ED%95%9C%EA%B8%80.jpg', 'OPS/Text/chapter.xhtml', resources), resources['OPS/Images/한글.jpg']);
    assert.equal(resolveEpubOriginalResource('https://remote.test/track.png', 'OPS/Text/chapter.xhtml', resources), '');
    assert.equal(resolveEpubOriginalResource('file:///etc/hosts', '', resources), '');
    assert.equal(resolveEpubOriginalResource('data:text/html;base64,abc', '', resources), '');
    assert.equal(resolveEpubOriginalResource('data:image/png;base64,abc', '', resources), 'data:image/png;base64,abc');
});

test('mapped EPUB audio remains unavailable to CSS image and font resource rewriting', () => {
    const audioUrl = 'bookmanager-document://session/OPS/Audio/voice.wav';
    const combined = { ...resources, 'OPS/Audio/voice.wav': audioUrl };
    assert.equal(resolveEpubOriginalResource('../Audio/voice.wav', 'OPS/Text/chapter.xhtml', combined), '');
    assert.equal(resolveEpubOriginalResource(audioUrl, 'OPS/Text/chapter.xhtml', combined), '');
    const rewritten = rewriteEpubOriginalCss(`p{background:url("../Audio/voice.wav")}@font-face{font-family:Audio;src:url("${audioUrl}")}`, 'OPS/Text/chapter.xhtml', combined);
    assert.equal((rewritten.match(/url\("about:blank"\)/g) || []).length, 2);
    assert.ok(!rewritten.includes('voice.wav'));
});

test('publisher CSS keeps declarations while resolving fonts and stripping network imports', () => {
    const css = '@import "https://remote.test/style.css"; @font-face {font-family: Book; src:url("../Fonts/book.woff2")} p { color:red; background:url(https://remote.test/track.png); }';
    const rewritten = rewriteEpubOriginalCss(css, 'OPS/Text/chapter.xhtml', resources);
    assert.ok(rewritten.includes(`url("${resources['OPS/Fonts/book.woff2']}")`));
    assert.ok(rewritten.includes('color:red'));
    assert.ok(rewritten.includes('url("about:blank")'));
    assert.ok(!rewritten.includes('@import'));
    assert.ok(!rewritten.includes('remote.test'));
});

test('scroll viewport dimensions stay tied to the viewer instead of the growing document', () => {
    const css = 'body{min-height:100vh;margin:8px;width:90vw;padding:2vmin 3vmax;top:calc(50vh - 10px)}';
    assert.equal(rewriteEpubOriginalViewportUnits(css, { width: 400, height: 600 }), 'body{min-height:600px;margin:8px;width:360px;padding:8px 18px;top:calc(300px - 10px)}');
    assert.equal(rewriteEpubOriginalViewportUnits('height:100dvh;min-height:100svh;max-height:100lvh;width:50dvw;padding:2svmin 2lvmax', { width: 400, height: 600 }), 'height:600px;min-height:600px;max-height:600px;width:200px;padding:8px 12px');
});

test('publisher CSS preserves literal URL text and resolves escaped resource paths', () => {
    const css = String.raw`.label::before { content: 'url(keep.png) @import "keep.css";'; background: url('../Images/pict\75 re.jpg'); } /* url(comment.png) */`;
    const rewritten = rewriteEpubOriginalCss(css, 'OPS/Text/chapter.xhtml', resources);
    assert.ok(rewritten.includes(`content: 'url(keep.png) @import "keep.css";'`));
    assert.ok(rewritten.includes(`url("${resources['OPS/Images/picture.jpg']}")`));
    assert.ok(rewritten.includes('/* url(comment.png) */'));
});

test('viewport rewriting preserves media conditions, strings, comments, URLs and unrelated units', () => {
    const css = '@media (min-height:100vh){@supports(height:100dvh){.size100vh{height:80vh;content:"100vh";background:url(images/100vh.png);--label:"50vw";padding:2em}}} /* 20vh */';
    assert.equal(rewriteEpubOriginalViewportUnits(css, { width: 400, height: 600 }), '@media (min-height:100vh){@supports(height:100dvh){.size100vh{height:480px;content:"100vh";background:url(images/100vh.png);--label:"50vw";padding:2em}}} /* 20vh */');
    assert.equal(rewriteEpubOriginalViewportUnits('top:-.5VH;left:+2.5vw;height:1e2vh;--100vh:1px', { width: 400, height: 600 }), 'top:-3px;left:10px;height:600px;--100vh:1px');
});

test('resource CSS rewriting fixes viewport units only when a scroll viewport is provided', () => {
    const css = 'body{min-height:100vh;background:url("../Images/picture.jpg")}';
    assert.ok(rewriteEpubOriginalCss(css, 'OPS/Text/chapter.xhtml', resources).includes('min-height:100vh'));
    const rewritten = rewriteEpubOriginalCss(css, 'OPS/Text/chapter.xhtml', resources, { width: 400, height: 600 });
    assert.ok(rewritten.includes('min-height:600px'));
    assert.ok(rewritten.includes(`url("${resources['OPS/Images/picture.jpg']}")`));
});
