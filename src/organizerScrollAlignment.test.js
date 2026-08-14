import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const organizerSource = fs.readFileSync(new URL('./tabs/OrganizerTab.jsx', import.meta.url), 'utf8');
const organizerCss = fs.readFileSync(new URL('./styles/OrganizerTab.css', import.meta.url), 'utf8');

function declarationsForSelector(source, selector) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, selectorList]) => selectorList
            .split(',')
            .map(value => value.trim())
            .includes(selector))
        .map(([, , declarations]) => declarations)
        .join('\n');
}

function lastPropertyValue(declarations, property) {
    const values = [...declarations.matchAll(new RegExp(`(?:^|[;\\n])\\s*${property}\\s*:\\s*([^;]+);`, 'g'))];
    return values.at(-1)?.[1].trim();
}

test('구조 정리 헤더는 행과 동일한 스크롤 컨테이너 안에 있다', () => {
    assert.match(
        organizerSource,
        /className="org-tree-body"[\s\S]*?>\s*<div className="org-tree-header">/,
        '헤더가 스크롤 영역의 첫 자식이어야 세로 스크롤바가 생겨도 행과 같은 가로 폭을 사용합니다.',
    );
});

test('구조 정리 헤더와 행은 공통 열 정의를 사용하고 헤더는 고정된다', () => {
    const containerDeclarations = declarationsForSelector(organizerCss, '.org-tree-container');
    const bodyDeclarations = declarationsForSelector(organizerCss, '.org-tree-body');
    const headerDeclarations = declarationsForSelector(organizerCss, '.org-tree-header');
    const rowDeclarations = declarationsForSelector(organizerCss, '.org-tree-row');

    assert.match(containerDeclarations, /--org-tree-columns\s*:/);
    assert.match(bodyDeclarations, /overflow\s*:\s*auto\s*;/);
    assert.match(headerDeclarations, /grid-template-columns\s*:\s*var\(--org-tree-columns\)\s*;/);
    assert.match(rowDeclarations, /grid-template-columns\s*:\s*var\(--org-tree-columns\)\s*;/);
    assert.match(headerDeclarations, /position\s*:\s*sticky\s*;/);
    assert.match(headerDeclarations, /top\s*:\s*0\s*;/);
});

test('구조 정리 항목 수와 용량 열은 작은 고정 너비와 가운데 정렬을 사용한다', () => {
    const containerDeclarations = declarationsForSelector(organizerCss, '.org-tree-container');
    const countDeclarations = declarationsForSelector(organizerCss, '.org-col-count');
    const sizeDeclarations = declarationsForSelector(organizerCss, '.org-col-size');
    const columnDefinition = containerDeclarations.match(/--org-tree-columns\s*:\s*([^;]+);/)?.[1];

    assert.ok(columnDefinition, '구조 정리 테이블의 공통 열 정의가 필요합니다.');
    assert.match(columnDefinition, /64px\s+84px\s+64px\s*$/);
    assert.match(countDeclarations, /justify-content\s*:\s*center\s*;/);
    assert.match(sizeDeclarations, /justify-content\s*:\s*center\s*;/);
});

test('구조 정리 제목과 원본 이름은 하나의 세로 텍스트 묶음으로 표시된다', () => {
    const nameTextDeclarations = declarationsForSelector(organizerCss, '.org-name-text');
    const titleDeclarations = declarationsForSelector(organizerCss, '.org-name-text .org-title');
    const originalNameDeclarations = declarationsForSelector(organizerCss, '.org-name-text .org-original-name');

    assert.match(
        organizerSource,
        /<span className="org-name-text">\s*<span className="org-title">[\s\S]*?<\/span>\s*<span className="org-original-name">[\s\S]*?<\/span>\s*<\/span>/,
        '제목과 원본 이름은 아이콘 영역과 분리된 동일한 텍스트 묶음 안에 있어야 합니다.',
    );
    assert.match(nameTextDeclarations, /display\s*:\s*flex\s*;/);
    assert.match(nameTextDeclarations, /flex-direction\s*:\s*column\s*;/);
    assert.match(nameTextDeclarations, /min-width\s*:\s*0\s*;/);
    assert.match(titleDeclarations, /white-space\s*:\s*nowrap\s*;/);
    assert.match(originalNameDeclarations, /white-space\s*:\s*nowrap\s*;/);
    assert.match(originalNameDeclarations, /margin-left\s*:\s*0\s*;/);
});

test('구조 정리 경로 입력창과 행 메뉴는 같은 높이를 사용한다', () => {
    const pathInputDeclarations = declarationsForSelector(organizerCss, '.org-path-input');
    const menuWrapDeclarations = declarationsForSelector(organizerCss, '.org-row-menu-wrap');
    const menuButtonDeclarations = declarationsForSelector(organizerCss, '.org-path-widget .org-row-menu-button');
    const pathInputHeight = lastPropertyValue(pathInputDeclarations, 'height');
    const menuWrapHeight = lastPropertyValue(menuWrapDeclarations, 'height');

    assert.ok(pathInputHeight, '경로 입력창에 명시적인 높이가 필요합니다.');
    assert.notEqual(pathInputHeight, 'auto');
    assert.equal(menuWrapHeight, pathInputHeight);
    assert.equal(lastPropertyValue(menuButtonDeclarations, 'height'), '100%');
});
