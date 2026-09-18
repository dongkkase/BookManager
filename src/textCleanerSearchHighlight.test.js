import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./tabs/TextCleanerTool.jsx', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function editorCanvasFont'), source.indexOf('const EMPTY_SEARCH_RESULT'));

function createElement() {
    return {
        style: {},
        children: [],
        hidden: true,
        setAttribute() {},
        get firstChild() { return this.textContent ? { textContent: this.textContent } : null; },
        get lastElementChild() { return this.children.at(-1); },
        getBoundingClientRect() { return { left: 0, top: 0 }; },
        appendChild(child) {
            this.children.push(child);
            child.remove = () => this.children.splice(this.children.indexOf(child), 1);
        },
    };
}

function createFixture(rects) {
    const highlight = createElement();
    const editor = {
        offsetWidth: 40, clientWidth: 40, clientHeight: 60, scrollTop: 0, scrollLeft: 0,
        getBoundingClientRect() { return { width: this.boxWidth ?? this.offsetWidth }; },
    };
    const style = {
        fontSize: '10px', fontFamily: 'monospace', lineHeight: '20px',
        paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
        tabSize: '4', wordBreak: 'normal', overflowWrap: 'anywhere', textRendering: 'auto',
    };
    const api = vm.runInNewContext(`${helpers}\n({ searchMirrorGeometry, positionSearchHighlight });`, {
        window: { getComputedStyle: () => style },
        document: {
            body: createElement(),
            createElement: tag => tag === 'canvas'
                ? { getContext: () => ({ measureText: text => ({ width: [...text].length * 10 }) }) }
                : createElement(),
            createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => rects }),
        },
    });
    return { ...api, editor, highlight, mirrorRef: { current: null } };
}

const wrappedRects = [
    { left: 30, top: 0, width: 10, height: 20 },
    { left: 0, top: 20, width: 30, height: 20 },
];

test('가상화 편집기의 검색 강조는 전체 본문을 복제하거나 좌표를 재측정하지 않는다', () => {
    const fixture = createFixture(wrappedRects);
    const matches = [];
    fixture.editor.setSearchMatch = match => matches.push(match);
    const text = { get length() { throw new Error('전체 본문에 접근하면 안 됩니다.'); } };
    const match = { start: 7000000, end: 7000004 };
    assert.equal(fixture.searchMirrorGeometry(fixture.editor, text, match, fixture.mirrorRef), null);
    fixture.positionSearchHighlight(fixture.highlight, fixture.editor, text, match, null, fixture.mirrorRef);
    fixture.positionSearchHighlight(fixture.highlight, fixture.editor, text, null, null, fixture.mirrorRef);
    assert.deepEqual(matches, [match, null]);
    assert.equal(fixture.mirrorRef.current, null);
    assert.equal(fixture.highlight.hidden, true);
});

test('스크롤바가 있어도 편집기의 실제 줄바꿈 폭으로 검색 영역을 측정한다', () => {
    const fixture = createFixture(wrappedRects);
    const { editor, mirrorRef } = fixture;
    editor.offsetWidth = 55;
    fixture.searchMirrorGeometry(editor, 'abcdefgh', { start: 3, end: 7 }, mirrorRef);

    assert.equal(mirrorRef.current.element.style.width, '40px');
    assert.equal(mirrorRef.current.element.style.textRendering, 'auto');
    editor.offsetWidth = 65;
    editor.clientWidth = 50;
    fixture.searchMirrorGeometry(editor, 'abcdefgh', { start: 3, end: 7 }, mirrorRef);
    assert.equal(mirrorRef.current.element.style.width, '50px');
});

test('소수점 너비가 바뀌면 동일한 clientWidth에서도 검색 위치를 다시 측정한다', () => {
    const fixture = createFixture(wrappedRects);
    const { editor, highlight, mirrorRef } = fixture;
    const match = { start: 3, end: 7 };
    editor.offsetWidth = 51;
    editor.boxWidth = 50.5;
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', match, null, mirrorRef);
    const previousGeometry = match.mirrorGeometry;
    assert.equal(mirrorRef.current.element.style.width, '39.5px');

    editor.boxWidth = 50.75;
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', match, null, mirrorRef);
    assert.equal(mirrorRef.current.element.style.width, '39.75px');
    assert.notEqual(match.mirrorGeometry, previousGeometry);
});

test('자동 줄바꿈을 넘는 검색어의 모든 표시 영역을 보관하고 그린다', () => {
    const fixture = createFixture(wrappedRects);
    const { editor, highlight, mirrorRef } = fixture;
    const match = { start: 3, end: 7 };

    const geometry = fixture.searchMirrorGeometry(editor, '가나다외손녀를소동사', match, mirrorRef);
    assert.equal(geometry.rects.length, 2);
    fixture.positionSearchHighlight(highlight, editor, '가나다외손녀를소동사', match, null, mirrorRef);

    assert.equal(highlight.hidden, false);
    assert.equal(highlight.children.length, 2);
    assert.deepEqual(highlight.children.map(child => child.style), [
        { transform: 'translate(30px, 0px)', width: '10px', height: '20px' },
        { transform: 'translate(0px, 20px)', width: '30px', height: '20px' },
    ]);
});

test('검색어 첫 줄이 화면 밖으로 나가도 이어지는 줄을 표시한다', () => {
    const fixture = createFixture(wrappedRects);
    const { editor, highlight, mirrorRef } = fixture;
    const match = { start: 3, end: 7 };
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', match, null, mirrorRef);
    editor.scrollTop = 20;
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', match, null, mirrorRef);

    assert.equal(highlight.hidden, false);
    assert.equal(highlight.children.length, 1);
    assert.equal(highlight.children[0].style.transform, 'translate(0px, 0px)');
    editor.scrollTop = 40;
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', match, null, mirrorRef);
    assert.equal(highlight.hidden, true);
    assert.equal(highlight.children.length, 0);
});

test('검색어가 짧아지거나 검색을 지우면 이전 강조 조각이 남지 않는다', () => {
    const fixture = createFixture(wrappedRects);
    const { editor, highlight, mirrorRef } = fixture;
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', { start: 3, end: 7 }, null, mirrorRef);
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', {
        start: 0, end: 1,
        mirrorGeometry: { editorWidth: 40, editorBoxWidth: 40, rects: [{ left: 0, top: 0, width: 10, height: 20 }] },
    }, null, mirrorRef);

    assert.equal(highlight.children.length, 1);
    assert.equal(highlight.children[0].style.width, '10px');
    fixture.positionSearchHighlight(highlight, editor, 'abcdefgh', null, null, mirrorRef);
    assert.equal(highlight.hidden, true);
});

test('DOM 측정이 없을 때도 화면 줄 인덱스로 여러 줄에 걸친 검색어를 표시한다', () => {
    for (const [text, end, offsets] of [['abcdefgh', 7, [0, 4]], ['abcd\nefgh', 8, [0, 5]]]) {
        const fixture = createFixture([]);
        const { editor, highlight, mirrorRef } = fixture;
        fixture.positionSearchHighlight(highlight, editor, text, { start: 3, end }, {
            visualRowOffsets: offsets,
        }, mirrorRef);

        assert.equal(highlight.children.length, 2);
        assert.equal(highlight.children[0].style.transform, 'translate(30px, 0px)');
        assert.equal(highlight.children[0].style.width, '10px');
        assert.equal(highlight.children[1].style.transform, 'translate(0px, 20px)');
        assert.equal(highlight.children[1].style.width, '30px');
    }
});
