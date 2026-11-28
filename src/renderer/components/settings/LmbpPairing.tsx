import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCircle, Copy, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react';
import type { LmbpPairingStatus, ProviderModelInfo } from '../../../shared/contracts';
import { configClient } from '../../features/config/api/config-client';
import { formatIpcError } from '../../utils/ipc-error';
import { InlineBanner } from '../ui';

interface Props {
  onModels: (models: ProviderModelInfo[]) => void;
  selectedModel: string;
}

const PAIRING_CODE_PATTERN = /^[A-Z0-9]{4}[- ]?[A-Z0-9]{4}$/;

export function LmbpPairing({ onModels, selectedModel }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LmbpPairingStatus>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const modelSignature = useRef('');
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await configClient.getLmbpStatus();
        if (!active) return;
        setStatus(next);
        setLoadError('');
        if (next.devices.some((device) => device.online)) {
          setNotice((current) => (current === 'api.lmbp.approved' ? '' : current));
        }
        const signature = JSON.stringify(next.models);
        if (modelSignature.current !== signature) {
          modelSignature.current = signature;
          onModels(next.models);
        }
      } catch (error) {
        if (!active) return;
        setStatus(undefined);
        if (modelSignature.current) onModels([]);
        modelSignature.current = '';
        setLoadError(formatIpcError(error, t('api.lmbp.loadFailed')));
      }
      if (active) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [onModels, revision, t]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  async function runAction(action: () => Promise<void>, message?: string) {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await action();
      if (message) setNotice(message);
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(formatIpcError(error, t('api.lmbp.actionFailed')));
    } finally {
      setBusy(false);
    }
  }

  const handleCopyLink = () => {
    if (!status) return;
    void runAction(async () => {
      await navigator.clipboard.writeText(status.link);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    });
  };

  const canApprove = !busy && PAIRING_CODE_PATTERN.test(code.trim());
  const handleApprove = () => {
    if (!canApprove) return;
    void runAction(async () => {
      await configClient.approveLmbpPairing(code.trim());
      setCode('');
      setPairingOpen(false);
    }, 'api.lmbp.approved');
  };

  const hasPairedDevices = Boolean(status && status.devices.length > 0);
  const showPairingForm = Boolean(status && (!hasPairedDevices || pairingOpen));
  const selected = status?.models.find((item) => item.id === selectedModel);
  const online = status?.devices.some((device) => device.online);

  return (
    <>
      {!status && !loadError && (
        <div className="ui-form-row">
          <span className="ui-form-label items-center whitespace-nowrap">
            {t('api.lmbp.pairedDevice')}
          </span>
          <div className="ui-form-value !p-0">
            <span className="ui-flush-text gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" />
              <span>{t('common.loading')}</span>
            </span>
          </div>
        </div>
      )}

      {status &&
        status.devices.map((device, index) => (
          <div key={device.id} className="ui-form-row">
            <span className="ui-form-label items-center whitespace-nowrap">
              {index === 0 ? t('api.lmbp.pairedDevice') : ''}
            </span>
            <div className="ui-form-value !flex-row items-stretch !p-0">
              <span className="ui-flush-text min-w-0 flex-1 gap-2" title={device.id}>
                {device.online ? (
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                )}
                <span className="min-w-0 truncate text-[12.5px] text-text-primary">
                  {device.name || device.id}
                </span>
                <span
                  className={`shrink-0 text-[12px] ${
                    device.online ? 'text-success' : 'text-text-muted'
                  }`}
                >
                  {t(device.online ? 'api.lmbp.online' : 'api.lmbp.offline')}
                </span>
              </span>

              {index === 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActionError('');
                    setNotice('');
                    setPairingOpen((open) => !open);
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t(pairingOpen ? 'common.cancel' : 'api.lmbp.repair')}
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await configClient.revokeLmbpDevice(device.id);
                    setPairingOpen(false);
                  })
                }
                className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-3 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Unlink className="h-3.5 w-3.5" />
                {t('api.lmbp.revoke')}
              </button>
            </div>
          </div>
        ))}

      {showPairingForm && status && (
        <>
          <div className="ui-form-row">
            <span className="ui-form-label items-center whitespace-nowrap">
              {t('api.lmbp.link')}
            </span>
            <div className="ui-form-value !flex-row items-stretch !p-0">
              <input
                type="text"
                aria-label={t('api.lmbp.link')}
                className="min-h-[35px] min-w-0 flex-1 border-0 bg-transparent px-2.5 font-mono text-[12px] text-text-secondary outline-none focus:bg-surface-hover/40"
                value={status.link}
                readOnly
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                disabled={busy}
                onClick={handleCopyLink}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {t(copied ? 'api.lmbp.copiedShort' : 'api.lmbp.copy')}
              </button>
            </div>
          </div>

          <div className="ui-form-row">
            <span className="ui-form-label items-center whitespace-nowrap">
              {t('api.lmbp.codeLabel')}
            </span>
            <div className="ui-form-value !flex-row items-stretch !p-0">
              <input
                type="text"
                aria-label={t('api.lmbp.code')}
                className="min-h-[35px] min-w-0 flex-1 border-0 bg-transparent px-2.5 font-mono text-[12.5px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40"
                placeholder={t('api.lmbp.codePlaceholder')}
                value={code}
                maxLength={9}
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleApprove();
                  }
                }}
              />
              <button
                type="button"
                disabled={!canApprove}
                onClick={handleApprove}
                className="ui-accent-cell shrink-0 border-l border-border-subtle"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('api.lmbp.approve')}
              </button>
            </div>
          </div>

          <div className="border-b border-border-subtle bg-surface-muted/40 px-3 py-2 text-[12px] leading-5 text-text-muted last:border-b-0">
            {t('api.lmbp.instructions')}
          </div>
        </>
      )}

      {status &&
        ((online && !status.models.length) ||
          (selectedModel && !selected) ||
          (selected && !selected.capabilities?.includes('tools'))) && (
          <div className="space-y-1 border-b border-border-subtle px-3 py-2 text-[12px] leading-5 text-text-muted last:border-b-0">
            {online && !status.models.length && <p>{t('api.lmbp.noAuthorizedModels')}</p>}
            {selectedModel && !selected && (
              <p className="break-all text-warning">
                {t('api.lmbp.unavailableModel', { model: selectedModel })}
              </p>
            )}
            {selected && !selected.capabilities?.includes('tools') && (
              <p>{t('api.lmbp.textOnly')}</p>
            )}
          </div>
        )}

      {notice && (
        <p
          role="status"
          className="border-b border-border-subtle px-3 py-1.5 text-[12px] text-success last:border-b-0"
        >
          {t(notice)}
        </p>
      )}

      {(loadError || actionError) && (
        <div className="border-b border-border-subtle px-3 py-2 last:border-b-0">
          <InlineBanner title={actionError || loadError} />
        </div>
      )}
    </>
  );
}
