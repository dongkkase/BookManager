import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sources = {
    app: fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8'),
    folder: fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8'),
    multiRenameDialog: fs.readFileSync(new URL('./components/MultiRenameDialog.jsx', import.meta.url), 'utf8'),
    fileTable: fs.readFileSync(new URL('./components/folder/FileTableView.jsx', import.meta.url), 'utf8'),
    thumbnailView: fs.readFileSync(new URL('./components/folder/ThumbnailView.jsx', import.meta.url), 'utf8'),
    tileView: fs.readFileSync(new URL('./components/folder/TileView.jsx', import.meta.url), 'utf8'),
    coverImage: fs.readFileSync(new URL('./components/folder/CoverImage.jsx', import.meta.url), 'utf8'),
    folderToolbar: fs.readFileSync(new URL('./components/folder/FolderToolbar.jsx', import.meta.url), 'utf8'),
    detailPanel: [
        './components/folder/DetailPanel.jsx',
        './components/folder/ComicDetailPanel.jsx',
        './components/folder/BookDetailPanel.jsx',
        './components/folder/detailPanelCommon.jsx',
    ].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'),
    folderCss: fs.readFileSync(new URL('./styles/FolderTab.css', import.meta.url), 'utf8'),
    faIcon: fs.readFileSync(new URL('./components/FaIcon.jsx', import.meta.url), 'utf8'),
    metadata: [
        './tabs/MetadataTab.jsx',
        './metadata/comicMetadataFields.js',
        './metadata/bookMetadataFields.js',
        './components/metadata/ComicMetadataEditor.jsx',
        './components/metadata/BookMetadataEditor.jsx',
    ].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'),
    organizer: fs.readFileSync(new URL('./tabs/OrganizerTab.jsx', import.meta.url), 'utf8'),
    organizerCss: fs.readFileSync(new URL('./styles/OrganizerTab.css', import.meta.url), 'utf8'),
    renamer: fs.readFileSync(new URL('./tabs/RenamerTab.jsx', import.meta.url), 'utf8'),
    settings: fs.readFileSync(new URL('./components/SettingsModal.jsx', import.meta.url), 'utf8'),
    sharing: fs.readFileSync(new URL('./tabs/SharingTab.jsx', import.meta.url), 'utf8'),
    sharingCss: fs.readFileSync(new URL('./styles/SharingTab.css', import.meta.url), 'utf8'),
    ipcHandlers: fs.readFileSync(new URL('../electron/ipcHandlers.js', import.meta.url), 'utf8'),
};

function assertInventory(sourceName, controls) {
    const source = sources[sourceName];
    for (const [label, fragment] of controls) {
        assert.ok(source.includes(fragment), `${label} 제어가 ${sourceName}에 있어야 합니다.`);
    }
}

