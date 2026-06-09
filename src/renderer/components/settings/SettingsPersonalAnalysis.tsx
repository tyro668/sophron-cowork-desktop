import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Database, Key, Loader2, RefreshCw, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import type { PersonalAnalysisConfig, PersonalAnalysisDatasource } from '../../types';
import { GlassSelect } from '../GlassSelect';

const EMPTY_PERSONAL_ANALYSIS_CONFIG: PersonalAnalysisConfig = {
  apiOrigin: '',
  apiKey: '',
  datasourceId: '',
};

export function SettingsPersonalAnalysis() {
  const { t } = useTranslation();
  const appConfig = useAppStore((s) => s.appConfig);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const [form, setForm] = useState<PersonalAnalysisConfig>(EMPTY_PERSONAL_ANALYSIS_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDatasources, setIsLoadingDatasources] = useState(false);
  const [datasources, setDatasources] = useState<PersonalAnalysisDatasource[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    setForm(appConfig?.personalAnalysis || EMPTY_PERSONAL_ANALYSIS_CONFIG);
  }, [appConfig?.personalAnalysis]);

  const updateField = (field: keyof PersonalAnalysisConfig, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
    setSuccessMessage('');
  };

  const normalizeApiOrigin = (value: string) => value.trim().replace(/\/+$/, '');

  const validateConnectionFields = (): Pick<
    PersonalAnalysisConfig,
    'apiOrigin' | 'apiKey'
  > | null => {
    const apiOrigin = normalizeApiOrigin(form.apiOrigin);
    const apiKey = form.apiKey.trim();

    if (!apiOrigin || !apiKey) {
      setError(
        t(
          'personalAnalysis.datasourceRefreshMissingConnection',
          'Fill Host and API Key before loading datasources'
        )
      );
      return null;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(apiOrigin);
    } catch {
      setError(
        t(
          'personalAnalysis.invalidApiOrigin',
          'Enter a valid Host URL, for example http://127.0.0.1:3000'
        )
      );
      return null;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      setError(
        t('personalAnalysis.invalidApiOriginProtocol', 'Host must start with http:// or https://')
      );
      return null;
    }

    if (/^x-api-key\s*:/i.test(apiKey)) {
      setError(
        t(
          'personalAnalysis.apiKeyHeaderPrefixError',
          'Paste only the API key value, without the X-API-Key: prefix'
        )
      );
      return null;
    }

    return { apiOrigin, apiKey };
  };

  const handleRefreshDatasources = async () => {
    const connection = validateConnectionFields();
    if (!connection) {
      return;
    }

    setIsLoadingDatasources(true);
    setError('');
    setSuccessMessage('');
    try {
      const nextDatasources = await window.electronAPI.config.listPersonalAnalysisDatasources({
        apiOrigin: connection.apiOrigin,
        apiKey: connection.apiKey,
      });
      setDatasources(nextDatasources);
      if (!form.datasourceId.trim() && nextDatasources[0]?.datasourceId) {
        updateField('datasourceId', nextDatasources[0].datasourceId);
      }
      if (nextDatasources.length === 0) {
        setError(
          t(
            'personalAnalysis.datasourceRefreshEmpty',
            'No datasources returned. Enter a datasource ID manually.'
          )
        );
      }
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : t(
              'personalAnalysis.datasourceRefreshFailed',
              'Failed to load Personal Analysis datasources'
            )
      );
    } finally {
      setIsLoadingDatasources(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    const connection = validateConnectionFields();
    if (!connection) {
      setIsSaving(false);
      return;
    }

    const datasourceId = form.datasourceId.trim();
    if (!datasourceId) {
      setError(t('personalAnalysis.datasourceRequired', 'Select or enter a datasource'));
      setIsSaving(false);
      return;
    }

    if (
      datasources.length > 0 &&
      !datasources.some((datasource) => datasource.datasourceId === datasourceId)
    ) {
      setError(
        t(
          'personalAnalysis.datasourceNotInList',
          'Select a datasource returned by the service, or reload the datasource list'
        )
      );
      setIsSaving(false);
      return;
    }

    const personalAnalysis: PersonalAnalysisConfig = {
      apiOrigin: connection.apiOrigin,
      apiKey: connection.apiKey,
      datasourceId,
    };

    try {
      const result = await window.electronAPI.config.save({ personalAnalysis });
      setAppConfig(result.config);
      setForm(result.config.personalAnalysis || personalAnalysis);
      setSuccessMessage(t('personalAnalysis.saveSuccess', 'Personal Analysis settings saved'));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('personalAnalysis.saveFailed', 'Failed to save Personal Analysis settings')
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="personal-analysis-api-origin"
            className="flex items-center gap-2 text-[13px] font-medium text-text-primary"
          >
            <Server className="h-4 w-4 text-accent-text" />
            {t('personalAnalysis.apiOrigin', 'Host')}
          </label>
          <span className="rounded-md border border-border-muted bg-background/42 px-2 py-1 text-[11px] font-medium text-text-secondary">
            {t('personalAnalysis.mockServer', 'Mock Server')}
          </span>
        </div>
        <input
          id="personal-analysis-api-origin"
          type="text"
          value={form.apiOrigin}
          onChange={(event) => updateField('apiOrigin', event.target.value)}
          placeholder={t(
            'personalAnalysis.apiOriginPlaceholder',
            'https://your-server.example.com'
          )}
          className="w-full rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[13px] text-text-primary shadow-soft placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <label
          htmlFor="personal-analysis-api-key"
          className="flex items-center gap-2 text-[13px] font-medium text-text-primary"
        >
          <Key className="h-4 w-4 text-accent-text" />
          {t('personalAnalysis.apiKey', 'API Key')}
        </label>
        <input
          id="personal-analysis-api-key"
          type="password"
          value={form.apiKey}
          onChange={(event) => updateField('apiKey', event.target.value)}
          placeholder={t('personalAnalysis.apiKeyPlaceholder', 'Enter API key')}
          className="w-full rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[13px] text-text-primary shadow-soft placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="glass-card space-y-3 rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="personal-analysis-datasource-id"
            className="flex items-center gap-2 text-[13px] font-medium text-text-primary"
          >
            <Database className="h-4 w-4 text-accent-text" />
            {t('personalAnalysis.datasourceId', 'Datasource ID')}
          </label>
          <button
            type="button"
            onClick={() => {
              void handleRefreshDatasources();
            }}
            disabled={isLoadingDatasources}
            className="flex items-center gap-1 rounded-md border border-border-muted bg-background/42 px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoadingDatasources ? 'animate-spin' : ''}`} />
            {t('personalAnalysis.loadDatasources', 'Load')}
          </button>
        </div>
        {datasources.length > 0 ? (
          <GlassSelect
            value={form.datasourceId}
            onValueChange={(value) => updateField('datasourceId', value)}
            options={datasources.map((datasource) => ({
              value: datasource.datasourceId,
              label: datasource.datasourceName
                ? `${datasource.datasourceName} (${datasource.datasourceId})`
                : datasource.datasourceId,
            }))}
            placeholder={t('personalAnalysis.datasourceIdPlaceholder', 'Select datasource')}
            triggerClassName="h-9 w-full justify-between rounded-lg bg-background/42 px-3 text-text-primary"
            contentClassName="w-[var(--radix-select-trigger-width)]"
          />
        ) : (
          <input
            id="personal-analysis-datasource-id"
            type="text"
            value={form.datasourceId}
            onChange={(event) => updateField('datasourceId', event.target.value)}
            placeholder={t(
              'personalAnalysis.datasourceIdPlaceholder',
              'Load or enter datasource ID'
            )}
            className="w-full rounded-lg border border-border-muted bg-background/42 px-3 py-2 text-[13px] text-text-primary shadow-soft placeholder-text-muted transition-all focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      <div className="space-y-3 py-2">
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-medium text-white transition-colors hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.saving')}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4" />
              {t('personalAnalysis.saveSettings', 'Save Settings')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
