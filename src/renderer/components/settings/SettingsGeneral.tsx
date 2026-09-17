import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';

export function SettingsGeneral() {
  const { i18n, t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const currentLang = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [appVer, setAppVer] = useState('');
  useEffect(() => {
    try {
      const v = window.electronAPI?.getVersion?.();
      if (v instanceof Promise) v.then(setAppVer);
      else if (v) setAppVer(v);
    } catch {
      /* ignore */
    }
  }, []);

  const languages = [
    { code: 'en', nativeName: 'English' },
    { code: 'zh', nativeName: '中文' },
  ];

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight') },
    { value: 'dark' as const, label: t('general.themeDark') },
    { value: 'system' as const, label: t('general.themeSystem', 'System') },
  ];

  return (
    <div className="space-y-3">
      {/* Theme */}
      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <h4 className="text-[13px] font-medium text-text-primary">{t('general.appearance')}</h4>
        <div className="flex gap-2">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSettings({ theme: opt.value })}
              className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all ${
                settings.theme === opt.value
                  ? 'border-accent/40 bg-accent-muted text-text-primary shadow-soft'
                  : 'border-border-muted bg-surface hover:border-accent/40 text-text-secondary shadow-soft'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <h4 className="text-[13px] font-medium text-text-primary">{t('general.language')}</h4>
        <div className="flex gap-2">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => i18n.changeLanguage(lang.code)}
              className={`flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all ${
                currentLang === lang.code
                  ? 'border-accent/40 bg-accent-muted text-text-primary shadow-soft'
                  : 'border-border-muted bg-surface hover:border-accent/40 text-text-secondary shadow-soft'
              }`}
            >
              {lang.nativeName}
            </button>
          ))}
        </div>
      </div>

      {/* About */}
      {appVer && (
        <div className="glass-card rounded-xl px-4 py-3">
          <p className="text-xs text-text-muted">
            {t('common.appName')} v{appVer}
          </p>
        </div>
      )}
    </div>
  );
}
