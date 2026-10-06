import assert from 'node:assert/strict';
import test from 'node:test';
import {
    installTelemetryErrorHandlers,
    reportTelemetryError,
    trackTelemetry,
} from './telemetry.js';

function createTarget() {
    const events = [];
    const errors = [];
    const listeners = new Map();
    const target = {
        electronAPI: {
            trackTelemetry(payload) { events.push(payload); },
            reportTelemetryError(payload) { errors.push(payload); },
        },
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name, listener) {
            if (listeners.get(name) === listener) listeners.delete(name);
        },
    };
    return { target, events, errors, listeners };
}

test('사용 이벤트는 정해진 필드만 전달하고 원본 작업 데이터를 제외한다', () => {
    const { target, events } = createTarget();
    assert.equal(trackTelemetry('feature_completed', {
        menu: 'tools', tool: 'epub-editor', feature: 'epub-export', format: 'epub',
        source: 'catalog', duration_ms: 12.8,
        paths: ['/Users/name/private-book.epub'], title: 'Private book', api_key: 'secret',
        project: { chapters: ['private text'] },
    }, target), true);
    assert.deepEqual(events, [{
        event: 'feature_completed', menu: 'tools', tool: 'epub-editor', feature: 'epub-export',
        format: 'epub', source: 'catalog', duration_ms: 13,
    }]);

    trackTelemetry('menu_opened', { menu: { title: 'Private book' }, duration_ms: Infinity }, target);
    trackTelemetry('menu_opened', { duration_ms: -1 }, target);
    assert.deepEqual(events.slice(1), [{ event: 'menu_opened' }, { event: 'menu_opened' }]);
    assert.equal(trackTelemetry(null, {}, target), false);
});

test('오류는 크기를 제한하고 오류 객체에 첨부된 사용자 데이터를 전달하지 않는다', () => {
    const { target, errors } = createTarget();
    reportTelemetryError({
        name: 'N'.repeat(200), message: 'M'.repeat(2000), stack: 'S'.repeat(10000),
        path: '/private/book.txt', project: { content: 'private text' },
    }, 'viewer', target);
    assert.deepEqual(errors, [{
        name: 'N'.repeat(80), message: 'M'.repeat(1024), stack: 'S'.repeat(8192), source: 'viewer',
    }]);
    reportTelemetryError('Failed to open viewer', 'viewer-load', target);
    assert.equal(errors[1].message, 'Failed to open viewer');
    reportTelemetryError({ toString() { throw new Error('Do not serialize arbitrary values'); } }, 'renderer', target);
    assert.equal(errors[2].message, 'Unknown renderer error');
});

test('브리지가 없거나 동기 예외와 Promise 거부가 발생해도 호출자에게 전파하지 않는다', async () => {
    for (const target of [undefined, null, {}, { electronAPI: {} }]) {
        assert.equal(trackTelemetry('menu_opened', { menu: 'tools' }, target), false);
        assert.equal(reportTelemetryError(new Error('test'), 'renderer', target), false);
    }

    const throwing = {
        electronAPI: {
            trackTelemetry() { throw new Error('Window destroyed'); },
            reportTelemetryError() { throw new Error('Window destroyed'); },
        },
    };
    assert.equal(trackTelemetry('menu_opened', {}, throwing), false);
    assert.equal(reportTelemetryError(new Error('test'), 'renderer', throwing), false);

    const rejecting = {
        electronAPI: {
            trackTelemetry() { return Promise.reject(new Error('IPC unavailable')); },
            reportTelemetryError() { return Promise.reject(new Error('IPC unavailable')); },
        },
    };
    assert.equal(trackTelemetry('menu_opened', {}, rejecting), true);
    assert.equal(reportTelemetryError(new Error('test'), 'renderer', rejecting), true);
    await new Promise(resolve => setImmediate(resolve));
});

test('비정상 속성 접근도 원래 작업을 중단시키지 않는다', () => {
    const { target } = createTarget();
    const throwingProperties = new Proxy({}, { get() { throw new Error('Invalid payload'); } });
    assert.equal(trackTelemetry('menu_opened', throwingProperties, target), false);
    assert.equal(reportTelemetryError(throwingProperties, 'renderer', target), false);
    assert.equal(trackTelemetry('menu_opened', {}, throwingProperties), false);
});

test('뷰어 전용 브리지에서도 오류를 보고하고 사용 이벤트는 메인 브리지로 제한한다', () => {
    const errors = [];
    const target = {
        viewerAPI: {
            reportTelemetryError(payload) { errors.push(payload); },
            trackTelemetry() { throw new Error('Viewer analytics bridge must not be used'); },
        },
    };
    assert.equal(reportTelemetryError(new Error('Viewer failed'), 'viewer-react', target), true);
    assert.equal(errors[0].message, 'Viewer failed');
    assert.equal(errors[0].source, 'viewer-react');
    assert.equal(trackTelemetry('menu_opened', { menu: 'tools' }, target), false);
    target.electronAPI = {};
    assert.equal(reportTelemetryError('Module failed', 'viewer-load', target), true);
    assert.equal(errors[1].source, 'viewer-load');
});

test('전역 JS 오류와 처리하지 않은 거부를 보고하고 기존 브라우저 처리를 유지한다', () => {
    const { target, errors, listeners } = createTarget();
    const dispose = installTelemetryErrorHandlers({ target, source: 'viewer' });
    let prevented = false;
    const error = new TypeError('Renderer failed');
    listeners.get('error')({ error, preventDefault() { prevented = true; } });
    listeners.get('error')({ message: 'Script failed' });
    listeners.get('error')({ target: { src: 'private-image.png' } });
    listeners.get('unhandledrejection')({ reason: 'Request failed', preventDefault() { prevented = true; } });

    assert.equal(errors.length, 3);
    assert.equal(errors[0].name, 'TypeError');
    assert.equal(errors[0].stack, error.stack);
    assert.equal(errors[1].message, 'Script failed');
    assert.equal(errors[2].message, 'Request failed');
    assert.ok(errors.every(value => value.source === 'viewer'));
    assert.equal(prevented, false);
    dispose();
    assert.equal(listeners.size, 0);
    assert.doesNotThrow(dispose);
    assert.doesNotThrow(() => installTelemetryErrorHandlers({ target: null })());
});
