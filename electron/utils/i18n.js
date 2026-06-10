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