test('14.3 input 전수 목록이 실제 제어와 연결되어 있다', () => {
    assertInventory('app', [
        ['설정 기반 언어 동기화', 'useI18n(config)'],
    ]);
    assertInventory('ipcHandlers', [
        ['설정 저장 시 메인 프로세스 언어 갱신', 'setLanguage(nextLang)'],
        ['등록 라이브러리 검색 IPC', "folder:searchLibraryFiles"],
        ['라이브러리 이동 증분 인덱스 IPC', "folder:applyLibraryMoveIndex"],
    ]);
    assertInventory('folder', [
        ['폴더 검색', 'value={searchQuery}'],
        ['등록 라이브러리 검색 API', 'searchLibraryFiles'],
        ['등록 라이브러리 검색 placeholder', 'folder_search_library_ph'],
        ['폴더/파일 단일 이름 변경 내부 입력 다이얼로그', 'requestTextInput'],
        ['폴더 이름 변경 입력 필드', 'folder-tree-rename-input'],
        ['파일 이름 변경 입력 필드', 'folder-file-rename-input'],
        ['폴더 탭 숨김 상태 단축키 차단', 'isFolderTabVisible'],
        ['폴더 탭 이름 변경 단축키 분기', 'handleRenameShortcut'],
        ['탐색기 패널 포커스 추적', "markFolderPanelFocus('explorer')"],
        ['리스트 패널 포커스 추적', "markFolderPanelFocus('list')"],
        ['여러 파일 이름 변경 공용 컴포넌트', '<MultiRenameDialog'],
        ['레이아웃 이름 저장', "t('dlg_save_lay_msg')"],
        ['삭제할 레이아웃 선택', 'id="layout-delete-select"'],
        ['경로로 이동', "t('fm_title')"],
        ['경로 이동 단축키', "isShortcutKey(event, 'g')"],
        ['보이는 항목 표지 지연 로드 큐', 'handleVisibleFilesChange'],
        ['표지 지연 로드 동시성 제한', 'COVER_PREVIEW_CONCURRENCY'],
    ]);
    assertInventory('fileTable', [
        ['리스트 보이는 항목 표지 요청', 'onVisibleFilesChange?.(visibleCoverRows)'],
    ]);
    assertInventory('thumbnailView', [
        ['썸네일 보이는 항목 표지 요청', 'onVisibleFilesChange?.(visibleCoverItems)'],
    ]);
    assertInventory('tileView', [
        ['타일 보이는 항목 표지 요청', 'onVisibleFilesChange?.(visibleCoverItems)'],
    ]);
    assertInventory('organizer', [
        ['구조 정리 출력 경로', 'item.out_path'],
        ['구조 정리 하위 항목 다중 선택', 'useFileSelection(visibleVolumeRows)'],
        ['구조 정리 하위 항목 다중 이름 변경', 'executeVolumeMultiRename'],
        ['구조 정리 탭 숨김 상태 단축키 차단', 'isOrganizerTabVisible'],
        ['구조 정리 작업 리스트 키보드 포커스', 'tabIndex={0}'],
        ['구조 정리 1뎁스 cube 아이콘', 'name="cube"'],
        ['구조 정리 2뎁스 file-zipper 아이콘', 'name="file-zipper"'],
    ]);
    assertInventory('multiRenameDialog', [
        ['여러 파일 이름 변경 기존 형식', 'value={oldPattern}'],
        ['여러 파일 이름 변경 새 형식', 'value={newPattern}'],
        ['여러 파일 이름 변경 ESC 닫기', "event.key !== 'Escape'"],
    ]);
    assertInventory('renamer', [
        ['내부 파일명 custom pattern', 'value={customText}'],
        ['내부 파일명 시작 번호', 'value={startNum}'],
        ['내부 파일명 미리보기 noimage fallback', "import noImage from '../images/noimage.png'"],
        ['내부 파일명 미리보기 빈 상태 이미지', 'src={noImage}'],
    ]);
    assertInventory('metadata', [
        ['메타데이터 검색어', 'value={searchQuery}'],
        ['ComicInfo 필드 정의', 'const META_FIELDS'],
        ['ComicInfo multiline 입력', "field.type === 'textarea'"],
        ['ComicInfo tag 입력', 'renderDualTextarea'],
        ['ComicInfo tag 칩 입력', 'function TagInput'],
        ['ComicInfo tag 추가 정규화', 'joinTagValues'],
        ['ComicInfo tag 칩 클래스', 'meta-tag-chip'],
        ['메타데이터 권 소수 입력', "{ id: 'Volume', labelKey: 't3_f_vol', type: 'decimal' }"],
        ['메타데이터 화 소수 입력', "{ id: 'Number', labelKey: 't3_f_num', type: 'decimal' }"],
        ['메타데이터 소수 입력 모드', "field.type === 'decimal' ? 'decimal'"],
        ['메타데이터 소수 입력 정규화', 'normalizeMetadataDecimal(nextValue)'],
        ['메타데이터 자동 제목 권화 동시 적용', 'applyInferredMetadataField(item.metadata || {}, inferred, field)'],
        ['메타데이터 시리즈 전체 일괄 복사', 'applyBatchMetadataFields(item.metadata || {}, batchMetadata, currentMetaFieldIds, applyEmpty)'],
        ['메타데이터 시리즈 전체 자동 후처리', 'applySeriesAutoMetadata(copiedMetadata, inferred)'],
        ['메타데이터 아이템 수정일 표시', 'metadataModifiedDate(file)'],
        ['메타데이터 아이템 수정일 fallback', "'No Data'"],
        ['메타데이터 파일명 중간 말줄임 분리', 'splitMetadataFileDisplayName(file.name)'],
        ['메타데이터 파일명 끝부분 보존', 'meta-tree-file-name-tail'],
        ['메타데이터 트리 전체 선택 버튼', 'className={`meta-tree-toggle-all'],
        ['메타데이터 트리 전체 선택 카운트', 'meta-tree-toggle-count'],
        ['메타데이터 폴더 원클릭 접기 펼치기', 'toggleGroupCollapsed(groupName)'],
        ['메타데이터 폴더 원클릭 핸들러', 'onClick={() => handleGroupClick(dir.name)}'],
        ['메타데이터 작업 리스트 키보드 포커스', 'ref={treeContainerRef}'],
        ['메타데이터 작업 리스트 활성 상태 유지', 'metadataTreeKeyboardActiveRef'],
        ['메타데이터 작업 리스트 방향키 핸들러', 'handleMetadataTreeKeyDown'],
        ['메타데이터 작업 리스트 보이는 항목 순회', 'metadataTreeVisibleNodes(groupedItems, collapsedGroups)'],
        ['메타데이터 작업 리스트 선택 행 스크롤', "querySelectorAll('[data-meta-tree-key]')"],
        ['메타데이터 작업 리스트 위 이동', "event.key === 'ArrowUp'"],
        ['메타데이터 작업 리스트 아래 이동', "event.key === 'ArrowDown'"],
        ['메타데이터 작업 리스트 폴더 접기', "event.key === 'ArrowLeft'"],
        ['메타데이터 작업 리스트 폴더 펼치기', "event.key === 'ArrowRight'"],
        ['메타데이터 검색형 select 필드 제한', "SEARCHABLE_SELECT_FIELDS = new Set(['SeriesGroup', 'Format'])"],
        ['메타데이터 검색형 select 컴포넌트', 'function SearchableSelect'],
        ['메타데이터 시리즈 그룹 후보 수집', 'seriesGroupOptions'],
        ['메타데이터 포맷 Python i18n 후보', 'const FORMAT_OPTIONS'],
        ['메타데이터 포맷 WebComic 후보', "'WebComic'"],
        ['메타데이터 포맷 Digital 후보', "'Digital'"],
        ['메타데이터 연령등급 Python i18n 후보', 'const AGE_RATING_OPTIONS'],
        ['메타데이터 연령등급 Adult 후보', "'Adult / Mature Audiences'"],
        ['메타데이터 읽기 방향 Python i18n 후보', 'const MANGA_READING_OPTIONS'],
        ['메타데이터 읽기 방향 우좌 후보', "'YesAndRightToLeft'"],
        ['API 검색 다이얼로그 검색어', 'value={dialogQuery}'],
        ['EPUB 표지 내부 이미지 목록 IPC', 'listMetadataEpubImages'],
        ['EPUB 표지 내부 이미지 선택 IPC', 'loadMetadataEpubImage'],
        ['EPUB 표지 로컬 이미지 선택 IPC', 'loadMetadataImageFile'],
        ['EPUB 표지 API 캐시 IPC', 'cacheMetadataRemoteCover'],
        ['EPUB 표지 저장 지시값', 'epubCoverChange'],
        ['EPUB 표지 도구 클래스', 'meta-epub-cover-tools'],
        ['EPUB 표지 기본정보 필드 주입', 'renderCoverField?.()'],
        ['EPUB 표지 해상도 표시', 'meta-epub-cover-resolution'],
        ['리디 표지 원본 URL 사용', 'ridiOriginalCoverUrl'],
        ['리디 표지 xxlarge 요청', 'xxlarge?dpi=xxhdpi#1'],
        ['API 검색 결과 표지 사용 버튼', "text('btn_use_cover', '표지 사용(X)')"],
    ]);
    assertInventory('settings', [
        ['형식별 뷰어 경로', "localConfig.viewer_paths?.[option.key] || ''"],
        ['코믹 뷰어 연결 확장자 안내', 'viewer_type_comic_extensions'],
        ['API secret key', 'renderSecretInput'],
        ['TTS API key 탭', "activeTab === 'ttsApi'"],
        ['TTS API key 탭 문구', 'tab_tts_api_key'],
        ['TTS 전용 OpenAI API key', "renderSecretInput('tts_openai_key'"],
        ['TTS 전용 Google API key', "renderSecretInput('tts_google_key'"],
        ['태그 치환 규칙 textarea', "localConfig.api_keys?.tag_rules || ''"],
    ]);
    assertInventory('sharing', [
        ['서버 주소 선택', 'id="sharing-server-address"'],
        ['Web 서버 포트', 'id="web-port"'],
        ['WebDAV 아이디', 'id="webdav-id"'],
        ['WebDAV 비밀번호', 'id="webdav-password"'],
    ]);
    assertInventory('sharingCss', [
        ['서버 주소 select 스타일', '.sharing-input-select'],
        ['서버 상태 로그 텍스트 선택', 'user-select: text'],
    ]);
});

