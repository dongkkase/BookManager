# BookManager 마이그레이션 계획

## 📋 프로젝트 개요

- **프로젝트명**: BookManager (기존 ComicZIP Optimizer 마이그레이션)
- **목표**: Python/PyQt6 기반 앱을 100% Electron + React + TypeScript로 재구축
- **현재 상태**: Gemini Code Assist로 초기 세팅 완료, 핵심 기능 구현 진행 중

---

## ✅ Task 1: 초기 프로젝트 세팅 검토 및 보완

### 1.1 현재 세팅 상태

| 항목 | 상태 | 비고 |
|------|------|------|
| Electron + Vite + React + TS | ✅ 완료 | electron-vite 보일러플레이트 |
| TailwindCSS v4 | ✅ 완료 | @tailwindcss/vite 플러그인 |
| contextBridge + preload | ✅ 완료 | 보안 구조 적용됨 |
| better-sqlite3 | ✅ 완료 | DB 스키마 마이그레이션 완료 |
| sharp | ✅ 완료 | 이미지 처리용 |
| 7zip-bin + node-7z | ✅ 완료 | 압축 처리용 |
| chokidar | ✅ 완료 | 폴더 감시용 |
| express | ✅ 완료 | 서버용 |
| webdav-server | ✅ 완료 | WebDAV 서버용 |
| zustand | ✅ 완료 | 상태 관리용 |
| react-router-dom | ✅ 완료 | 라우팅용 |
| lucide-react | ✅ 완료 | 아이콘용 |

### 1.2 디렉토리 구조 (현재)

```
src/
├── main/                 # Main Process
│   ├── index.ts         # Electron 진입점
│   ├── ipc/
│   │   └── index.ts     # IPC 핸들러
│   ├── services/
│   │   ├── configService.ts   # 설정 관리
│   │   ├── libraryDb.ts       # SQLite DB
│   │   └── taskManager.ts     # 태스크 관리
│   └── utils/
│       ├── archiveUtils.ts    # 압축 유틸리티
│       └── imageUtils.ts      # 이미지 유틸리티
├── preload/
│   ├── index.ts         # Preload 스크립트
│   └── index.d.ts       # 타입 정의
├── renderer/
│   ├── index.html
│   └── src/
│       ├── main.tsx     # React 진입점
│       ├── App.tsx      # 루트 컴포넌트
│       ├── assets/      # 스타일, 이미지
│       └── components/  # UI 컴포넌트
└── shared/
    ├── constants/
    │   ├── index.ts
    │   └── ipc.ts       # IPC 채널 상수
    └── types/
        ├── index.ts
        ├── config.ts    # 설정 타입
        └── models.ts    # 데이터 모델 타입
```

### 1.3 보완 필요 사항

- [ ] **UI 컴포넌트 라이브러리 추가**: shadcn/ui 또는 MUI 도입 권장
- [ ] **i18n 설정**: i18next 또는 react-i18next 도입
- [ ] **로깅 시스템**: winston 또는 pino 도입
- [ ] **단일 인스턴스 락**: electron-locker 또는 custom 구현

---

## 🔧 Task 2: 핵심 Main Process 서비스 완성

### 2.1 ConfigService ([`src/main/services/configService.ts`](src/main/services/configService.ts))

**현재 상태**: 기본 로드/저장 기능 구현됨
**보완 필요**:
- [ ] 창 크기/위치 저장 기능 추가
- [ ] splitter 상태 저장 기능
- [ ] 마지막 탭 인덱스 저장

### 2.2 LibraryDB ([`src/main/services/libraryDb.ts`](src/main/services/libraryDb.ts))

**현재 상태**: 테이블 생성, 기본 CRUD 구현됨
**보완 필요**:
- [ ] bulk upsert 최적화
- [ ] 중복 검사 캐시 테이블 CRUD
- [ ] 대상 폴더 인덱싱 테이블 CRUD
- [ ] 검색 쿼리 최적화

