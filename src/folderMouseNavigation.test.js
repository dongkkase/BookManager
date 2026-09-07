import assert from 'node:assert/strict';
import test from 'node:test';
import { attachFolderMouseNavigation, folderHistoryKeyDirection } from './hooks/useFolderMouseNavigation.js';
import { moveFolderNavigation } from './folderNavigationState.js';

function deferred() {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

function flushNavigation() {
    return new Promise(resolve => setImmediate(resolve));
}

function createHarness({ onNavigate, platform = 'MacIntel' } = {}) {
    const listeners = new Map();
    const moves = [];
    let nativeCallback;
    let time = 0;
    let visible = true;
    let enabled = true;
    const dispose = attachFolderMouseNavigation({
        platform,
        target: {
            addEventListener: (type, callback, capture) => {
                assert.equal(capture, true);
                listeners.set(type, callback);
            },
            removeEventListener: (type, callback, capture) => {
                assert.equal(capture, true);
                assert.equal(listeners.get(type), callback);
                listeners.delete(type);
            },
        },
        subscribeNative: callback => {
            nativeCallback = callback;
            return () => { nativeCallback = undefined; };
        },
        isVisible: () => visible,
        canNavigate: () => enabled,
        onNavigate: direction => {
            moves.push(direction);
            return onNavigate?.(direction);
        },
        now: () => time,
    });
    return {
        moves,
        dispose,
        listeners,
        setVisible: value => { visible = value; },
        setEnabled: value => { enabled = value; },
        advance: milliseconds => { time += milliseconds; },
        native: direction => nativeCallback?.(direction),
        key: properties => {
            const event = {
                ...properties,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() { this.propagationStopped = true; },
            };
            listeners.get('keydown')?.(event);
            return event;
        },
        mouse: (type, button) => {
            const event = {
                type,
                button,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() { this.propagationStopped = true; },
            };
            listeners.get(type)?.(event);
            return event;
        },
    };
}

test('측면 버튼이 브라우저 키나 탐색 단축키로 전달되어도 이동한다', async () => {
    const harness = createHarness();
    harness.key({ key: 'BrowserBack' });
    harness.key({ key: 'BrowserForward' });
    harness.key({ key: 'ArrowLeft', altKey: true });
    harness.key({ key: 'ArrowRight', altKey: true });
    harness.key({ key: '[', code: 'BracketLeft', metaKey: true });
    harness.key({ key: ']', code: 'BracketRight', metaKey: true });
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, 1, -1, 1, -1, 1]);
});

test('Mac 텍스트 이동과 일반 방향키/괄호 입력을 가로채지 않는다', () => {
    const input = { tagName: 'INPUT' };
    for (const event of [
        { key: 'ArrowLeft' },
        { key: '[', code: 'BracketLeft' },
        { key: 'ArrowRight', metaKey: true, target: input },
        { key: 'ArrowLeft', altKey: true, target: input },
        { key: 'ArrowRight', altKey: true, shiftKey: true },
        { key: 'ArrowLeft', altKey: true, ctrlKey: true },
        { key: '[', metaKey: true, defaultPrevented: true },
    ]) assert.equal(folderHistoryKeyDirection(event, 'MacIntel'), 0);
    assert.equal(folderHistoryKeyDirection({ key: 'ArrowLeft', altKey: true, target: input }, 'Win32'), -1);
    assert.equal(folderHistoryKeyDirection({ key: '[', metaKey: true }, 'Win32'), 0);
    assert.equal(folderHistoryKeyDirection({ key: 'Unidentified', code: 'BrowserBack' }, 'MacIntel'), -1);
    assert.equal(folderHistoryKeyDirection({ key: 'Unidentified', code: 'BrowserForward' }, 'Win32'), 1);
});

test('탐색 키의 자동 반복과 다른 입력 경로의 중복은 한 번만 처리한다', async () => {
    const harness = createHarness();
    const first = harness.key({ key: 'BrowserBack' });
    const repeated = harness.key({ key: 'BrowserBack', repeat: true });
    harness.native(-1);
    harness.key({ key: 'BrowserForward' });
    harness.mouse('mousedown', 4);
    await flushNavigation();
    assert.equal(first.defaultPrevented, true);
    assert.equal(first.propagationStopped, true);
    assert.equal(repeated.defaultPrevented, true);
    assert.deepEqual(harness.moves, [-1, 1]);
});

