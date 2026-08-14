import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const folderSource = readFileSync(path.join(srcRoot, 'tabs/FolderTab.jsx'), 'utf8');
const folderStyles = readFileSync(path.join(srcRoot, 'styles/FolderTab.css'), 'utf8');
const folderSearchInputStart = folderSource.indexOf('const FolderSearchInput');
const folderSearchInputEnd = folderSource.indexOf('function FolderTab');
const folderSearchInputSource = folderSource.slice(
    folderSearchInputStart,
    folderSearchInputEnd,
);

assert.ok(folderSearchInputStart >= 0);
assert.ok(folderSearchInputEnd > folderSearchInputStart);

test('폴더 검색 placeholder는 기존 문구와 input 너비를 유지한다', () => {
    assert.match(folderSource, /t\('folder_search_library_ph'\)/);
    assert.match(folderSource, /t\('folder_search_ph'\)/);
    assert.match(folderSource, /t\('folder_search_content_ph'\)/);
    assert.match(folderSource, /placeholder=\{searchPlaceholder\}/);
    assert.match(folderStyles, /\.search-input-wrap\s*\{[^}]*width:\s*210px;/);
    assert.match(folderStyles, /\.search-input-wrap\.has-search-scope\s*\{[^}]*width:\s*292px;/);
    assert.match(folderStyles, /\.search-input\s*\{[^}]*width:\s*100%;/);
});

