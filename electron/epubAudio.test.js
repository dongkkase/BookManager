import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceZipEntry } from './core/zipArchive.js';
import { ViewerSessionManager } from './viewerSessions.js';
import { buildWebApp } from './servers/webServer.js';
import { epubAssetResponseData, parseEpubAudioClock, prepareEpubInlineAudio } from './epubAudio.js';
import { epubTtsText } from './epubTts.js';
import { mapEpubAudioTracks } from '../src/epubAudioContext.js';

function makeWav() {
    const samples = 3200;
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF');
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(8000, 24);
    buffer.writeUInt32LE(16000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index * Math.PI * 2 * 220 / 8000) * 1200), 44 + index * 2);
    return buffer;
}

async function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-epub-audio-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filePath = path.join(root, 'audio.epub');
    fs.writeFileSync(filePath, Buffer.alloc(0));
    const wav = makeWav();
    const entries = {
        'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>',
        'OEBPS/content.opf': `<package><metadata><dc:title>Audio EPUB</dc:title></metadata><manifest>
            <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay" />
            <item id="only" href="text/only.xhtml" media-type="application/xhtml+xml" />
            <item id="overlay" href="media/chapter.smil" media-type="application/smil+xml" />
            <item id="sound" href="audio/tone.wav" media-type="audio/wav" />
            </manifest><spine><itemref idref="chapter" /><itemref idref="only" /></spine></package>`,
        'OEBPS/text/chapter.xhtml': `<html><head><style>body { background-image: url('../audio/tone.wav'); }</style></head><body>
            <h1>본문 소리</h1><section id="spoken"><p>낭독과 연결된 문단입니다.</p></section>
            <audio id="rain" title="빗소리" loop controls><source src="https://example.invalid/remote.mp3" /><source src="../audio/tone.wav" /></audio>
            <p>소리 이후 본문입니다.</p><audio src="../audio/missing.wav"></audio></body></html>`,
        'OEBPS/text/only.xhtml': '<html><body><audio src="../audio/tone.wav" /></body></html>',
        'OEBPS/media/chapter.smil': `<smil><body><seq><par id="one"><text src="../text/chapter.xhtml#spoken" /><audio src="../audio/tone.wav" clipBegin="100ms" clipEnd="00:00:00.300" /></par>
            <par><text src="../text/chapter.xhtml#spoken" /><audio src="../audio/tone.wav" clipBegin="0.3s" clipEnd="0.2s" /></par>
            <par><text src="../text/chapter.xhtml#spoken" /><audio src="https://example.invalid/no.wav" /></par>
            </seq></body></smil>`,
        'OEBPS/audio/tone.wav': wav,
        'OEBPS/secret.txt': 'private document',
    };
    for (const [name, data] of Object.entries(entries)) await replaceZipEntry(filePath, name, data);
    return { root, filePath, wav };
}

test('EPUB inline audio와 SMIL은 본문 위치, 소스, 반복, clip 시간을 연결한다', async t => {
    const { filePath, wav } = await fixture(t);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, { skipAdjacent: true });
    const result = await manager.getEpubText(session.id);
    const chapter = result.chapters[0];
    assert.equal(chapter.audioTracks.length, 2);
    const inline = chapter.audioTracks.find(track => track.kind === 'inline');
    assert.equal(inline.title, '빗소리');
    assert.equal(inline.anchor, 'rain');
    assert.equal(inline.loop, true);
    assert.deepEqual(inline.sources.map(source => source.type), ['audio/wav']);
    assert.equal(inline.clipBegin, 0);
    assert.equal(inline.clipEnd, null);
    const inlineBlock = chapter.blocks.find(block => block.audioTracks?.includes(inline.id));
    assert.ok(inlineBlock.hasAudio);
    assert.ok(inlineBlock.anchors.includes('rain'));
    assert.match(chapter.original.html, /<audio[^>]*id="rain"[^>]*data-bookmanager-audio-track=/);
    assert.equal((chapter.original.html.match(/id="rain"/g) || []).length, 1);
    const overlay = chapter.audioTracks.find(track => track.kind === 'overlay');
    assert.equal(overlay.anchor, 'spoken');
    assert.equal(overlay.clipBegin, 0.1);
    assert.equal(overlay.clipEnd, 0.3);
    assert.equal(overlay.loop, false);
    assert.match(overlay.text, /낭독과 연결/);
    assert.ok(chapter.blocks.find(block => block.anchors?.includes('spoken')).audioTracks.includes(overlay.id));
    const only = result.chapters[1];
    assert.equal(only.originalOnly, undefined);
    assert.equal(only.blocks[0].hasAudio, true);
    assert.equal(only.audioTracks[0].anchor, 'bookmanager-epub-audio-1');
    assert.match(only.original.html, /id="bookmanager-epub-audio-1"/);
    const asset = await manager.getDocumentAssetFromRequest(inline.sources[0].src);
    assert.equal(asset.mime, 'audio/wav');
    assert.deepEqual(asset.buffer, wav);
    assert.equal(await manager.getDocumentAssetFromRequest(inline.sources[0].src), asset, '다음 range 요청은 압축 해제한 오디오를 재사용한다');
    const denied = inline.sources[0].src.replace('audio/tone.wav', 'secret.txt');
    assert.equal(await manager.getDocumentAssetFromRequest(denied), null);
    await replaceZipEntry(filePath, 'OEBPS/audio/tone.wav', Buffer.from('changed'));
    assert.equal((await manager.getDocumentAssetFromRequest(inline.sources[0].src)).buffer.toString(), 'changed');
});