test('비활성 폴더 탭과 대화상자에서는 탐색 키로 이동하지 않는다', async () => {
    const harness = createHarness();
    harness.setVisible(false);
    assert.equal(harness.key({ key: 'BrowserBack' }).defaultPrevented, false);
    harness.setVisible(true);
    harness.setEnabled(false);
    assert.equal(harness.key({ key: 'BrowserForward' }).defaultPrevented, true);
    await flushNavigation();
    assert.deepEqual(harness.moves, []);
    harness.dispose();
    assert.equal(harness.key({ key: 'BrowserBack' }).defaultPrevented, false);
});

test('마우스 뒤로/앞으로 버튼은 누를 때 한 번 이동하고 브라우저 기본 동작을 차단한다', async () => {
    const harness = createHarness();
    for (const button of [3, 4]) {
        for (const type of ['mousedown', 'mouseup', 'auxclick']) {
            const event = harness.mouse(type, button);
            assert.equal(event.defaultPrevented, true);
            assert.equal(event.propagationStopped, true);
        }
    }
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, 1]);
});

test('왼쪽/가운데/오른쪽 버튼과 알 수 없는 native 명령은 간섭하지 않는다', () => {
    const harness = createHarness();
    for (const button of [0, 1, 2]) {
        for (const type of ['mousedown', 'mouseup', 'auxclick']) {
            const event = harness.mouse(type, button);
            assert.equal(event.defaultPrevented, false);
            assert.equal(event.propagationStopped, false);
        }
    }
    for (const command of [0, 2, 'back', '-1', null]) harness.native(command);
    assert.deepEqual(harness.moves, []);
});

for (const firstSource of ['native', 'mouse']) {
    test(`${firstSource} 입력이 먼저 도착해도 native/DOM 중복만 제거하고 연속 클릭을 유지한다`, async () => {
        const harness = createHarness();
        const inputs = {
            native: () => harness.native(-1),
            mouse: () => harness.mouse('mousedown', 3),
        };
        const secondSource = firstSource === 'native' ? 'mouse' : 'native';
        for (let click = 0; click < 3; click += 1) {
            inputs[firstSource]();
            harness.advance(10);
            inputs[secondSource]();
            harness.mouse('mouseup', 3);
            harness.mouse('auxclick', 3);
        }
        await flushNavigation();
        assert.deepEqual(harness.moves, [-1, -1, -1]);
    });
}

test('IPC 전달이 몰려도 각 클릭을 한 번씩 처리한다', async () => {
    const harness = createHarness();
    harness.mouse('mousedown', 3);
    harness.mouse('mousedown', 3);
    harness.advance(100);
    harness.native(-1);
    harness.native(-1);
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, -1]);
});

test('서로 다른 방향의 입력과 중복 대기 시간이 지난 입력은 처리한다', async () => {
    const harness = createHarness();
    harness.mouse('mousedown', 3);
    harness.native(1);
    harness.advance(501);
    harness.native(-1);
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, 1, -1]);
});

test('폴더 탭이 숨겨져 있으면 마우스/native 모두 이동하지 않는다', async () => {
    const harness = createHarness();
    harness.setVisible(false);
    const event = harness.mouse('mousedown', 3);
    harness.native(1);
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(harness.moves, []);
    harness.setVisible(true);
    harness.native(1);
    await flushNavigation();
    assert.deepEqual(harness.moves, [1]);
});

test('대화상자/잠금/최근 읽은 목록으로 이동이 비활성화되어도 기본 페이지 이동은 차단한다', async () => {
    const harness = createHarness();
    harness.setEnabled(false);
    const event = harness.mouse('mousedown', 3);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(harness.moves, []);
    harness.setEnabled(true);
    harness.native(-1);
    assert.deepEqual(harness.moves, []);
    harness.mouse('mousedown', 3);
    harness.native(-1);
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1]);
});