test('상단 메뉴는 버그 신고 옆에 매뉴얼 외부 링크 버튼을 제공한다', () => {
    assertInventory('app', [
        ['매뉴얼 URL import', 'MANUAL_URL'],
        ['버그 신고 버튼', "openExternal?.(ISSUE_URL)"],
        ['매뉴얼 버튼', "openExternal?.(MANUAL_URL)"],
        ['매뉴얼 아이콘', 'name="bookOpen"'],
        ['매뉴얼 문구', "t('btn_manual')"],
    ]);
});

test('폴더 탭은 Electron 미지원 window.prompt 대신 내부 입력 다이얼로그를 사용한다', () => {
    assert.doesNotMatch(sources.folder, /window\.prompt/);
    assertInventory('folder', [
        ['공용 텍스트 입력 다이얼로그', 'function TextInputDialog'],
        ['텍스트 입력 다이얼로그 상태', 'textInputDialog'],
        ['텍스트 입력 확인 콜백', 'closeTextInputDialog(value)'],
        ['레이아웃 이름 저장 입력 필드', 'folder-layout-save-input'],
    ]);
});

test('14.4 dropdown 전수 목록이 실제 제어와 연결되어 있다', () => {
    assertInventory('settings', [
        ['환경설정 언어', 'LANGUAGE_OPTIONS.map'],
        ['완료 알림 소리', 'soundOptions.map'],
        ['폰트', "localConfig.font_family || 'Noto Sans KR'"],
        ['폰트 배율', 'localConfig.font_scale || 100'],
        ['출력 포맷', "localConfig.target_format || 'none'"],
        ['내부 파일명 변경 재압축 강도', "localConfig.renamer_archive_compression || 'auto'"],
        ['AI provider', "localConfig.api_keys?.ai_provider || 'Gemini'"],
    ]);
    assertInventory('folderToolbar', [
        ['폴더 그룹 기준', 'groupLabels'],
        ['폴더 필터 checkable action', 'metadataMissingOnly'],
        ['폴더 정렬 기준/순서', 'FOLDER_SORT_KEYS.map'],
        ['저장 레이아웃 적용', 'onApplyLayout'],
    ]);
    assertInventory('folder', [
        ['저장 레이아웃 삭제', 'id="layout-delete-select"'],
        ['라이브러리 이동 대상', 'id="library-move-select"'],
        ['라이브러리 이동 요약', 'className="library-move-summary"'],
        ['라이브러리 이동 옵션', 'library_move_option'],
        ['라이브러리 이동 미리보기 개수', 'library_move_preview_count'],
        ['라이브러리 이동 일괄 충돌 확인', 'findLibraryMoveConflicts'],
        ['라이브러리 이동 즉시 상태 표시', 'folder:libraryMove'],
        ['라이브러리 이동 슬라이드 항목 표시', 'slideItemReady'],
        ['라이브러리 이동 상태 문구', 'library_move_status_prepare'],
    ]);
    assertInventory('multiRenameDialog', [
        ['여러 파일 이름 변경 순번 위치', 'value={sequencePosition}'],
        ['여러 파일 이름 변경 취소 버튼', 'multi-rename-cancel'],
    ]);
    assertInventory('renamer', [
        ['내부 파일명 패턴', 'value={patternIndex}'],
    ]);
    assertInventory('metadata', [
        ['메타데이터 검색 API', 'value={apiSource}'],
        ['메타데이터 combo', "field.type === 'select'"],
        ['API 검색 다이얼로그 API', 'value={dialogApi}'],
    ]);
});

