/**
 * AdvancedConfigStep — flush form rows for gateway port, working directory, and auto-approve settings
 */

import { useTranslation } from 'react-i18next';
import { Switch } from '../ui/switch';

interface Props {
  defaultWorkingDirectory: string;
  gatewayPort: number;
  autoApproveSafeTools: boolean;
  onWorkingDirectoryChange: (value: string) => void;
  onGatewayPortChange: (value: number) => void;
  onAutoApproveChange: (value: boolean) => void;
}

export function AdvancedConfigStep({
  defaultWorkingDirectory,
  gatewayPort,
  autoApproveSafeTools,
  onWorkingDirectoryChange,
  onGatewayPortChange,
  onAutoApproveChange,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      <div className="ui-group-title">{t('remote.advancedTitle')}</div>

      <div className="ui-form-row">
        <label htmlFor="remote-working-dir" className="ui-form-label items-center">
          {t('remote.defaultWorkingDirectory')}
        </label>
        <div className="ui-form-value">
          <input
            id="remote-working-dir"
            type="text"
            value={defaultWorkingDirectory}
            onChange={(e) => onWorkingDirectoryChange(e.target.value)}
            className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            placeholder={t('remote.defaultWorkingDirectoryPlaceholder')}
          />
        </div>
      </div>

      <div className="ui-form-row">
        <label htmlFor="remote-gateway-port" className="ui-form-label items-center">
          {t('remote.gatewayPort')}
        </label>
        <div className="ui-form-value">
          <input
            id="remote-gateway-port"
            type="number"
            value={gatewayPort}
            onChange={(e) => onGatewayPortChange(parseInt(e.target.value) || 18789)}
            className="font-mono tabular-nums text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            placeholder="18789"
          />
        </div>
      </div>

      <div className="ui-form-row">
        <span className="ui-form-label items-center">{t('remote.autoApproveSafeTools')}</span>
        <div className="ui-form-value !flex-row items-center justify-between gap-3 px-[10px]">
          <span className="truncate text-[12px] text-text-muted">
            {t('remote.autoApproveSafeToolsDesc')}
          </span>
          <Switch
            size="sm"
            checked={autoApproveSafeTools}
            onCheckedChange={onAutoApproveChange}
            aria-label={t('remote.autoApproveSafeTools')}
          />
        </div>
      </div>
    </>
  );
}
