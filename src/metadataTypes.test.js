import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUDIO_EXTENSIONS,
    extensionFromFile,
    isAudioFile,
    resolveBookType,
} from './metadata/metadataTypes.js';

test('Readive 호환 오디오 확장자는 오디오북으로 분류한다', () => {
    for (const extension of AUDIO_EXTENSIONS) {
        assert.equal(resolveBookType({ path: `/library/book${extension}` }), 'audio');
        assert.equal(isAudioFile({ ext: extension.toUpperCase() }), true);
    }
    assert.equal(resolveBookType({ path: '/library/book.mp4' }), 'comic');
});

test('명시적인 audiobook 유형과 대소문자 확장자를 정규화한다', () => {
    assert.equal(resolveBookType({ book_type: 'Audiobook' }), 'audio');
    assert.equal(resolveBookType({ mediaType: 'audio-book' }), 'audio');
    assert.equal(extensionFromFile({ path: 'C:\\Books\\Story.M4B' }), '.m4b');
});
