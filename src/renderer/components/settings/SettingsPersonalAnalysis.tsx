import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Cloud, KeyRound, PlugZap, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { showToast } from '../../utils/toast';
import type { PersonalAnalysisConfig } from '../../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  getPersonalAnalysisErrorMessage,
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

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
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
  };

  const validateConnectionFields = (): Pick<
    PersonalAnalysisConfig,
    'apiOrigin' | 'apiKey'
  > | null => {
    const validation = validatePersonalAnalysisConnection(form, t);
    if (!validation.connection) {
      showToast('error', validation.error || t('cloudData.connectionFailed'));
      return null;
    }

    return validation.connection;
  };

  const handleTest = async () => {
    const connection = validateConnectionFields();
    if (!connection) return;
    setIsTesting(true);
    try {
      const result = await window.electronAPI.data.listCloudSpaces(connection);
      showToast('success', t('cloudData.testSuccess', { count: result.spaces.length }));
    } catch (testError) {
      showToast('error', getPersonalAnalysisErrorMessage(testError, t));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const connection = validateConnectionFields();
    if (!connection) return;
    setIsSaving(true);
    try {
      const result = await window.electronAPI.config.save({ personalAnalysis: connection });
      setAppConfig(result.config);
      setForm(result.config.personalAnalysis || connection);
      setIsEditing(false);
      showToast('success', t('personalAnalysis.saveSuccess'));
    } catch (saveError) {
      showToast('error', getPersonalAnalysisErrorMessage(saveError, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setIsSaving(true);
    try {
      const result = await window.electronAPI.config.save({
        personalAnalysis: EMPTY_PERSONAL_ANALYSIS_CONFIG,
      });
      setAppConfig(result.config);
      setForm(EMPTY_PERSONAL_ANALYSIS_CONFIG);
      setIsEditing(true);
      showToast('success', t('cloudData.disconnected'));
    } catch (disconnectError) {
      showToast('error', getPersonalAnalysisErrorMessage(disconnectError, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setForm(storedConnection);
    setIsEditing(false);
  };

  return (
    <section className="rounded-xl border border-border-muted bg-background p-4 shadow-soft sm:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
          <Cloud className="h-4 w-4" />
        </div>
        <span
          className={`ml-auto flex h-6 flex-shrink-0 items-center rounded-full px-2 text-[12px] font-medium ${
            isConnected ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
          }`}
        >
          {isConnected ? t('cloudData.connected') : t('cloudData.notConnected')}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <FieldRow label={t('personalAnalysis.apiOrigin')}>
          {isEditing ? (
            <Input
              id="personal-analysis-api-origin"
              type="text"
              value={form.apiOrigin}
              onChange={(event) => updateField('apiOrigin', event.target.value)}
              placeholder={t('personalAnalysis.apiOriginPlaceholder')}
              className="h-9 bg-surface px-3 text-[13px] shadow-soft"
            />
          ) : (
            <span className="block truncate text-[13px] text-text-primary">
              {storedConnection.apiOrigin}
            </span>
          )}
        </FieldRow>
        <FieldRow label={t('personalAnalysis.apiKey')}>
          {isEditing ? (
            <Input
              id="personal-analysis-api-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              placeholder={t('personalAnalysis.apiKeyPlaceholder')}
              className="h-9 bg-surface px-3 text-[13px] shadow-soft"
            />
          ) : (
            <span className="block font-mono text-[13px] text-text-primary">
              {maskKey(storedConnection.apiKey)}
            </span>
          )}
        </FieldRow>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => void handleTest()}
          loading={isTesting}
          disabled={isSaving}
          className="h-8 text-[12px]"
        >
          {!isTesting && <PlugZap className="h-3.5 w-3.5" />}
          {t('cloudData.testConnection')}
        </Button>
        {isEditing ? (
          <>
            {isConnected && (
              <Button variant="ghost" onClick={handleCancelEdit} className="h-8 text-[12px]">
                {t('common.cancel')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              loading={isSaving}
              className="h-8 text-[12px] shadow-soft"
            >
              {!isSaving && <KeyRound className="h-3.5 w-3.5" />}
              {t('cloudData.connect')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => setIsEditing(true)}
              className="h-8 text-[12px]"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t('cloudData.changeConnection')}
            </Button>
            <Button variant="secondary" onClick={navigateToCloudData} className="h-8 text-[12px]">
              <Cloud className="h-3.5 w-3.5" />
              {t('cloudData.viewCloudData')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleDisconnect()}
              disabled={isSaving}
              className="h-8 text-[12px] text-error hover:bg-error/10 hover:text-error"
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('cloudData.disconnect')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
