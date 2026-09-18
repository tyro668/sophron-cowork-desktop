import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { CodexAuthStatus, CodexLoginPromptPayload } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

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
            <Button
              variant="secondary"
              onClick={() => {
                void handleLogout();
              }}
              loading={busy === 'logout'}
              disabled={busy !== null}
            >
              {busy === 'logout' ? (
                t('api.codexLogout')
              ) : (
                <>
                  <LogOut className="h-3.5 w-3.5" />
                  {t('api.codexLogout')}
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  void handleImport();
                }}
                loading={busy === 'import'}
                disabled={busy !== null}
                title={t('api.codexRedetect')}
              >
                {busy === 'import' ? (
                  t('api.codexRedetect')
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t('api.codexRedetect')}
                  </>
                )}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void handleLogin();
                }}
                loading={busy === 'login'}
                disabled={busy !== null}
                className="shadow-soft"
              >
                {busy === 'login' ? (
                  t('api.codexLoggingIn')
                ) : (
                  <>
                    <LogIn className="h-3.5 w-3.5" />
                    {t('api.codexLogin')}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {prompt && (
        <div className="mt-3 flex items-center gap-2 border-t border-border-subtle pt-3">
          <Input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t('api.codexManualCodePlaceholder')}
            aria-label={t('api.codexManualCodeLabel')}
            className="h-9 min-w-0 flex-1 bg-background px-3"
          />
          <Button
            variant="primary"
            onClick={submitManualCode}
            disabled={!manualCode.trim()}
            className="h-9 shrink-0 shadow-soft"
          >
            {t('api.codexManualCodeSubmit')}
          </Button>
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
