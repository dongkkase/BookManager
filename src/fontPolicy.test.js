import assert from 'node:assert/strict';
import test from 'node:test';
import { fontFamilyForConfig, fontVarsForConfig } from './fontPolicy.js';

test('Default 폰트는 Jua와 플랫폼 fallback을 제공한다', () => {
    const family = fontFamilyForConfig('Default');
    assert.match(family, /Jua/);
    assert.match(family, /Noto Sans KR/);
    assert.match(family, /Malgun Gothic/);
    assert.match(family, /Segoe UI/);
    assert.match(family, /Yu Gothic UI/);
});

test('폰트 배율은 80%부터 155%까지 제한하고 공통 크기에 적용한다', () => {
    assert.equal(fontVarsForConfig({ font_scale: 50 })['--font-scale'], '0.8');
    assert.equal(fontVarsForConfig({ font_scale: 100 })['--font-base'], '13px');
    assert.equal(fontVarsForConfig({ font_scale: 155 })['--font-2xl'], '31px');
    assert.equal(fontVarsForConfig({ font_scale: 155 })['--control-height'], '43px');
    assert.equal(fontVarsForConfig({ font_scale: 155 })['--checkbox-size'], '25px');
    assert.equal(fontVarsForConfig({ font_scale: 200 })['--font-scale'], '1.55');
});
