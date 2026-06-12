// i18n 관리
let currentLanguage = 'ko';

// 번역 데이터
const translations = {
  ko: {
    app: {
      name: 'BookManager',
      version: '버전',
    },
    tabs: {
      organizer: '정리',
      renamer: '이름변경',
      metadata: '메타데이터',
      folder: '폴더',
      sharing: '공유 서버',
    },
    common: {
      start: '시작',
      stop: '중지',
      cancel: '취소',
      save: '저장',
      load: '불러오기',
      close: '닫기',
      select: '선택',
      delete: '삭제',
      settings: '설정',
      help: '도움말',
      about: '정보',
      exit: '종료',
      confirm: '확인',
      yes: '예',
      no: '아니오',
      ok: '확인',
      warning: '경고',
      error: '오류',
      success: '성공',
      info: '정보',
    },
    folder: {
      toolbar: {
        group_by: '그룹화',
        sort_by: '정렬',
        view_detail: '상세',
        view_thumbnail: '썸네일',
        view_tile: '타일',
        include_subfolders: '하위 폴더 포함',
        dup_check: '중복 검사',
        refresh: '새로고침',
        search: '검색',
      },
      sidebar: {
        libraries: '라이브러리',
        favorites: '즐겨찾기',
        folders: '폴더',
        add_library: '라이브러리 추가',
        remove_library: '라이브러리 제거',
        add_favorite: '즐겨찾기에 추가',
        remove_favorite: '즐겨찾기에서 제거',
      },
      columns: {
        cover: '커버',
        name: '이름',
        size: '크기',
        resolution: '해상도',
        modified: '수정일',
        series: '시리즈',
        title: '제목',
        volume: '권',
        issue: '화',
        writer: '작가',
      },
      status: {
        scanning: '폴더 스캔 중...',
        scanning_progress: '스캔 진행률: {progress}%',
        files_found: '{count}개 파일 발견',
        no_files: '파일이 없습니다',
        empty_folder: '폴더가 비어 있습니다',
      },
      detail: {
        metadata: '메타데이터',
        no_selection: '파일을 선택하세요',
      },
    },
  },
  en: {
    app: {
      name: 'BookManager',
      version: 'Version',
    },
    tabs: {
      organizer: 'Organizer',
      renamer: 'Renamer',
      metadata: 'Metadata',
      folder: 'Folder',
      sharing: 'Sharing',
    },
    common: {
      start: 'Start',
      stop: 'Stop',
      cancel: 'Cancel',
      save: 'Save',
      load: 'Load',
      close: 'Close',
      select: 'Select',
      delete: 'Delete',
      settings: 'Settings',
      help: 'Help',
      about: 'About',
      exit: 'Exit',
      confirm: 'Confirm',
      yes: 'Yes',
      no: 'No',
      ok: 'OK',
      warning: 'Warning',
      error: 'Error',
      success: 'Success',
      info: 'Info',
    },
    folder: {
      toolbar: {
        group_by: 'Group',
        sort_by: 'Sort',
        view_detail: 'Detail',
        view_thumbnail: 'Thumbnail',
        view_tile: 'Tile',
        include_subfolders: 'Include Subfolders',
        dup_check: 'Duplicate Check',
        refresh: 'Refresh',
        search: 'Search',
      },
      sidebar: {
        libraries: 'Libraries',
        favorites: 'Favorites',
        folders: 'Folders',
        add_library: 'Add Library',
        remove_library: 'Remove Library',
        add_favorite: 'Add to Favorites',
        remove_favorite: 'Remove from Favorites',
      },
      columns: {
        cover: 'Cover',
        name: 'Name',
        size: 'Size',
        resolution: 'Resolution',
        modified: 'Modified',
        series: 'Series',
        title: 'Title',
        volume: 'Volume',
        issue: 'Issue',
        writer: 'Writer',
      },
      status: {
        scanning: 'Scanning folder...',
        scanning_progress: 'Scan progress: {progress}%',
        files_found: '{count} files found',
        no_files: 'No files',
        empty_folder: 'Folder is empty',
      },
      detail: {
        metadata: 'Metadata',
        no_selection: 'Select a file',
      },
    },
  },
};

export async function setupI18n(lang) {
  currentLanguage = lang || 'ko';
}

export function t(key) {
  const keys = key.split('.');
  let value = translations[currentLanguage];
  
  for (const k of keys) {
    if (value && value[k] !== undefined) {
      value = value[k];
    } else {
      // 한국어로 폴백
      value = translations.ko;
      for (const kk of keys) {
        if (value && value[kk] !== undefined) {
          value = value[kk];
        } else {
          return key;
        }
      }
      break;
    }
  }
  
  return typeof value === 'string' ? value : key;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function setLanguage(lang) {
  if (translations[lang]) {
    currentLanguage = lang;
  }
}
