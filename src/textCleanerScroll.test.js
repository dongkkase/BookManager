import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextCleanerScroll } from './textCleanerScroll.js';

test('검색 이동 뒤 여러 프레임에 걸친 스크롤 보정은 동기화를 다시 시작하지 않는다', async () => {
    const editor = new EventTarget();
    let synchronized = 0;
    const scroll = createTextCleanerScroll(editor, () => { synchronized += 1; });
    scroll.move(() => editor.dispatchEvent(new Event('scroll')));
    for (let frame = 0; frame < 4; frame += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
        editor.dispatchEvent(new Event('scroll'));
    }
    assert.equal(synchronized, 0);
    scroll.destroy();
});

test('검색 이동 뒤 휠·터치·스크롤바·키보드·편집으로 이동하면 동기화를 재개한다', () => {
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown', 'beforeinput']) {
        const editor = new EventTarget();
        let synchronized = 0;
        const scroll = createTextCleanerScroll(editor, () => { synchronized += 1; });
        scroll.move(() => {});
        editor.dispatchEvent(new Event(type));
        editor.dispatchEvent(new Event('scroll'));
        assert.equal(synchronized, 1, type);
        scroll.destroy();
    }
});

test('반대편 편집기를 맞춘 결과가 원래 편집기로 되돌아오지 않는다', () => {
    const source = new EventTarget();
    const result = new EventTarget();
    let sourceUpdates = 0;
    let resultUpdates = 0;
    const sourceScroll = createTextCleanerScroll(source, () => {
        sourceUpdates += 1;
        resultScroll.move(() => result.dispatchEvent(new Event('scroll')));
    });
    const resultScroll = createTextCleanerScroll(result, () => { resultUpdates += 1; });
    source.dispatchEvent(new Event('wheel'));
    source.dispatchEvent(new Event('scroll'));
    result.dispatchEvent(new Event('scroll'));
    assert.equal(sourceUpdates, 1);
    assert.equal(resultUpdates, 0);
    result.dispatchEvent(new Event('pointerdown'));
    result.dispatchEvent(new Event('scroll'));
    assert.equal(resultUpdates, 1);
    sourceScroll.destroy();
    resultScroll.destroy();
});

test('편집기 해제 후에는 스크롤 이벤트를 전달하지 않는다', () => {
    const editor = new EventTarget();
    let synchronized = 0;
    const scroll = createTextCleanerScroll(editor, () => { synchronized += 1; });
    scroll.destroy();
    editor.dispatchEvent(new Event('wheel'));
    editor.dispatchEvent(new Event('scroll'));
    assert.equal(synchronized, 0);
});
