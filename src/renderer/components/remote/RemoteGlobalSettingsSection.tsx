import { Loader2, Save } from 'lucide-react';
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
      className="ui-form-flush bg-surface"
    >
      <AdvancedConfigStep
        defaultWorkingDirectory={defaultWorkingDirectory}
        gatewayPort={gatewayPort}
        autoApproveSafeTools={autoApproveSafeTools}
        onWorkingDirectoryChange={onWorkingDirectoryChange}
        onGatewayPortChange={onGatewayPortChange}
        onAutoApproveChange={onAutoApproveChange}
      />

      <div className="ui-form-row">
        <span className="ui-form-label items-center" />
        <div className="ui-form-value !flex-row items-stretch">
          <span className="ui-flush-text min-w-0 flex-1 truncate">
            {t('remote.globalSettingsHint')}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="ui-accent-cell w-[140px] shrink-0 border-l border-border-subtle"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t('remote.saveGlobalSettings')}
          </button>
        </div>
      </div>
    </section>
  );
}
