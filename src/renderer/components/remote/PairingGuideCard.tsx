/**
 * PairingGuideCard — compact step-by-step guide shown when pairing mode is active
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';

const DISMISS_KEY = 'sophron-pairing-guide-dismissed';

const supportsStorage = typeof window !== 'undefined' && window.localStorage;

export function PairingGuideCard() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() =>
    supportsStorage ? localStorage.getItem(DISMISS_KEY) === 'true' : false
  );

  if (dismissed) return null;

  const steps = [
    t('remote.pairingGuideStep1'),
    t('remote.pairingGuideStep2'),
    t('remote.pairingGuideStep3'),
    t('remote.pairingGuideStep4'),
  ];

  function handleDismiss() {
    setDismissed(true);
    if (supportsStorage) localStorage.setItem(DISMISS_KEY, 'true');
  }

  return (
    <div className="relative border-b border-border-subtle bg-accent-muted/40 px-4 py-3">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('common.close')}
        className="absolute right-3 top-2.5 rounded-md p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-accent">
        <Link2 className="h-3.5 w-3.5" />
        {t('remote.pairingGuideTitle')}
      </h3>
      <ol className="space-y-1.5 text-[12px] text-text-secondary">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] font-semibold text-accent">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
