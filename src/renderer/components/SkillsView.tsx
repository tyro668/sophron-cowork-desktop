import { SettingsSkills } from './settings/SettingsSkills';

export function SkillsView() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col px-3 py-3 sm:px-4">
        <SettingsSkills isActive={true} />
      </div>
    </div>
  );
}
