import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const viewerSource = fs.readFileSync(new URL('./ViewerApp.jsx', import.meta.url), 'utf8');
const viewerCss = fs.readFileSync(new URL('./styles/viewer.css', import.meta.url), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);

    assert.notEqual(startIndex, -1, `시작 소스 마커가 필요합니다: ${startMarker}`);
    assert.notEqual(endIndex, -1, `종료 소스 마커가 필요합니다: ${endMarker}`);
    return source.slice(startIndex, endIndex);
}

function cssRuleBody(selector) {
    const selectorIndex = viewerCss.indexOf(selector);
    const openingBraceIndex = viewerCss.indexOf('{', selectorIndex);
    const closingBraceIndex = viewerCss.indexOf('}', openingBraceIndex);

    assert.notEqual(selectorIndex, -1, `CSS 선택자가 필요합니다: ${selector}`);
    assert.notEqual(openingBraceIndex, -1, `CSS 규칙 시작이 필요합니다: ${selector}`);
    assert.notEqual(closingBraceIndex, -1, `CSS 규칙 종료가 필요합니다: ${selector}`);
    return viewerCss.slice(openingBraceIndex + 1, closingBraceIndex);
}

function themeColor(themeEntry, property) {
    const color = themeEntry.match(new RegExp(`${property}:\\s*'(#[0-9a-fA-F]{6})'`))?.[1];

    assert.ok(color, `테마에 ${property} 색상이 필요합니다.`);
    return color;
}

function relativeLuminance(hexColor) {
    const channels = hexColor.slice(1).match(/[0-9a-fA-F]{2}/g).map(channel => parseInt(channel, 16) / 255);
    const linearChannels = channels.map(channel => (
        channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4
    ));

    return (0.2126 * linearChannels[0])
        + (0.7152 * linearChannels[1])
        + (0.0722 * linearChannels[2]);
}

function contrastRatio(firstColor, secondColor) {
    const firstLuminance = relativeLuminance(firstColor);
    const secondLuminance = relativeLuminance(secondColor);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);

    return (lighter + 0.05) / (darker + 0.05);
}

test('EPUB과 TXT 리더 테마는 머릿글과 바닥글 전용 색상을 제공한다', () => {
    const themesSource = sourceBetween(viewerSource, 'const THEMES = [', '\n];');
    const themeEntries = [...themesSource.matchAll(/\{[^{}]+\}/g)].map(match => match[0]);

    assert.ok(themeEntries.length > 1, '둘 이상의 리더 테마가 필요합니다.');
    themeEntries.forEach(themeEntry => {
        assert.match(themeEntry, /headerFg:\s*'#[0-9a-fA-F]{6}'/);
        assert.match(themeEntry, /footerFg:\s*'#[0-9a-fA-F]{6}'/);
    });

    const headerColors = themeEntries.map(themeEntry => themeEntry.match(/headerFg:\s*'([^']+)'/)?.[1]);
    const footerColors = themeEntries.map(themeEntry => themeEntry.match(/footerFg:\s*'([^']+)'/)?.[1]);
    assert.ok(new Set(headerColors).size > 1, '머릿글 색상은 테마에 따라 달라야 합니다.');
    assert.ok(new Set(footerColors).size > 1, '바닥글 색상은 테마에 따라 달라야 합니다.');
});

test('리더 머릿글과 바닥글은 각 테마 배경과 4.5:1 이상의 대비비를 유지한다', () => {
    const themesSource = sourceBetween(viewerSource, 'const THEMES = [', '\n];');
    const themeEntries = [...themesSource.matchAll(/\{[^{}]+\}/g)].map(match => match[0]);

    themeEntries.forEach(themeEntry => {
        const themeId = themeEntry.match(/id:\s*'([^']+)'/)?.[1] || '알 수 없는 테마';
        const background = themeColor(themeEntry, 'bg');
        const headerContrast = contrastRatio(themeColor(themeEntry, 'headerFg'), background);
        const footerContrast = contrastRatio(themeColor(themeEntry, 'footerFg'), background);

        assert.ok(
            headerContrast >= 4.5,
            `${themeId} 머릿글 대비비가 ${headerContrast.toFixed(2)}:1로 4.5:1 미만입니다.`,
        );
        assert.ok(
            footerContrast >= 4.5,
            `${themeId} 바닥글 대비비가 ${footerContrast.toFixed(2)}:1로 4.5:1 미만입니다.`,
        );
    });
});

test('선택한 리더 테마의 머릿글과 바닥글 색상을 CSS 변수로 전달한다', () => {
    const readerStyleSource = sourceBetween(
        viewerSource,
        'const readerStyle = {',
        '\n\n  const renderReaderPageBody',
    );

    assert.match(readerStyleSource, /'--viewer-reader-header-fg':\s*theme\.headerFg/);
    assert.match(readerStyleSource, /'--viewer-reader-footer-fg':\s*theme\.footerFg/);
});

test('리더 머릿글과 바닥글은 테마 전용 CSS 변수를 사용한다', () => {
    const headerRule = cssRuleBody('.viewer-reader-page-body > h2,');
    const footerRule = cssRuleBody('.viewer-reader-page-number');

    assert.match(headerRule, /color:\s*var\(--viewer-reader-header-fg(?:,[^)]+)?\)/);
    assert.match(footerRule, /color:\s*var\(--viewer-reader-footer-fg(?:,[^)]+)?\)/);
});
