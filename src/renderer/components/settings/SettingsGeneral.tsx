import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { BrandMark } from '../BrandMark';

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

  // Swatch hexes mirror each accent family's --color-accent in globals.css.
  const accentOptions = [
    { value: 'mint' as const, label: t('general.accentMint'), swatch: '#2f8f63' },
    { value: 'lake' as const, label: t('general.accentLake'), swatch: '#2f9fd1' },
    { value: 'lavender' as const, label: t('general.accentLavender'), swatch: '#7656e8' },
    { value: 'orange' as const, label: t('general.accentOrange'), swatch: '#e47b2e' },
    { value: 'rose' as const, label: t('general.accentRose'), swatch: '#d94d78' },
  ];
  const logoOptions = [
    { value: 'mark' as const, label: t('general.logoMark') },
    { value: 'fold' as const, label: t('general.logoFold') },
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
        <div role="radiogroup" aria-label={t('general.accentTheme')} className="flex gap-2">
          {accentOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={settings.accentTheme === opt.value}
              onClick={() => updateSettings({ accentTheme: opt.value })}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[12px] font-medium transition-all ${
                settings.accentTheme === opt.value
                  ? 'border-accent/40 bg-accent-muted text-text-primary shadow-soft'
                  : 'border-border-muted bg-surface hover:border-accent/40 text-text-secondary shadow-soft'
              }`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-full"
                style={{ backgroundColor: opt.swatch }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <h4 className="text-[13px] font-medium text-text-primary">{t('general.logo')}</h4>
        <div role="radiogroup" aria-label={t('general.logo')} className="flex gap-2">
          {logoOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={settings.logoVariant === opt.value}
              onClick={() => updateSettings({ logoVariant: opt.value })}
              className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                settings.logoVariant === opt.value
                  ? 'border-accent/40 bg-accent-muted text-text-primary'
                  : 'border-border-muted bg-surface text-text-secondary hover:border-accent/40'
              }`}
            >
              <BrandMark variant={opt.value} className="h-9 w-9" />
              <span className="truncate">{opt.label}</span>
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
