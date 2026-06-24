# BookManager

[한국어](#한국어) | [English](#english)

## 한국어

BookManager는 만화책과 전자책 파일을 로컬 데스크톱에서 관리하기 위한 Electron 기반 앱입니다.
로컬 드라이브나 NAS에 있는 압축 파일 라이브러리를 스캔하고, 파일 구조 정리, 내부 파일명 변경, 메타데이터 편집, 공유 서버 실행을 한 화면에서 처리하는 것을 목표로 합니다.

### 주요 기능

- 라이브러리 폴더 등록, 스캔, 검색, 썸네일 및 메타데이터 캐시 관리
- ZIP, CBZ, CBR, RAR, 7Z 기반 압축 파일의 구조 정리 및 평탄화
- 압축 파일 내부 이미지 파일명 일괄 변경, 패턴 미리보기, 누락 페이지 확인
- ComicInfo.xml 기반 메타데이터 조회, 편집, 저장
- OPDS, Web, WebDAV 공유 서버 실행
- Windows, macOS, Linux용 Electron 빌드 지원

### 기술 스택

- JavaScript
- Electron
- React
- Vite
- better-sqlite3
- Express
- WebDAV
- node-7z, 7zip-bin
- Font Awesome
- electron-builder

### 설치 및 실행

릴리즈 파일을 내려받은 뒤 운영체제에 맞게 압축을 해제합니다.

macOS에서 처음 실행할 때 보안 경고로 앱이 열리지 않으면 다음 명령으로 격리 속성을 제거한 뒤 실행합니다.

```bash
xattr -cr /Users/이름/Downloads/BookManager.app
open /Users/이름/Downloads/BookManager.app
```

Windows에서는 압축을 해제한 뒤 `BookManager.exe`를 실행합니다.

개발 환경에서 실행하려면 다음 명령을 사용합니다.

```bash
npm install
npm run electron:dev
```

빌드는 운영체제별 스크립트를 사용합니다.

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

### 라이선스

MIT

## English

BookManager is an Electron-based desktop app for managing comic and ebook files.
It is designed to scan archive libraries on local drives or NAS storage and provide archive organization, internal filename renaming, metadata editing, and sharing server features in one app.

### Features

- Register, scan, search, and cache library folders with thumbnails and metadata
- Organize and flatten ZIP, CBZ, CBR, RAR, and 7Z archive structures
- Batch rename image files inside archives with pattern previews and missing page checks
- Read, edit, and save ComicInfo.xml metadata
- Run OPDS, Web, and WebDAV sharing servers
- Build Electron packages for Windows, macOS, and Linux

### Tech Stack

- JavaScript
- Electron
- React
- Vite
- better-sqlite3
- Express
- WebDAV
- node-7z, 7zip-bin
- Font Awesome
- electron-builder

### Installation and Run

Download a release file and extract the archive for your operating system.

If macOS blocks the app on first launch, remove the quarantine attribute and open the app.

```bash
xattr -cr /Users/your-name/Downloads/BookManager.app
open /Users/your-name/Downloads/BookManager.app
```

On Windows, extract the archive and run `BookManager.exe`.

To run the app in a development environment:

```bash
npm install
npm run electron:dev
```

Use the platform-specific build scripts to create release artifacts.

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

### License

MIT
