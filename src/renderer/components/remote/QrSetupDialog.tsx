import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogTitle } from '../ui/dialog';
import { ChannelBrandIcon } from './ChannelBrandIcon';
import type {
  RemoteQrChannel,
  RemoteQrSetupState,
} from '../../../shared/contracts/remote/qr-setup';

export function QrSetupDialog({
  channel,
  onClose,
  onManual,
  onCompleted,
}: {
  channel: RemoteQrChannel;
  onClose: () => void;
  onManual: () => void;
  onCompleted: () => void;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RemoteQrSetupState>({ id: '', status: 'generating' });
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completed = useRef(onCompleted);
  completed.current = onCompleted;

  useEffect(() => {
    const id = crypto.randomUUID();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const api = window.electronAPI?.remote;
    const update = (next: RemoteQrSetupState) => {
      if (disposed) return;
      setState(next);
      if (next.status === 'completed') completed.current();
      else if (['generating', 'waiting', 'scanned', 'verifying', 'saving'].includes(next.status)) {
        timer = setTimeout(() => void poll(), 1000);
      }
    };
    const fail = () => {
      if (!disposed) {
        setState({ id, status: 'failed', errorCode: 'unavailable' });
        void api?.cancelQrSetup?.(id).catch(() => {});
      }
    };
    const poll = async () => {
      try {
        update(await api.getQrSetup(id));
      } catch {
        fail();
      }
    };
    setState({ id, status: 'generating' });
    setCode('');
    if (api?.beginQrSetup) void api.beginQrSetup(id, channel).then(update, fail);
    else fail();
    return () => {
      disposed = true;
      clearTimeout(timer);
      void api?.cancelQrSetup?.(id).catch(() => {});
    };
  }, [channel, attempt]);

  const busy = state.status === 'saving';
  const success = state.status === 'completed';
  const showQr = ['waiting', 'scanned', 'verifying'].includes(state.status) && state.qrCodeDataUrl;
  const name = t(`remote.channelName.${channel}`);
  const statusKey =
    state.status === 'failed'
      ? `remote.qr.errors.${state.errorCode || 'registration_failed'}`
      : `remote.qr.status.${state.status}`;

  async function submitCode() {
    const id = state.id;
    setSubmitting(true);
    try {
      await window.electronAPI.remote.submitQrSetupCode(id, code);
      setCode('');
    } catch {
      setState((current) =>
        current.id === id && current.status === 'verifying'
          ? { ...current, status: 'failed', errorCode: 'unavailable' }
          : current
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      busy={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      ariaLabelledBy="remote-qr-title"
      className="max-w-md p-0 gap-0 overflow-hidden"
    >
      <div className="relative flex min-h-0 flex-col items-center gap-3 overflow-y-auto p-6 text-center">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3"
          disabled={busy}
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
        <ChannelBrandIcon type={channel} className="h-12 w-12" />
        <DialogTitle id="remote-qr-title">{t('remote.qr.title', { channel: name })}</DialogTitle>
        <p className="text-sm text-text-secondary">
          {t(channel === 'wechat' ? 'remote.qr.wechatInstruction' : 'remote.qr.instruction', {
            channel: name,
          })}
        </p>
        <div className="flex min-h-64 w-full flex-col items-center justify-center gap-3 py-2">
          {showQr ? (
            <img
              src={state.qrCodeDataUrl}
              width={256}
              height={256}
              alt={t('remote.qr.imageAlt', { channel: name })}
              className="max-w-full rounded-lg border border-border-muted"
            />
          ) : success ? (
            <CheckCircle2 className="h-12 w-12 text-success" />
          ) : busy || state.status === 'generating' ? (
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          ) : null}
          <p
            role="status"
            aria-live="polite"
            className={
              state.status === 'failed' || state.status === 'denied'
                ? 'text-sm text-error'
                : 'text-sm text-text-secondary'
            }
          >
            {t(statusKey)}
          </p>
          {state.status === 'verifying' && (
            <form
              className="flex w-full gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCode();
              }}
            >
              <Input
                aria-label={t('remote.qr.verifyCode')}
                placeholder={t('remote.qr.verifyCode')}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 12))}
              />
              <Button type="submit" loading={submitting} disabled={!/^\d{4,12}$/.test(code)}>
                {t('remote.qr.confirm')}
              </Button>
            </form>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border-subtle p-4">
        {success ? (
          <Button variant="primary" onClick={onClose}>
            {t('remote.qr.done')}
          </Button>
        ) : (
          <Button
            disabled={busy || state.status === 'generating'}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw className="h-4 w-4" />
            {t('remote.qr.refresh')}
          </Button>
        )}
        {channel !== 'wechat' && !success && (
          <Button variant="ghost" disabled={busy} onClick={onManual}>
            {t('remote.qr.manual')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
