import { SettingsSchedule } from './settings/SettingsSchedule';

export function AutomationView() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col px-3 py-3 sm:px-4">
        <SettingsSchedule isActive />
      </div>
    </div>
  );
}
