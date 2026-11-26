/**
 * PairingRequestsSection — displays pending pairing requests with approve/reject
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Check, X, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import type { PairingRequest } from './types';

interface Props {
  pendingPairings: PairingRequest[];
  showEmpty?: boolean;
  onApprove: (request: PairingRequest) => void;
  onReject: (request: PairingRequest) => void;
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const timer = setInterval(() => {
      const r = Math.max(0, expiresAt - Date.now());
      setRemaining(r);
      if (r <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (remaining <= 0) return null;

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const time = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;

  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] tabular-nums text-text-muted">
      <Clock className="h-3 w-3" />
      {t('remote.expiresIn', { time })}
    </span>
  );
}

export function PairingRequestsSection({
  pendingPairings,
  showEmpty = false,
  onApprove,
  onReject,
}: Props) {
  const { t } = useTranslation();

  if (pendingPairings.length === 0 && !showEmpty) return null;

  return (
    <section className="border-b border-border-subtle">
      <div className="ui-group-title justify-between gap-2">
        <span className="flex items-center gap-1.5 text-warning">
          <Shield className="h-3.5 w-3.5" />
          {t('remote.pairingRequests')}
        </span>
        {pendingPairings.length > 0 && (
          <span className="text-[11px] font-normal text-text-muted">
            {t('remote.pairingReviewHint')}
          </span>
        )}
      </div>

      {pendingPairings.length === 0 ? (
        <div className="px-4 py-4 text-center text-[12.5px] text-text-muted">
          {t('remote.noPendingPairings')}
        </div>
      ) : (
        <div className="divide-y divide-border-subtle bg-warning/5">
          {pendingPairings.map((request) => (
            <div
              key={`${request.channelType}-${request.userId}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-text-primary">
                    {request.userName || t('remote.unknownUser')}
                  </span>
                  <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[10.5px] font-medium capitalize text-accent">
                    {t(`remote.channelName.${request.channelType}`, {
                      defaultValue: request.channelType,
                    })}
                  </span>
                </div>
                <p className="mt-0.5 break-all font-mono text-[11.5px] text-text-muted">
                  {request.userId}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[12px] text-text-secondary">
                  <span>
                    {t('remote.pairingCode')}:{' '}
                    <span className="font-mono font-medium text-warning">{request.code}</span>
                  </span>
                  <Countdown expiresAt={request.expiresAt} />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" onClick={() => onReject(request)}>
                  <X className="h-3.5 w-3.5" />
                  {t('remote.reject')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => onApprove(request)}>
                  <Check className="h-3.5 w-3.5" />
                  {t('remote.approve')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
