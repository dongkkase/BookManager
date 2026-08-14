import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { translate } from './utils/i18n.js';

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const folderSource = readFileSync(path.join(srcRoot, 'tabs/FolderTab.jsx'), 'utf8');
const folderStyles = readFileSync(path.join(srcRoot, 'styles/FolderTab.css'), 'utf8');

test('내용 검색이 정상 완료된 뒤 결과나 인덱스 데이터가 없을 때만 수집 안내를 표시한다', () => {
    const searchEffectStart = folderSource.indexOf('const requestId = librarySearchRequestRef.current + 1;');
    const searchEffectEnd = folderSource.indexOf('const refreshViewerStatus', searchEffectStart);
    const searchEffectSource = folderSource.slice(searchEffectStart, searchEffectEnd);

    assert.ok(searchEffectStart >= 0);
    assert.ok(searchEffectEnd > searchEffectStart);
    assert.match(folderSource, /const \[showContentIndexSearchHint, setShowContentIndexSearchHint\] = useState\(false\);/);
    const statusPromiseMatch = searchEffectSource.match(
        /const (\w+)\s*=\s*searchScope === 'metadata'\s*\?\s*Promise\.resolve\(null\)\s*:\s*window\.electronAPI\?\.getContentIndexStatus\?\.\(libraries\);/,
    );
    assert.ok(statusPromiseMatch);
    assert.match(
        searchEffectSource,
        new RegExp(`Promise\\.allSettled\\(\\[[\\s\\S]*?metadataPromise[\\s\\S]*?contentPromise[\\s\\S]*?${statusPromiseMatch[1]}[\\s\\S]*?\\]\\)`),
    );
    assert.match(searchEffectSource, /tokenCount[\s\S]{0,240}=== 0/);
    assert.match(searchEffectSource, /totalCount[\s\S]{0,240}=== 0/);
    assert.match(searchEffectSource, /rows\.length === 0/);
    assert.match(searchEffectSource, /searchScope !== 'metadata'/);
    assert.match(
        searchEffectSource,
        /setShowContentIndexSearchHint\(current => \(\s*librarySearchRequestRef\.current === requestId\s*\? shouldShowContentIndexHint\s*:\s*current\s*\)\);/,
    );
    assert.match(
        searchEffectSource,
        /catch \(error\)[\s\S]*?setShowContentIndexSearchHint\(current => \(\s*librarySearchRequestRef\.current === requestId \? false : current\s*\)\);/,
    );
    assert.match(
        folderSource,
        /showContentIndexSearchHint\s*&&\s*\(\s*<div\s+className="content-index-search-hint"\s+role="status"\s+aria-live="polite">\s*\{t\('folder_content_index_search_hint'\)\}\s*<\/div>/,
    );
});

test('새 검색, 검색 지우기, 범위 변경 시 이전 수집 안내를 즉시 숨긴다', () => {
    const applySearchStart = folderSource.indexOf('const applySearchQuery = useCallback');
    const searchEffectStart = folderSource.indexOf('const requestId = librarySearchRequestRef.current + 1;');
    const callbacksSource = folderSource.slice(applySearchStart, searchEffectStart);

    assert.ok(applySearchStart >= 0);
    assert.ok(searchEffectStart > applySearchStart);
    assert.match(callbacksSource, /const applySearchQuery[\s\S]*?setShowContentIndexSearchHint\(false\);/);
    assert.match(callbacksSource, /const clearAppliedSearchQuery[\s\S]*?setShowContentIndexSearchHint\(false\);/);
    assert.match(callbacksSource, /const handleSearchScopeChange[\s\S]*?setShowContentIndexSearchHint\(false\);/);
    assert.match(folderSource.slice(searchEffectStart), /if \(!isLibrarySearchActive\) \{[\s\S]*?setShowContentIndexSearchHint\(false\);/);
});

test('내용 인덱스 수집 안내 말풍선은 인덱스 검사 버튼 바로 아래에 배치한다', () => {
    const indexButtonIndex = folderSource.indexOf('className={`content-index-btn');
    const hintIndex = folderSource.indexOf('className="content-index-search-hint"');
    const refreshButtonIndex = folderSource.indexOf('className="refresh-btn"', indexButtonIndex);

    assert.ok(indexButtonIndex >= 0);
    assert.ok(hintIndex > indexButtonIndex);
    assert.ok(refreshButtonIndex > hintIndex);
    assert.match(folderSource, /className="content-index-control"[\s\S]*?className=\{`content-index-btn[\s\S]*?className="content-index-search-hint"/);
    assert.match(folderStyles, /\.content-index-control\s*\{[^}]*position:\s*relative;/);
    assert.match(folderStyles, /\.content-index-search-hint\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*calc\(100%\s*\+\s*\d+px\);[\s\S]*?z-index:\s*\d+;/);
    assert.match(folderStyles, /\.content-index-search-hint::(?:before|after)\s*\{[\s\S]*?content:\s*(['"])\1;[\s\S]*?position:\s*absolute;/);
});

test('내용 인덱스 수집 안내 문구를 지원 언어로 제공한다', () => {
    const koreanMessage = translate('folder_content_index_search_hint', 'ko');

    assert.match(koreanMessage, /인덱스/);
    assert.match(koreanMessage, /수집/);
    for (const language of ['ko', 'en', 'ja']) {
        assert.notEqual(
            translate('folder_content_index_search_hint', language),
            'folder_content_index_search_hint',
        );
    }
});
