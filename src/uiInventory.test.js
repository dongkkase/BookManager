import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sources = {
    app: fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8'),
    folder: fs.readFileSync(new URL('./tabs/FolderTab.jsx', import.meta.url), 'utf8'),
    folderToolbar: fs.readFileSync(new URL('./components/folder/FolderToolbar.jsx', import.meta.url), 'utf8'),
    metadata: fs.readFileSync(new URL('./tabs/MetadataTab.jsx', import.meta.url), 'utf8'),
    organizer: fs.readFileSync(new URL('./tabs/OrganizerTab.jsx', import.meta.url), 'utf8'),
    renamer: fs.readFileSync(new URL('./tabs/RenamerTab.jsx', import.meta.url), 'utf8'),
    settings: fs.readFileSync(new URL('./components/SettingsModal.jsx', import.meta.url), 'utf8'),
    sharing: fs.readFileSync(new URL('./tabs/SharingTab.jsx', import.meta.url), 'utf8'),
};

function assertInventory(sourceName, controls) {
    const source = sources[sourceName];
    for (const [label, fragment] of controls) {
        assert.ok(source.includes(fragment), `${label} 제어가 ${sourceName}에 있어야 합니다.`);
    }
}

test('14.3 input 전수 목록이 실제 제어와 연결되어 있다', () => {
    assertInventory('folder', [
        ['폴더 검색', 'value={searchQuery}'],
        ['폴더/파일 단일 이름 변경', 'window.prompt'],
        ['여러 파일 이름 변경 기존 형식', 'value={oldPattern}'],
        ['여러 파일 이름 변경 새 형식', 'value={newPattern}'],
        ['레이아웃 이름 저장', "t('dlg_save_lay_msg')"],
        ['삭제할 레이아웃 선택', 'id="layout-delete-select"'],
        ['경로로 이동', 'className="path-navigation-input"'],
    ]);
    assertInventory('organizer', [
        ['구조 정리 출력 경로', 'item.out_path'],
        ['구조 정리 자식 파일명', 'id="org-filename-input"'],
    ]);
    assertInventory('renamer', [
        ['내부 파일명 custom pattern', 'value={customText}'],
        ['내부 파일명 시작 번호', 'value={startNum}'],
    ]);
    assertInventory('metadata', [
        ['메타데이터 검색어', 'value={searchQuery}'],
        ['ComicInfo 필드 정의', 'const META_FIELDS'],
        ['ComicInfo multiline 입력', "field.type === 'textarea'"],
        ['ComicInfo tag 입력', 'renderDualTextarea'],
        ['API 검색 다이얼로그 검색어', 'value={dialogQuery}'],
    ]);
    assertInventory('settings', [
        ['뷰어 경로', "localConfig.viewer_path || ''"],
        ['API secret key', 'renderSecretInput'],
        ['태그 치환 규칙 textarea', "localConfig.api_keys?.tag_rules || ''"],
    ]);
    assertInventory('sharing', [
        ['WebDAV 아이디', 'id="webdav-id"'],
        ['WebDAV 비밀번호', 'id="webdav-password"'],
    ]);
});

test('14.4 dropdown 전수 목록이 실제 제어와 연결되어 있다', () => {
    assertInventory('settings', [
        ['환경설정 언어', 'LANGUAGE_OPTIONS.map'],
        ['완료 알림 소리', 'soundOptions.map'],
        ['폰트', "localConfig.font_family || 'Default'"],
        ['폰트 배율', 'localConfig.font_scale || 100'],
        ['출력 포맷', "localConfig.target_format || 'none'"],
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
        ['여러 파일 이름 변경 순번 위치', 'value={sequencePosition}'],
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
