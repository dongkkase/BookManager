import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyMotionPreference,
    initializeMotionPreference,
    isMotionReduced,
    normalizeMotionPreference,
    resolveReducedMotion,
    subscribeMotionPreference,
} from './motionPolicy.js';

function fixture(systemReduced = false) {
    const attributes = new Map();
    const media = new EventTarget();
    media.matches = systemReduced;
    const view = new EventTarget();
    view.Event = Event;
    view.document = {
        documentElement: {
            getAttribute: name => attributes.get(name) ?? null,
            setAttribute: (name, value) => attributes.set(name, value),
        },
    };
    view.matchMedia = query => {
        assert.equal(query, '(prefers-reduced-motion: reduce)');
        return media;
    };
    return {
        view,
        attributes,
        changeSystem(value) {
            media.matches = value;
            media.dispatchEvent(new Event('change'));
        },
    };
}

test('모션 설정은 시스템 기본값과 두 명시적 선택을 일관되게 해석한다', () => {
    for (const value of [undefined, null, '', 'invalid', true, {}, []]) {
        assert.equal(normalizeMotionPreference(value), 'system');
    }
    for (const systemReduced of [false, true]) {
        assert.equal(resolveReducedMotion('system', systemReduced), systemReduced);
        assert.equal(resolveReducedMotion('full', systemReduced), false);
        assert.equal(resolveReducedMotion('reduced', systemReduced), true);
    }
    assert.equal(isMotionReduced(undefined), false);
});

test('시스템 변경과 앱 선택을 CSS와 JS에 즉시 동일하게 반영하고 구독을 정리한다', () => {
    const { view, attributes, changeSystem } = fixture(true);
    const dispose = initializeMotionPreference(view);
    let changes = 0;
    const unsubscribe = subscribeMotionPreference(() => { changes += 1; }, view);
    const check = reduced => {
        assert.equal(isMotionReduced(view), reduced);
        assert.equal(attributes.get('data-motion'), reduced ? 'reduced' : 'full');
    };
    check(true);
    assert.equal(attributes.get('data-motion-preference'), 'system');
    changeSystem(false);
    check(false);
    assert.equal(changes, 1);
    applyMotionPreference('full', view);
    const beforeSystemChange = changes;
    changeSystem(true);
    check(false);
    assert.equal(changes, beforeSystemChange, 'Explicit animation setting ignores OS changes');
    applyMotionPreference('reduced', view);
    check(true);
    changeSystem(false);
    check(true);
    applyMotionPreference('system', view);
    check(false);
    changeSystem(true);
    check(true);
    unsubscribe();
    const afterUnsubscribe = changes;
    changeSystem(false);
    check(false);
    assert.equal(changes, afterUnsubscribe);
    dispose();
    changeSystem(true);
    assert.equal(attributes.get('data-motion'), 'full', 'Disposed bootstrap no longer changes the document');
});

test('모션 설정을 반복 적용해도 중복 변경 이벤트가 발생하지 않는다', () => {
    const { view } = fixture();
    const dispose = initializeMotionPreference(view);
    let changes = 0;
    const unsubscribe = subscribeMotionPreference(() => { changes += 1; }, view);
    applyMotionPreference('system', view);
    applyMotionPreference('system', view);
    assert.equal(changes, 0);
    applyMotionPreference('reduced', view);
    applyMotionPreference('reduced', view);
    assert.equal(changes, 1);
    unsubscribe();
    dispose();
});