test('내부 파일명 변경 리스트는 키보드 이동과 대상 삭제를 지원한다', () => {
    assertInventory('renamer', [
        ['대상 압축 파일 리스트 키보드 핸들러', 'handleArchiveTableKeyDown'],
        ['내부 파일 리스트 키보드 핸들러', 'handleInnerTableKeyDown'],
        ['대상 압축 파일 리스트 포커스', 'ref={archiveTableRef}'],
        ['내부 파일 리스트 포커스', 'ref={innerTableRef}'],
        ['방향키 아래 이동', "event.key === 'ArrowDown'"],
        ['대상 압축 파일 Delete 삭제', "event.key === 'Delete'"],
        ['대상 압축 파일 삭제 컬럼', "<th style={{ width: '8%' }}>{t('btn_remove')}</th>"],
        ['대상 압축 파일 행 삭제 버튼', 'className="renamer-archive-delete-btn"'],
        ['대상 압축 파일 행 삭제 동작', 'handleRemoveArchive(file.id)'],
        ['sticky 헤더 고려 선택 행 스크롤', 'scrollTableRowIntoView'],
        ['내부 파일 삭제 체크박스', "t('renamer.delete_entry')"],
        ['내부 파일 삭제 상태', 'entry.deleteChecked'],
        ['내부 파일 삭제 토글', 'handleToggleEntryDelete'],
    ]);
});

test('내부 파일명 변경 대상 리스트는 출력 포맷 변경 배지를 표시한다', () => {
    assertInventory('renamer', [
        ['대상 압축 파일 포맷 변경 배지 계산', 'archiveChangeBadges(file, config)'],
        ['대상 압축 파일 포맷 변경 배지 클래스', 'renamer-format-badge'],
        ['대상 압축 파일 누락페이지 컬럼', "t('col_missing_pages')"],
        ['대상 압축 파일 누락페이지 값', 'file.missingPages ||'],
        ['대상 압축 파일 누락페이지 스타일', 'renamer-missing-pages'],
    ]);
});

