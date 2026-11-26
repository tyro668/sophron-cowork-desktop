/**
 * 设置 → 云空间：配置服务地址与 API Key、测试连接、查看云数据与断开连接。
 * 视觉结构与「设置 → 云连接」保持一致（ui-group + ui-form-flush + 贴边操作单元）。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Cloud, KeyRound, Loader2, PlugZap, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { configClient } from '../../features/config/api/config-client';
import { useAppStore } from '../../store';
import { showToast } from '../../utils/toast';
import type { PersonalAnalysisConfig } from '../../types';
import {
  EMPTY_PERSONAL_ANALYSIS_CONFIG,
  hasPersonalAnalysisConnection,
  getPersonalAnalysisErrorMessage,
  validatePersonalAnalysisConnection,
} from '../../../shared/personal-analysis';
import { Badge } from '../ui';

type PersonalAnalysisFormField = 'apiOrigin' | 'apiKey';

function maskKey(value: string) {
  if (!value) return '••••••••';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ui-form-row">
      <span className="ui-form-label items-center">{label}</span>
      <div className="ui-form-value">{children}</div>
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
  const isConnected = hasPersonalAnalysisConnection(storedConnection);
  const isBusy = isSaving || isTesting;

  useEffect(() => {
    setForm(storedConnection);
    setIsEditing(!hasPersonalAnalysisConnection(storedConnection));
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
      if (
        storedConnection.connectionStatus === 'disconnected' &&
        connection.apiOrigin === storedConnection.apiOrigin &&
        connection.apiKey === storedConnection.apiKey
      ) {
        const saved = await configClient.save({ personalAnalysis: connection });
        setAppConfig(saved.config);
      }
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
      const result = await configClient.save({ personalAnalysis: connection });
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
      const result = await configClient.save({
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
    <div data-testid="settings-personal-analysis">
      <section className="ui-group ui-form-flush bg-surface">
        <div className="ui-group-title justify-between gap-2">
          <span className="truncate">{t('settings.personalAnalysis')}</span>
          <Badge tone={isConnected ? 'success' : 'default'} data-testid="personal-analysis-status">
            {isConnected ? t('cloudData.connected') : t('cloudData.notConnected')}
          </Badge>
        </div>

        <Row label={t('personalAnalysis.apiOrigin')}>
          {isEditing ? (
            <input
              id="personal-analysis-api-origin"
              type="text"
              value={form.apiOrigin}
              onChange={(event) => updateField('apiOrigin', event.target.value)}
              placeholder={t('personalAnalysis.apiOriginPlaceholder')}
              className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            />
          ) : (
            <span className="ui-flush-text truncate font-mono text-text-primary">
              {storedConnection.apiOrigin}
            </span>
          )}
        </Row>

        <Row label={t('personalAnalysis.apiKey')}>
          {isEditing ? (
            <input
              id="personal-analysis-api-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              placeholder={t('personalAnalysis.apiKeyPlaceholder')}
              className="font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
            />
          ) : (
            <span className="ui-flush-text font-mono text-text-primary">
              {maskKey(storedConnection.apiKey)}
            </span>
          )}
        </Row>

        <div className="ui-form-row">
          <span className="ui-form-label items-center" />
          <div className="ui-form-value !flex-row items-stretch">
            {isEditing ? (
              <>
                {isConnected && (
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
                    onClick={handleCancelEdit}
                  >
                    {t('common.cancel')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  className={`ui-accent-cell min-w-0 flex-1 ${
                    isConnected ? 'border-l border-border-subtle' : ''
                  }`}
                  onClick={() => void handleTest()}
                >
                  {isTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" />
                  )}
                  {t('cloudData.testConnection')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
                  onClick={() => void handleSave()}
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  {t('cloudData.connect')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isBusy}
                  className="ui-accent-cell min-w-0 flex-1"
                  onClick={() => void handleTest()}
                >
                  {isTesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" />
                  )}
                  {t('cloudData.testConnection')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
                  onClick={() => setIsEditing(true)}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {t('cloudData.changeConnection')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  className="ui-accent-cell min-w-0 flex-1 border-l border-border-subtle"
                  onClick={navigateToCloudData}
                >
                  <Cloud className="h-3.5 w-3.5" />
                  {t('cloudData.viewCloudData')}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 border-l border-border-subtle text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                  onClick={() => void handleDisconnect()}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  {t('cloudData.disconnect')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
