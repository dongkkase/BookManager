# ComicZIP Optimizer - Electron 마이그레이션 프롬프트

----

## [역할 및 목표]
현재 Python(PyQt6)으로 개발된 `ComicZIP Optimizer` 애플리케이션을 **Electron**(Node.js + Web Frontend) 기반으로 마이그레이션해야 합니다.

**최종 목표:** 
1. 기존 애플리케이션의 모든 기능 100% 동일하게 구현.
2. UI 레이아웃, 버튼 위치, 메뉴 구조, 텍스트 문구, 아이콘을 절대 변경하지 않고 그대로 유지.
3. 이미지(`src/`), 사운드(`sounds/`), 폰트(`fonts/`) 리소스를 100% 재사용.
4. 윈도우(Windows) 및 맥(macOS) 크로스플랫폼 완벽 지원.
5. 사용자 입장에서 디자인을 제외한 기존 프로그램과 작동 방식이나 기능적 차이를 전혀 느낄 수 없도록 구성.

----

## [프로젝트 정보 및 구조]
* **기존 환경:** Python 3, PyQt6, 백그라운드 스레드(QThread), 외부 바이너리 서브프로세스 제어(7za, cwebp, pngquant 등), 다양한 로컬 서버(FTP, WebDAV, SMB 등) 포함.
* **타겟 환경:** Electron, Node.js, HTML/CSS/JS (Vite + React). 백엔드 로직은 Electron Main Process(Node.js)에서 처리.

### 기존 디렉토리 구조 참고 (일부)
```text
├── bin/ (외부 바이너리)
│   ├── mac_linux/ (맥용 바이너리 위치 예정)
│   └── win/ (7za.exe, cwebp.exe, pngquant.exe 등)
├── core/ (파서, API 페처, 아카이브 유틸, DB)
├── tasks/ (QThread 기반 비동기 워커 로직 - 압축, 리네임, 정리 등)
├── servers/ (API, FTP, WebDAV, SMB, OPDS 로컬 서버)
├── ui/ (PyQt6 UI 컴포넌트, 다이얼로그)
│   └── tabs/ (탭별 화면 - Organizer, Renamer, Metadata, Folder, Sharing)
├── fonts/ (Jua, NotoSansKR)
├── sounds/ (작업 완료 및 효과음 mp3, wav)
├── src/ (드래그앤드롭 안내 이미지, 로딩 GIF 등)
├── config.py (환경 설정 및 바이너리 경로 탐색)
├── main.py (진입점 및 메인 윈도우 생성)
└── utils.py (공통 유틸 - 사운드 재생 등)
```

----

## [단계별 마이그레이션 지침]

다음의 Step에 따라 순차적으로 코드를 분석하고 포팅을 진행해 주세요.

### Step 1: 프로젝트 셋업 및 기본 설정 (Electron Builder)
* `package.json`을 생성하고 Electron, Electron-builder 및 필요한 패키지 설정.
* 윈도우(`win`)와 맥(`mac`) 모두 빌드 가능하도록 `electron-builder` 설정 구성. 바이너리(`bin/`), 사운드(`sounds/`), 폰트(`fonts/`), 이미지(`src/`) 폴더가 빌드 결과물에 올바르게 포함(ASAR unpack 또는 extraResources)되도록 처리.
* `main.js` 및 `preload.js` 구조 스캐폴딩 생성.

### Step 2: UI 레이아웃 및 스타일 포팅 (PyQt6 -> HTML/CSS)
* **제약사항:** 기존 `ui/` 폴더와 `ui/tabs/` 폴더의 코드를 분석하여, `QVBoxLayout`, `QHBoxLayout`, `QTabWidget`을 CSS `Flexbox`와 `Grid`로 1:1 매칭하세요.
* `QProgressBar`, `QPushButton`, `QLabel`, `QFileDialog` 등의 UI 요소들의 위치와 동작을 HTML 요소로 완벽히 동일하게 구성하세요.
* 폰트(`fonts/Jua-Regular.ttf`, `fonts/NotoSansKR-Regular.ttf`)를 `@font-face`로 등록하고, 설정의 배율(scale)에 따라 동적으로 폰트 크기가 변하는 로직(`config.py` 참조)을 CSS Variable로 구현하세요.
* `qtawesome`으로 사용하던 아이콘은 FontAwesome 또는 동일한 SVG 아이콘으로 대체하여 시각적 동일함을 유지하세요.

### Step 3: 설정(Config) 및 다국어(i18n) 마이그레이션
* `config.py`의 로직(config.json 읽기/쓰기, 시스템 언어 감지, 시스템 CPU 코어 수 기반 스레드 계산)을 Node.js 코드로 번역하여 Main Process에 구현하세요.
* `core/i18n.py`의 다국어 딕셔너리를 JS 객체나 JSON으로 변환하여 UI에 텍스트를 바인딩하세요.

