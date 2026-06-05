[개요]
- 현 프로젝트 BookManager 입니다.
- 기존 파이썬으로 개발했던 만화책 압축 파일 관리 및 최적화 툴(/old_project/ComicZip Optimizer)을 파이썬을 완전히 완전히 배제하고 100% Electron + React 기반으로 새롭게 재구축하려고 합니다.
- 현 프로젝트의 경로는 /Users/sungbinjung/work2/BookManager 입니다.

[Target Tech Stack]
- Framework: Electron
- Frontend (Renderer): React, Vite, TailwindCSS (UI 컴포넌트 프레임워크 추천 요망)
- Backend (Main Process): Node.js
- DB: better-sqlite3
- File/Image Processing: chokidar(폴더 감시), sharp(이미지 최적화/WebP 변환), node-7z 또는 외부 바이너리 호출(압축/해제)
- Server: express, webdav-server (모바일 앱 연동용 로컬 서버)

[Task 1: 초기 프로젝트 세팅]
- 위 기술 스택을 바탕으로 가장 모던하고 안정적인 Electron + React + Vite 보일러플레이트 세팅 명령어(NPM/Yarn)를 알려주세요. (보안과 IPC 통신을 위해 contextBridge와 preload.js를 반드시 사용하는 구조여야 합니다.)
- 확장성을 고려한 이상적인 디렉토리 구조(Main, Renderer, Shared 등)를 설계해 주세요.
- 핵심 기능을 대체할 Node.js 필수 NPM 패키지 목록(package.json에 들어갈 내용)을 정리해 주세요.
- 질문을 이해했다면, Task 1에 대한 답변부터 차근차근 시작해 주세요.

[주의 및 참고]
- 이 프로젝트는 빌드시 윈도우/맥 에서 실행되어야 합니다.
- 기존 프로젝트의 모든 기능과 편의사항은 빠짐없이 그대로 구현되어야 합니다.(마이그레이션시 누락되지 않게 해주세요)
- 기존 파이썬 프로로젝트의 기본적인 레이아웃은 동일하게 만들어야합니다.
- 기존 프로젝트는 context item에 추가했어요. 해당 폴더의 구조와 설정파일, 파이썬, 디비 구조만 참조해주세요
- ui/ux 신경써주세요.
- 이 프로젝트는 gemini code assist로 어느 정도 마이그레이션을 진행한 상태입니다. 이서서 마무리 작업을 하자



**Task 4.2: Tab 2 (Renamer) 실제 구현** - 테이블 뷰, 이름 변경 패턴, 미리보기, 일괄 적용, 이미지 최적화
**Task 4.3: Tab 3 (Metadata) 실제 구현** - 메타데이터 폼, 커버 이미지, API 검색/자동 채우기, 태그 관리
**Task 4.4: Tab 4 (Folder) 실제 구현** - 폴더 브라우저, 파일 미리보기, 폴더 감시 상태
**Task 4.5: Tab 5 (Sharing) 실제 구현** - 서버 설정 UI, 시작/정지, 상태 표시, QR 코드
**Task 4.6: Tab 6 (Settings) 실제 구현** - 일반 설정, 처리 설정, API 키, 사운드 설정
**Task 5: Server Manager 구현** - WebDAV, OPDS, YACReader, SMB, FTP, Web 서버 (src/main/services/serverManager.ts 신규)
**Task 6.1: Sound Service 구현** - 사운드 재생 (IPC 핸들러 아직 미구현)
**Task 6.2: Toast 알림 컴포넌트** - 성공/실패/경고 토스트
**Task 6.3: 로그 시스템** - 로그 다이얼로그, 실시간 스트리밍
**Task 6.4: 업데이트 체크** - electron-updater 연동 (IPC 핸들러 미구현)
**Task 6.5: i18n (다국어)** - i18next 설정, 한국어/영어 번역
**Task 1.3 보완: UI 컴포넌트 라이브러리** - shadcn/ui 또는 MUI 도입
**Task 1.3 보완: 로깅 시스템** - winston 또는 pino 도입
**Task 1.3 보완: 단일 인스턴스 락** - electron-locker 구현
**Task 7: 빌드 및 배포** - Windows/macOS 빌드, 리소스 번들링, 자동 업데이트