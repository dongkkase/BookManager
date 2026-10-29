import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findBinaryPath } from './binaryPolicy.js';
import { ViewerSessionManager } from './viewerSessions.js';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=', 'base64');
const COMIC_INFO = '<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>';
// RAR5 solid archive of the generated images below and dir/ComicInfo.xml.
const NESTED_RAR = Buffer.from(
    'UmFyIRoHAQAJ78hvCwEFBwQGAQGAgIAA0N7i3SMCAugABLcApIMCL36cEoAdARFkaXIvQ29taWNJbmZvLnhtbMT7ZSVVVDL4NPrGhIs0CiDoNiy7CBFxFwFgkJS1sJkkcocxFlDc1ujm9rdMt7c6BQQlGfVodAZo7//+D3/HT2pu9u6HaOBzTZMatqJTJnU+TRImiR/VNwgSeJFGymNWeaekjv7wtf6QLATksB8CAroABNEApIMCvp6Q0cAdAQ1kaXIvMDEvMDEucG5nQi8356YcrjdxsABw2YsQrW+bZsD3tdt1xS0YsEfHvL693gaaWz56eDi8BskJeuLXyOje7gwjl/cs4LqH/lEfAgKHAATRAKSDAl2ZH1/AHQENZGlyLzAyLzAxLnBuZ0IcBGOR6qAdfI7PHwIChwAE0QCkgwJu5DCWwB0BDWRpci8wMS8wMi5wbmdEGgRlWXqgkhAJ5B8CAocABNEApIMCjeO/GMAdAQ1kaXIvMDIvMDIucG5nQx0EZVn6QKkVskYSAgIAAQDtgwHAAAEGZGlyLzAxE0S73xICAgABAO2DAcAAAQZkaXIvMDI+FVBHDwICAAEA7YMBwAABA2Rpch13VlEDBQQA',
    'base64',
);

function archiveFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmanager-viewer-archives-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sevenZExe = findBinaryPath('7z', { projectRoot: PROJECT_ROOT, pathValue: '' });
    assert.ok(sevenZExe, 'The bundled full 7-Zip executable must be available.');
    assert.ok(sevenZExe.includes(`${path.sep}7zip-bin-full${path.sep}`), 'Use the bundled full 7-Zip, not a system installation.');
    const manager = new ViewerSessionManager({ getSevenZPath: async () => sevenZExe });
    return { root, sevenZExe, manager };
}

function run7z(sevenZExe, args, cwd) {
    const result = spawnSync(sevenZExe, args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
}

function pageBuffer(name) {
    return Buffer.concat([IMAGE, Buffer.from(name)]);
}

function create7z(fixture, fileName, names) {
    const input = path.join(fixture.root, 'input');
    fs.mkdirSync(input);
    for (const name of names) {
        const target = path.join(input, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, pageBuffer(name));
    }
    fs.writeFileSync(path.join(input, 'ComicInfo.xml'), COMIC_INFO);
    fs.mkdirSync(path.join(input, '__MACOSX'));
    fs.writeFileSync(path.join(input, '__MACOSX', '._01.png'), 'metadata');
    fs.mkdirSync(path.join(input, 'empty.png'));
    const filePath = path.join(fixture.root, fileName);
    run7z(fixture.sevenZExe, ['a', '-t7z', '-ms=on', '--', filePath, '.'], input);
    return filePath;
}

async function assertPages(manager, filePath, names) {
    const session = manager.create(filePath, { skipAdjacent: true });
    assert.equal(session.type, 'comic');
    const listed = await manager.listComicPages(session.id);
    assert.equal(listed.readingDirection, 'rtl');
    assert.deepEqual(listed.pages.map(page => page.name), names);
    assert.equal(new Set(listed.pages.map(page => page.pageUrl)).size, names.length);
    for (const [index, page] of listed.pages.entries()) {
        assert.equal(page.index, index);
        assert.equal(page.size, pageBuffer(page.name).length);
        const result = await manager.getComicPageDataFromRequest(page.pageUrl);
        assert.equal(result.mime, 'image/png');
        assert.deepEqual(result.buffer, pageBuffer(page.name));
    }
}

const STRUCTURES = [
    ['alpha', ['dir/01.png', 'dir/02.png', 'dir/03.png']],
    ['beta', ['01/01.png', '01/02.png', '02/01.png', '02/02.png']],
    ['gamma', ['dir/01/01.png', 'dir/01/02.png', 'dir/02/01.png', 'dir/02/02.png']],
];

for (const extension of ['7z', 'cb7']) {
    for (const [name, pages] of STRUCTURES) {
        test(`${extension} 뷰어는 ${name} 폴더 구조의 모든 이미지를 경로 순서대로 읽는다`, async t => {
            const fixture = archiveFixture(t);
            const filePath = create7z(fixture, `${name}.${extension}`, [...pages].reverse());
            await assertPages(fixture.manager, filePath, pages);
        });
    }
}

for (const extension of ['rar', 'cbr', 'RAR']) {
    test(`${extension} 뷰어는 RAR5 solid 압축의 중첩 폴더와 중복 이미지 이름을 읽는다`, async t => {
        const fixture = archiveFixture(t);
        const filePath = path.join(fixture.root, `gamma.${extension}`);
        fs.writeFileSync(filePath, NESTED_RAR);
        await assertPages(fixture.manager, filePath, STRUCTURES[2][1]);
    });
}

test('7z 뷰어는 폴더와 페이지의 숫자를 자연 정렬하고 느낌표 표지를 먼저 읽는다', async t => {
    const fixture = archiveFixture(t);
    const names = ['dir/10/1.png', 'dir/2/10.png', 'dir/2/2.png', 'dir/1/2.png', 'extra/!cover.png'];
    const filePath = create7z(fixture, 'natural.7z', names);
    await assertPages(fixture.manager, filePath, [...names].reverse());
});

test('7z 뷰어는 유니코드 원본 경로와 와일드카드 문자가 든 페이지를 정확히 한 장씩 읽는다', async t => {
    const fixture = archiveFixture(t);
    const names = ['page1.png', 'page2.png', 'page3.png', 'page4.png', 'page5.png'];
    const filePath = create7z(fixture, 'literal.7z', names);
    const originalName = '한글/01?.png'.normalize('NFD');
    const renamed = [originalName, '한글/01a.png'.normalize('NFD'), '@page.png', '-page.png', '한글/01*.png'.normalize('NFD')];
    run7z(fixture.sevenZExe, ['rn', '-spd', '--', filePath, ...names.flatMap((name, index) => [name, renamed[index]])]);

    const session = fixture.manager.create(filePath, { skipAdjacent: true });
    const listed = await fixture.manager.listComicPages(session.id);
    assert.equal(listed.pages.length, names.length);
    for (const [index, name] of renamed.entries()) {
        const page = listed.pages.find(entry => entry.name === name);
        assert.ok(page, `The original archive name must be preserved: ${name}`);
        const result = await fixture.manager.getComicPageDataFromRequest(page.pageUrl);
        assert.deepEqual(result.buffer, pageBuffer(names[index]));
    }
});
