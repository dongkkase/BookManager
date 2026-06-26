import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundCommand, normalizeSoundFilename } from './soundPolicy.js';

test('사운드 파일명은 mp3와 wav의 단일 파일명만 허용한다', () => {
    assert.equal(normalizeSoundFilename('Default.wav'), 'Default.wav');
    assert.equal(normalizeSoundFilename('Ara Ara.mp3'), 'Ara Ara.mp3');
    assert.equal(normalizeSoundFilename('../secret.wav'), '');
    assert.equal(normalizeSoundFilename('sound.ogg'), '');
});

test('macOS와 Windows 사운드 실행은 shell 문자열 대신 인자 배열을 사용한다', () => {
    const mac = createSoundCommand('darwin', '/tmp/Ara Ara.mp3');
    assert.equal(mac.command, 'afplay');
    assert.deepEqual(mac.args, ['/tmp/Ara Ara.mp3']);

    const windows = createSoundCommand('win32', 'C:\\Book Manager\\wow.mp3');
    assert.equal(windows.command, 'powershell.exe');
    assert.equal(windows.env.BOOKMANAGER_SOUND_PATH, 'C:\\Book Manager\\wow.mp3');
    assert.equal(windows.args.includes('-Sta'), true);
    assert.equal(windows.args.includes('C:\\Book Manager\\wow.mp3'), false);
    assert.match(windows.args.join(' '), /NaturalDuration\.HasTimeSpan/);
});
