/**
 * GatewayControlCard — main status card with toggle button and metrics
 */

import { useTranslation } from 'react-i18next';
import { Power, RadioTower, Loader2 } from 'lucide-react';
import type { GatewayStatus, PairedUser, PairingRequest } from './types';

interface Props {
  status: GatewayStatus | null;
  pairedUsers: PairedUser[];
  pendingPairings: PairingRequest[];
  isTogglingGateway: boolean;
  configuredChannels: number;
  connectedChannels: number;
  totalChannels: number;
  canStartService: boolean;
  onToggle: () => void;
}

export function GatewayControlCard({
  status,
  pairedUsers,
  pendingPairings,
  isTogglingGateway,
  configuredChannels,
  connectedChannels,
  totalChannels,
  canStartService,
  onToggle,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="glass-card relative overflow-hidden rounded-2xl border border-border-subtle shadow-card">
      <div className="relative p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${status?.running ? 'bg-success/10' : 'bg-surface-active'}`}
            >
              <RadioTower
                className={`w-5 h-5 ${status?.running ? 'text-success' : 'text-text-muted'}`}
              />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary">{t('remote.title')}</h2>
              <p className="text-sm text-text-secondary mt-0.5">
                {status?.running ? t('remote.statusRunning') : t('remote.statusStopped')}
              </p>
            </div>
          </div>

          <button
            onClick={onToggle}
            disabled={isTogglingGateway || (!status?.running && !canStartService)}
            title={!canStartService ? t('remote.startRequiresChannel') : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              status?.running
                ? 'bg-error hover:bg-error/90 text-white'
                : 'bg-accent hover:bg-accent/90 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isTogglingGateway ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {status?.running ? t('remote.stopService') : t('remote.startService')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-5 pt-4 border-t border-border/50 sm:grid-cols-4">
          <div className="rounded-xl border border-border-subtle bg-background/38 p-3 text-center shadow-soft">
            <div className="text-xl font-semibold text-accent">
              {connectedChannels}/{totalChannels}
            </div>
            <div className="text-xs text-text-muted mt-1">{t('remote.connectedChannels')}</div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-background/38 p-3 text-center shadow-soft">
            <div className="text-xl font-semibold text-accent">{status?.activeSessions ?? 0}</div>
            <div className="text-xs text-text-muted mt-1">{t('remote.activeSessions')}</div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-background/38 p-3 text-center shadow-soft">
            <div className="text-xl font-semibold text-success">{pairedUsers.length}</div>
            <div className="text-xs text-text-muted mt-1">{t('remote.authorizedUsers')}</div>
          </div>
          <div className="rounded-lg border border-border-subtle bg-background/38 p-3 text-center shadow-soft">
            <div className="text-xl font-semibold text-warning">{pendingPairings.length}</div>
            <div className="text-xs text-text-muted mt-1">{t('remote.pendingApprovals')}</div>
          </div>
        </div>
        {!configuredChannels && (
          <p className="mt-3 text-xs text-text-muted">{t('remote.noConfiguredChannels')}</p>
        )}
      </div>
    </div>
  );
}
