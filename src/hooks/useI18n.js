import { useState, useCallback, useEffect, useRef } from 'react';
import { setLanguage, translate, SUPPORTED_LANGUAGES } from '../utils/i18n.js';

export function useI18n(config = null) {
  const [language, setLanguageState] = useState('ko');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
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

  useEffect(() => {
    const lang = config?.language || config?.lang;
    if (!lang) return;
    const nextLang = setLanguage(lang);
    if (mountedRef.current) setLanguageState(current => current === nextLang ? current : nextLang);
  }, [config?.language, config?.lang]);

  const changeLanguage = useCallback(async (lang) => {
    const nextLang = setLanguage(lang);
    if (mountedRef.current) setLanguageState(nextLang);
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
