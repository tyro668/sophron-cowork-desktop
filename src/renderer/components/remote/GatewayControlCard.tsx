/**
 * GatewayControlCard — compact service status header bar with start/stop control.
 */

import { useTranslation } from 'react-i18next';
import { Loader2, Power, RadioTower } from 'lucide-react';
import { Badge, Button } from '../ui';
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
    <div className="flex h-11 items-center justify-between gap-3 border-b border-border-subtle px-4">
      <div className="flex min-w-0 items-center gap-2">
        <RadioTower
          className={`h-4 w-4 shrink-0 ${running ? 'text-success' : 'text-text-muted'}`}
        />
        <h2 className="truncate text-[13px] font-semibold text-text-primary">
          {t('remote.title')}
        </h2>
        <Badge tone={running ? 'success' : 'default'}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-success' : 'bg-text-muted/70'}`}
          />
          {running ? t('remote.statusRunning') : t('remote.statusStopped')}
        </Badge>
      </div>
      <Button
        variant={running ? 'danger-outline' : 'primary'}
        size="sm"
        onClick={onToggle}
        disabled={isTogglingGateway}
      >
        {isTogglingGateway ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Power className="h-3.5 w-3.5" />
        )}
        {running ? t('remote.stopService') : t('remote.startService')}
      </Button>
    </div>
  );
}