test('EPUB 오디오 parser는 script/comment를 무시하고 생성 anchor 충돌과 잘못된 시각을 피한다', () => {
    const result = prepareEpubInlineAudio('<html><body><p id="bookmanager-epub-audio-1">본문</p><!-- <audio src="bad.wav"></audio> --><script>"<audio src=bad.wav></audio>"</script><audio src="good.wav"></audio></body></html>', 'one.xhtml', (_base, href) => href === 'good.wav' ? { src: 'safe.wav', type: 'audio/wav', name: href } : null);
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].anchor, 'bookmanager-epub-audio-1-audio');
    assert.match(result.html, /<audio src="good.wav" id="bookmanager-epub-audio-1-audio"/);
    const selfClosed = prepareEpubInlineAudio('<audio id=existing src=good.wav/>', 'one.xhtml', () => ({ src: 'safe.wav', type: 'audio/wav' }));
    assert.equal(selfClosed.tracks[0].anchor, 'existing');
    assert.match(selfClosed.html, /id="existing"[^>]*\/>$/);
    assert.equal(parseEpubAudioClock('02:30'), 150);
    assert.equal(parseEpubAudioClock('01:02:03.5'), 3723.5);
    assert.equal(parseEpubAudioClock('2.5min'), 150);
    assert.equal(parseEpubAudioClock('npt=0.25s'), 0.25);
    for (const invalid of ['-1s', '1e99', '00:60:00', '1:90', 'foo']) assert.equal(parseEpubAudioClock(invalid), null);
});

test('audio appearance and volume metadata preserve defaults and bound malformed values', () => {
    const resolve = (_base, href) => ({ src: `safe:${href}`, type: 'audio/wav', name: href });
    const result = prepareEpubInlineAudio([
        '<audio src="legacy.wav" controls></audio>',
        '<audio src="hidden.wav" controls loop data-bookmanager-audio-controls="false" data-bookmanager-audio-volume="0.35"></audio>',
        '<audio src="silent.wav" data-bookmanager-audio-controls="true" data-bookmanager-audio-volume="0"></audio>',
        ...['-2', '9', 'invalid', ''].map(value => `<audio src="${value}.wav" data-bookmanager-audio-volume="${value}"></audio>`),
    ].join(''), 'chapter.xhtml', resolve);
    assert.deepEqual(result.tracks.map(track => track.controls), [true, false, true, false, false, false, false]);
    assert.deepEqual(result.tracks.map(track => track.volume), [1, 0.35, 0, 0, 1, 1, 1]);
    assert.equal(result.tracks[1].loop, true);
    assert.match(result.optimizedHtml, /data-bookmanager-audio-track="inline:chapter.xhtml:2" data-bookmanager-audio-controls="false"/);
});

