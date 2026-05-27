import { useTranslation } from 'react-i18next';
import { Wrench } from 'lucide-react';
import { SettingsSkills } from './settings/SettingsSkills';

export function SkillsView() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[960px] px-5 py-8 lg:px-8">
        <header className="mb-5 flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
            <Wrench className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {t('mainNav.skills')}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-text-primary">
              {t('skills.pageTitle')}
            </h1>
            <p className="mt-2 max-w-[42rem] text-sm leading-6 text-text-muted">
              {t('skills.pageDescription')}
            </p>
          </div>
        </header>

        <SettingsSkills isActive={true} />
      </div>
    </div>
  );
}
