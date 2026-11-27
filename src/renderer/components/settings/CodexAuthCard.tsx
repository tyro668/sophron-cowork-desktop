import { configClient } from '../../features/config/api/config-client';
import { formatIpcError } from '../../utils/ipc-error';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, KeyRound, Loader2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { CodexAuthStatus, CodexLoginPromptPayload } from '../../types';
import { showToast } from '../../utils/toast';

type BusyAction = 'login' | 'import' | 'logout' | null;

export function CodexAuthCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<CodexLoginPromptPayload | null>(null);
  const [manualCode, setManualCode] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await configClient.codexAuthStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const api = window.electronAPI?.config;
    if (!api?.onCodexLoginPrompt) return;
    return api.onCodexLoginPrompt((payload) => {
      setPrompt(payload);
      setManualCode('');
    });
  }, []);

  useEffect(() => {
    if (error) {
      showToast('error', error);
      setError('');
    }
  }, [error]);

  const handleLogin = useCallback(async () => {
    setBusy('login');
    setError('');
    try {
      const result = await configClient.codexLogin();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexLoginFailed'));
      }
    } catch (err) {
      setError(formatIpcError(err, String(err)));
    } finally {
      setBusy(null);
      setPrompt(null);
    }
  }, [t]);

  const handleImport = useCallback(async () => {
    setBusy('import');
    setError('');
    try {
      const result = await configClient.codexImportCli();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexCliNotFound'));
      }
    } catch (err) {
      setError(formatIpcError(err, String(err)));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const handleLogout = useCallback(async () => {
    setBusy('logout');
    setError('');
    try {
      const result = await configClient.codexLogout();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexLoginFailed'));
      }
    } catch (err) {
      setError(formatIpcError(err, String(err)));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const submitManualCode = useCallback(() => {
    if (!prompt) return;
    void configClient.codexSubmitLoginCode({
      requestId: prompt.requestId,
      code: manualCode.trim(),
    });
    setPrompt(null);
  }, [prompt, manualCode]);

  const connected = status?.connected === true;
  const statusText = !status
    ? t('common.loading')
    : connected
      ? status.source === 'codex-cli'
        ? t('api.codexConnectedCli')
        : t('api.codexConnectedApp')
      : t('api.codexNotConnected');

  return (
    <>
      <div className="ui-form-row">
        <span className="ui-form-label items-center whitespace-nowrap">
          {t('api.codexAuthTitle')}
        </span>
        <div className="ui-form-value !flex-row items-stretch">
          <span
            className={`ui-flush-text min-w-0 flex-1 gap-1.5 ${connected ? '!text-success' : ''}`}
          >
            {connected ? (
              <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            )}
            <span className="truncate">{statusText}</span>
          </span>

          {connected ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={busy !== null}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-3 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'logout' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              {t('api.codexLogout')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={busy !== null}
                title={t('api.codexRedetect')}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t('api.codexRedetect')}
              </button>
              <button
                type="button"
                onClick={() => void handleLogin()}
                disabled={busy !== null}
                className="ui-accent-cell shrink-0 border-l border-border-subtle"
              >
                {busy === 'login' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <LogIn className="h-3.5 w-3.5" />
                )}
                {busy === 'login' ? t('api.codexLoggingIn') : t('api.codexLogin')}
              </button>
            </>
          )}
        </div>
      </div>

      {prompt && (
        <div className="ui-form-row">
          <span
            className="ui-form-label items-center whitespace-nowrap"
            title={t('api.codexManualCodeLabel')}
          >
            {t('api.codexManualCodeTitle')}
          </span>
          <div className="ui-form-value !flex-row items-stretch">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={t('api.codexManualCodePlaceholder')}
              aria-label={t('api.codexManualCodeLabel')}
              className="min-w-0 flex-1 text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={submitManualCode}
              disabled={!manualCode.trim()}
              className="ui-accent-cell shrink-0 border-l border-border-subtle"
            >
              {t('api.codexManualCodeSubmit')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
