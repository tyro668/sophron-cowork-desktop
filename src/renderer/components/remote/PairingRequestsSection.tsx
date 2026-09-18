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
    <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
      <Clock className="w-3 h-3" />
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
    <div className="p-4 rounded-lg border border-warning/30 bg-warning/5">
      <h3 className="font-medium text-warning mb-3 flex items-center gap-2">
        <Shield className="w-4 h-4" />
        {t('remote.pairingRequests')}
      </h3>
      {pendingPairings.length > 0 && (
        <p className="mb-3 text-sm text-text-secondary">{t('remote.pairingReviewHint')}</p>
      )}
      {pendingPairings.length === 0 ? (
        <div className="text-sm text-text-secondary py-3 text-center">
          {t('remote.noPendingPairings')}
        </div>
      ) : (
        <div className="space-y-3">
          {pendingPairings.map((request) => (
            <div
              key={`${request.channelType}-${request.userId}`}
              className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface rounded-lg"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">
                    {request.userName || t('remote.unknownUser')}
                  </span>
                  <span className="px-1.5 py-0.5 text-xs rounded bg-accent-muted text-accent capitalize">
                    {t(`remote.channelName.${request.channelType}`, {
                      defaultValue: request.channelType,
                    })}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-text-secondary">{request.userId}</p>
                <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary mt-1">
                  <span>
                    {t('remote.pairingCode')}:{' '}
                    <span className="font-mono text-warning font-medium">{request.code}</span>
                  </span>
                  <Countdown expiresAt={request.expiresAt} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => onReject(request)}>
                  <X className="w-4 h-4" />
                  {t('remote.reject')}
                </Button>
                <Button variant="primary" onClick={() => onApprove(request)}>
                  <Check className="w-4 h-4" />
                  {t('remote.approve')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