test('압축 파일 구조 정리 로컬 툴바는 공통 파일 액션을 중복 노출하지 않는다', () => {
    const start = sources.organizer.indexOf('className="org-local-toolbar"');
    assert.notEqual(start, -1);
    const end = sources.organizer.indexOf('<div className="org-content-area"', start);
    const block = sources.organizer.slice(start, end);
    assert.doesNotMatch(block, /t\('add_folder'\)/);
    assert.doesNotMatch(block, /t\('add_file'\)/);
    assert.doesNotMatch(block, /t\('clear_all'\)/);
    assert.match(block, /t\('org_expand_collapse_all'\)/);
    assert.match(block, /t\('batch_default'\)/);
    assert.match(block, /t\('batch_title'\)/);
});

test('압축 파일 구조 정리는 하위 항목 다중 선택과 공용 이름 변경을 사용한다', () => {
    assertInventory('organizer', [
        ['하위 항목 선택 경로', 'selectedVolumePaths.includes(volumeRow.path)'],
        ['하위 항목 활성 선택 표시', "activeVolumePath === volumeRow.path"],
        ['하위 항목 드래그 범위 선택', 'handleVolumeRowMouseEnter'],
        ['하위 항목 드래그 영역 표시', 'volumeSelectionBox'],
        ['하위 항목 드래그 영역 선택 계산', 'updateVolumeRubberSelection'],
        ['하위 항목 드래그 영역 선택 반영', 'selectVolumePaths(selected)'],
        ['폴더명 드롭다운 메뉴 버튼', "t('org_folder_menu')"],
        ['폴더명 드롭다운 메뉴 상태', 'openFolderMenuId === item.id'],
        ['폴더명 드롭다운 마우스 오버 열기', 'onMouseEnter={() => openFolderRowMenu(item.id)}'],
        ['폴더명 드롭다운 마우스 아웃 닫기', 'onMouseLeave={() => closeFolderRowMenu(item.id)}'],
        ['폴더명 파일명 항목', "t('org_filename_path')"],
        ['폴더명 파일명 경로 적용', 'filenameOutputPath(item)'],
        ['일괄 드롭다운 메뉴 버튼', "t('org_batch_menu')"],
        ['일괄 드롭다운 메뉴 상태', 'openBatchMenuId === item.id'],
        ['일괄 드롭다운 마우스 오버 열기', 'onMouseEnter={() => openBatchRowMenu(item.id)}'],
        ['일괄 드롭다운 마우스 아웃 닫기', 'onMouseLeave={() => closeBatchRowMenu(item.id)}'],
        ['일괄 드롭다운 메뉴 액션', 'handleBatchMenuAction(item.id'],
        ['일괄 기존 파일명 버튼', "t('org_batch_original_name')"],
        ['일괄 제목추출 버튼', "t('org_batch_extracted_title')"],
        ['분석 결과 추출명 보존', 'hydrateOrganizerItem(item)'],
        ['일괄 기존 파일명 적용', 'organizerOriginalFilenameName(preserved)'],
        ['일괄 제목추출 적용', 'organizerExtractedTitleName(preserved)'],
        ['일괄 조작 전 추출명 고정', 'preserveOrganizerExtractedTitle(volume)'],
        ['작업 리스트 빈 영역 선택 해제', "event.target.closest('.org-tree-row')"],
        ['작업 리스트 빈 영역 하위 선택 해제', 'clearVolumeSelection();'],
        ['다중 이름 변경 단축키', "event.shiftKey && isShortcutKey(event, 'r')"],
        ['하위 항목 클릭 시 작업 리스트 포커스', 'treeBodyRef.current?.focus'],
        ['공용 이름 변경 실행 연결', 'onExecute={executeVolumeMultiRename}'],
    ]);
    assertInventory('organizerCss', [
        ['하위 항목 드래그 영역 스타일', '.org-drag-selection-box'],
        ['행 드롭다운 메뉴 스타일', '.org-row-menu'],
        ['행 드롭다운 hover 이탈 방지 위치', 'top: 100%;'],
    ]);
    assert.doesNotMatch(sources.organizer, /OrganizerFilenameDialog|org-filename-input|openVolumeEditor|editingVolume|org-context-menu/);
    assert.doesNotMatch(sources.organizer, /image_count\}p/);
});

test('여러 파일 이름 변경 UI는 공용 컴포넌트로 분리된다', () => {
    assertInventory('multiRenameDialog', [
        ['미리보기 컬럼 폭 상태', 'columnWidths'],
        ['미리보기 컬럼 리사이저', 'multi-rename-column-resizer'],
        ['미리보기 컬럼 자동 리사이즈', 'autoResizeColumn'],
        ['미리보기 컬럼 더블클릭 자동 리사이즈', 'onDoubleClick'],
        ['변경된 새 파일명 색상 클래스', 'rename-new-name-changed'],
        ['미리보기 갱신 표시 지연 상태', 'previewProgressVisible'],
        ['파일 객체 배경 갱신에 흔들리지 않는 미리보기 기준', 'renameFilesSignature'],
    ]);
    assertInventory('folder', [
        ['폴더 탭 공용 다중 이름 변경', '<MultiRenameDialog'],
    ]);
    assertInventory('organizer', [
        ['구조 정리 공용 다중 이름 변경', '<MultiRenameDialog'],
    ]);
});

