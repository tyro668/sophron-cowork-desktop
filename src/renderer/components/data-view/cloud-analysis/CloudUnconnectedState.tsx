import { Cloud, KeyRound, Loader2, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';

interface CloudUnconnectedStateProps {
  serverUnavailable: boolean;
  retryingConnection: boolean;
  loadingCatalog: boolean;
  loginBusy: boolean;
  onRetryConnection: () => void;
  onLogin: () => void;
  onOpenSettings: () => void;
}

export function CloudUnconnectedState({
  serverUnavailable,
  retryingConnection,
  loadingCatalog,
  loginBusy,
  onRetryConnection,
  onLogin,
  onOpenSettings,
}: CloudUnconnectedStateProps) {
  const { t } = useTranslation();

  if (serverUnavailable) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 py-5">
        <div className="flex flex-col items-center gap-4 text-center">
          <Cloud className="h-8 w-8 text-text-muted" />
          <p role="alert" className="text-sm text-text-secondary">
            {t('cloudData.serverUnavailable')}
          </p>
          <Button onClick={onRetryConnection} disabled={retryingConnection || loadingCatalog}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {t('cloudData.retryConnection')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-5">
      <div className="flex w-full max-w-[340px] flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted text-accent-text">
          <Cloud className="h-6 w-6" />
        </div>

        <h3 className="mt-4 text-[16px] font-semibold leading-tight text-text-primary">
          {t('cloudData.connectTitle')}
        </h3>
        <p className="mt-1.5 text-[13px] leading-6 text-text-secondary">
          {t('cloudData.connectDescription')}
        </p>

        <div className="mt-6 flex w-full flex-col gap-2.5">
          <button
            type="button"
            onClick={onLogin}
            disabled={loginBusy}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-foreground shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
          >
            {loginBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {t('cloudData.startConnect')}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-muted bg-surface px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <KeyRound className="h-4 w-4" />
            {t('cloudData.configureApiKey')}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-[12px] text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{t('cloudData.privacyHint')}</span>
        </div>
      </div>
    </div>
  );
}
