# BookManager 마이그레이션 트래킹 문서 (Python -> Electron + Node.js + React)

이 문서는 기존 Python 기반 `ComicZIP Optimizer` 애플리케이션을 Electron + Node.js + React 기반의 `BookManager` 앱으로 마이그레이션하는 전체 과정을 추적합니다.
- **주요 목표**: 100% 기능 동일, UI/UX 디자인 완벽 유지, 기존 리소스(이미지, 사운드, 폰트) 재사용, 대용량 파일 모듈화, 윈도우/맥 포터블 크로스플랫폼 지원.

---

## [Phase 1] 프로젝트 구조 및 스캐폴딩 생성
- [x] 기존 프로젝트(`old_project`) 파일/구조 분석 완료
- [x] 마이그레이션 트래킹 문서(`MIGRATION_TRACKING.md`) 작성 완료
- [x] 새로운 Electron + Node.js + React 기반의 디렉토리 및 빈 파일 생성 (대용량 파일 모듈화 고려)

## [Phase 2] 환경 설정 및 유틸리티 마이그레이션
- [x] **환경설정 (`config.py`)**: `electron/configManager.js` 로 분리 (Node.js `fs` 및 Electron `userData` 활용)
- [x] **다국어 지원 (`core/i18n.py`)**: `react-app/src/i18n/locales/` 및 `electron/utils/i18n.js` 로 분리 적용
- [x] **공통 유틸리티 (`utils.py`)**: `electron/utils/common.js` 등 세부 모듈로 분할

## [Phase 3] 코어 로직 마이그레이션 (`core/`)
- [x] `core/library_db.py` -> `electron/core/libraryDb.js`: SQLite3 (`better-sqlite3` 권장) 연동
- [x] `core/archive_utils.py` -> `electron/core/archiveUtils.js`: 압축 해제 및 이미지 처리 (기존 `bin/win` 바이너리 연동)
- [x] `core/api_fetcher.py` -> `electron/core/apiFetcher.js`: 메타데이터 및 번역 API 연동 (비동기 HTTP 클라이언트)
- [x] `core/parser.py` -> `electron/core/parser.js`: 파일명/메타데이터 정규식 파싱 로직

## [Phase 4] 백그라운드 태스크 로직 마이그레이션 (`tasks/`)
> **Note**: 기존 용량이 큰 스레드 기반 작업들은 Node.js의 비동기 큐 또는 하위 모듈로 쪼개어 관리합니다.
- [x] `tasks/organize_task.py` -> `electron/tasks/organizeTask.js`
- [x] `tasks/rename_task.py` -> `electron/tasks/renameTask.js`
- [x] `tasks/tab_folder_threads.py` (폴더 스캔) -> `electron/tasks/folderTask.js`
- [x] `tasks/extract_task.py` (메모리 추출) -> `electron/tasks/extractTask.js`
- [ ] 기타 워커(`library_task.py`, `save_task.py` 등) 모듈화 진행 예정

## [Phase 5] 공유 서버 로직 마이그레이션 (`servers/`)
- [x] 서버 매니저 및 기본 클래스 (`manager.js`, `baseServer.js`)
- [x] OPDS 서버 (`opdsServer.js`) - Express.js 기반 구축
- [x] Web/API 서버 (`webServer.js`, `apiServer.js`)
- [x] 프로토콜 서버 구현 (WebDAV, FTP, SMB 지원 여부 확인 후 Node.js 모듈 매핑)

## [Phase 6] 프론트엔드 UI 마이그레이션 (React)
> **Note**: 기존 레이아웃, 버튼, 문구, 아이콘을 100% 동일하게 유지합니다. PyQt 기반의 복잡한 UI는 컴포넌트화 시킵니다.
- [x] 기존 이미지(`src/`), 사운드(`sounds/`), 폰트(`fonts/`) 리소스 에셋 연동
- [x] **메인 윈도우 (`ui/main_window.py`)** -> `react-app/src/App.js` 및 `SettingsModal.js`
- [x] **공통 위젯 (`widgets.py`, `tag_widgets.py`)** -> `react-app/src/components/widgets/` 분할
- [x] **다이얼로그 (`dialogs.py`, `api_search_dialog.py`)** -> `react-app/src/components/dialogs/` 분할
- [x] **Tab 1: Organizer** (`ui/tabs/tab1_organizer.py`) -> `react-app/src/tabs/OrganizerTab/OrganizerTab.js`
- [x] **Tab 2: Renamer** (`ui/tabs/tab2_renamer.py`) -> `react-app/src/tabs/RenamerTab/RenamerTab.js`
- [x] **Tab 3: Metadata** (`ui/tabs/tab3_metadata.py`) -> `react-app/src/tabs/MetadataTab/MetadataTab.js`
- [x] **Tab 4: Folder/Explorer** (`ui/tabs/tab_folder*.py`) -> `react-app/src/tabs/FolderTab/index.js`
- [x] **Tab 5: Sharing** (`ui/tabs/tab_sharing.py`) -> `react-app/src/tabs/SharingTab/index.js`

## [Phase 7] Electron IPC 및 상태 통합 연동
- [x] React 렌더러 - Electron 메인 프로세스 간 IPC 통신 인터페이스 완성 (`preload.js`, `ipcHandlers.js`)
- [x] 프론트엔드 - 백엔드 이벤트 시그널(`ui/signals.py` 대체) 연동 완벽 구현 테스트

## [Phase 8] 크로스 플랫폼 빌드 및 패키징
- [x] `electron-builder` 설정 (package.json)
- [x] Windows (win32) Portable 빌드 설정 (외부 바이너리 `bin/win` 포함 설정)
- [x] macOS (darwin) 빌드 설정 (Universal/Portable)
- [ ] 기능 100% 동일성 검증 테스트 완료 (최종 QA 대기)