### 2.3 TaskManager ([`src/main/services/taskManager.ts`](src/main/services/taskManager.ts))

**기존 Python 대응**:
- [`tasks/load_task.py`](old_project/ComicZIP_Optimizer/tasks/load_task.py) → 파일 로드 태스크
- [`tasks/organize_task.py`](old_project/ComicZIP_Optimizer/tasks/organize_task.py) → 정리 태스크
- [`tasks/rename_task.py`](old_project/ComicZIP_Optimizer/tasks/rename_task.py) → 이름 변경 태스크
- [`tasks/save_task.py`](old_project/ComicZIP_Optimizer/tasks/save_task.py) → 저장 태스크
- [`tasks/update_task.py`](old_project/ComicZIP_Optimizer/tasks/update_task.py) → 업데이트 체크 태스크
- [`tasks/api_workers.py`](old_project/ComicZIP_Optimizer/tasks/api_workers.py) → API 작업

**구현 필요**:
- [ ] 태스크 큐 시스템 (병렬 처리, 우선순위)
- [ ] 진행률 보고 메커니즘 (IPC를 통한 프론트엔드 업데이트)
- [ ] 태스크 취소/일시 정지 기능
- [ ] 에러 처리 및 재시도 로직

### 2.4 ArchiveUtils ([`src/main/utils/archiveUtils.ts`](src/main/utils/archiveUtils.ts))

**기존 Python 대응**: [`core/archive_utils.py`](old_project/ComicZIP_Optimizer/core/archive_utils.py)

**구현 필요**:
- [ ] ZIP/CBZ/CBR/7Z 압축/해제
- [ ] 내부 파일 목록 조회
- [ ] 커버 이미지 추출
- [ ] 메타데이터 파싱 (comicInfo.xml 등)

### 2.5 ImageUtils ([`src/main/utils/imageUtils.ts`](src/main/utils/imageUtils.ts))

**기존 Python 대응**: [`core/archive_utils.py`](old_project/ComicZIP_Optimizer/core/archive_utils.py)의 이미지 처리 부분

**구현 필요**:
- [ ] WebP 변환 (sharp 사용)
- [ ] JPEG 최적화 (quality 조정)
- [ ] PNG 양자화 (pngquant 호출)
- [ ] 이미지 해상도 조회
- [ ] 썸네일 생성

### 2.6 Parser ([`src/main/utils/parser.ts`](src/main/utils/parser.ts) - 신규)

**기존 Python 대응**: [`core/parser.py`](old_project/ComicZIP_Optimizer/core/parser.py)

**구현 필요**:
- [ ] 파일명에서 제목 추출
- [ ] 시리즈 그룹화 로직
- [ ] 유사도 계산
- [ ] 스팸 폴더명 필터링

### 2.7 API Fetcher ([`src/main/services/apiFetcher.ts`](src/main/services/apiFetcher.ts) - 신규)

**기존 Python 대응**: [`core/api_fetcher.py`](old_project/ComicZIP_Optimizer/core/api_fetcher.py)

**구현 필요**:
- [ ] Comic Vine API 연동
- [ ] Ridi Books API 연동
- [ ] AI 번역 (Gemini/OpenAI)
- [ ] 캐시 시스템 (SQLite)

---

## 🔌 Task 3: IPC 통신 체계 완성

### 3.1 IPC 채널 정의 ([`src/shared/constants/ipc.ts`](src/shared/constants/ipc.ts))

**현재 정의된 채널**:
- DB 관련: `db:getFileInfo`, `db:upsertFileInfo`
- Config 관련: `config:get`, `config:save`
- Task 관련: `task:start`, `task:pause`, `task:cancel`, `task:progress`
- API 관련: `api:search`
- 파일 시스템: `dialog:openDirectory`, `dialog:openFile`, `shell:openPath`

