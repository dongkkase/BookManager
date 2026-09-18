import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createTextCleanerInput } from './textCleanerInput.js';
import { countTextLines, findTextMatches } from './textCleanerNavigation.js';
import { inspectTextQuotes } from './textCleanerQuotes.js';

const toolSource = fs.readFileSync(new URL('./tabs/TextCleanerTool.jsx', import.meta.url), 'utf8');

function createClock(t) {
    let time = 0;
    let nextId = 0;
    const timers = new Map();
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        const id = ++nextId;
        timers.set(id, { callback, due: time + delay });
        return id;
    });
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
    return {
        tick(duration) {
            time += duration;
            for (const [id, timer] of timers) {
                if (timer.due > time) continue;
                timers.delete(id);
                timer.callback();
            }
        },
    };
}

function createToolFixture(t) {
    const effects = [];
    const stateUpdates = [];
    const saves = [];
    const component = toolSource.slice(
        toolSource.indexOf('export default function TextCleanerTool'),
        toolSource.indexOf('\n    if (!fileInfo) {\n        return ('),
    ).replace('export default ', '').replaceAll('import.meta.url', JSON.stringify(import.meta.url));
    let stateIndex = 0;
    const api = vm.runInNewContext(`${component}
        return { handleResultInput, handleSave, resultInput, resultAreaRef, resultTextRef,
            workerRef, quoteRequestIdRef, layoutRequestIdRef };
    }
    TextCleanerTool({ t: key => key });`, {
        createTextCleanerInput,
        URL,
        DEFAULT_TEXT_CLEANER_OPTIONS: {},
        DEFAULT_TEXT_SEARCH_OPTIONS: {},
        EMPTY_SEARCH_RESULT: { query: '', matches: [], index: -1, pending: false },
        useState(initial) {
            let value = stateIndex++ === 0 ? { filePath: '/test.txt', snapshot: {} } : initial;
            return [value, update => {
                value = typeof update === 'function' ? update(value) : update;
                stateUpdates.push(value);
            }];
        },
        useRef: current => ({ current }),
        useMemo: callback => callback(),
        useCallback: callback => callback,
        useEffect: callback => effects.push(callback),
        disposeSearchMirror: ref => { ref.current = null; },
        editorWrapMetrics: () => ({ columns: 80 }),
        Worker: class {
            postMessage() {}
            terminate() {}
        },
        window: { electronAPI: { saveTextCleanerFile: async data => {
            saves.push(data);
            return { ok: true, snapshot: {}, encoding: 'utf-8-bom' };
        } } },
    });
    let text = '';
    const readText = t.mock.fn(() => text);
    api.resultAreaRef.current = { get value() { return readText(); } };
    return { ...api, effects, stateUpdates, saves, readText, setText: value => { text = value; } };
}

function createFixture(t) {
    const clock = createClock(t);
    let text = '';
    const readText = t.mock.fn(() => text);
    const onCommit = t.mock.fn();
    const input = createTextCleanerInput({ readText, onCommit });
    return { input, readText, onCommit, clock, setText: value => { text = value; } };
}

test('연속 입력 중에는 본문을 읽지 않고 입력이 멈추면 최신 내용만 한 번 반영한다', t => {
    const { input, readText, onCommit, clock, setText } = createFixture(t);
    for (let index = 0; index < 20; index += 1) {
        setText(`입력 ${index}`);
        input.schedule();
        clock.tick(100);
    }
    assert.equal(readText.mock.callCount(), 0);
    assert.equal(onCommit.mock.callCount(), 0);
    clock.tick(250);
    assert.equal(readText.mock.callCount(), 1);
    assert.deepEqual(onCommit.mock.calls[0].arguments, ['입력 19']);
    assert.equal(input.pending, false);
});

test('한글 조합 중에는 오래 멈춰도 본문을 읽거나 검사를 시작하지 않는다', t => {
    const { input, readText, onCommit, clock, setText } = createFixture(t);
    input.schedule();
    input.compositionStart();
    setText('ㅎ');
    input.schedule();
    clock.tick(1000);
    assert.equal(readText.mock.callCount(), 0);
    setText('한');
    input.compositionEnd();
    input.schedule();
    clock.tick(350);
    assert.deepEqual(onCommit.mock.calls[0].arguments, ['한']);
    assert.equal(onCommit.mock.callCount(), 1);
});