test('text range audio connects every marked fragment and never uses its stored audio position', async t => {
    const { filePath } = await fixture(t);
    const html = `<html><body>
        <p>Before <span data-bookmanager-audio-range="r_rain">First <strong>range</strong> fragment</span></p>
        <p><span id="second-range" data-bookmanager-audio-range="r_rain">Second fragment</span> after</p>
        <audio id="stored" src="../audio/tone.wav" data-bookmanager-audio-range="r_rain" data-bookmanager-audio-volume="0.3" loop></audio>
        <audio id="orphaned" src="../audio/tone.wav" data-bookmanager-audio-range="r_missing"></audio>
        </body></html>`;
    const parsed = prepareEpubInlineAudio(html, 'chapter.xhtml', (_base, href) => ({ src: `safe:${href}`, type: 'audio/wav' }));
    assert.equal(parsed.tracks[0].rangeId, 'r_rain');
    assert.deepEqual(parsed.tracks[0].triggerAnchors, ['bookmanager-epub-audio-trigger-1', 'second-range']);
    assert.deepEqual(parsed.tracks[1].triggerAnchors, []);
    assert.match(parsed.optimizedHtml, /<span id="stored"><\/span>/);
    assert.match(parsed.optimizedHtml, /<span id="orphaned"><\/span>/);
    await replaceZipEntry(filePath, 'OEBPS/text/chapter.xhtml', html);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, { skipAdjacent: true });
    const chapter = (await manager.getEpubText(session.id)).chapters[0];
    const rangeTrack = chapter.audioTracks.find(track => track.rangeId === 'r_rain');
    const blocks = chapter.blocks.filter(block => block.audioTracks?.includes(rangeTrack.id));
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks.map(block => block.text), ['Before First range fragment', 'Second fragment after']);
    const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
    assert.ok(blocks.every(block => flatten(block.nodes).some(node => node.audioRangeId === 'r_rain' && node.audioRangeTrackId === rangeTrack.id)));
    assert.ok(!chapter.blocks.some(block => block.audioTracks?.includes(chapter.audioTracks.find(track => track.rangeId === 'r_missing').id)));
});

test('visible range controls survive optimization without becoming playback triggers or joining selected words', async t => {
    const { filePath } = await fixture(t);
    const html = `<html><body><p>앞 <span data-bookmanager-audio-range="r_words">첫 단어 </span><span data-bookmanager-audio-range="r_words"><strong>둘째 </strong></span>뒤</p>
        <p><audio id="range-player" controls="controls" data-bookmanager-audio-controls="true" data-bookmanager-audio-range="r_words" src="../audio/tone.wav"></audio></p></body></html>`;
    const prepared = prepareEpubInlineAudio(html, 'chapter.xhtml', (_base, href) => ({ src: `safe:${href}`, type: 'audio/wav' }));
    assert.match(prepared.optimizedHtml, /<span id="range-player" data-bookmanager-audio-track="inline:chapter.xhtml:1" data-bookmanager-audio-controls="true"><\/span>/);
    await replaceZipEntry(filePath, 'OEBPS/text/chapter.xhtml', html);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, { skipAdjacent: true });
    const chapter = (await manager.getEpubText(session.id)).chapters[0];
    const cue = chapter.audioTracks.find(track => track.rangeId === 'r_words');
    const textBlock = chapter.blocks.find(block => block.text);
    const storageBlock = chapter.blocks.find(block => !block.text && block.audioTracks?.includes(cue.id));
    assert.equal(textBlock.text, '앞 첫 단어 둘째 뒤');
    assert.equal(epubTtsText(textBlock.text, textBlock.ttsEdits), '앞 첫 단어 둘째 뒤');
    assert.ok(storageBlock);
    const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
    assert.equal(flatten(storageBlock.nodes).find(node => node.audioTrackId === cue.id).audioControls, undefined);
    const mapping = mapEpubAudioTracks([chapter], [{ name: chapter.name, blocks: [textBlock] }, { name: chapter.name, blocks: [storageBlock] }]);
    assert.equal(mapping.byPage.get(0)[0].id, cue.id);
    assert.equal(mapping.byPage.has(1), false);
});

