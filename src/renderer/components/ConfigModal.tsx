import { useEffect } from 'react';
import { X, Key, Server, Cpu, CheckCircle, Edit3, Plug, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig, ApiTestResult } from '../types';
import { useApiConfigState } from '../hooks/useApiConfigState';
import { ApiConfigSetManager } from './ApiConfigSetManager';
import { GlassSelect } from './GlassSelect';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { Input } from './ui/input';
import { CommonProviderSetupsCard } from './ProviderGuidance';
import { VISIBLE_API_PROVIDER_OPTIONS } from '../../shared/api-model-presets';
import { showToast } from '../utils/toast';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

const PROVIDER_LABELS: Record<
  | 'anthropic'
  | 'openai'
  | 'openai-codex'
  | 'openrouter'
  | 'deepseek'
  | 'moonshot'
  | 'aliyun'
  | 'zai'
  | 'sophron'
  | 'ollama',
  string
> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-codex': 'OpenAI Codex（订阅）',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  aliyun: 'Aliyun',
  zai: 'Z.AI',
  sophron: '内置 LLM',
  ollama: 'Ollama',
};

export function ConfigModal({
  isOpen,
  onClose,
  onSave,
  initialConfig,
  isFirstRun,
}: ConfigModalProps) {
  const { t } = useTranslation();
  const {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    modelInputPlaceholder,
    presets,
    currentPreset,
    modelOptions,
    isSaving,
    lastSaveCompletedAt,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    testResult,
    friendlyTestDetails,
    isOllamaMode,
    requiresApiKey,
    commonProviderSetups,
    configSets,
    activeConfigSetId,
    selectedConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    toggleCustomModel,
    applyCommonProviderSetup,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestSelectConfigSet,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
    refreshModelOptions,
    discoverLocalOllama,
    shouldShowOllamaManualModelToggle,
  } = useApiConfigState({
    enabled: isOpen,
    initialConfig,
    onSave,
  });

  useEffect(() => {
    if (!lastSaveCompletedAt) {
      return;
    }
    const timer = setTimeout(() => {
      onClose();
    }, 1000);
    return () => clearTimeout(timer);
  }, [lastSaveCompletedAt, onClose]);

  const testErrorMessage = (result: ApiTestResult) => {
    switch (result.errorType) {
      case 'missing_key':
        return t('api.testError.missing_key');
      case 'missing_base_url':
        return t('api.testError.missing_base_url');
      case 'unauthorized':
        return t('api.testError.unauthorized');
      case 'not_found':
        return t('api.testError.not_found');
      case 'rate_limited':
        return t('api.testError.rate_limited');
      case 'server_error':
        return t('api.testError.server_error');
      case 'network_error':
        return t('api.testError.network_error');
      case 'ollama_not_running':
        return t('api.testError.ollama_not_running');
      default:
        return t('api.testError.unknown');
    }
  };

  useEffect(() => {
    if (!testResult) return;
    if (testResult.ok) {
      showToast(
        'success',
        t('api.testSuccess', {
          ms: typeof testResult.latencyMs === 'number' ? testResult.latencyMs : '--',
        })
      );
    } else {
      const detail = friendlyTestDetails || testResult.details;
      showToast(
        'error',
        detail ? `${testErrorMessage(testResult)} · ${detail}` : testErrorMessage(testResult)
      );
    }
  }, [testResult]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const providerOptions = VISIBLE_API_PROVIDER_OPTIONS;
  const isSophronMode = provider === 'sophron';
  const isCodexMode = provider === 'openai-codex';
  const showsBaseUrl = provider === 'ollama';
  const baseUrlPlaceholder = 'http://localhost:11434/v1';

  return (
    <Dialog
      open
      onOpenChange={onClose}
      ariaLabelledBy="config-modal-title"
      overlayClassName="bg-black/25"
      className="max-h-[88vh] max-w-[880px] gap-0 overflow-hidden p-0"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl border border-border-subtle bg-surface flex items-center justify-center text-accent shadow-soft">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
              {t('settings.title')}
            </p>
            <h2 id="config-modal-title" className="mt-1 text-[17px] font-medium text-text-primary">
              {isFirstRun ? t('api.firstRunTitle') : t('api.settingsTitle')}
            </h2>
            <p className="text-[13px] text-text-secondary">
              {isFirstRun ? t('api.firstRunSubtitle') : t('api.settingsSubtitle')}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-9 w-9 rounded-xl"
          aria-label={t('common.close')}
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4 flex-1 overflow-y-auto bg-surface">
        {/* Config Set Switcher */}
        <ApiConfigSetManager
          configSets={configSets}
          activeConfigSetId={activeConfigSetId}
          selectedConfigSetId={selectedConfigSetId}
          currentConfigSet={currentConfigSet}
          pendingConfigSetAction={pendingConfigSetAction}
          pendingConfigSet={pendingConfigSet}
          hasUnsavedChanges={hasUnsavedChanges}
          isMutatingConfigSet={isMutatingConfigSet}
          isSaving={isSaving}
          onSelectSet={requestSelectConfigSet}
          onSwitchSet={requestConfigSetSwitch}
          onRequestCreateBlankSet={requestCreateBlankConfigSet}
          onRenameSet={renameConfigSet}
          onDeleteSet={deleteConfigSet}
          onCancelPendingAction={cancelPendingConfigSetAction}
          onSaveAndContinuePendingAction={saveAndContinuePendingConfigSetAction}
          onDiscardAndContinuePendingAction={discardAndContinuePendingConfigSetAction}
        />

        {/* Provider Selection */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Server className="w-4 h-4" />
            {t('api.provider')}
          </label>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-2">
            {providerOptions.map((p) => (
              <button
                key={p}
                onClick={() => changeProvider(p)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  provider === p
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                }`}
              >
                {presets?.[p]?.name || PROVIDER_LABELS[p] || p}
              </button>
            ))}
          </div>
        </div>

        {!isSophronMode && !isCodexMode && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Key className="w-4 h-4" />
              {t('api.apiKey')}
            </label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
              className="h-auto px-3 py-2 shadow-soft"
            />
          </div>
        )}

        {isCodexMode && <p className="text-xs text-text-muted">{t('api.codexAuthDescription')}</p>}

        {/* Custom Protocol */}
        {provider === 'custom' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Server className="w-4 h-4" />
              {t('api.protocol')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'anthropic', label: 'Anthropic' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'gemini', label: 'Gemini' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => changeProtocol(mode.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    customProtocol === mode.id
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Base URL */}
        {showsBaseUrl && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Server className="w-4 h-4" />
                {t('api.baseUrl')}
              </label>
              {isOllamaMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void discoverLocalOllama();
                  }}
                  disabled={isDiscoveringLocalOllama}
                  className="h-auto gap-1 rounded-md bg-accent-muted px-2 py-1 text-xs text-text-primary hover:bg-accent-muted"
                >
                  <Plug className="w-3 h-3" />
                  {isDiscoveringLocalOllama
                    ? t('api.discoveringLocalOllama')
                    : t('api.discoverLocalOllama')}
                </Button>
              )}
            </div>
            <Input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={baseUrlPlaceholder}
              className="h-auto px-3 py-2 shadow-soft"
            />
          </div>
        )}

        {/* Model Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Cpu className="w-4 h-4" />
              {t('api.model')}
            </label>
            <div className="flex items-center gap-2">
              {(isOllamaMode || isSophronMode || isCodexMode) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void refreshModelOptions();
                  }}
                  className="h-auto gap-1 rounded-md bg-surface-hover px-2 py-1 text-xs hover:bg-surface-active"
                  disabled={isRefreshingModels}
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                  {isRefreshingModels ? t('api.refreshingModels') : t('api.refreshModels')}
                </Button>
              )}
              {shouldShowOllamaManualModelToggle && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleCustomModel}
                  className={`h-auto gap-1 rounded-md px-2 py-1 text-xs ${
                    useCustomModel
                      ? 'bg-accent-muted text-text-primary ring-1 ring-inset ring-accent/20 hover:bg-accent-muted'
                      : 'bg-surface-hover hover:bg-surface-active'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  {isOllamaMode
                    ? useCustomModel
                      ? t('api.useDetectedModels')
                      : t('api.manualModel')
                    : useCustomModel
                      ? t('api.usePreset')
                      : t('api.custom')}
                </Button>
              )}
            </div>
          </div>
          {useCustomModel ? (
            <Input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder={modelInputPlaceholder}
              className="h-auto px-3 py-2 shadow-soft"
            />
          ) : (
            <GlassSelect
              value={modelOptions.length ? model : ''}
              onValueChange={setModel}
              options={
                modelOptions.length
                  ? modelOptions.map((m) => ({ value: m.id, label: m.name }))
                  : [{ value: 'no-models', label: t('api.noModelsAvailable'), disabled: true }]
              }
              placeholder={t('api.noModelsAvailable')}
              disabled={!modelOptions.length}
              triggerClassName="h-9 w-full justify-between rounded-lg bg-surface px-3 text-text-primary"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          )}
        </div>

        {provider === 'custom' && (
          <CommonProviderSetupsCard
            setups={commonProviderSetups}
            onApplySetup={applyCommonProviderSetup}
          />
        )}
      </div>

      {/* Footer */}
      <div className="glass-panel-header border-b-0 px-6 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            onClick={handleTest}
            loading={isTesting}
            disabled={requiresApiKey && !apiKey.trim()}
            className="h-auto w-full gap-2 rounded-xl px-4 py-3 shadow-soft"
          >
            {isTesting ? (
              t('api.testingConnection')
            ) : (
              <>
                <Plug className="w-4 h-4" />
                {t('api.testConnection')}
              </>
            )}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              void handleSave();
            }}
            loading={isSaving}
            disabled={requiresApiKey && !apiKey.trim()}
            className="h-auto w-full gap-2 rounded-xl px-4 py-3"
          >
            {isSaving ? (
              t('common.saving')
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {isFirstRun ? t('api.getStarted') : t('api.saveSettings')}
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
