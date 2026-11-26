import { Info, Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdvancedConfigStep } from './AdvancedConfigStep';

interface RemoteGlobalSettingsSectionProps {
  defaultWorkingDirectory: string;
  gatewayPort: number;
  autoApproveSafeTools: boolean;
  isSaving: boolean;
  onWorkingDirectoryChange: (value: string) => void;
  onGatewayPortChange: (value: number) => void;
  onAutoApproveChange: (value: boolean) => void;
  onSave: () => void;
}

export function RemoteGlobalSettingsSection({
  defaultWorkingDirectory,
  gatewayPort,
  autoApproveSafeTools,
  isSaving,
  onWorkingDirectoryChange,
  onGatewayPortChange,
  onAutoApproveChange,
  onSave,
}: RemoteGlobalSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <section
      id="remote-panel-global"
      role="tabpanel"
      aria-labelledby="remote-nav-tab-global"
      className="overflow-hidden rounded-md border border-border-subtle"
    >
      <div className="p-4 sm:p-5">
        <AdvancedConfigStep
          defaultWorkingDirectory={defaultWorkingDirectory}
          gatewayPort={gatewayPort}
          autoApproveSafeTools={autoApproveSafeTools}
          onWorkingDirectoryChange={onWorkingDirectoryChange}
          onGatewayPortChange={onGatewayPortChange}
          onAutoApproveChange={onAutoApproveChange}
        />
        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent/20 bg-accent-muted p-3 text-xs leading-5 text-text-secondary">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          {t('remote.globalSettingsHint')}
        </div>
      </div>
      <div className="flex justify-end border-t border-border-subtle p-4">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('remote.saveGlobalSettings')}
        </button>
      </div>
    </section>
  );
}
