import { useState, useCallback, useEffect, useRef } from 'react';
import { setLanguage, translate, SUPPORTED_LANGUAGES } from '../utils/i18n.js';

export function useI18n() {
  const [language, setLanguageState] = useState('ko');
  const mountedRef = useRef(true);

  useEffect(() => {
    const initI18n = async () => {
      try {
        const config = await window.electronAPI?.getConfig?.();
        const lang = config?.language || config?.lang || 'ko';
        const nextLang = setLanguage(lang);
        if (mountedRef.current) setLanguageState(nextLang);
      } catch (error) {
        console.error('언어 초기화 실패:', error);
      }
    };
    initI18n();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const changeLanguage = useCallback(async (lang) => {
    const nextLang = setLanguage(lang);
    if (mountedRef.current) setLanguageState(nextLang);
    try {
      await window.electronAPI?.saveConfig?.({ lang: nextLang, language: nextLang });
    } catch (error) {
      console.error('언어 저장 실패:', error);
    }
    return nextLang;
  }, []);

  const t = useCallback((key, values) => {
    return translate(key, language, values);
  }, [language]);

  return {
    language,
    supportedLanguages: SUPPORTED_LANGUAGES,
    t,
    changeLanguage,
  };
}