test('폴더 탭 컨텍스트 메뉴는 기존 Python 메뉴 항목과 단축키를 노출한다', () => {
    assertInventory('folder', [
        ['컨텍스트 메뉴 단축키 표시', 'folder-context-menu-shortcut'],
        ['탐색기 폴더 이름 변경 단축키', 'shortcut="Shift+R"'],
        ['탐색기 폴더 구조 정리 단축키', 'shortcut="F1"'],
        ['탐색기 폴더 내부 이름 변경 단축키', 'shortcut="F2"'],
        ['탐색기 폴더 메타데이터 편집 단축키', 'shortcut="F3"'],
        ['탐색기 폴더 삭제 단축키', 'shortcut="Del"'],
        ['리스트 파일 강제 업데이트', "t('action_update_files')"],
        ['리스트 이름 변경 취소', "t('tf_undo_rename')"],
        ['리스트 전체 선택', "t('action_sel_all')"],
        ['리스트 primary modifier 단축키 표시', 'formatPrimaryShortcut'],
        ['리스트 primary modifier 선택', 'hasPrimaryModifier(event, runtimePlatform)'],
        ['리스트 새로고침 단축키', 'shortcut="F5"'],
    ]);
});

test('리스트 패널 새로고침 버튼은 캐시를 건너뛰고 강제 스캔한다', () => {
    assert.match(
        sources.folder,
        /className="refresh-btn"[\s\S]*onClick=\{\(\) => handleSmartRefresh\(true\)\}/,
    );
    assert.match(
        sources.folder,
        /event\.key === 'F5'[\s\S]*handleRefreshShortcut\(\)/,
    );
});

test('폴더 탭 F5는 활성 패널에 맞는 새로고침을 실행한다', () => {
    assertInventory('folder', [
        ['F5 활성 패널 판정', 'isExplorerPanelActive'],
        ['탐색기 패널 F5 폴더 새로고침', 'refreshContextFolder(selectedFolderPath)'],
        ['리스트 패널 F5 강제 새로고침', 'handleSmartRefresh(true)'],
        ['F5 단축키 핸들러', 'handleRefreshShortcut()'],
    ]);
    assert.match(
        sources.folder,
        /handleRefreshShortcut[\s\S]*isExplorerPanelActive\(\)[\s\S]*refreshContextFolder\(selectedFolderPath\)[\s\S]*handleSmartRefresh\(true\)/,
    );
});

test('폴더 탭 패널 splitter는 드래그 중 React 상태 갱신을 프레임 단위로 제한한다', () => {
    assertInventory('folder', [
        ['패널 리사이즈 가이드 생성', 'createFolderResizeGuide'],
        ['패널 리사이즈 가이드 이동', 'updateFolderResizeGuide'],
        ['패널 리사이즈 가이드 제거', 'guide?.remove()'],
        ['패널 리사이즈 중 측정 업데이트 보류', 'panelResizingRef'],
        ['리사이즈 중 ResizeObserver 상태 갱신 차단', 'if (!panelResizingRef.current) updateRightPanelWidth()'],
        ['패널 리사이즈 프레임 예약', 'window.requestAnimationFrame'],
        ['좌우 splitter 종료 시 상태 커밋', 'setLeftPanelWidth(current => current === savedWidth ? current : savedWidth)'],
        ['상하 splitter 종료 시 상태 커밋', 'setDetailPanelHeight(current => current === savedHeight ? current : savedHeight)'],
    ]);
    assertInventory('folderCss', [
        ['패널 리사이즈 중 선택 방지', 'body.is-resizing-panel'],
        ['좌우 패널 리사이즈 커서', 'body.is-resizing-folder-horizontal'],
        ['상하 패널 리사이즈 커서', 'body.is-resizing-folder-vertical'],
        ['패널 리사이즈 중 포인터 이벤트 차단', 'pointer-events: none'],
        ['패널 리사이즈 가이드 스타일', '.folder-resize-guide'],
    ]);
});

test('이름 바꾸기 미리보기는 컬럼 크기 조절과 변경 색상 표시를 제공한다', () => {
    assertInventory('multiRenameDialog', [
        ['미리보기 컬럼 폭 상태', 'columnWidths'],
        ['미리보기 컬럼 리사이저', 'multi-rename-column-resizer'],
        ['미리보기 컬럼 자동 리사이즈', 'autoResizeColumn'],
        ['미리보기 컬럼 더블클릭 자동 리사이즈', 'onDoubleClick'],
        ['변경된 새 파일명 색상 클래스', 'rename-new-name-changed'],
    ]);
});

