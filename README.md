# BookManager
> **This program supports `Korean`, `English`, `Japanese`.**
> **The program description on the wiki page is only available in `Korean`. Please use Chrome's translation feature.**

<kbd>![image](https://raw.githubusercontent.com/dongkkase/BookManager/main/demo/demo1.gif)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/BookManager/main/demo/demo2.gif)</kbd>

BookManager는 CBZ, ZIP, EPUB, PDF 같은 만화책과 전자책 파일을 로컬 데스크톱에서 정리하고 관리하기 위한 Windows/macOS 지원 앱입니다.
Kavita, Komga, YACReader, Panels 같은 만화 관리 서버와 Calibre, KOReader, Apple Books, Google Play Books 같은 전자책 환경에서 쓰기 좋도록 압축 파일 구조 정리, 내부 이미지 파일명 변경, ComicInfo.xml 메타데이터 편집, 라이브러리 검색을 한 화면에서 처리하는 것을 목표로 합니다.
로컬 드라이브나 NAS에 보관된 대량의 파일을 스캔하고, OPDS, Web, WebDAV 공유 서버로 책 파일을 공유할 수 있습니다.

- 프로젝트 페이지: https://dongkkase.github.io/BookManager/

<div align="center">

[![Issues](https://img.shields.io/badge/Issues-질문,%20의견,%20버그%20제보-D21F3C?style=for-the-badge&logo=github)](https://github.com/dongkkase/BookManager/issues)
[![Wiki](https://img.shields.io/badge/Wiki-상세한%20설명-1F425F?style=for-the-badge&logo=read-the-docs)](https://github.com/dongkkase/BookManager/wiki)
[![Download](https://img.shields.io/badge/Download-최신버전%20다운로드-238636?style=for-the-badge&logo=github)](https://github.com/dongkkase/BookManager/releases)

</div>

## 지원 플랫폼

- Windows
- macOS

## 주요 기능

- 라이브러리 폴더 등록, 스캔, 검색, 썸네일 및 메타데이터 캐시 관리
- ZIP, CBZ, CBR, RAR, 7Z 기반 만화책 압축 파일의 구조 정리, 평탄화
- 압축 파일 내부 이미지 파일명 일괄 변경, 패턴 미리보기, 누락 페이지 확인
- EPUB, PDF 파일의 라이브러리 관리 및 메타데이터 관리
- ComicInfo.xml 기반 메타데이터 조회, 편집, 저장
- 내장 뷰어에서 만화책, EPUB, PDF, TXT 지원
- OPDS, Web, WebDAV 공유 서버 실행

## 만화책 파일 관리

BookManager는 만화책 압축 파일을 여러 만화 관리 서버와 뷰어에 맞춰 관리하기 좋은 형태로 정리하는 데 초점을 둡니다.
폴더 구조를 평탄화하고, 내부 이미지 파일명을 일정한 패턴으로 맞추며, CBZ/ZIP 같은 일반적인 만화책 파일 형식으로 관리할 수 있습니다.

정리된 만화책 파일은 다음과 같은 서버와 뷰어에서 사용하기 좋은 형태로 관리할 수 있습니다.

- Kavita
- YACReader
- Komga
- Panels
- Calibre
- KOReader

## EPUB/PDF 관리

EPUB과 PDF도 만화책 파일처럼 라이브러리 단위로 관리할 수 있습니다.
표지, 제목, 작가, 출판사, 출판일, ISBN, 언어, 평점, 설명 같은 메타데이터를 정리해 여러 전자책 플랫폼과 뷰어에서 일관된 정보로 사용할 수 있도록 돕습니다.

정리된 EPUB/PDF 파일은 다음과 같은 전자책 서비스와 뷰어에서 활용하기 좋습니다.

- Calibre
- Calibre-Web
- KOReader
- Google Play Books
- Apple Books
- Kavita
- Komga

## 메타데이터 관리

BookManager는 국내외 메타데이터 API와 연동하여 책 정보를 검색하고 편집할 수 있습니다.
리디북스, 알라딘, Google Books, AniList, Comic Vine, Amazon 등 다양한 소스에서 제목, 작가, 시리즈, 출판사, 출판일, ISBN, 표지, 설명, 평점 정보를 가져와 관리할 수 있습니다.

만화책 메타데이터는 글로벌 만화 관리 생태계에서 널리 사용하는 ComicInfo.xml 형식으로 저장할 수 있습니다.
이를 통해 파일 자체와 함께 메타데이터를 보관하고, 다른 서버나 뷰어에서도 가능한 한 동일한 책 정보를 유지할 수 있습니다.

## 기술 스택

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

## 설치 및 실행

릴리즈 파일을 내려받은 뒤 운영체제에 맞게 압축을 해제합니다.

macOS에서 처음 실행할 때 보안 경고로 앱이 열리지 않으면 다음 명령으로 격리 속성을 제거한 뒤 실행합니다.

```bash
xattr -cr /Users/이름/Downloads/BookManager.app
open /Users/이름/Downloads/BookManager.app
```

Windows에서는 압축을 해제한 뒤 `BookManager.exe`를 실행합니다.

## 라이선스

MIT
