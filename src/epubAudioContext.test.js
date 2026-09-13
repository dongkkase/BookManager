import test from 'node:test';
import assert from 'node:assert/strict';
import { mapEpubAudioTracks } from './epubAudioContext.js';

const track = (id, anchor, extra = {}) => ({ id, anchor, sources: [{ src: `bookmanager-document://session/test/asset/${id}.wav`, type: 'audio/wav' }], ...extra });

test('audio cues follow their own chapter and anchor when optimized and original pagination differ', () => {
    const chapters = [
        { name: 'one.xhtml', audioTracks: [track('one', 'speech')] },
        { name: 'two.xhtml', audioTracks: [track('two', 'speech', { clipBegin: 2, clipEnd: 5 })] },
    ];
    const original = mapEpubAudioTracks(chapters, [
        { name: 'one.xhtml', anchors: ['speech'] },
        { name: 'two.xhtml', anchors: [] },
        { name: 'two.xhtml', anchors: ['speech'] },
    ]);
    assert.deepEqual(original.tracks.map(item => item.pageIndex), [0, 2]);
    assert.deepEqual(original.byChapter.get('one.xhtml').map(item => item.id), ['one']);
    assert.deepEqual(original.byChapter.get('two.xhtml').map(item => item.id), ['two']);
    const optimized = mapEpubAudioTracks(chapters, [
        { name: 'one.xhtml', blocks: [{ anchors: [] }] },
        { name: 'one.xhtml', blocks: [{ anchors: ['speech'] }] },
        { name: 'two.xhtml', blocks: [{ anchors: ['speech'] }] },
    ]);
    assert.deepEqual(optimized.tracks.map(item => item.pageIndex), [1, 2]);
    assert.equal(optimized.byPage.get(2)[0].clipEnd, 5);
});

test('audio-only blocks stay playable without adding fake TTS text', () => {
    const mapped = mapEpubAudioTracks([{ name: 'sound.xhtml', audioTracks: [track('sound', 'hidden-marker')] }], [
        { name: 'sound.xhtml', text: '', blocks: [{ text: '', audioTracks: ['sound'], hasAudio: true }] },
    ]);
    assert.equal(mapped.byPage.get(0)[0].id, 'sound');
});

test('missing text anchors use matching passage text and invalid audio never enters a playlist', () => {
    const mapped = mapEpubAudioTracks([{ name: 'chapter.xhtml', audioTracks: [track('voice', 'missing', { text: '이 문단부터 낭독합니다' }), { id: 'invalid', sources: [] }] }], [
        { name: 'chapter.xhtml', text: '앞의 문단' },
        { name: 'chapter.xhtml', text: '이 문단부터 낭독합니다. 다음 내용입니다.' },
    ]);
    assert.equal(mapped.tracks.length, 1);
    assert.equal(mapped.tracks[0].pageIndex, 1);
});

test('declared passage triggers take priority over audio elements stored on later pages', () => {
    const chapter = { name: 'chapter.xhtml', audioTracks: [track('sound', 'audio-at-end', { triggerAnchors: ['passage', 'second-passage'] })] };
    const mapping = mapEpubAudioTracks([chapter], [
        { name: chapter.name, blocks: [{ anchors: ['passage'] }] },
        { name: chapter.name, anchors: ['second-passage'] },
        { name: chapter.name, blocks: [{ anchors: ['audio-at-end'], audioTracks: ['sound'] }] },
    ]);
    assert.equal(mapping.tracks[0].pageIndex, 0);
    assert.equal(mapping.byPage.get(0)[0].id, 'sound');
    assert.equal(mapping.byPage.get(1)[0].id, 'sound');
    assert.equal(mapping.byPage.has(2), false);
});

test('missing declared triggers do not fall back to the unrelated audio storage location', () => {
    const chapter = { name: 'chapter.xhtml', audioTracks: [track('sound', 'audio-at-end', { triggerAnchors: ['missing'] })] };
    const mapping = mapEpubAudioTracks([chapter], [{ name: chapter.name, anchors: ['audio-at-end'] }]);
    assert.equal(mapping.byPage.size, 0);
    assert.equal(mapping.byChapter.get(chapter.name).length, 1);
});