### Step 4: 메인 비즈니스 로직 및 백그라운드 워커 (tasks/)
* **가장 중요한 부분입니다.** 기존의 PyQt `QThread` 기반 워커들(`load_task.py`, `organize_task.py`, `rename_task.py`, `save_task.py`)은 무거운 파일 I/O 및 이미지 처리 작업을 담당합니다.
* Electron에서는 메인 UI 스레드가 블로킹되지 않도록, 해당 로직들을 Node.js `worker_threads`를 사용하거나, 비동기 `Promise`와 `child_process`로 Main Process에서 처리한 후 `IPC (Inter-Process Communication)`를 통해 Renderer Process(UI)에 진행률(progress)을 전달하도록 구성하세요.

### Step 5: 외부 바이너리 실행 로직 변환 (Cross-Platform)
* `config.py`의 `get_bin_path` 로직을 Node.js로 구현하세요.
* `process.platform`을 확인하여 윈도우(`win32`)일 경우 `bin/win/` 하위의 `.exe`를, 맥(`darwin`)일 경우 `bin/mac_linux/` 하위의 바이너리를 사용하도록 `child_process.spawn` 경로를 동적으로 할당하세요. (맥용 바이너리에 실행 권한 부여(chmod +x) 로직 필요).

### Step 6: 로컬 서버 포팅 (servers/)
* 기존 Python으로 작성된 로컬 서버(FTP, WebDAV, SMB, HTTP, OPDS)를 Node.js 기반 패키지로 대체하여 구성하세요.
  * 예: HTTP/OPDS -> `express`
  * FTP -> `ftp-srv`
  * WebDAV -> `webdav-server`
* 사용자 설정에 따라 메인 프로세스에서 서버를 켜고 끄는 관리자(manager) 로직을 포팅하세요.

### Step 7: 파일 다이얼로그 및 네이티브 기능
* `QFileDialog`는 Electron의 `dialog.showOpenDialog` 및 `dialog.showSaveDialog`로 1:1 대체하세요.
* 파일 드래그 앤 드롭 기능을 HTML5 Drag & Drop API를 사용하여 구현하고, 파일 경로 리스트를 IPC로 메인 프로세스에 전달하게 구현하세요.
* `utils.py`의 `play_complete_sound` 함수를 오디오 API(`new Audio('sounds/...').play()`)로 렌더러 측에서 실행되게 구현하세요.

----

## [실행 지침]
이 프롬프트를 확인하셨다면, "네, 이해했습니다. 어느 부분부터 코드 변환을 시작할까요? Step 1의 package.json 및 기본 구조 설정부터 진행해 드릴까요?" 라고 대답해 주세요. 그리고 사용자의 답변에 따라 코드를 단계별로 작성해 주시기 바랍니다. 한 번에 너무 많은 코드를 작성하지 말고, 각 모듈(파일) 단위로 꼼꼼히 변환을 진행하세요.
# ComicZIP Optimizer - Electron 마이그레이션 프롬프트

> **사용자 안내**: 아래의 내용을 로컬 LLM(예: Ollama, LM Studio, Claude Desktop 등)에 복사하여 붙여넣고 마이그레이션을 진행하세요. 제공되는 스크린샷 이미지들도 함께 첨부하여 컨텍스트를 제공해 주시면 더욱 좋습니다.

---

## [역할 및 목표]
당신은 데스크톱 애플리케이션 개발, 크로스플랫폼 마이그레이션, 그리고 레거시 코드 리팩토링 전문가입니다. 
현재 Python(PyQt6)으로 개발된 `ComicZIP Optimizer` 애플리케이션을 **Electron**(Node.js + Web Frontend, React 권장) 기반으로 마이그레이션해야 합니다.

**최종 목표:** 
1. 기존 애플리케이션의 모든 기능을 100% 동일하게 구현.
2. 함께 제공된 `ui_screenshop` 폴더의 스크린샷을 분석하여 UI 레이아웃, 버튼 위치, 메뉴 구조, 텍스트 문구, 아이콘을 절대 변경하지 않고 그대로 유지.
3. 이미지(`src/`), 사운드(`sounds/`), 폰트(`fonts/`) 리소스를 100% 재사용.
4. 윈도우(Windows) 및 맥(macOS) 크로스플랫폼 완벽 지원.

---

## [프로젝트 폴더 구조]
마이그레이션 작업은 다음과 같은 디렉토리 구조 하에 진행됩니다. 새로운 Electron 코드는 `BookManager` 루트(또는 별도의 프론트엔드 폴더)에 작성합니다.

```text
BookManager/ (새로운 Electron 프로젝트 루트)
├── package.json, main.js, src/ (앞으로 생성할 파일들)
└── old_project/ 
    ├── ComicZip_Optimizer/ (기존 Python 소스 코드 원본 - 분석용)
    │   ├── bin/, core/, tasks/, servers/, ui/, main.py 등
    └── ui_screenshop/ (기존 프로그램의 레이아웃/UI/UX 참조용 스크린샷 이미지들)
```

