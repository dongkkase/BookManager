import {
  getCurrentLanguage,
  getTranslations,
  setLanguage,
  translate,
} from '../../src/utils/i18n.js';

export async function setupI18n(lang) {
  setLanguage(lang || 'ko');
}

export function t(key, values) {
  return translate(key, getCurrentLanguage(), values);
}

export function getI18n(lang) {
  return getTranslations(lang || getCurrentLanguage());
}

export { getCurrentLanguage, setLanguage };
