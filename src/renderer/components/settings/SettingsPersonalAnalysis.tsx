import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  PlugZap,
  Unplug,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import type { PersonalAnalysisConfig } from '../../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  getPersonalAnalysisErrorMessage,
  normalizePersonalAnalysisApiOrigin,
  validatePersonalAnalysisConnection,
} from '../../../shared/personal-analysis';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type PersonalAnalysisFormField = 'apiOrigin' | 'apiKey';

function maskKey(value: string) {
  if (!value) return '••••••••';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function SettingsPersonalAnalysis() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const navigateToCloudData = useAppStore((s) => s.navigateToCloudData);
  const [form, setForm] = useState<PersonalAnalysisConfig>(EMPTY_PERSONAL_ANALYSIS_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const storedConnection = useMemo(
    () => appConfig?.personalAnalysis || EMPTY_PERSONAL_ANALYSIS_CONFIG,
    [appConfig?.personalAnalysis]
  );
  const isConnected = Boolean(storedConnection.apiOrigin && storedConnection.apiKey);

  useEffect(() => {
    setForm(storedConnection);
    setIsEditing(!storedConnection.apiOrigin || !storedConnection.apiKey);
  }, [storedConnection]);

  const updateField = (field: PersonalAnalysisFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
    setSuccessMessage('');
  };

  const validateConnectionFields = (): Pick<
    PersonalAnalysisConfig,
    'apiOrigin' | 'apiKey'
  > | null => {
    const validation = validatePersonalAnalysisConnection(form, t);
    if (!validation.connection) {
      setError(validation.error || t('cloudData.connectionFailed'));
      return null;
    }

    return validation.connection;
  };

  const handleOpenApiKeyPage = async () => {
    const apiOrigin = normalizePersonalAnalysisApiOrigin(
      form.apiOrigin || storedConnection.apiOrigin
    );
    if (!apiOrigin) {
      setIsEditing(true);
      setError(t('cloudData.fillHostBeforeOpenKeyPage'));
      return;
    }
    try {
      await window.electronAPI?.openExternal?.(apiOrigin);
    } catch (openError) {
      setError(getPersonalAnalysisErrorMessage(openError, t));
    }
  };

  const handleTest = async () => {
    const connection = validateConnectionFields();
    if (!connection) return;
    setIsTesting(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await window.electronAPI.data.listCloudSpaces(connection);
      setSuccessMessage(t('cloudData.testSuccess', { count: result.spaces.length }));
    } catch (testError) {
      setError(getPersonalAnalysisErrorMessage(testError, t));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const connection = validateConnectionFields();
    if (!connection) return;
    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await window.electronAPI.config.save({ personalAnalysis: connection });
      setAppConfig(result.config);
      setForm(result.config.personalAnalysis || connection);
      setIsEditing(false);
      setSuccessMessage(t('personalAnalysis.saveSuccess'));
    } catch (saveError) {
      setError(getPersonalAnalysisErrorMessage(saveError, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');
    try {
      const result = await window.electronAPI.config.save({
        personalAnalysis: EMPTY_PERSONAL_ANALYSIS_CONFIG,
      });
      setAppConfig(result.config);
      setForm(EMPTY_PERSONAL_ANALYSIS_CONFIG);
      setIsEditing(true);
      setSuccessMessage(t('cloudData.disconnected'));
    } catch (disconnectError) {
      setError(getPersonalAnalysisErrorMessage(disconnectError, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewCloudData = () => {
    navigateToCloudData();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <Cloud className="h-4 w-4 text-accent-text" />
              {t('settings.personalAnalysis')}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-text-secondary">
              {t('personalAnalysis.settingsDescription')}
            </p>
          </div>
          <span
            className={`flex h-6 flex-shrink-0 items-center rounded-full px-2 text-[12px] font-medium ${
              isConnected ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
            }`}
          >
            {isConnected ? t('cloudData.connected') : t('cloudData.notConnected')}
          </span>
        </div>

        {isConnected && !isEditing && (
          <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
            <InfoRow label={t('personalAnalysis.apiOrigin')} value={storedConnection.apiOrigin} />
            <InfoRow
              label={t('personalAnalysis.apiKey')}
              value={maskKey(storedConnection.apiKey)}
            />
          </div>
        )}

        {isEditing && (
          <div className="mt-3 grid gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {t('personalAnalysis.apiOrigin')}
              </span>
              <Input
                id="personal-analysis-api-origin"
                type="text"
                value={form.apiOrigin}
                onChange={(event) => updateField('apiOrigin', event.target.value)}
                placeholder={t('personalAnalysis.apiOriginPlaceholder')}
                className="h-9 bg-background px-3 shadow-soft"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-text-secondary">
                {t('personalAnalysis.apiKey')}
              </span>
              <Input
                id="personal-analysis-api-key"
                type="password"
                value={form.apiKey}
                onChange={(event) => updateField('apiKey', event.target.value)}
                placeholder={t('personalAnalysis.apiKeyPlaceholder')}
                className="h-9 bg-background px-3 shadow-soft"
              />
            </label>
            <p className="text-[12px] leading-5 text-text-muted">{t('cloudData.apiKeyHint')}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[13px] text-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-[13px] text-success">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void handleTest()}
          loading={isTesting}
          disabled={isSaving}
          className="text-[12px]"
        >
          {isTesting ? (
            t('cloudData.testConnection')
          ) : (
            <>
              <PlugZap className="h-3.5 w-3.5" />
              {t('cloudData.testConnection')}
            </>
          )}
        </Button>
        <Button variant="secondary" onClick={handleOpenApiKeyPage} className="text-[12px]">
          <ExternalLink className="h-3.5 w-3.5" />
          {t('cloudData.openApiKeyPage')}
        </Button>
        {isEditing ? (
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            loading={isSaving}
            className="text-[12px] shadow-soft"
          >
            {isSaving ? (
              t('cloudData.connect')
            ) : (
              <>
                <KeyRound className="h-3.5 w-3.5" />
                {t('cloudData.connect')}
              </>
            )}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => setIsEditing(true)}
            className="text-[12px] shadow-soft"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {t('cloudData.changeConnection')}
          </Button>
        )}
        {isConnected && (
          <>
            <Button variant="secondary" onClick={handleViewCloudData} className="text-[12px]">
              <Cloud className="h-3.5 w-3.5" />
              {t('cloudData.viewCloudData')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleDisconnect()}
              disabled={isSaving}
              className="text-[12px] text-error hover:bg-error/10 hover:text-error"
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('cloudData.disconnect')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="mt-1 truncate text-[13px] font-medium text-text-primary">{value}</div>
    </div>
  );
}
