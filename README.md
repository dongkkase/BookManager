# BookManager
> **This program supports `Korean`, `English`, `Japanese`.**
> **The program description on the wiki page is only available in `Korean`. Please use Chrome's translation feature.**

[![프로젝트 페이지](https://img.shields.io/badge/Project-Website-1f7dbc?style=flat-square&logo=githubpages&logoColor=white)](https://dongkkase.github.io/BookManager/)
[![Discord 참여](https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/ND6gpPZHD)
[![전체 릴리즈 다운로드 수](https://img.shields.io/github/downloads/dongkkase/BookManager/total?style=flat-square&logo=github&label=Downloads)](https://github.com/dongkkase/BookManager/releases)

<kbd>![image](https://raw.githubusercontent.com/dongkkase/BookManager/main/demo/demo1.gif)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/BookManager/main/demo/demo2.gif)</kbd>

BookManager는 CBZ, ZIP, EPUB, PDF 같은 만화책·전자책과 MP3, M4B 등의 오디오북 파일을 로컬 데스크톱에서 정리하고 관리하기 위한 Windows/macOS 지원 앱입니다.
Kavita, Komga, YACReader, Panels 같은 만화 관리 서버와 Calibre, KOReader, Apple Books, Google Play Books 같은 전자책 환경에서 쓰기 좋도록 압축 파일 구조 정리, 내부 이미지 파일명 변경, 책과 오디오북 메타데이터 편집, 라이브러리 검색을 한 화면에서 처리하는 것을 목표로 합니다.
로컬 드라이브나 NAS에 보관된 대량의 파일을 스캔하고, OPDS, Web, WebDAV 공유 서버로 책 파일을 공유할 수 있습니다.


## 지원 플랫폼

- Windows
- macOS

## 주요 기능

- 라이브러리 폴더 등록, 스캔, 검색, 썸네일 및 메타데이터 캐시 관리
- ZIP, CBZ, CBR, RAR, 7Z 기반 만화책 압축 파일의 구조 정리, 평탄화
- 압축 파일 내부 이미지 파일명 일괄 변경, 패턴 미리보기, 누락 페이지 확인
- CBZ, EPUB, PDF, 오디오북 파일의 라이브러리 및 메타데이터 관리
- ComicInfo.xml 기반 메타데이터 조회, 편집, 저장
- 내장 뷰어에서 만화책, EPUB, PDF, TXT, 오디오북 지원
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

## 오디오북 관리

BookManager는 오디오북의 임베디드 태그와 표지, 재생 시간과 코덱 정보를 분석해 라이브러리에 표시합니다. 제목, 시리즈, 앨범, 아티스트, 출판사, 설명, 장르·태그, 연도, 트랙·디스크 번호를 편집할 수 있습니다.

AAC, AIF/AIFF, FLAC, M4A/M4B, MP3, OGA/OGG/OPUS, WAV/WAVE는 편집 결과를 실제 오디오 파일의 내부 태그에 저장합니다. 사용자 지정 표지도 파일 내부의 임베디드 앞표지로 교체됩니다. 3GP, AMR, CAF, WEBM은 분석은 가능하지만 BookManager에서 파일 내부 메타데이터를 저장할 수 없는 읽기 전용 형식입니다.

저장 후에는 실제 파일을 다시 읽어 라이브러리 DB와 썸네일을 갱신합니다. 실제 파일이 변경되므로 원본을 보관해야 한다면 환경 설정의 원본 백업을 켜세요. 오디오북 뷰어에서는 재생 속도, 북마크, 취침 타이머와 미니 플레이어를 사용할 수 있습니다.

## 메타데이터 관리

BookManager는 국내외 메타데이터 API와 연동하여 책 정보를 검색하고 편집할 수 있습니다.
리디북스, 알라딘, Google Books, AniList, Comic Vine, Amazon 등 다양한 소스에서 제목, 작가, 시리즈, 출판사, 출판일, ISBN, 표지, 설명, 평점 정보를 가져와 관리할 수 있습니다.

만화책 메타데이터는 글로벌 만화 관리 생태계에서 널리 사용하는 ComicInfo.xml 형식으로 저장할 수 있습니다.
이를 통해 파일 자체와 함께 메타데이터를 보관하고, 다른 서버나 뷰어에서도 가능한 한 동일한 책 정보를 유지할 수 있습니다.

오디오북은 쓰기 지원 형식의 실제 파일 태그와 임베디드 앞표지를 저장합니다. 재생 시간, 비트레이트, 샘플레이트, 코덱, 컨테이너, 채널과 MIME 형식은 파일에서 분석해 표시만 하며 편집하지 않습니다.

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
