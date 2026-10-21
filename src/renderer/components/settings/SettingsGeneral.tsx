import { useCallback, useState, useEffect, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '../ui/button';
import { formatTimestamp } from '../data-view/shared';
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
    { code: 'zh', nativeName: '简体中文' },
    { code: 'en', nativeName: 'English' },
  ];

  // Login service is read-only here (resolved by the main process); the test
  // button only re-queries auth status.
  const [auth, setAuth] = useState<{
    origin?: string;
    status?: 'connected' | 'disconnected';
    testing: boolean;
  }>({ testing: false });
  const testConnection = useCallback(async () => {
    if (!window.electronAPI?.auth?.getStatus) return;
    setAuth((current) => ({ ...current, testing: true }));
    try {
      const status = await window.electronAPI.auth.getStatus();
      setAuth({ origin: status.apiOrigin, status: status.connectionStatus, testing: false });
    } catch {
      setAuth((current) => ({ ...current, status: 'disconnected', testing: false }));
    }
  }, []);
  useEffect(() => {
    void testConnection();
  }, [testConnection]);

  const now = Date.now();
  const sampleDate = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const absoluteSample = `${sampleDate.getFullYear()}-${pad(sampleDate.getMonth() + 1)}-${pad(
    sampleDate.getDate()
  )} ${pad(sampleDate.getHours())}:${pad(sampleDate.getMinutes())}`;
  const numberSample = new Intl.NumberFormat(currentLang === 'zh' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1857304.85);

  const themeOptions = [
    { value: 'light' as const, label: t('general.themeLight'), icon: Sun },
    { value: 'dark' as const, label: t('general.themeDark'), icon: Moon },
    { value: 'system' as const, label: t('general.themeSystem', 'System'), icon: Monitor },
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
    <div>
      <SettingsCard title={t('general.appearance')}>
        <SettingsRow label={t('general.theme')}>
          <div className="inline-flex rounded-lg bg-surface-muted p-0.5">
            {themeOptions.map((opt) => {
              const active = settings.theme === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateSettings({ theme: opt.value })}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors ${active ? 'bg-surface text-accent-text shadow-soft ring-1 ring-accent/25' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <SettingsRow label={t('general.accentTheme')}>
          <div
            role="radiogroup"
            aria-label={t('general.accentTheme')}
            className="flex flex-wrap gap-2"
          >
            {accentOptions.map((opt) => {
              const active = settings.accentTheme === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ accentTheme: opt.value })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${active ? 'border-accent/40 bg-accent-muted text-accent-text' : 'border-border-muted bg-surface text-text-secondary hover:border-accent/40'}`}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: opt.swatch }}
                  />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <SettingsRow label={t('general.logo')}>
          <div
            role="radiogroup"
            aria-label={t('general.logo')}
            className="flex flex-wrap items-center gap-2"
          >
            {logoOptions.map((opt) => {
              const active = settings.logoVariant === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ logoVariant: opt.value })}
                  className={`${`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors ${active ? 'border-accent/40 bg-accent-muted text-accent-text' : 'border-border-muted bg-surface text-text-secondary hover:border-accent/40'}`} h-9`}
                >
                  <BrandMark variant={opt.value} className="h-5 w-5" />
                  {opt.label}
                </button>
              );
            })}
            <span className="text-xs text-text-muted">{t('general.logoFollowsAccent')}</span>
          </div>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title={t('general.languageAndFormat')}>
        <SettingsRow label={t('general.language')}>
          <div className="inline-flex rounded-lg bg-surface-muted p-0.5">
            {languages.map((lang) => {
              const active = currentLang === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => i18n.changeLanguage(lang.code)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors ${active ? 'bg-surface text-accent-text shadow-soft ring-1 ring-accent/25' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  {lang.nativeName}
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <SettingsRow label={t('general.dateTime')}>
          <span className="font-mono text-[12.5px] text-text-primary">{absoluteSample}</span>
          <span className="ml-2 text-xs text-text-muted">
            · {formatTimestamp(now, t)} · {t('general.hour24')}
          </span>
        </SettingsRow>
        <SettingsRow label={t('general.numbers')}>
          <span className="font-mono text-[12.5px] text-text-primary">{numberSample}</span>
          <span className="ml-2 text-xs text-text-muted">· {t('general.numberFormatHint')}</span>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard title={t('general.accountAndLogin')}>
        <SettingsRow label={t('general.loginService')}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-border-muted bg-surface-muted px-2.5 font-mono text-[12.5px] text-text-secondary">
              <span className="truncate">{auth.origin || '—'}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={auth.testing}
              onClick={() => void testConnection()}
            >
              {t('general.testConnection')}
            </Button>
          </div>
        </SettingsRow>
        {auth.status && !auth.testing && (
          <div className="pl-[88px]">
            {auth.status === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('general.loginServiceReachable')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('general.loginServiceUnreachable')}
              </span>
            )}
          </div>
        )}
      </SettingsCard>

      {appVer && (
        <p className="px-1 text-xs text-text-muted">
          {t('common.appName')} v{appVer}
        </p>
      )}
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ui-group bg-surface">
      <h4 className="ui-group-title">{title}</h4>
      {children}
    </section>
  );
}

function SettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value">
        <div className="flex min-w-0 flex-wrap items-center gap-1">{children}</div>
      </div>
    </div>
  );
}
