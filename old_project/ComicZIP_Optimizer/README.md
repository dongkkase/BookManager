# ComicZIP Optimizer
> **This program supports `Korean`, `English`, `Japanese`.**
> **The program description on the wiki page is only available in `Korean`. Please use Chrome's translation feature.**

**ComicZIP Optimizer**는 만화 및 코믹스 압축 파일(ZIP, CBZ, CBR, 7Z)을 가장 효율적으로 관리하고 최적화할 수 있는 **올인원 라이브러리 도구**입니다. 

클릭 몇 번만으로 복잡한 압축 파일의 내부 구조를 정리하고, 이미지 파일명을 나만의 규칙대로 일괄 수정할 수 있습니다. 특히 리디북스, 알라딘, Google Books, AniList, Comic Vine 등 다양한 국내외 API와 연동하여 글로벌 표준인 `ComicInfo.xml` 메타데이터를 손쉽게 구축할 수 있습니다. 

이를 통해 **Kavita, YACReader, Komga, Panels** 등 다양한 만화 관리 서버 및 뷰어에서 가장 완벽하고 쾌적한 독서 환경을 경험해 보세요!


<div align="center">

[![Issues](https://img.shields.io/badge/Issues-질문,%20의견,%20버그%20제보-D21F3C?style=for-the-badge&logo=github)](https://github.com/dongkkase/ComicZIP_Optimizer/issues)
[![Wiki](https://img.shields.io/badge/Wiki-상세한%20설명-1F425F?style=for-the-badge&logo=read-the-docs)](https://github.com/dongkkase/ComicZIP_Optimizer/wiki)
[![Download](https://img.shields.io/badge/Download-최신버전%20다운로드-238636?style=for-the-badge&logo=github)](https://github.com/dongkkase/ComicZIP_Optimizer/releases)

</div>

<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo.gif)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo2.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo3.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo8.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo4.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo5.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo6.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo7.png)</kbd>
<kbd>![image](https://raw.githubusercontent.com/dongkkase/ComicZIP_Optimizer/main/demo/demo1.png)</kbd>

---

## ComicZip Optimizer가 제공하는 것
### 폴더 탭
- **상태 모니터링**: 폴더 탭을 통해 내 라이브러리의 압축 파일들의 메타데이터(`ComicInfo.xml`) 등록 여부와 화질 상태 등을 한눈에 파악하고 관리할 수 있습니다.
- **중복 검사**: 파일명, 일치율, 파일 용량 등을 대조하여 라이브러리 내 중복된 파일을 필터링 합니다.
- **일괄 이름 변경**:  애브리띵의 일괄 이름 변경처럼 파일명을 일괄 변경할 수 있습니다.

### 압축 파일 구조 정리
- **압축 파일 구조 정리**: 시리즈로 압축되어 있는 파일을 권/화로 분리하여 **Kavita, YACReader, Komga, Panels** 등 다양한 만화 관리 서버 및 뷰어에서 최적화된 구조로 변경합니다.

### 내부 파일명 변경
- **구조 평탄화**: 복잡한 다중 폴더 구조를 제거하여 이미지를 최상단으로 꺼내는 평탄화 작업을 수행합니다. 
- **용량 최적화**: 이미지에 포함된 불필요한 EXIF 데이터를 제거하고, 설정한 비율에 맞춰 용량을 압축하거나 WebP 포맷으로 일괄 변환하여 저장 공간을 효율적으로 확보합니다.
- **파일명 및 순서 변경**: 압축 파일 내 불규칙한 이미지 파일명을 지정한 도서 스타일 패턴(예: `Cover`, `Page_001` 등)으로 일괄 변경하고, 필요에 따라 이미지의 순서를 직접 재배치할 수 있습니다.

### 메타데이터 관리
* **다중 API 검색 지원:** 리디북스, 알라딘, Google Books, AniList, Comic Vine 등 국내외 주요 도서/코믹스 DB에서 정보를 검색하고 일괄 적용합니다.
* **AI 검색어 최적화:** Gemini 및 OpenAI API와 연동하여, 해외 DB 검색 시 한글 제목을 '영문명'으로 자동 치환하여 검색 성공률을 극대화합니다.
* **표준 메타데이터 삽입:** 검색된 정보를 바탕으로 글로벌 표준인 `ComicInfo.xml`을 자동 생성하고, 압축 파일 내부에 직접 등록합니다.

---

## 설치 및 실행 (Installation)
1. [Releases](https://github.com/dongkkase/ComicZIP_Optimizer/releases) 페이지로 이동합니다.
2. 최신 버전의 `ComicZIP_Optimizer.zip` 파일을 다운로드합니다.
3. 압축을 풀고 안에 있는 실행 파일(`.exe`)을 실행하세요. (별도 설치 불필요)

---
## 상세 사용 가이드 (Wiki)
각 기능별 상세한 사용법과 설정 방법은 공식 [Wiki](https://github.com/dongkkase/ComicZIP_Optimizer/wiki)를 참조해 주세요.

---
### 사용 기술
- **Python 3**
- **PyQt6** (UI 프레임워크)
- **QtAwesome** (벡터 아이콘)
- **Pillow** (파이썬 이미지 처리 라이브러리)
- **7-Zip** (`7za.exe` 고속 파일 압축/해제 엔진)
- **libjpeg-turbo** (`jpegtran.exe` JPEG 무손실/손실 최적화 엔진)
- **pngquant** (`pngquant.exe` PNG 색상 손실 압축 엔진)
- **WebP** (`cwebp.exe` WebP 이미지 변환 엔진)

---
## 라이선스 (License)

이 프로젝트는 [MIT License](https://github.com/dongkkase/ComicZIP_Optimizer/blob/main/LICENSE)를 따릅니다. 

본 프로그램은 원활한 파일 처리 및 이미지 최적화를 위해 아래의 외부 도구(바이너리)를 내부적으로 포함하여 사용하고 있으며, 각 도구는 해당 프로젝트의 라이선스 규정을 따릅니다.

- **7-Zip (`7za.exe`)**: GNU LGPL 라이선스를 따릅니다. ([7-zip.org](https://www.7-zip.org/))
- **libjpeg-turbo (`jpegtran.exe`)**: IJG License, Modified BSD, zlib License를 따릅니다. ([libjpeg-turbo.org](https://libjpeg-turbo.org/))
- **pngquant (`pngquant.exe`)**: GPLv3 라이선스를 따릅니다. ([pngquant.org](https://pngquant.org/))
- **WebP (`cwebp.exe`)**: Google의 WebP BSD 라이선스를 따릅니다. ([developers.google.com/speed/webp](https://developers.google.com/speed/webp/))