**추가 필요 채널**:
```typescript
export const IPC_CHANNELS = {
  // 기존 채널 유지 ...
  
  // 압축 관련
  ARCHIVE_LIST_FILES: 'archive:listFiles',
  ARCHIVE_EXTRACT_COVER: 'archive:extractCover',
  ARCHIVE_CREATE: 'archive:create',
  ARCHIVE_EXTRACT: 'archive:extract',
  
  // 이미지 관련
  IMAGE_CONVERT_WEBP: 'image:convertWebp',
  IMAGE_OPTIMIZE: 'image:optimize',
  IMAGE_GET_RESOLUTION: 'image:getResolution',
  
  // 폴더 감시
  FOLDER_WATCH_START: 'folder:watchStart',
  FOLDER_WATCH_STOP: 'folder:watchStop',
  FOLDER_WATCH_EVENT: 'folder:watchEvent',
  
  // 서버 관련
  SERVER_START: 'server:start',
  SERVER_STOP: 'server:stop',
  SERVER_STATUS: 'server:status',
  
  // 사운드
  SOUND_PLAY: 'sound:play',
  
  // 업데이트
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  
  // 중복 검사
  DUP_CHECK: 'dup:check',
  DUP_INDEX_FOLDER: 'dup:indexFolder',
};
```

### 3.2 Preload API 확장 ([`src/preload/index.ts`](src/preload/index.ts))

**현재 노출된 API**:
- `getConfig()`, `saveConfig()`, `getFileInfo()`, `getAllFilesInPath()`

**추가 필요 API**:
- [ ] 모든 IPC 채널에 대한 프론트엔드 API 노출
- [ ] 타입 안전을 위한 TypeScript 타입 정의

---

## 🎨 Task 4: Renderer UI/UX 구현

### 4.1 전체 레이아웃

**기존 Python 레이아웃 대응**: [`ui/main_window.py`](old_project/ComicZIP_Optimizer/ui/main_window.py)

```
┌─────────────────────────────────────────────────┐
│  Title Bar (앱 이름, 버전, 업데이트 버튼)        │
├─────────────────────────────────────────────────┤
│  Tab Bar (Organizer | Renamer | Metadata |      │
│           Folder | Sharing | Settings)          │
├─────────────────────────────────────────────────┤
│                                                 │
│              Tab Content Area                    │
│                                                 │
├─────────────────────────────────────────────────┤
│  Progress Bar | Status Label | Log Button       │
└─────────────────────────────────────────────────┘
```

### 4.2 Tab 구현 계획

#### Tab 1: Organizer ([`ui/tabs/tab1_organizer.py`](old_project/ComicZIP_Optimizer/ui/tabs/tab1_organizer.py))
- [ ] 트리 뷰 (시리즈 그룹화)
- [ ] 파일 목록 표시
- [ ] 드래그&드롭 지원
- [ ] 컨텍스트 메뉴
- [ ] 검색/필터 기능

#### Tab 2: Renamer ([`ui/tabs/tab2_renamer.py`](old_project/ComicZIP_Optimizer/ui/tabs/tab2_renamer.py))
- [ ] 테이블 뷰 (파일 목록)
- [ ] 이름 변경 패턴 입력
- [ ] 미리보기 기능
- [ ] 일괄 적용
- [ ] 이미지 최적화 옵션

#### Tab 3: Metadata ([`ui/tabs/tab3_metadata.py`](old_project/ComicZIP_Optimizer/ui/tabs/tab3_metadata.py))
- [ ] 메타데이터 폼 (제목, 시리즈, 작가 등)
- [ ] 커버 이미지 표시
- [ ] API 검색 및 자동 채우기
- [ ] 태그 입력/관리
- [ ] comicInfo.xml 저장

#### Tab 4: Folder ([`ui/tabs/tab_folder.py`](old_project/ComicZIP_Optimizer/ui/tabs/tab_folder.py))
- [ ] 폴더 브라우저
- [ ] 파일 미리보기
- [ ] 폴더 감시 상태 표시

