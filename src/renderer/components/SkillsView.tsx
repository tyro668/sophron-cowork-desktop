import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { SettingsSkills } from './settings/SettingsSkills';

export function SkillsView() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-[1120px] px-5 py-5 lg:px-7">
        <header className="mb-4 flex items-center gap-2.5">
          <Package className="h-5 w-5 flex-shrink-0 text-accent" />
          <h1 className="text-[22px] font-semibold leading-tight text-text-primary">
            {t('skills.pageTitle')}
          </h1>
        </header>

        <SettingsSkills isActive={true} />
      </div>
    </div>
  );
}
