import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import type { CodexAuthStatus, CodexLoginPromptPayload } from '../../types';

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
      setStatus(await window.electronAPI.config.codexAuthStatus());
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

  const handleLogin = useCallback(async () => {
    setBusy('login');
    setError('');
    try {
      const result = await window.electronAPI.config.codexLogin();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexLoginFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setPrompt(null);
    }
  }, [t]);

  const handleImport = useCallback(async () => {
    setBusy('import');
    setError('');
    try {
      const result = await window.electronAPI.config.codexImportCli();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexCliNotFound'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const handleLogout = useCallback(async () => {
    setBusy('logout');
    setError('');
    try {
      const result = await window.electronAPI.config.codexLogout();
      setStatus(result.status);
      if (!result.success) {
        setError(result.error || t('api.codexLoginFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const submitManualCode = useCallback(() => {
    if (!prompt) return;
    void window.electronAPI.config.codexSubmitLoginCode({
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
    <div className="rounded-xl border border-border-muted bg-background px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {connected ? (
            <CheckCircle className="h-4.5 w-4.5 shrink-0 text-success" />
          ) : (
            <KeyRound className="h-4.5 w-4.5 shrink-0 text-text-muted" />
          )}
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text-primary">
              {t('api.codexAuthTitle')}
            </div>
            <div
              className={`mt-0.5 truncate text-[12px] ${
                connected ? 'text-success' : 'text-text-muted'
              }`}
            >
              {statusText}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <button
              type="button"
              onClick={() => {
                void handleLogout();
              }}
              disabled={busy !== null}
              className="btn btn-secondary h-8"
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
                onClick={() => {
                  void handleImport();
                }}
                disabled={busy !== null}
                className="btn btn-secondary h-8"
                title={t('api.codexRedetect')}
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
                onClick={() => {
                  void handleLogin();
                }}
                disabled={busy !== null}
                className="btn btn-primary h-8"
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
        <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t('api.codexManualCodePlaceholder')}
            aria-label={t('api.codexManualCodeLabel')}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border-muted bg-background px-3 text-[13px] text-text-primary outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={submitManualCode}
            disabled={!manualCode.trim()}
            className="btn btn-primary h-9 shrink-0"
          >
            {t('api.codexManualCodeSubmit')}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 text-[12px] text-error">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
