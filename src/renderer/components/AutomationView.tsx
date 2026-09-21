import { SettingsSchedule } from './settings/SettingsSchedule';

export function AutomationView({ isActive }: { isActive: boolean }) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <div className="flex h-full min-h-0 w-full flex-col">
        <SettingsSchedule isActive={isActive} />
      </div>
    </div>
  );
}
