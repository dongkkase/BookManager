import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExternalUrl } from './externalUrlPolicy.js';

test('외부 브라우저는 http와 https URL만 연다', () => {
    assert.equal(normalizeExternalUrl('https://github.com/example/release'), 'https://github.com/example/release');
    assert.equal(normalizeExternalUrl('http://example.com/path'), 'http://example.com/path');
    assert.equal(normalizeExternalUrl('javascript:alert(1)'), '');
    assert.equal(normalizeExternalUrl('file:///tmp/private'), '');
    assert.equal(normalizeExternalUrl('invalid'), '');
});
