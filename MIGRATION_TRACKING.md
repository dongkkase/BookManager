# MIGRATION_TRACKING

## Phase 6: Folder Tab UI (진행중)
- [x] 폴더 트리 모델 연동: `electronAPI.getRoots()` 및 `readDir` 연동으로 실제 드라이브/폴더 구조 Lazy Loading 구현 (`FolderSidebar.jsx`)
- [x] 사이드바 레이아웃 및 폴더 확장/축소 기능 구성
- [x] 선택 항목 상세 패널(`DetailPanel.jsx`) 파이썬 원본(`DetailBackgroundWidget`) 스타일에 맞춘 UI 구현 (Blur, Gradient Overlay 추가)
- [x] 관련 CSS 작성 (`FolderTab.css`)
- [x] 파일 스캔 시 메타데이터 추출(`folderUtils.js` 활용하여 시리즈, 제목, 화수, 권수 추출) 적용
- [ ] 즐겨찾기, 라이브러리 목록 관리 (DB 연동 또는 설정 연동)
- [ ] 썸네일 추출 백그라운드 태스크 연동
- [ ] 중복 검사 로직(Bigram) 연동