test('자세히 보기 테이블도 빈 영역 드래그 선택 콜백을 받는다', () => {
    assertInventory('folder', [
        ['테이블 드래그 선택 콜백 전달', 'onDragSelect={selectPaths}'],
    ]);
});

test('파일 보기 항목은 mouseup에서 선택 상태를 확정한다', () => {
    assertInventory('fileTable', [
        ['테이블 mouseup 선택 확정', 'onMouseUp={(event) => handleRowMouseUp(file, event, fileIndex)}'],
        ['테이블 마우스 click 재선택 방지', 'if (e.detail > 0) return;'],
    ]);
    assertInventory('thumbnailView', [
        ['썸네일 mouseup 선택 확정', 'onMouseUp={(event) => handleItemMouseUp(file, event, fileIndex)}'],
        ['썸네일 마우스 click 재선택 방지', 'if (e.detail > 0) return;'],
    ]);
    assertInventory('tileView', [
        ['타일 mouseup 선택 확정', 'onMouseUp={(event) => handleItemMouseUp(file, event, fileIndex)}'],
        ['타일 마우스 click 재선택 방지', 'if (e.detail > 0) return;'],
    ]);
});

test('폴더 탭은 앱 공통 하단 상태바와 중복되는 자체 상태바를 렌더링하지 않는다', () => {
    assert.equal(sources.folder.includes('className="global-status-bar"'), false);
});

test('폴더 빈 상태 이미지는 보기 영역 중앙에 고정된다', () => {
    assertInventory('folderCss', [
        ['폴더 빈 상태 오버레이', '.empty-folder-page'],
        ['폴더 빈 상태 절대 배치', 'position: absolute;'],
        ['폴더 빈 상태 전체 영역', 'inset: 0;'],
        ['폴더 빈 상태 중앙 정렬', 'justify-content: center;'],
    ]);
});

test('썸네일 모드는 커버 카드 오버레이 디자인을 사용한다', () => {
    assertInventory('thumbnailView', [
        ['썸네일 커버 카드 구조', 'thumbnail-cover-card'],
        ['썸네일 평점 배지', 'thumbnail-rating-badge'],
        ['썸네일 페이지 배지', 'thumbnail-page-badge'],
    ]);
});

test('폴더 커버 이미지는 보이는 항목에만 로딩 스피너를 표시한다', () => {
    assertInventory('coverImage', [
        ['커버 로딩 스피너 기본 지원', 'showLoadingIndicator = true'],
        ['커버 로딩 스피너 명시 조건', 'showLoadingIndicator && !loaded'],
    ]);
    assertInventory('fileTable', [
        ['테이블 커버 스피너 가시 항목 제한', 'visibleCoverPathSet.has(file.path)'],
    ]);
    assertInventory('thumbnailView', [
        ['썸네일 커버 스피너 가시 항목 제한', 'visibleCoverPathSet.has(file.path)'],
    ]);
    assertInventory('tileView', [
        ['타일 커버 스피너 가시 항목 제한', 'visibleCoverPathSet.has(file.path)'],
    ]);
    assertInventory('folderCss', [
        ['커버 로딩 컨테이너 상대 배치', '.folder-cover-loading'],
        ['타일 커버 스피너 절대 배치 유지', '.tile-image .folder-cover-spinner'],
        ['커버 로딩 스피너 지연 표시', 'folder-cover-spinner-delay'],
    ]);
});

test('폴더 커버 이미지는 이미 로드한 썸네일을 재진입 시 즉시 표시 상태로 시작한다', () => {
    assertInventory('coverImage', [
        ['로드 완료 커버 URL 캐시 제한', 'LOADED_COVER_SRC_CACHE_LIMIT'],
        ['로드 완료 커버 URL 기억', 'rememberLoadedCoverSource(src)'],
        ['초기 로드 상태 캐시 재사용', 'useState(() => isCoverSourceLoaded(src))'],
        ['src 변경 시 캐시 상태 적용', 'setLoaded(isCoverSourceLoaded(src))'],
    ]);
});

test('상세보기 패널은 선택 항목 내용 높이에 맞춰 자동 조절한다', () => {
    assertInventory('folder', [
        ['상세보기 내용 높이 변경 핸들러', 'handleDetailContentHeightChange'],
        ['상세보기 내용 높이 콜백 연결', 'onContentHeightChange={handleDetailContentHeightChange}'],
    ]);
});

