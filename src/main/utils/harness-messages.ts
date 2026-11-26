import { createInstance } from 'i18next';
import en from '../../shared/i18n/locales/en.json';
import zh from '../../shared/i18n/locales/zh.json';

const messages = createInstance();
void messages.init({
  initAsync: false,
  fallbackLng: 'en',
  resources: {
    en: { translation: en.agentHarness },
    zh: { translation: zh.agentHarness },
  },
  interpolation: { escapeValue: false },
});

export function harnessMessage(
  key: keyof typeof en.agentHarness,
  params: Record<string, string | number> = {},
  locale = Intl.DateTimeFormat().resolvedOptions().locale
) {
  return messages.getFixedT(locale)(key, params);
}