test('폴더 검색 placeholder는 비어 있고 문구가 넘칠 때만 자동 슬라이드한다', () => {
    assert.match(folderSource, /Math\.ceil\(textNode\.scrollWidth\s*-\s*viewport\.clientWidth\)/);
    assert.match(folderSource, /!searchQuery\s*&&\s*<SlidingSearchPlaceholder/);
    assert.match(folderSource, /overflowDistance\s*>\s*0\s*\?\s*'is-overflowing'/);
    assert.match(folderSource, /new ResizeObserver\(scheduleMeasure\)/);
    assert.match(folderSource, /'--search-placeholder-offset':\s*`\$\{-overflowDistance\}px`/);
    assert.match(folderStyles, /\.search-placeholder-viewport\.is-overflowing \.search-placeholder-text\s*\{[\s\S]*?animation:\s*folder-search-placeholder-slide/);
    assert.match(folderStyles, /transform:\s*translateX\(var\(--search-placeholder-offset\)\)/);
    assert.doesNotMatch(folderStyles, /calc\(-1\s*\*\s*var\(--search-placeholder-offset\)\)/);
});

test('슬라이드 placeholder는 입력 접근성과 포인터 동작을 보존한다', () => {
    assert.match(folderSource, /aria-label=\{searchPlaceholder\}/);
    assert.match(folderSource, /aria-hidden="true"/);
    assert.match(folderStyles, /\.search-placeholder-viewport\s*\{[\s\S]*?pointer-events:\s*none;/);
    assert.doesNotMatch(folderStyles, /\.search-placeholder-viewport\.is-overflowing[\s\S]*?animation:\s*none;/);
});

test('폴더 검색은 자동 적용하지 않고 버튼 또는 submit에서만 실행한다', () => {
    assert.doesNotMatch(folderSource, /FOLDER_SEARCH_DEBOUNCE_MS/);
    assert.doesNotMatch(folderSearchInputSource, /setTimeout/);
    assert.equal(folderSearchInputSource.match(/onApplyQuery\s*\(/g)?.length, 1);
    assert.match(folderSearchInputSource, /onChange=\{event\s*=>\s*setSearchQuery\(event\.target\.value\)\}/);
    assert.match(folderSearchInputSource, /<form[\s\S]*?className=\{`search-input-wrap \$\{showSearchScope \? 'has-search-scope' : ''\}`\}[\s\S]*?role="search"[\s\S]*?onSubmit=\{handleSubmit\}\s*>/);
    assert.match(folderSearchInputSource, /const submitSearch\s*=\s*\(\)\s*=>\s*\{\s*if \(isComposingRef\.current\) return;\s*const inputValue = inputRef\.current\?\.value \?\? searchQuery;\s*onApplyQuery\(inputValue\.trim\(\)\);\s*\};/);
    assert.match(folderSearchInputSource, /const handleSubmit\s*=\s*event\s*=>\s*\{\s*event\.preventDefault\(\);\s*submitSearch\(\);\s*\};/);
    assert.match(folderSearchInputSource, /type="submit"[\s\S]*?className="search-submit-btn"[\s\S]*?<FaIcon name="search"/);
    assert.match(folderSource, /searchLabel=\{t\('btn_search'\)\}/);
    assert.match(folderSource, /const \[searchSubmitToken, setSearchSubmitToken\] = useState\(0\);/);
    assert.match(folderSource, /const applySearchQuery = useCallback\(query => \{\s*setAppliedSearchQuery\(query\);\s*setSearchSubmitToken\(token => token \+ 1\);/);
    assert.match(folderSource, /onApplyQuery=\{applySearchQuery\}/);
    assert.match(folderSource, /\[isLibrarySearchActive, libraries, normalizedSearchQuery, searchScope, searchSubmitToken, showToast, t\]/);
});

test('폴더 검색 Enter는 IME 조합을 보호하고 지우기는 즉시 적용한다', () => {
    assert.match(folderSearchInputSource, /const handleKeyDown\s*=\s*event\s*=>\s*\{\s*if \(event\.key !== 'Enter'\) return;\s*if \(\s*event\.nativeEvent\?\.isComposing\s*\|\| event\.nativeEvent\?\.keyCode === 229\s*\|\| isComposingRef\.current\s*\) \{\s*event\.preventDefault\(\);\s*\}\s*\};/);
    assert.match(folderSearchInputSource, /onKeyDown=\{handleKeyDown\}/);
    assert.match(folderSearchInputSource, /onCompositionStart=\{\(\)\s*=>\s*\{\s*isComposingRef\.current = true;/);
    assert.match(folderSearchInputSource, /onCompositionEnd=\{event\s*=>\s*\{\s*isComposingRef\.current = false;/);
    assert.match(folderSearchInputSource, /type="button"[\s\S]*?className="search-clear-btn"[\s\S]*?onClick=\{clearSearch\}/);
    assert.match(folderSearchInputSource, /const clearSearch[\s\S]*?setSearchQuery\(''\);[\s\S]*?onClearQuery\(\);/);
});

test('검색 및 지우기 버튼은 input 안에서 텍스트와 겹치지 않는다', () => {
    assert.match(folderStyles, /\.search-input\s*\{[\s\S]*?padding:\s*2px 56px 2px 12px;/);
    assert.match(folderStyles, /\.search-placeholder-viewport\s*\{[\s\S]*?inset:\s*1px 36px 1px 12px;/);
    assert.match(folderStyles, /\.search-clear-btn,[\s\S]*?\.search-submit-btn\s*\{[\s\S]*?width:\s*24px;[\s\S]*?height:\s*24px;/);
    assert.match(folderStyles, /\.search-clear-btn\s*\{[\s\S]*?right:\s*29px;/);
    assert.match(folderStyles, /\.search-submit-btn\s*\{[\s\S]*?right:\s*4px;/);
});

test('검색 범위는 검색 form 내부의 input 왼쪽 영역에 표시한다', () => {
    const searchFormIndex = folderSearchInputSource.indexOf('<form');
    const searchScopeIndex = folderSearchInputSource.indexOf('className="folder-search-scope"');
    const searchInputIndex = folderSearchInputSource.indexOf('<input', searchScopeIndex);
    const searchFormEndIndex = folderSearchInputSource.indexOf('</form>', searchInputIndex);

    assert.ok(searchFormIndex >= 0);
    assert.ok(searchScopeIndex > searchFormIndex);
    assert.ok(searchInputIndex > searchScopeIndex);
    assert.ok(searchFormEndIndex > searchInputIndex);
    assert.equal(folderSource.match(/className="folder-search-scope"/g)?.length, 1);
    assert.match(folderSearchInputSource, /className=\{`search-input-wrap \$\{showSearchScope \? 'has-search-scope' : ''\}`\}/);
    assert.match(folderSearchInputSource, /value=\{searchScope\}/);
    assert.match(folderSearchInputSource, /onChange=\{event\s*=>\s*onSearchScopeChange\(event\.target\.value\)\}/);
    assert.match(folderSource, /searchScope=\{searchScope\}/);
    assert.match(folderSource, /onSearchScopeChange=\{handleSearchScopeChange\}/);

    assert.match(folderStyles, /\.search-input-wrap\s*\{[^}]*position:\s*relative;/);
    assert.match(folderStyles, /\.folder-search-scope\s*\{[^}]*position:\s*absolute;[^}]*left:\s*\d+px;[^}]*z-index:\s*\d+;[^}]*width:\s*82px;[^}]*height:\s*calc\(100% - 2px\);/);
    assert.match(folderStyles, /\.search-input-wrap\.has-search-scope \.search-input\s*\{[^}]*padding-left:\s*[^;]+;/);
    assert.match(folderStyles, /\.search-input-wrap\.has-search-scope \.search-placeholder-viewport\s*\{[^}]*left:\s*[^;]+;/);
});