test('상세보기 패널은 링크 열기와 메타데이터 값 스타일을 제공한다', () => {
    assertInventory('detailPanel', [
        ['상세보기 링크 외부 열기', 'openExternalLink(value)'],
        ['상세보기 링크 역할', 'role="link"'],
        ['상세보기 링크 키보드 실행', "event.key !== 'Enter' && event.key !== ' '"],
        ['상세보기 등장인물 users 아이콘', 'icon="users"'],
    ]);
    assertInventory('folderCss', [
        ['상세보기 메타데이터 값 색상', 'color: rgba(255, 255, 255, 0.8);'],
        ['상세보기 메타데이터 값 굵기', 'font-weight: normal;'],
        ['상세보기 링크 색상', '.metadata-link-value'],
        ['상세보기 링크 포인터', 'cursor: pointer;'],
    ]);
    assertInventory('faIcon', [
        ['users 아이콘 매핑', 'users: faUsers'],
    ]);
});

test('도서 상세보기 패널은 메타데이터 관리와 같은 책 항목을 표시한다', () => {
    assertInventory('detailPanel', [
        ['만화책 상세 출간일', "t('col_pub_date')"],
        ['도서 상세 제목 헤딩', 'className="detail-title"'],
        ['도서 상세 시리즈 헤딩', 'className="detail-series"'],
        ['도서 상세 시리즈번호', "metadataText(t, 't3_f_series_number'"],
        ['도서 상세 책설명', "metadataText(t, 't3_f_book_description'"],
        ['도서 상세 작가', "metadataText(t, 't3_f_writer'"],
        ['도서 상세 장르/키워드/카테고리', "metadataText(t, 't3_f_genre_keywords_categories'"],
        ['도서 상세 태그 칩 영역', 'className="detail-tags" aria-label={tagLabel}'],
        ['도서 상세 출판사', "metadataText(t, 't3_f_pub'"],
        ['도서 상세 발행일', "metadataText(t, 'book_detail_publish_date'"],
        ['도서 상세 ISBN', "metadataText(t, 't3_f_isbn'"],
        ['도서 상세 언어 코드', "metadataText(t, 't3_f_iso'"],
        ['도서 상세 평점', "metadataText(t, 't3_f_rating'"],
    ]);
});

test('타일 모드는 항목 크기 변화에도 카드 레이아웃을 유지한다', () => {
    assertInventory('tileView', [
        ['타일 최소 폭은 이미지 폭 기반 계산', 'imageWidth + Math.round'],
        ['타일 커버 카드 구조', 'tile-cover-card'],
        ['타일 이미지 높이 CSS 변수', "'--tile-image-height'"],
        ['타일 작가 출판사 장르 표시', 'tile-meta-line'],
        ['타일 줄거리 표시', 'tile-summary'],
    ]);
    assertInventory('folderCss', [
        ['타일 커버 카드 겹침 레이어', '.tile-cover-card::before'],
        ['타일 이미지 배경색', 'background: #1c1c1c;'],
    ]);
});

test('리스트 파일 강제 업데이트는 선택 파일을 단일 파일 미리보기로 갱신한다', () => {
    assertInventory('folder', [
        ['파일 강제 업데이트 메뉴', "handleContextAction('update-files')"],
        ['파일 강제 업데이트 단일 파일 추출', 'getFilePreview'],
        ['보이는 항목 표지 캐시 우선 로드', "loadPreview(filePath, { force: false })"],
        ['파일 강제 업데이트 표지 강제 추출', "getFilePreview?.(filePath, { force: true })"],
        ['파일 강제 업데이트 캐시 반영', 'updateCachedFiles'],
    ]);
});

test('자세히 보기 테이블 헤더는 컬럼 조작과 정렬 상태를 노출한다', () => {
    assertInventory('folder', [
        ['테이블 컬럼 폭 조절 콜백', 'onColumnLayoutChange'],
    ]);
    assertInventory('fileTable', [
        ['테이블 컬럼 리사이저', 'file-table-column-resizer'],
        ['테이블 컬럼 드래그 순서 변경', 'moveColumnTo'],
        ['테이블 컬럼 드래그 그립 아이콘', 'name="grip-vertical"'],
        ['테이블 컬럼 드래그 고스트', 'file-table-column-drag-ghost'],
        ['테이블 컬럼 드래그 시작 표시', 'drag-source'],
        ['테이블 지정 컬럼 중앙 정렬', 'centeredColumnKeys'],
        ['테이블 중앙 정렬 셀 클래스', 'center-cell'],
        ['테이블 정렬 활성 클래스', 'active-sort'],
        ['테이블 정렬 방향 아이콘', 'file-table-sort-icon'],
    ]);
});

test('14.1의 추가 확인 동작은 기본값 아니오로 구성된다', () => {
    assertInventory('app', [
        ['업데이트 페이지 이동 확인', 'shouldOpenUpdatePage(response)'],
        ['업데이트 확인 기본값', "defaultChoice: 'no'"],
    ]);
    assertInventory('metadata', [
        ['시리즈 그룹 삭제 확인', "t('t3_msg_delete_series_group')"],
        ['시리즈 삭제 확인 기본값', "defaultChoice: 'no'"],
    ]);
});
