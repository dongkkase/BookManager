import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
function section(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing drag pan source: ${start}`);
    return source.slice(from, to);
}
const overflowSource = section('function dragPanOverflowStateForTarget(', 'function zoomAnchorSelectorForTarget(');
const handlersSource = section('const getDragPanTarget =', 'const releaseSwipePointerCapture =');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function fixture({ type = 'pdf', translate = [0, 0], scroll = [0, 0], content = [1200, 1600] } = {}) {
    let scrollLeft = scroll[0];
    let scrollTop = scroll[1];
    let translation = [...translate];
    let styleWrites = 0;
    const capture = new Set();
    const classes = new Set();
    const node = {
        clientWidth: 600, clientHeight: 400,
        scrollWidth: Math.max(600, content[0]), scrollHeight: Math.max(400, content[1]),
        get scrollLeft() { return scrollLeft; },
        set scrollLeft(value) { scrollLeft = clamp(value, 0, this.scrollWidth - this.clientWidth); },
        get scrollTop() { return scrollTop; },
        set scrollTop(value) { scrollTop = clamp(value, 0, this.scrollHeight - this.clientHeight); },
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 }),
        style: {
            getPropertyValue: () => translation.map(value => `${value}px`).join(' '),
            setProperty(name, value) {
                assert.equal(name, '--viewer-zoom-translate');
                translation = value.split(/\s+/).map(Number.parseFloat);
                styleWrites += 1;
            },
        },
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        setPointerCapture: id => capture.add(id),
        hasPointerCapture: id => capture.has(id),
        releasePointerCapture: id => capture.delete(id),
    };
    const target = {
        closest: selector => selector === '.viewer-pdf-text-layer' ? null : target,
        getBoundingClientRect: () => ({
            left: translation[0] - scrollLeft, top: translation[1] - scrollTop,
            right: translation[0] - scrollLeft + content[0], bottom: translation[1] - scrollTop + content[1],
            width: content[0], height: content[1],
        }),
    };
    const state = { current: { active: false } };
    const handlers = new Function('useCallback', 'session', 'scrollRef', 'dragPanRef', 'clamp',
        `${overflowSource}\n${handlersSource}\nreturn { down: handleDragPanPointerDown, move: handleDragPanPointerMove, end: endDragPan, overflow: dragPanOverflowStateForTarget };`)(
        callback => callback, { type }, { current: node }, state, clamp,
    );
    const event = changes => ({
        button: 0, pointerId: 7, clientX: 100, clientY: 80, target,
        preventDefault() { this.prevented = true; }, ...changes,
    });
    return {
        node, target, state, capture, classes, handlers,
        get translation() { return translation; },
        get styleWrites() { return styleWrites; },
        down(changes) { const input = event(changes); handlers.down(input); return input; },
        move(dx, dy, changes) {
            const input = event({ clientX: 100 + dx, clientY: 80 + dy, ...changes });
            handlers.move(input);
            return input;
        },
    };
}

test('일반 PDF와 만화 드래그는 기존 스크롤 방향과 포인터 캡처 동작을 유지한다', () => {
    for (const type of ['pdf', 'comic']) {
        const f = fixture({ type, scroll: [120, 180] });
        assert.equal(f.down().prevented, true);
        assert.equal(f.capture.has(7), true);
        assert.equal(f.classes.has('is-drag-panning'), true);
        assert.equal(f.move(40, 25).prevented, true);
        assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [80, 155]);
        assert.equal(f.styleWrites, 0);
        f.move(-5000, -5000);
        assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [600, 1200]);
        assert.deepEqual(f.translation, [0, 0]);
        f.handlers.end({ pointerId: 7 });
        assert.equal(f.state.current.active, false);
        assert.equal(f.capture.size, 0);
        assert.equal(f.classes.size, 0);
    }
});

test('왼쪽과 위로 잘린 보정 영역은 스크롤 한계에서 끌면 0까지만 복구된다', () => {
    const f = fixture({ translate: [-100, -80], scroll: [50, 40] });
    f.down();
    f.move(30, 20);
    assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [20, 20]);
    assert.deepEqual(f.translation, [-100, -80], 'Native scrolling must be used before changing the offset');
    f.move(80, 70);
    assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [0, 0]);
    assert.deepEqual(f.translation, [-70, -50]);
    f.move(1000, 1000);
    assert.deepEqual(f.translation, [0, 0], 'Dragging past the edge must not create a positive gap');
    f.move(60, 50);
    assert.deepEqual(f.translation, [-90, -70], 'Reversing the same drag must follow its original starting position');
});

test('오른쪽과 아래 보정값은 반대 방향으로 끌면 줄어들며 처음보다 큰 여백을 만들지 않는다', () => {
    const f = fixture({ translate: [70, 60], scroll: [600, 1200] });
    f.down();
    f.move(-20, -15);
    assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [600, 1200]);
    assert.deepEqual(f.translation, [50, 45]);
    f.move(-1000, -1000);
    assert.deepEqual(f.translation, [0, 0]);
    f.move(1000, 2000);
    assert.deepEqual(f.translation, [70, 60]);
    assert.deepEqual([f.node.scrollLeft, f.node.scrollTop], [0, 0]);
});

test('스크롤 범위가 없어도 잘린 이미지는 복구할 수 있고 완전히 보이는 이미지와 다른 포인터는 제외한다', () => {
    const f = fixture({ translate: [-100, -50], content: [400, 300] });
    assert.deepEqual(f.handlers.overflow(f.node, f.target), { canPanX: true, canPanY: true });
    f.down();
    f.move(30, 20, { pointerId: 8 });
    assert.deepEqual(f.translation, [-100, -50]);
    f.move(500, 500);
    assert.deepEqual(f.translation, [0, 0]);
    assert.deepEqual(f.handlers.overflow(f.node, f.target), { canPanX: false, canPanY: false });
    f.handlers.end({ pointerId: 7 });
    assert.equal(f.down().prevented, undefined);
    assert.equal(f.state.current.active, false);
    const textLayer = { closest: selector => selector === '.viewer-pdf-text-layer' ? textLayer : null };
    assert.equal(f.down({ target: textLayer }).prevented, undefined);
    assert.equal(f.down({ button: 2 }).prevented, undefined);
});