test('hidden editor audio removes captions and player spacing while preserving its reading position', async t => {
    const { filePath } = await fixture(t);
    await replaceZipEntry(filePath, 'OEBPS/text/chapter.xhtml', `<html><body>
        <p id="before">앞의 문장</p>
        <figure id="hidden-figure" class="audio background" data-bookmanager-audio-controls="false">
            <figcaption>HIDDEN_AUDIO_CAPTION</figcaption>
            <audio id="hidden-audio" src="../audio/tone.wav" loop data-bookmanager-audio-controls="false" data-bookmanager-audio-volume="0.25"></audio>
        </figure>
        <p id="after">뒤의 문장</p>
        <figure class="audio effect" data-bookmanager-audio-controls="true"><figcaption>VISIBLE_AUDIO_CAPTION</figcaption>
            <audio id="visible-audio" src="../audio/tone.wav" controls data-bookmanager-audio-controls="true"></audio>
        </figure></body></html>`);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, { skipAdjacent: true });
    const { chapters } = await manager.getEpubText(session.id);
    const chapter = chapters[0];
    const hidden = chapter.audioTracks.find(track => track.anchor === 'hidden-audio');
    assert.equal(hidden.controls, false);
    assert.equal(hidden.volume, 0.25);
    assert.equal(hidden.loop, true);
    assert.ok(!chapter.text.includes('HIDDEN_AUDIO_CAPTION'));
    assert.ok(chapter.text.includes('VISIBLE_AUDIO_CAPTION'));
    const block = chapter.blocks.find(item => item.audioTracks?.includes(hidden.id));
    assert.equal(block.text, '뒤의 문장');
    assert.ok(block.anchors.includes('hidden-figure'));
    assert.ok(block.anchors.includes('hidden-audio'));
    const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
    const marker = flatten(block.nodes).find(node => node.audioTrackId === hidden.id);
    assert.equal(marker.audioControls, false);
    assert.ok(!chapter.blocks.some(item => !item.text && item.audioTracks?.includes(hidden.id)));
});

test('story sound는 같은 문서의 오디오 ID와 여러 본문 트리거를 연결하고 ID 충돌을 피한다', () => {
    const html = `<html><body>
        <p id=bookmanager-epub-audio-trigger-1>기존 위치</p>
        <p data-story-sound="rain">처음 소리가 나는 본문</p>
        <p><span id="existing-trigger" data-story-sound="rain">두 번째 본문</span></p>
        <p data-story-sound="missing">없는 오디오</p>
        <p data-story-sound="other.xhtml#rain">다른 문서 참조</p>
        <!-- <p data-story-sound="rain">주석</p> -->
        <script>const example = '<p data-story-sound="rain">문자열</p>';</script>
        <audio id="rain" src="rain.wav"></audio><audio id="backup" src="backup.wav"></audio>
        </body></html>`;
    const resolve = (_base, href) => ({ src: `safe:${href}`, type: 'audio/wav', name: href });
    const result = prepareEpubInlineAudio(html, 'one.xhtml', resolve);
    assert.equal(result.tracks.length, 2);
    const track = result.tracks[0];
    assert.equal(track.anchor, 'rain');
    assert.deepEqual(track.triggerAnchors, ['bookmanager-epub-audio-trigger-1-trigger', 'existing-trigger']);
    for (const output of [result.html, result.optimizedHtml]) {
        assert.match(output, /<p data-story-sound="rain" id="bookmanager-epub-audio-trigger-1-trigger">/);
        assert.match(output, /<span data-story-sound="rain" id="existing-trigger">/);
        assert.match(output, /<p data-story-sound="missing">없는 오디오/);
        assert.match(output, /<p data-story-sound="other.xhtml#rain">다른 문서 참조/);
    }
    assert.match(result.html, /<audio[^>]*id="rain"[^>]*data-bookmanager-audio-track="inline:one.xhtml:1"/);
    assert.match(result.optimizedHtml, /<span id="rain"><\/span>/);
    assert.equal(result.tracks[1].triggerAnchors, undefined);
    assert.match(result.optimizedHtml, /<span id="backup" data-bookmanager-audio-track=/);
    const otherChapter = prepareEpubInlineAudio('<p data-story-sound="rain">다른 문서</p><audio id="backup" src="backup.wav"></audio>', 'two.xhtml', resolve);
    assert.equal(otherChapter.tracks[0].triggerAnchors, undefined);
    assert.match(otherChapter.html, /<p data-story-sound="rain">다른 문서/);
});

