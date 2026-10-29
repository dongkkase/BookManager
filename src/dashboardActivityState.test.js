import assert from 'node:assert/strict';
import test from 'node:test';
import { randomPassage, dashboardDate, dashboardMonth, dashboardMonthDays, readingDurationLabel, shiftDashboardMonth } from './dashboardActivityState.js';

test('독서 달력은 로컬 날짜와 연도 경계에 맞춰 월을 이동한다', () => {
    assert.equal(dashboardMonth(new Date(2026, 0, 1, 0, 1)), '2026-01');
    assert.equal(dashboardDate(new Date(2026, 9, 31, 23, 59, 59)), '2026-10-31');
    assert.equal(dashboardDate(new Date(2026, 10, 1, 0, 0, 1)), '2026-11-01');
    assert.equal(shiftDashboardMonth('2026-12', 1), '2027-01');
    assert.equal(shiftDashboardMonth('2026-01', -1), '2025-12');
    assert.equal(shiftDashboardMonth('2026-02', 12), '2027-02');
    assert.equal(shiftDashboardMonth('2026-02', -14), '2024-12');
});

test('달력의 날짜와 첫 요일은 평년·윤년·세기 윤년 규칙을 따른다', () => {
    const leap = dashboardMonthDays('2028-02');
    assert.equal(leap.dates.length, 29);
    assert.equal(leap.dates[0], '2028-02-01');
    assert.equal(leap.dates.at(-1), '2028-02-29');
    assert.equal(leap.offset, 2);
    assert.equal(dashboardMonthDays('2026-02').dates.length, 28);
    assert.equal(dashboardMonthDays('2000-02').dates.length, 29);
    assert.equal(dashboardMonthDays('2100-02').dates.length, 28);
    assert.equal(dashboardMonthDays('2026-04').dates.length, 30);
    assert.equal(dashboardMonthDays('2026-12').dates.length, 31);
    const sunday = dashboardMonthDays('2026-11');
    assert.equal(sunday.offset, 0);
    assert.equal(new Set(sunday.dates).size, 30);
});

test('독서 시간은 분 미만·분·시간 경계에서 과장 없이 표시한다', () => {
    const t = (key, values = []) => ({ key, values });
    const minutes = value => ({ key: 'dashboard.minutes', values: [value] });
    const underMinute = { key: 'dashboard.under_minute', values: [] };
    for (const value of [undefined, null, NaN, 'invalid', -1, 0]) assert.deepEqual(readingDurationLabel(value, t), minutes(0));
    for (const value of [0.001, 1, 59.999]) assert.deepEqual(readingDurationLabel(value, t), underMinute);
    assert.deepEqual(readingDurationLabel(60, t), minutes(1));
    assert.deepEqual(readingDurationLabel(119.999, t), minutes(1));
    assert.deepEqual(readingDurationLabel(3599.999, t), minutes(59));
    assert.deepEqual(readingDurationLabel(3600, t), { key: 'dashboard.hours_minutes', values: [1, 0] });
    assert.deepEqual(readingDurationLabel('3660', t), { key: 'dashboard.hours_minutes', values: [1, 1] });
    assert.deepEqual(readingDurationLabel(86400, t), { key: 'dashboard.hours_minutes', values: [24, 0] });
});

test('문장은 날짜와 관계없이 매번 새 난수로 전체 후보에서 선택한다', () => {
    const entries = Object.freeze(Array.from({ length: 24 }, (_, index) => Object.freeze({ id: `passage-${index}`, text: `Saved passage ${index}` })));
    for (let index = 0; index < entries.length; index += 1) {
        assert.equal(randomPassage(entries, () => (index + 0.5) / entries.length), entries[index]);
    }
    assert.equal(randomPassage(entries, () => 0), entries[0]);
    assert.equal(randomPassage(entries, () => 0.999999), entries.at(-1));
});

test('문장 선택은 빈 문장을 건너뛰며 문장이 없으면 빈 상태를 반환한다', () => {
    const valid = { id: 'saved', text: '한 문장' };
    assert.equal(randomPassage([null, {}, { id: 'blank', text: ' \n\t ' }, valid], () => 0.999999), valid);
    const noRandom = () => assert.fail('Empty passages do not need a random draw');
    assert.equal(randomPassage([], noRandom), null);
    assert.equal(randomPassage(undefined, noRandom), null);
    assert.equal(randomPassage([{ id: 'blank', text: '' }], noRandom), null);
});
