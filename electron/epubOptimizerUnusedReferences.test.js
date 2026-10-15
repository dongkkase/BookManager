import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { inspectUnusedResources } from './epubOptimizer/unusedResources.js';

const asset = (name, kind = 'image', extra = {}) => ({ name, kind, mediaType: kind === 'font' ? 'font/ttf' : kind === 'audio' ? 'audio/mpeg' : 'image/png', ...extra });
const text = (name, source, mediaType = 'application/xhtml+xml') => ({ name, mediaType, data: Buffer.from(source) });
const xhtml = content => `<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>${content}</body></html>`;
const opf = content => ({ name: 'OPS/book.opf', document: new DOMParser().parseFromString(`<package xmlns="http://www.idpf.org/2007/opf">${content}</package>`, 'application/xml') });

test('only unused media are removable; OPF manifest registration is not a usage reference', () => {
    const resources = [asset('OPS/used.png'), asset('OPS/orphan.png'), asset('OPS/orphan.ttf', 'font'), asset('OPS/orphan.mp3', 'audio'), { name: 'OPS/keep.bin', kind: 'other' }];
    const result = inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<img src="used.png"/>'))], packageDocuments: [opf('<manifest><item id="i" href="orphan.png"/><item id="f" href="orphan.ttf"/><item id="a" href="orphan.mp3"/></manifest>')] });
    assert.deepEqual(result, { unusedNames: ['OPS/orphan.png', 'OPS/orphan.ttf', 'OPS/orphan.mp3'], uncertain: false });
});

test('CSS urls, imports, image-set strings, inline styles, and retained unused stylesheets protect references', () => {
    const resources = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'].map(name => asset(`OPS/${name}`));
    resources.push(asset('OPS/fonts/body.ttf', 'font'), asset('OPS/unused.png'));
    const result = inspectUnusedResources({ resources, textResources: [
        text('OPS/css/style.css', '@import "../a.png"; @font-face { font-family: Body; src:url("../fonts/body.ttf") } p {background: image-set("../b.png" 1x, "../c.png" 2x)}', 'text/css'),
        text('OPS/chapter.xhtml', xhtml('<style>p {background:url(d.png)}</style><p style="background:url(e.png)">Text</p>')),
    ] });
    assert.deepEqual(result, { unusedNames: ['OPS/unused.png'], uncertain: false });
});

test('SVG, SMIL, NCX, srcset, audio sources, poster, and object references are preserved', () => {
    const names = ['svg.png', 'fill.png', 'filter.png', 'smil.mp3', 'ncx.png', 'small.png', 'large.png', 'audio.mp3', 'poster.png', 'object.png'];
    const resources = names.map(name => asset(`OPS/${name}`, name.endsWith('.mp3') ? 'audio' : 'image'));
    resources.push(asset('OPS/unused.png'));
    const result = inspectUnusedResources({ resources, textResources: [
        text('OPS/vector.svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="svg.png"/><rect fill="url(fill.png#pattern)" filter="url(filter.png#effect)"/></svg>', 'image/svg+xml'),
        text('OPS/timing.smil', '<smil><body><seq><audio src="smil.mp3#t=1,2"/></seq></body></smil>', 'application/smil+xml'),
        text('OPS/toc.ncx', '<ncx><content src="ncx.png"/></ncx>', 'application/x-dtbncx+xml'),
        text('OPS/chapter.xhtml', xhtml('<img srcset="small.png 1x, large.png 2x"/><audio><source src="audio.mp3"/></audio><video poster="poster.png"/><object data="object.png"/>')),
    ] });
    assert.deepEqual(result, { unusedNames: ['OPS/unused.png'], uncertain: false });
});

test('OPF cover, spine, nav, fallback, overlay, bindings, guide, and metadata references protect their targets', () => {
    const names = ['cover.png', 'cover2.png', 'spine.png', 'nav.png', 'fallback.png', 'style.ttf', 'overlay.mp3', 'handler.png', 'guide.png', 'refined.png', 'unused.png'];
    const resources = names.map(name => asset(`OPS/${name}`));
    const manifest = names.map((name, index) => `<item id="i${index}" href="${name}" ${index === 1 ? 'properties="cover-image"' : index === 3 ? 'properties="nav"' : index === 10 ? 'fallback="i4" fallback-style="i5" media-overlay="i6"' : ''}/>`).join('');
    const result = inspectUnusedResources({ resources, packageDocuments: [opf(`<metadata><meta name="cover" content="i0"/><meta refines="#i9">metadata</meta></metadata><manifest>${manifest}</manifest><spine><itemref idref="i2"/></spine><bindings><mediaType handler="i7"/></bindings><guide><reference type="cover" href="guide.png"/></guide>`)] });
    assert.deepEqual(result, { unusedNames: ['OPS/unused.png'], uncertain: false });
});

test('cover flags, encrypted fonts, protected names, and META-INF resources are never removed', () => {
    const resources = [asset('cover.png', 'image', { isCover: true }), asset('font.ttf', 'font', { encrypted: true }), asset('keep.mp3', 'audio'), asset('META-INF/private.png'), asset('orphan.png')];
    assert.deepEqual(inspectUnusedResources({ resources, protectedNames: ['keep.mp3'] }), { unusedNames: ['orphan.png'], uncertain: false });
});

test('percent encoding, Unicode normalization, query strings, fragments, and CSS escapes resolve safely', () => {
    const decomposed = 'OPS/표지.png';
    const resources = [asset(decomposed), asset('OPS/a b.png'), asset('OPS/unused.png')];
    const result = inspectUnusedResources({ resources, textResources: [
        text('OPS/chapter.xhtml', xhtml(`<img src="${encodeURIComponent('표지.png')}?size=large#page"/>`)),
        text('OPS/styles.css', 'body{background:url("a\\20 b.png")}', 'text/css'),
    ] });
    assert.deepEqual(result, { unusedNames: ['OPS/unused.png'], uncertain: false });
});

