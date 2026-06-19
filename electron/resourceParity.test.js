import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(relativePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(projectRoot, relativePath)))
        .digest('hex');
}

test('원본 폰트와 화면 이미지 리소스의 해시를 유지한다', () => {
    const expected = {
        'src/fonts/Jua-Regular.ttf': 'a1ad0976608d0dd6d298cb01de8431f20e9416b330dd8f58cb0e5f88cee39985',
        'src/fonts/NotoSansKR-Regular.ttf': '8cbc9b353bb9ce848fd69bb6a507319dfacc659cf5fd643db5d88f3c4970e1dd',
        'src/images/draganddrop1.png': 'bce2a6bd510c05c8eb32f572fa501925e09583e5a5c50683cbe314805a9cbe06',
        'src/images/draganddrop2.png': 'ed3911738accd078b1f09080369a1969806aff403783151976709cfe623f9bfb',
        'src/images/draganddrop3.png': '588c5cf99b848b1e16110337867959b186382d98d1756716a3317da071ea4ada',
        'src/images/nodata.png': '53199793b589eb68c7fbaae132fe90774be9e22915db7892070e0238595cf1f7',
        'src/images/nodata2.png': '829d547d8e25953e7d022aac4b26ac75b07ad2661fce41073e948c69b1e0660b',
        'src/images/rainbow cat remix.gif': 'f4f8198c42ee023e90849365868cb50912f7f638e79ed6c8bf1c1b4e54499622',
    };

    for (const [relativePath, expectedHash] of Object.entries(expected)) {
        assert.equal(sha256(relativePath), expectedHash, relativePath);
    }
});

test('원본 완료음 mp3와 wav 15개를 모두 번들 대상에 유지한다', () => {
    const sounds = fs.readdirSync(path.join(projectRoot, 'src', 'sounds'))
        .filter(name => /\.(mp3|wav)$/i.test(name))
        .sort();
    assert.deepEqual(sounds, [
        'Ara Ara.mp3',
        'Default.wav',
        'Demons slayer Cap.mp3',
        'Infinity Castle Gate opening sound.mp3',
        'Legend of Zelda - Rupee.mp3',
        'MadeInAbyss.mp3',
        'Omae wa mou shindeiru.mp3',
        'Ppyu.mp3',
        'Thank you, Onii chan.wav',
        'Title Card I.mp3',
        'Twinkle Sparkle.mp3',
        'YOWAI MO!!!.mp3',
        'complete.wav',
        'meow-1.mp3',
        'wow.mp3',
    ].sort());

    const packageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    assert.equal(packageConfig.build.extraResources.some(item => item.from === 'src' && item.to === 'src'), true);
});