#### Tab 5: Sharing ([`ui/tabs/tab_sharing.py`](old_project/ComicZIP_Optimizer/ui/tabs/tab_sharing.py))
- [ ] 서버 설정 (포트, 인증 등)
- [ ] 시작/정지 버튼
- [ ] 상태 표시
- [ ] QR 코드 (모바일 연동용)

#### Tab 6: Settings (신규)
- [ ] 일반 설정 (언어, 테마 등)
- [ ] 처리 설정 (스레드 수, 품질 등)
- [ ] API 키 설정
- [ ] 사운드 설정

### 4.3 상태 관리 (Zustand)

**스토어 설계**:
```typescript
// useAppStore.ts - 앱 전역 상태
interface AppState {
  config: AppConfig;
  currentTab: number;
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
}

// useLibraryStore.ts - 라이브러리 상태
interface LibraryState {
  files: FileMetadata[];
  selectedFiles: string[];
  searchQuery: string;
  filterOptions: FilterOptions;
}

// useTaskStore.ts - 태스크 상태
interface TaskState {
  activeTasks: Task[];
  taskQueue: Task[];
}

// useServerStore.ts - 서버 상태
interface ServerState {
  isRunning: boolean;
  port: number;
  protocol: string;
}
```

### 4.4 UI 컴포넌트 라이브러리

**추천**: shadcn/ui (TailwindCSS 기반, 커스터마이징 용이)

**도입 계획**:
- [ ] shadcn/ui 초기화
- [ ] 기본 컴포넌트 도입 (Button, Input, Table, Tree, Dialog 등)
- [ ] 커스텀 컴포넌트 개발 (Toast, Progress, Status Bar 등)

---

## 🌐 Task 5: 서버 기능 구현

### 5.1 Server Manager ([`src/main/services/serverManager.ts`](src/main/services/serverManager.ts) - 신규)

**기존 Python 대응**: [`servers/manager.py`](old_project/ComicZIP_Optimizer/servers/manager.py)

**지원 프로토콜**:
- [ ] WebDAV 서버 ([`servers/webdav_server.py`](old_project/ComicZIP_Optimizer/servers/webdav_server.py))
- [ ] OPDS 서버 ([`servers/opds_server.py`](old_project/ComicZIP_Optimizer/servers/opds_server.py))
- [ ] YACReader 서버 ([`servers/yacreader_server.py`](old_project/ComicZIP_Optimizer/servers/yacreader_server.py))
- [ ] SMB 서버 ([`servers/smb_server.py`](old_project/ComicZIP_Optimizer/servers/smb_server.py))
- [ ] FTP 서버 ([`servers/ftp_server.py`](old_project/ComicZIP_Optimizer/servers/ftp_server.py))
- [ ] 일반 Web 서버 ([`servers/web_server.py`](old_project/ComicZIP_Optimizer/servers/web_server.py))

### 5.2 구현 전략

- Express 기반 통합 서버
- 프로토콜별 미들웨어/라우터 분리
- 포트 충돌 감지 및 자동 처리
- 인증 시스템 (Basic Auth)

---

## 🔊 Task 6: 부가 기능

### 6.1 사운드 시스템 ([`src/main/services/soundService.ts`](src/main/services/soundService.ts) - 신규)

**기존 Python 대응**: [`utils.py`](old_project/ComicZIP_Optimizer/utils.py)의 `play_complete_sound`

**구현 필요**:
- [ ] 사운드 파일 로드 (resources/sounds/)
- [ ] 완료 사운드 재생
- [ ] 설정에서 사운드 선택

### 6.2 토스트 알림

**구현 필요**:
- [ ] 성공/실패/경고 토스트 컴포넌트
- [ ] 자동 사라짐 (3-5초)
- [ ] 스택 관리 (동시 여러 토스트)

### 6.3 로그 시스템

**구현 필요**:
- [ ] 로그 다이얼로그 컴포넌트
- [ ] 실시간 로그 스트리밍
- [ ] 로그 레벨 필터링

### 6.4 업데이트 체크

**기존 Python 대응**: [`tasks/update_task.py`](old_project/ComicZIP_Optimizer/tasks/update_task.py)