test('standard XHTML named entities are handled without interpreting decoded markup', () => {
    const resources = [asset('OPS/표지.png'), asset('OPS/orphan.png')];
    const result = inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<p>&nbsp;&mdash;&lt;img src=&quot;orphan.png&quot;/&gt;</p><img src="표지.png"/>'))] });
    assert.deepEqual(result, { unusedNames: ['OPS/orphan.png'], uncertain: false });
    assert.deepEqual(inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<p>&unknownentity;</p>'))] }), { unusedNames: [], uncertain: true });
});

test('exact paths take priority and ambiguous case or Unicode references block removal', () => {
    const resources = [asset('OPS/Cover.png'), asset('OPS/cover.png')];
    assert.deepEqual(inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<img src="Cover.png"/>'))] }), { unusedNames: ['OPS/cover.png'], uncertain: false });
    assert.deepEqual(inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<img src="COVER.png"/>'))] }), { unusedNames: [], uncertain: true });
});

test('ambiguous comma-separated srcset tokens block removal while exact comma filenames remain protected', () => {
    const resources = [asset('OPS/a.png'), asset('OPS/b.png'), asset('OPS/unused.png')];
    const textResources = [text('OPS/chapter.xhtml', xhtml('<img srcset="a.png,b.png"/>'))];
    assert.deepEqual(inspectUnusedResources({ resources, textResources }), { unusedNames: [], uncertain: true });
    assert.deepEqual(inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml('<img srcset="a.png,b.png,"/>'))] }), { unusedNames: [], uncertain: true });
    const exactResources = [asset('OPS/a.png,b.png'), asset('OPS/unused.png')];
    assert.deepEqual(inspectUnusedResources({ resources: exactResources, textResources }), { unusedNames: ['OPS/unused.png'], uncertain: false });
});

test('local embedded documents of unknown types block removal', () => {
    const resources = [asset('OPS/unused.png'), { name: 'OPS/opaque.bin', kind: 'other', mediaType: 'application/octet-stream' }];
    for (const markup of ['<object data="opaque.bin"/>', '<iframe src="opaque.bin"/>', '<embed src="opaque.bin"/>']) {
        assert.deepEqual(inspectUnusedResources({ resources, textResources: [text('OPS/chapter.xhtml', xhtml(markup))] }), { unusedNames: [], uncertain: true });
    }
});

test('text-based audio playlists block removal of media they could reference', () => {
    const playlists = [
        { name: 'OPS/list.dat', mediaType: 'audio/x-mpegurl' },
        { name: 'OPS/list.dat', mediaType: 'application/vnd.apple.mpegurl' },
        { name: 'OPS/list.dat', mediaType: 'audio/x-scpls' },
        { name: 'OPS/list.dat', mediaType: 'application/playlist+xml' },
        { name: 'OPS/list.dat', mediaType: 'application/xspf+xml' },
        { name: 'OPS/list.m3u', mediaType: 'audio/mpeg' },
        { name: 'OPS/list.m3u8', mediaType: 'application/octet-stream' },
        { name: 'OPS/list.pls', mediaType: 'audio/mpeg' },
        { name: 'OPS/list.xspf', mediaType: 'application/octet-stream' },
    ];
    for (const playlist of playlists) {
        const resources = [asset('OPS/track.mp3', 'audio'), { kind: 'audio', ...playlist }];
        const textResources = [{ ...playlist, data: Buffer.from('<playlist><location>track.mp3</location></playlist>') }];
        assert.deepEqual(inspectUnusedResources({ resources, textResources }), { unusedNames: [], uncertain: true }, playlist.name + ': ' + playlist.mediaType);
    }
});

test('scripts, dynamic references, remote stylesheets, incomplete and malformed content block removal', () => {
    const resources = [asset('unused.png')];
    const documents = [
        text('chapter.xhtml', xhtml('<script>run()</script>')),
        text('chapter.xhtml', xhtml('<p onclick="run()"/>')),
        text('chapter.xhtml', xhtml('<img xml:base="images/" src="cover.png"/>')),
        text('chapter.xhtml', xhtml('<a href="javascript:run()">Link</a>')),
        text('chapter.xhtml', xhtml('<link rel="stylesheet" href="https://example.test/style.css"/>')),
        text('chapter.xhtml', '<html><body><img></body></html>'),
        text('style.css', '@import "https://example.test/style.css";', 'text/css'),
        text('style.css', 'p {background:url(image.png)', 'text/css'),
        text('style.css', 'p {background:url("image.png)}', 'text/css'),
        text('code.js', 'image.src = "unused.png";', 'text/javascript'),
        text('chapter.xhtml', '<?xml version="1.0" encoding="Shift_JIS"?><html/>'),
    ];
    for (const document of documents) {
        assert.deepEqual(inspectUnusedResources({ resources, textResources: [document] }), { unusedNames: [], uncertain: true }, document.data.toString());
    }
    assert.deepEqual(inspectUnusedResources({ resources, incomplete: true }), { unusedNames: [], uncertain: true });
    assert.deepEqual(inspectUnusedResources({ resources: [...resources, { name: 'missing.css', mediaType: 'text/css' }] }), { unusedNames: [], uncertain: true });
    assert.deepEqual(inspectUnusedResources({ resources, packageDocuments: [opf('<manifest><item id="remote" href="https://example.test/style.css" media-type="text/css"/></manifest>')] }), { unusedNames: [], uncertain: true });
});
