/**
 * GatewayControlCard — compact service status row with the start/stop toggle.
 */

import { useTranslation } from 'react-i18next';
import { Loader2, Power, RadioTower } from 'lucide-react';
import { Button } from '../ui/button';
import type { GatewayStatus } from './types';

interface Props {
  status: GatewayStatus | null;
  isTogglingGateway: boolean;
  onToggle: () => void;
}

export function GatewayControlCard({ status, isTogglingGateway, onToggle }: Props) {
  const { t } = useTranslation();
  const running = !!status?.running;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            running ? 'bg-success/10 text-success' : 'bg-surface-active text-text-muted'
          }`}
        >
          <RadioTower className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">{t('remote.title')}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-success' : 'bg-text-muted'}`}
            />
            {running ? t('remote.statusRunning') : t('remote.statusStopped')}
          </p>
        </div>
      </div>
      <Button
        variant={running ? 'danger' : 'primary'}
        onClick={onToggle}
        disabled={isTogglingGateway}
      >
        {isTogglingGateway ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Power className="h-4 w-4" />
        )}
        {running ? t('remote.stopService') : t('remote.startService')}
      </Button>
    </div>
  );
}
