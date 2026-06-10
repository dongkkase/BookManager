import { useState, useCallback, useEffect } from 'react';

/**
 * 국제화(i18n) 관리 훅
 * Electron IPC를 통해 언어 변경 및 번역 요청
 */
export function useI18n() {
  const [language, setLanguageState] = useState('ko');
  const [translations, setTranslations] = useState({});

  useEffect(() => {
    // 초기 언어 로드
    const initI18n = async () => {
      try {
        if (window.electronAPI && window.electronAPI.config) {
          const config = await window.electronAPI.config.get();
          const lang = config.language || 'ko';
          setLanguageState(lang);
        }
      } catch (error) {
        console.error('언어 초기화 실패:', error);
      }
    };
    initI18n();
  }, []);

  const changeLanguage = useCallback(async (lang) => {
    setLanguageState(lang);
    // 설정에 언어 저장
    if (window.electronAPI && window.electronAPI.config) {
      await window.electronAPI.config.update({ language: lang });
    }
  }, []);

  const t = useCallback((key) => {
    // 키를 '.'으로 분리하여 중첩 객체에서 값 탐색
    const keys = key.split('.');
    let value = translations;
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // 키를 찾지 못하면 키 자체 반환
      }
    }
    return value !== undefined ? value : key;
  }, [translations]);

  return {
    language,
    t,
    changeLanguage,
  };
}
