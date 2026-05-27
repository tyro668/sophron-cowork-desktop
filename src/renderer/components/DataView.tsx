import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';

export function DataView() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto flex h-full min-h-[28rem] w-full max-w-[960px] flex-col px-5 py-8 lg:px-8">
        <header className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Layers className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {t('mainNav.data')}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-text-primary">{t('data.pageTitle')}</h1>
            <p className="mt-2 max-w-[42rem] text-sm leading-6 text-text-muted">
              {t('data.pageDescription')}
            </p>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border-muted bg-surface/40 px-6 py-16">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Layers className="h-7 w-7" />
            </div>
            <div className="text-xl font-semibold text-text-primary">{t('data.comingSoon')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
