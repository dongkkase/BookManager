import assert from 'node:assert/strict';
import test from 'node:test';
import { isMetadataApiSourceEnabled, METADATA_API_SOURCE_NAMES, normalizeHardcoverToken, normalizeMetadataApiEnabled, normalizeMetadataProviderSettings } from './metadataProviderSettings.js';

test('검색 소스 옵션은 기본값을 제공하고 지원되지 않는 지역과 언어를 복구한다', () => {
    const defaults = {
        itunes_country: 'US', itunes_cover_resolution: 'high',
        kobo_country: 'us', kobo_language: 'en', audible_region: 'us',
    };
    for (const input of [undefined, null, [], {}, {
        itunes_country: '../US', itunes_cover_resolution: 'unknown',
        kobo_country: 'unknown', kobo_language: 'unknown', audible_region: 'unknown',
    }]) {
        assert.deepEqual(normalizeMetadataProviderSettings(input), defaults);
    }
    assert.deepEqual(normalizeMetadataProviderSettings({
        itunes_country: ' kr ', itunes_cover_resolution: 'standard',
        kobo_country: ' JP ', kobo_language: ' ALL ', audible_region: ' UK ',
    }), {
        itunes_country: 'KR', itunes_cover_resolution: 'standard',
        kobo_country: 'jp', kobo_language: 'all', audible_region: 'uk',
    });
});

test('Hardcover 토큰의 선택적인 Bearer 접두사만 제거한다', () => {
    assert.equal(normalizeHardcoverToken(' Bearer hc_token '), 'hc_token');
    assert.equal(normalizeHardcoverToken(' bearer hc_token '), 'hc_token');
    assert.equal(normalizeHardcoverToken(' hc_token '), 'hc_token');
    assert.equal(normalizeHardcoverToken('Bearer'), '');
    assert.equal(normalizeHardcoverToken('BearerToken'), 'BearerToken');
});

test('검색 소스 토글은 누락된 기존 설정을 활성화하고 명시적으로 꺼진 등록 소스만 비활성화한다', () => {
    const defaults = normalizeMetadataApiEnabled();
    assert.equal(Object.keys(defaults).length, 19);
    assert.ok(Object.values(defaults).every(value => value === true));
    for (const value of [null, [], 'invalid', true]) {
        assert.deepEqual(normalizeMetadataApiEnabled(value), defaults);
    }
    const settings = normalizeMetadataApiEnabled({ '리디북스': false, Hardcover: false, Kobo: true, unknown: false });
    assert.equal(settings['리디북스'], false);
    assert.equal(settings.Hardcover, false);
    assert.equal(settings.Kobo, true);
    assert.equal(settings.Amazon, true);
    assert.equal(Object.hasOwn(settings, 'unknown'), false);
    for (const value of [null, undefined, 0, 1, 'false', 'true', {}, []]) {
        assert.equal(normalizeMetadataApiEnabled({ Kobo: value }).Kobo, true);
    }
    assert.deepEqual(normalizeMetadataApiEnabled(Object.create({ Kobo: false })), defaults);
});

test('검색 소스 활성 판정은 정규화된 지도와 부분 지도에 같은 결과를 주고 미등록 소스를 허용하지 않는다', () => {
    const partial = { Kobo: false, '알라딘': false };
    const normalized = normalizeMetadataApiEnabled(partial);
    for (const source of METADATA_API_SOURCE_NAMES) {
        assert.equal(isMetadataApiSourceEnabled(source, partial), normalized[source]);
        assert.equal(isMetadataApiSourceEnabled(source, normalized), normalized[source]);
        assert.equal(isMetadataApiSourceEnabled(source, null), true);
    }
    assert.equal(isMetadataApiSourceEnabled('unknown'), false);
    assert.equal(isMetadataApiSourceEnabled('통합검색'), false);
    assert.equal(isMetadataApiSourceEnabled('Kobo', Object.create({ Kobo: false })), true);
});