test('입력 직후 저장하거나 검색 이동하면 대기 중인 최신 내용을 즉시 사용한다', t => {
    const { input, onCommit, clock, setText } = createFixture(t);
    setText('아직 반영되지 않은 마지막 글자');
    input.schedule();
    assert.equal(input.flush(), '아직 반영되지 않은 마지막 글자');
    assert.equal(input.pending, false);
    clock.tick(1000);
    assert.equal(onCommit.mock.callCount(), 1);
});

test('다른 파일 열기와 화면 종료 시 대기 중인 본문 반영을 취소한다', t => {
    const { input, readText, onCommit, clock, setText } = createFixture(t);
    input.compositionStart();
    input.schedule();
    input.cancel();
    clock.tick(1000);
    assert.equal(input.pending, false);
    assert.equal(readText.mock.callCount(), 0);
    setText('새 파일');
    input.schedule();
    clock.tick(350);
    assert.deepEqual(onCommit.mock.calls[0].arguments, ['새 파일']);
});

test('실제 입력 핸들러는 본문을 읽지 않고 즉시 저장에는 최신 편집을 전달한다', async t => {
    const clock = createClock(t);
    const fixture = createToolFixture(t);
    fixture.setText('첫 글자');
    fixture.handleResultInput();
    fixture.setText('첫 글자와 마지막 글자');
    fixture.handleResultInput();
    assert.equal(fixture.readText.mock.callCount(), 0);
    assert.equal(fixture.resultTextRef.current, '');
    await fixture.handleSave();
    assert.equal(fixture.saves[0].text, '첫 글자와 마지막 글자');
    assert.equal(fixture.resultTextRef.current, '첫 글자와 마지막 글자');
    clock.tick(1000);
    assert.equal(fixture.readText.mock.callCount(), 1);
});

test('새 입력 후 이전 Worker 검사 결과와 레이아웃 응답은 화면에 반영하지 않는다', t => {
    const clock = createClock(t);
    const fixture = createToolFixture(t);
    fixture.effects[1]();
    const requestId = fixture.quoteRequestIdRef.current;
    const layoutRequestId = fixture.layoutRequestIdRef.current;
    fixture.handleResultInput({ stopPropagation() {} });
    const updateCount = fixture.stateUpdates.length;
    fixture.workerRef.current.onmessage({ data: {
        type: 'resultReviewResult', requestId, ok: true,
        lineCount: 999, query: '', search: { matches: [] }, review: { issues: [], total: 0 },
    } });
    fixture.workerRef.current.onmessage({ data: {
        type: 'layoutResult', requestId: layoutRequestId, ok: true,
    } });
    assert.equal(fixture.stateUpdates.length, updateCount);
    fixture.resultInput.cancel();
});

test('결과 검사는 Worker에서 같은 본문의 줄 수, 검색 위치, 따옴표를 반환한다', () => {
    const source = fs.readFileSync(new URL('./workers/textCleanerWorker.js', import.meta.url), 'utf8');
    const messages = [];
    const worker = { postMessage: message => messages.push(message) };
    vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
        self: worker, countTextLines, findTextMatches, inspectTextQuotes,
    });
    worker.onmessage({ data: {
        type: 'resultReview', requestId: 3, text: "'사저!\"\n\n사저", query: '사저', inspectQuotes: true,
    } });
    assert.equal(messages[0].type, 'resultReviewResult');
    assert.equal(messages[0].requestId, 3);
    assert.equal(messages[0].lineCount, 3);
    assert.equal(messages[0].query, '사저');
    assert.deepEqual(messages[0].search.matches, [1, 7]);
    assert.equal(messages[0].review.total, 1);
    worker.onmessage({ data: {
        type: 'resultReview', requestId: 4, text: '', query: '', inspectQuotes: false,
    } });
    assert.equal(messages[1].lineCount, 1);
    assert.equal(messages[1].search.totalCount, 0);
    assert.equal(messages[1].review, null);
});