---

## ⚠️ [로컬 LLM 최적화 및 작업 지침] ⚠️
이 환경은 로컬 LLM으로 구동되므로 **응답 속도와 컨텍스트 메모리 제한**을 반드시 고려해야 합니다.

1. **한 번에 하나씩 (Incremental Steps):** 
   절대 전체 코드를 한 번에 작성하려 하지 마세요. 한 번의 응답에는 **"하나의 컴포넌트"** 또는 **"하나의 작은 모듈"** 코드만 작성하세요. 
2. **모놀리식 코드 분할 (Refactoring):** 
   기존 `main_window.py`나 `tasks` 파일 등은 수천 라인에 달하는 거대한 파일입니다. 이를 그대로 1:1로 하나의 JS/TS 파일로 옮기지 마세요. 
   - **UI:** 탭별, 역할별로 작게 React 컴포넌트화 하세요 (예: `TabOrganizer.jsx`, `TabRenamer.jsx`, `ProgressBar.jsx`).
   - **Logic:** 메인 프로세스의 IPC 핸들러, 유틸리티, 백그라운드 워커 등으로 역할을 엄격히 분리하여 파일을 쪼개세요.
3. **간결한 응답:** 
   토큰 생성을 최소화하기 위해 불필요한 부연 설명, 인사말, 긴 주석을 생략하고 **핵심 설명과 코드 위주**로 출력하세요.
4. **시각적 컨텍스트 활용:**
   제공된 `ui_screenshop` 내부의 이미지를 바탕으로 UI 요소의 배치(Flexbox/Grid), 여백, 색상 등을 유추하여 CSS/컴포넌트를 구성하세요. 디자인은 기존과 완전히 똑같아야 합니다.

---

## [단계별 마이그레이션 지침]

다음의 Step에 따라 순차적으로 작업을 진행합니다. 각 Step 내에서도 작은 파일 단위로 나누어 응답하세요.

### Step 1: 프로젝트 셋업 및 구조 설계
* 사용자에게 `package.json`과 기본 폴더 구조(예: `src/main`, `src/renderer`, `src/components`) 설정을 제시하세요.
* 빌드 도구(Vite + React 추천) 및 Electron Builder 기본 설정을 작성합니다.

### Step 2: 공통 유틸리티 및 리소스 매핑
* `old_project/ComicZip_Optimizer/config.py`와 `utils.py`를 분석합니다.
* OS별 바이너리 경로 탐색 모듈, 설정(Config) 관리자, 사운드 재생 유틸리티를 Node.js 환경의 작은 모듈들로 쪼개어 작성합니다.

### Step 3: UI 셸 및 뼈대 구현 (스크린샷 참조)
* 스크린샷 이미지와 `ui/main_window.py`를 참조하여, 메인 레이아웃 뼈대(`App.jsx`, 상단 메뉴, 탭 뼈대)를 작성합니다.
* 내부 로직 없이 HTML/CSS(또는 Styled-components/Tailwind)만 먼저 작성하여 UI가 동일하게 나오는지 확인합니다.
* 사용자에게 "UI 뼈대 코드를 제공했습니다. 확인 후 다음 탭 상세 내용으로 넘어갈까요?" 라고 묻습니다.

### Step 4: 개별 탭 및 컴포넌트 마이그레이션
* `ui/tabs/` 에 있던 수많은 코드들을 각 탭별(예: 탭1 정리기, 탭2 변환기 등)로 독립된 React 컴포넌트로 만듭니다.
* 한 번의 응답에 하나의 탭 컴포넌트만 작성하세요.

### Step 5: 비즈니스 로직 및 백그라운드 워커 (IPC 통신)
* `tasks/` 폴더에 있던 거대한 QThread 로직들을 확인합니다.
* 이를 Node.js의 `worker_threads`나 독립된 로직 파일로 분리합니다. UI(Renderer) ↔ Main(로직 처리) 간의 IPC 통신 코드를 단계별로 작성합니다.

### Step 6: 로컬 서버 및 기타 기능 포팅
* `servers/`의 FTP, WebDAV 등의 로컬 서버를 Node.js 라이브러리(`ftp-srv`, `webdav-server`, `express`)로 변환하는 코드를 제공합니다.

---

## [시작 지침]
이 프롬프트를 확인하셨다면, 다음과 같이 대답하고 기다리세요.
> "네, 이해했습니다. 로컬 LLM의 성능을 고려하여 코드를 잘게 쪼개어 진행하겠습니다. 먼저 Step 1의 `package.json` 및 폴더 구조 스캐폴딩 코드를 작성해 드릴까요? 제공해주신 스크린샷과 기존 프로젝트 코드를 기반으로 시작하겠습니다."