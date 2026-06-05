# 기존 Python 프로젝트 분석 (ComicZIP_Optimizer)

## 프로젝트 개요
- Python 기반의 만화 파일 관리 및 최적화 도구
- GUI 기반으로 동작하며, 만화 ZIP 파일(ComicZIP)을 관리하고 최적화하는 기능 제공
- 주요 기능으로는 만화 파일 처리, 메타데이터 관리, 폴더 관리, sharing 기능 등을 포함

## 주요 기능 목록

### 1. Organizer Tab
- 만화 ZIP 파일을 관리하고 정리하는 기능
- 폴더별로 분류하여 자동으로 만화 파일을 정리
- ZIP 파일 내의 폴더 구조를 분석하여 자동으로 구성

### 2. Renamer Tab
- 만화 파일의 이름을 규칙에 따라 자동으로 변경
- 사용자 정의 이름 규칙을 지원하여 일관된 파일명 생성

### 3. Metadata Tab
- 만화 파일에 대한 메타데이터 정보 관리
- ComicInfo.xml 파일을 읽고, 편집 및 저장 기능 제공
- 다양한 메타데이터 필드를 지원 (제목, 시리즈, 문제 번호, 볼륨 등)

### 4. Folder Tab
- 만화 파일 폴더 구조 관리
- 폴더 생성, 삭제 및 정리 기능 제공

### 5. Sharing Tab
- 만화 파일 공유 기능
- 공유 설정 및 관리 기능 제공

### 6. Settings Tab (신규)
- 사용자 설정 및 환경 설정 기능
- 다양한 설정 옵션 제공 (기본 폴더, 언어, 테마 등)

## 기술 스택
- Python 3.x
- PyQt5 (GUI 라이브러리)
- 7zip-bin (ZIP 파일 처리)
- ComicInfo.xml 파서
- 기타 다양한 이미지 처리 라이브러리

## 프로젝트 구조
```
ComicZIP_Optimizer/
├── src/
│   ├── draganddrop1.png
│   ├── draganddrop2.png
│   └── draganddrop3.png
├── ui/
│   ├── tabs/
│   │   ├── tab1_organizer.py
│   │   ├── tab2_renamer.py
│   │   ├── tab3_metadata.py
│   │   ├── tab_folder.py
│   │   └── tab_sharing.py
│   └── main_window.py
├── resources/
│   └── config.json
└── requirements.txt
```

## 주요 기능 상세

### Organizer Tab
- ZIP 파일 내의 폴더 구조 분석
- 자동 폴더 정리 기능
- 만화 파일의 메타데이터 추출

### Renamer Tab
- 사용자 정의 이름 규칙 적용
- 파일명 자동 생성 기능
- 텍스트 변환 및 포맷팅 지원

### Metadata Tab
- ComicInfo.xml 파일 처리
- 메타데이터 편집 및 저장
- 다양한 필드 지원

### Folder Tab
- 폴더 생성 및 관리
- 폴더 정리 기능
- 복사/이동 기능

### Sharing Tab
- 공유 설정 관리
- 네트워크 공유 기능
- 파일 전송 기능

### Settings Tab
- 사용자 환경 설정
- 언어 및 테마 변경
- 기본 폴더 설정

## 기존 프로젝트의 제약사항
- Python 기반으로 인한 성능 제한
- GUI 기반으로 인한 리소스 소비
- 단일 플랫폼 지원 (Windows 전용)