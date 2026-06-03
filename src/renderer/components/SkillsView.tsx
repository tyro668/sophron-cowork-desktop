import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { SettingsSkills } from './settings/SettingsSkills';

export function SkillsView() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-transparent">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-4 lg:px-6">
        <header className="mb-3 flex h-10 items-center gap-2.5 border-b border-border-subtle">
          <Package className="h-4 w-4 flex-shrink-0 text-accent" />
          <h1 className="text-[16px] font-medium leading-tight text-text-primary">
            {t('skills.pageTitle')}
          </h1>
        </header>

        <SettingsSkills isActive={true} />
      </div>
    </div>
  );
}
