# MIGRATION_TRACKING

## Phase 6: Folder Tab UI (진행중)
- [x] 폴더 트리 모델 연동: `electronAPI.getRoots()` 및 `readDir` 연동으로 실제 드라이브/폴더 구조 Lazy Loading 구현 (`FolderSidebar.jsx`)
- [x] 사이드바 레이아웃 및 폴더 확장/축소 기능 구성
- [x] 선택 항목 상세 패널(`DetailPanel.jsx`) 파이썬 원본(`DetailBackgroundWidget`) 스타일에 맞춘 UI 구현 (Blur, Gradient Overlay 추가)
- [x] 관련 CSS 작성 (`FolderTab.css`)
- [x] 파일 스캔 시 메타데이터 추출(`folderUtils.js` 활용하여 시리즈, 제목, 화수, 권수 추출) 적용
- [x] 즐겨찾기, 라이브러리 목록 관리 (설정 연동 및 부분 저장 마이그레이션 오류 수정)
- [x] ZIP/CBZ ComicInfo.xml 메타데이터 및 첫 이미지 커버/해상도 추출 연동
- [x] 중복 검사 로직(Bigram/유사도) 연동 및 테이블 표시
- [x] 폴더 선택 IPC, 스캔 이벤트 콜백, 옵션별 캐시/강제 새로고침 오류 수정

## Phase 7: Archive Organizer Tab (진행중)
- [x] 더미 데이터 제거 및 실제 파일/폴더 선택, 드래그 앤 드롭 분석 연동
- [x] ZIP/CBZ 네이티브 엔트리 분석 및 7z fallback 기반 구조 분석 태스크 구현
- [x] 분석 결과 트리 UI, 체크 상태, 출력 경로, 권/화 이름 편집 연동
- [x] 7z 기반 압축 해제/재압축 실행 IPC 구현
- [x] 백업 옵션, 출력 포맷 옵션, macOS `7z` fallback 처리

## Phase 8: Inner Renamer Tab (진행중)
- [x] 더미 데이터 제거 및 실제 파일/폴더 선택, 드래그 앤 드롭 분석 연동
- [x] ZIP/CBZ 네이티브 엔트리 분석 및 7z fallback 기반 내부 이미지 목록 생성
- [x] 기존 Python 패턴 규칙(기본 번호, Page/Cover, 파일명 동기화, 커스텀, 시작 번호) 미리보기 구현
- [x] 압축파일 체크, 이미지 압축/EXIF 옵션 토글, 내부 파일 순서 변경 UI 연동
- [x] 7z 기반 압축 해제/내부 파일명 변경/재압축 실행 IPC 구현
- [x] 백업 옵션, 출력 포맷 옵션, macOS `7z` fallback 처리

## Phase 9: Settings Dialog (진행중)
- [x] 기존 PyQt `SettingsDialog` 기준으로 기본 설정/폴더 탭 설정/API 검색 설정 탭 구조 마이그레이션
- [x] 언어, 완료 알림음, 폰트, 출력 포맷, 스레드, 백업, 폴더 평탄화, WebP, 이미지 품질, 뷰어 경로 설정 연동
- [x] 라이브러리/중복 검사 대상 폴더 목록 추가/삭제 UI 및 `dup_check_folders` 저장 연동
- [x] Aladin/Google Books/Comic Vine/AI 변환/API 태그 규칙 저장 연동
- [x] 기존 설정 키(`target_format`, `backup_on`, `flatten_folders`, `webp_conversion`, `img_quality`, `max_threads`, `play_sound`, `api_keys`)와 호환되도록 저장 로직 수정
- [x] 검색 캐시 초기화 및 폴더 인덱스 갱신 버튼 IPC 연동

## Phase 10: Metadata Management Tab (진행중)
- [x] 더미 데이터 제거 및 실제 파일/폴더 선택, 드래그 앤 드롭 분석 연동
- [x] 7z 기반 압축파일 목록 분석, 첫 이미지 커버 추출, ComicInfo.xml 추출/파싱 구현
- [x] 좌측 시리즈/파일 트리, 커버 미리보기, 체크 대상 저장 UI 연동
- [x] 내 데이터/일괄 편집창 필드 편집, 필드별 복사, 전체 반영, 시리즈 전체 반영, 리셋 구현
- [x] 7z 기반 ComicInfo.xml 생성 및 ZIP/CBZ/7z 아카이브 주입 저장 IPC 구현
- [ ] API 검색 결과 다이얼로그 및 외부 API fetch/cache 마이그레이션
- [ ] 라이브러리 최신권 메타 불러오기 및 자동 생성 마이그레이션

## Phase 11: Sharing Server & Release Notes (진행중)
- [x] 공유 서버 탭 더미 상태 제거 및 설정 기반 포트/계정 초기화 연동
- [x] OPDS 서버 IPC 및 로컬 HTTP 피드/다운로드 서버 구현
- [x] WebDAV 서버 IPC 및 기본 인증, PROPFIND, 파일 다운로드 구현
- [x] 서버 상태 조회/로그 이벤트를 렌더러 UI에 연결
- [x] 업데이트 및 릴리즈 노트 탭을 실제 탭 렌더링에 연결
- [x] GitHub 릴리즈 조회 IPC 및 네트워크 실패 폴백 구현
- [ ] 공유 서버 실제 클라이언트(Panels/ComicGlass) 호환성 상세 검증
