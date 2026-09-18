/**
 * AdvancedConfigStep — gateway port, working directory, and auto-approve settings
 */

import { useTranslation } from 'react-i18next';
import { Input } from '../ui/input';
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
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium text-text-primary mb-1">
          {t('remote.advancedTitle')}
        </h3>
        <p className="text-sm text-text-secondary">{t('remote.advancedDesc')}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.defaultWorkingDirectory')}
          </label>
          <Input
            type="text"
            value={defaultWorkingDirectory}
            onChange={(e) => onWorkingDirectoryChange(e.target.value)}
            className="h-auto bg-surface-hover px-3 py-2.5 text-sm"
            placeholder={t('remote.defaultWorkingDirectoryPlaceholder')}
          />
          <p className="text-xs text-text-muted mt-1">{t('remote.defaultWorkingDirectoryHint')}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {t('remote.gatewayPort')}
          </label>
          <Input
            type="number"
            value={gatewayPort}
            onChange={(e) => onGatewayPortChange(parseInt(e.target.value) || 18789)}
            className="h-auto bg-surface-hover px-3 py-2.5 text-sm"
            placeholder="18789"
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-surface-hover">
          <div>
            <div className="font-medium text-text-primary text-sm">
              {t('remote.autoApproveSafeTools')}
            </div>
            <p className="text-xs text-text-muted mt-0.5">{t('remote.autoApproveSafeToolsDesc')}</p>
          </div>
          <Switch
            checked={autoApproveSafeTools}
            onCheckedChange={onAutoApproveChange}
            aria-label={t('remote.autoApproveSafeTools')}
          />
        </div>
      </div>
    </div>
  );
}
