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
    <div className="glass-card space-y-3 rounded-xl px-4 py-3">
      <label className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
        <KeyRound className="w-4 h-4" />
        {t('api.codexAuthTitle')}
      </label>
      <p className="text-xs text-text-muted">{t('api.codexAuthDescription')}</p>

      <div
        className={`flex items-center gap-2 text-[13px] ${
          connected ? 'text-success' : 'text-text-secondary'
        }`}
      >
        {connected ? (
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
        )}
        {statusText}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            void handleLogin();
          }}
          disabled={busy !== null}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-accent/10 text-text-primary hover:bg-accent/15 disabled:opacity-50"
        >
          {busy === 'login' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LogIn className="w-3 h-3" />
          )}
          {busy === 'login' ? t('api.codexLoggingIn') : t('api.codexLogin')}
        </button>
        <button
          type="button"
          onClick={() => {
            void handleImport();
          }}
          disabled={busy !== null}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-surface-hover text-text-secondary hover:bg-surface-active disabled:opacity-50"
        >
          {busy === 'import' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {t('api.codexRedetect')}
        </button>
        {connected && (
          <button
            type="button"
            onClick={() => {
              void handleLogout();
            }}
            disabled={busy !== null}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors active:scale-95 bg-surface-hover text-text-secondary hover:bg-surface-active disabled:opacity-50"
          >
            {busy === 'logout' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <LogOut className="w-3 h-3" />
            )}
            {t('api.codexLogout')}
          </button>
        )}
      </div>

      {prompt && (
        <div className="space-y-2 rounded-lg border border-border-muted bg-background/42 px-3 py-2">
          <p className="text-xs text-text-secondary">{t('api.codexManualCodeLabel')}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={t('api.codexManualCodePlaceholder')}
              className="flex-1 rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[13px] text-text-primary shadow-soft placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
            />
            <button
              type="button"
              onClick={submitManualCode}
              disabled={!manualCode.trim()}
              className="text-xs px-3 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {t('api.codexManualCodeSubmit')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-error text-xs">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