test('구독을 해제하면 마우스/native 이벤트를 더 이상 처리하지 않는다', () => {
    const harness = createHarness();
    harness.dispose();
    harness.mouse('mousedown', 3);
    harness.native(1);
    assert.equal(harness.listeners.size, 0);
    assert.deepEqual(harness.moves, []);
});

test('마우스 버튼으로 기존 폴더 기록을 양방향 이동하며 기록 경계를 넘지 않는다', async () => {
    const harness = createHarness();
    let navigation = { entries: ['/books', '/books/a', '/books/b'], index: 2 };
    const paths = [];
    for (const button of [3, 3, 3, 4, 4, 4]) {
        harness.mouse('mousedown', button);
        await flushNavigation();
        navigation = moveFolderNavigation(navigation, harness.moves.at(-1));
        paths.push(navigation.entries[navigation.index]);
    }
    assert.deepEqual(paths, ['/books/a', '/books', '/books', '/books/a', '/books/b', '/books/b']);
});

test('연속 뒤로/앞으로 입력은 이전 폴더 이동 완료 후 순서대로 실행한다', async () => {
    const pending = [];
    const paths = [];
    let navigation = { entries: ['/books', '/books/a', '/books/b'], index: 2 };
    const harness = createHarness({
        onNavigate: direction => {
            const result = deferred();
            pending.push(result);
            return result.promise.then(() => {
                navigation = moveFolderNavigation(navigation, direction);
                paths.push(navigation.entries[navigation.index]);
            });
        },
    });
    harness.mouse('mousedown', 3);
    harness.mouse('mousedown', 3);
    harness.mouse('mousedown', 4);
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1]);
    assert.deepEqual(paths, []);

    pending[0].resolve();
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, -1]);
    assert.deepEqual(paths, ['/books/a']);

    pending[1].resolve();
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1, -1, 1]);
    assert.deepEqual(paths, ['/books/a', '/books']);

    pending[2].resolve();
    await flushNavigation();
    assert.deepEqual(paths, ['/books/a', '/books', '/books/a']);
});

for (const gate of ['setVisible', 'setEnabled']) {
    test(`대기 중 ${gate}가 꺼지면 큐의 다음 입력을 실행하지 않는다`, async () => {
        const first = deferred();
        const harness = createHarness({ onNavigate: () => first.promise });
        harness.mouse('mousedown', 3);
        harness.mouse('mousedown', 4);
        await flushNavigation();
        assert.deepEqual(harness.moves, [-1]);

        harness[gate](false);
        first.resolve();
        await flushNavigation();
        assert.deepEqual(harness.moves, [-1]);
        harness[gate](true);
        await flushNavigation();
        assert.deepEqual(harness.moves, [-1]);
    });

    test(`입력 시 ${gate}가 꺼져 있으면 활성화 후에도 이동을 예약하지 않는다`, async () => {
        const first = deferred();
        const harness = createHarness({ onNavigate: () => first.promise });
        harness.mouse('mousedown', 3);
        await flushNavigation();
        harness[gate](false);
        harness.mouse('mousedown', 4);
        harness.native(1);
        harness[gate](true);
        first.resolve();
        await flushNavigation();
        assert.deepEqual(harness.moves, [-1]);
    });
}

test('구독을 해제하면 이미 대기 중인 다음 이동도 실행하지 않는다', async () => {
    const first = deferred();
    const harness = createHarness({ onNavigate: () => first.promise });
    harness.mouse('mousedown', 3);
    harness.mouse('mousedown', 4);
    await flushNavigation();
    harness.dispose();
    first.resolve();
    await flushNavigation();
    assert.deepEqual(harness.moves, [-1]);
    assert.equal(harness.listeners.size, 0);
});

test('한 번의 이동이 실패해도 오류를 기록하고 뒤의 입력을 계속 처리한다', async t => {
    const error = new Error('stat failed');
    const log = t.mock.method(console, 'error', () => {});
    const harness = createHarness({
        onNavigate: direction => direction === -1 ? Promise.reject(error) : Promise.resolve(),
    });
    harness.mouse('mousedown', 3);
    harness.mouse('mousedown', 4);
    await flushNavigation();

    assert.deepEqual(harness.moves, [-1, 1]);
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(log.mock.calls[0].arguments, ['폴더 탐색 실패:', error]);
});
