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