test('story sound가 연결된 EPUB은 장 끝의 audio 대신 실제 본문 블록에 오디오를 보존한다', async t => {
    const { filePath } = await fixture(t);
    await replaceZipEntry(filePath, 'OEBPS/text/chapter.xhtml', `<html><body>
        <div data-story-sound="rain"><p>첫 트리거 본문</p></div>
        <p>오디오와 연결되지 않은 중간 본문</p>
        <p><span id="second-trigger" data-story-sound="rain">다음 트리거 본문</span></p>
        <p data-story-sound="missing">없는 오디오 참조</p>
        <audio id="rain" style="display:none"><source src="../audio/tone.wav" /></audio>
        </body></html>`);
    const manager = new ViewerSessionManager();
    const session = manager.create(filePath, { skipAdjacent: true });
    const result = await manager.getEpubText(session.id);
    const chapter = result.chapters[0];
    const track = chapter.audioTracks.find(item => item.kind === 'inline');
    assert.equal(track.anchor, 'rain');
    assert.deepEqual(track.triggerAnchors, ['bookmanager-epub-audio-trigger-1', 'second-trigger']);
    const linked = chapter.blocks.filter(block => block.audioTracks?.includes(track.id));
    assert.equal(linked.length, 2);
    assert.deepEqual(linked.map(block => block.text), ['첫 트리거 본문', '다음 트리거 본문']);
    assert.ok(linked.every(block => block.hasAudio));
    assert.ok(track.triggerAnchors.every(anchor => linked.some(block => block.anchors.includes(anchor))));
    const assertTextNodes = nodes => {
        for (const node of nodes || []) {
            assert.equal(node.audioTrackId, undefined, '본문 트리거는 오디오 버튼용 노드가 되지 않는다');
            assertTextNodes(node.children);
        }
    };
    linked.forEach(block => assertTextNodes(block.nodes));
    assert.equal(linked[0].nodes[0].children[0].text, '첫 트리거 본문');
    assert.equal(linked[1].nodes[0].children[0].children[0].text, '다음 트리거 본문');
    assert.equal(chapter.blocks.some(block => block.anchors?.includes('rain')), false);
    assert.equal(chapter.blocks.find(block => block.text.includes('중간 본문')).hasAudio, undefined);
    assert.match(chapter.original.html, /<audio[^>]*id="rain"/);
    const nextChapterTrack = result.chapters[1].audioTracks[0];
    assert.equal(nextChapterTrack.triggerAnchors, undefined);
    assert.equal(result.chapters[1].blocks[0].hasAudio, true);
});

test('EPUB 오디오 응답은 전체, 부분, suffix, HEAD와 잘못된 범위를 구분한다', () => {
    const asset = { buffer: Buffer.from('0123456789'), mime: 'audio/wav' };
    assert.equal(epubAssetResponseData(asset).body.toString(), '0123456789');
    const partial = epubAssetResponseData(asset, 'bytes=2-5');
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['Content-Range'], 'bytes 2-5/10');
    assert.equal(partial.body.toString(), '2345');
    assert.equal(epubAssetResponseData(asset, 'bytes=-3').body.toString(), '789');
    assert.equal(epubAssetResponseData(asset, 'bytes=8-100').body.toString(), '89');
    const head = epubAssetResponseData(asset, 'bytes=2-5', 'HEAD');
    assert.equal(head.body, null);
    assert.equal(head.headers['Content-Length'], '4');
    for (const invalid of ['bytes=99-', 'bytes=-0', 'bytes=4-1', 'bytes=0-1,3-4', 'invalid']) {
        assert.equal(epubAssetResponseData(asset, invalid).status, 416);
    }
});

test('웹 EPUB 오디오는 변환된 URL로 실제 WAV와 range 및 HEAD 응답을 제공한다', async t => {
    const { root, filePath, wav } = await fixture(t);
    const server = http.createServer(buildWebApp({ dup_check_folders: [root] }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const session = await (await fetch(`${origin}/api/viewer/session?file=${encodeURIComponent(filePath)}`)).json();
        const result = await (await fetch(`${origin}/api/viewer/epub/${session.id}`)).json();
        const source = result.chapters[0].audioTracks[0].sources[0].src;
        assert.match(source, /^\/api\/viewer\/epub-asset\//);
        const url = `${origin}${source}`;
        const response = await fetch(url, { headers: { Range: 'bytes=0-43' } });
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('content-type'), 'audio/wav');
        assert.equal(response.headers.get('content-range'), `bytes 0-43/${wav.length}`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav.subarray(0, 44));
        const head = await fetch(url, { method: 'HEAD' });
        assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(wav.length));
        assert.equal((await head.arrayBuffer()).byteLength, 0);
        const invalid = await fetch(url, { headers: { Range: `bytes=${wav.length}-` } });
        assert.equal(invalid.status, 416);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