**구현 필요**:
- [ ] GitHub Releases API 연동
- [ ] 새 버전 감지 및 알림
- [ ] 자동 다운로드 및 설치 (electron-updater 사용)

### 6.5 i18n (다국어 지원)

**기존 Python 대응**: [`core/i18n.py`](old_project/ComicZIP_Optimizer/core/i18n.py)

**구현 필요**:
- [ ] i18next 설정
- [ ] 한국어/영어 번역 파일
- [ ] 동적 언어 전환

---

## 📦 Task 7: 빌드 및 배포 설정

### 7.1 electron-builder 설정 ([`electron-builder.yml`](electron-builder.yml))

**현재 상태**: 기본 설정 완료
**보완 필요**:
- [ ] Windows 빌드 설정 (NSIS 인스톨러)
- [ ] macOS 빌드 설정 (DMG, notarization)
- [ ] 리소스 번들링 (사운드, 폰트, 아이콘)
- [ ] 자동 업데이트 설정

### 7.2 리소스 관리

**번들링 필요**:
- [ ] 사운드 파일 (`resources/sounds/`)
- [ ] 폰트 파일 (`resources/fonts/`)
- [ ] 아이콘 파일 (`build/icon.*`)
- [ ] 7z 바이너리 (자동 포함됨)

---

## 📅 구현 우선순위

### Phase 1: 핵심 기능 (우선순위 높음)
1. TaskManager 구현
2. ArchiveUtils 완성
3. IPC 채널 완성
4. Tab 1 (Organizer) UI
5. Tab 2 (Renamer) UI

### Phase 2: 메타데이터 및 서버
6. API Fetcher 구현
7. Tab 3 (Metadata) UI
8. Server Manager 구현
9. Tab 5 (Sharing) UI

### Phase 3: 부가 기능 및 완성
10. Tab 4 (Folder) UI
11. Tab 6 (Settings) UI
12. 사운드 시스템
13. i18n
14. 업데이트 시스템

### Phase 4: 테스트 및 배포
15. 크로스 플랫폼 테스트
16. 성능 최적화
17. 빌드 및 배포

---

## ⚠️ 주의사항

1. **단일 인스턴스**: 기존 Python의 QSharedMemory 대응 구현 필요
2. **스레드 안전**: Node.js는 단일 스레드이므로 Worker Threads 활용
3. **메모리 관리**: 대용량 파일 처리 시 메모리 누수 방지
4. **경로 처리**: Windows/macOS 경로 구분자 차이 고려
5. **권한**: 파일 시스템 접근 권한 처리

---

## 📚 참조 파일

### 기존 Python 프로젝트
- 메인: [`old_project/ComicZIP_Optimizer/main.py`](old_project/ComicZIP_Optimizer/main.py)
- 설정: [`old_project/ComicZIP_Optimizer/config.json`](old_project/ComicZIP_Optimizer/config.json)
- DB: [`old_project/ComicZIP_Optimizer/core/library_db.py`](old_project/ComicZIP_Optimizer/core/library_db.py)
- UI: [`old_project/ComicZIP_Optimizer/ui/main_window.py`](old_project/ComicZIP_Optimizer/ui/main_window.py)
- Tabs: [`old_project/ComicZIP_Optimizer/ui/tabs/`](old_project/ComicZIP_Optimizer/ui/tabs/)
- Tasks: [`old_project/ComicZIP_Optimizer/tasks/`](old_project/ComicZIP_Optimizer/tasks/)
- Servers: [`old_project/ComicZIP_Optimizer/servers/`](old_project/ComicZIP_Optimizer/servers/)
- Core: [`old_project/ComicZIP_Optimizer/core/`](old_project/ComicZIP_Optimizer/core/)

### 현재 Electron 프로젝트
- Main: [`src/main/`](src/main/)
- Renderer: [`src/renderer/`](src/renderer/)
- Shared: [`src/shared/`](src/shared/)
- Preload: [`src/preload/`](src/preload/)
