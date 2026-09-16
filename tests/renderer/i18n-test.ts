/**
 * Test i18n instance — real locale resources, no browser language detection.
 * Import once per test file that renders translated components.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslations from '../../src/shared/i18n/locales/en.json';
import zhTranslations from '../../src/shared/i18n/locales/zh.json';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: enTranslations },
      zh: { translation: zhTranslations },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    pluralSeparator: '_',
    contextSeparator: '_',
  });
}

export default i18n;
