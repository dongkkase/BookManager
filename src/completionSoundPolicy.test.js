import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPlayCompletionSound } from './completionSoundPolicy.js';

test('완료음 OFF, 성공 없음, 취소 작업에서는 완료음을 재생하지 않는다', () => {
    assert.equal(shouldPlayCompletionSound({ play_sound: false }, 1, false), false);
    assert.equal(shouldPlayCompletionSound({ play_sound: true }, 0, false), false);
    assert.equal(shouldPlayCompletionSound({ play_sound: true }, 1, true), false);
    assert.equal(shouldPlayCompletionSound({ play_sound: true }, 1, false), true);
});
