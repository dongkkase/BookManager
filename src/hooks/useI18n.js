import { useState, useCallback, useEffect } from 'react';
import { setLanguage, translate, SUPPORTED_LANGUAGES } from '../utils/i18n.js';

export function useI18n() {
  const [language, setLanguageState] = useState('ko');

  useEffect(() => {
    const initI18n = async () => {
      try {
        const config = await window.electronAPI?.getConfig?.();
        const lang = config?.language || config?.lang || 'ko';
        const nextLang = setLanguage(lang);
        setLanguageState(nextLang);
      } catch (error) {
        console.error('언어 초기화 실패:', error);
      }
    };
    initI18n();
  }, []);

  const changeLanguage = useCallback(async (lang) => {
    const nextLang = setLanguage(lang);
    setLanguageState(nextLang);
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
