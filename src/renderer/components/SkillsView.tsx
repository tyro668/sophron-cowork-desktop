import { SettingsSkills } from './settings/SettingsSkills';

export function SkillsView() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-transparent">
      <div className="flex h-full min-h-0 w-full flex-col">
        <SettingsSkills isActive={true} />
      </div>
    </div>
  );
}
