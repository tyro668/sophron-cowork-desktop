import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  BrainCircuit,
  CheckCircle,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  Loader2,
  Play,
  Plug,
  RefreshCw,
  Save,
  Server,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { VISIBLE_API_PROVIDER_OPTIONS } from '../../../shared/api-model-presets';
import { useApiConfigState } from '../../hooks/useApiConfigState';
import type { ProviderType } from '../../types';
import ApiDiagnosticsPanel from '../ApiDiagnosticsPanel';
import { ApiConfigSetManager } from '../ApiConfigSetManager';
import { GlassSelect } from '../GlassSelect';
import { GlassSwitch } from '../GlassSwitch';
import { CommonProviderSetupsCard } from '../ProviderGuidance';
import { CodexAuthCard } from './CodexAuthCard';

interface ModelOptionItem {
  id: string;
  name: string;
}

function SettingsCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border-muted bg-background p-4 shadow-soft sm:p-5 lg:h-full">
      <div className="mb-5 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <p className="mt-0.5 text-[12px] leading-5 text-text-muted">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsAPI() {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const {
    provider,
    customProtocol,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder,
    presets,
    currentPreset,
    modelOptions,
    isSaving,
    isLoadingConfig,
    error,
    successMessage,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    enableThinking,
    isOllamaMode,
    requiresApiKey,
    commonProviderSetups,
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    setApiKey,
    setBaseUrl,
    setModel,
    setCustomModel,
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    applyCommonProviderSetup,
    changeProvider,
    changeProtocol,
    requestConfigSetSwitch,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    refreshModelOptions,
    discoverLocalOllama,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
  } = useApiConfigState();

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <span className="ml-2 text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  const isSophronMode = provider === 'sophron';
  const isCodexMode = provider === 'openai-codex';
  const providerOptions: ProviderType[] = [
    ...VISIBLE_API_PROVIDER_OPTIONS,
    ...(provider === 'custom' ? (['custom'] as const) : []),
  ];
  const canSave =
    !isSaving &&
    !isMutatingConfigSet &&
    !pendingConfigSetAction &&
    (!requiresApiKey || Boolean(apiKey.trim()));
  const connectionOk = Boolean(diagnosticResult?.overallOk);
  const connectionFailed = Boolean(diagnosticResult && !diagnosticResult.overallOk);

  return (
    <div className="flex min-h-full flex-col gap-4 pb-2">
      <ApiConfigSetManager
        configSets={configSets}
        activeConfigSetId={activeConfigSetId}
        currentConfigSet={currentConfigSet}
        pendingConfigSetAction={pendingConfigSetAction}
        pendingConfigSet={pendingConfigSet}
        hasUnsavedChanges={hasUnsavedChanges}
        isMutatingConfigSet={isMutatingConfigSet}
        isSaving={isSaving}
        onSwitchSet={requestConfigSetSwitch}
        onRequestCreateBlankSet={requestCreateBlankConfigSet}
        onRenameSet={renameConfigSet}
        onDeleteSet={deleteConfigSet}
        onCancelPendingAction={cancelPendingConfigSetAction}
        onSaveAndContinuePendingAction={saveAndContinuePendingConfigSetAction}
        onDiscardAndContinuePendingAction={discardAndContinuePendingConfigSetAction}
      />

      {(error || successMessage) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] ${
            error ? 'bg-error/10 text-error' : 'bg-success/10 text-success'
          }`}
        >
          {error ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 shrink-0" />
          )}
          {error || successMessage}
        </div>
      )}

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <SettingsCard
          icon={<Wifi className="h-4.5 w-4.5" />}
          title={t('api.serviceAuth')}
          description={t('api.serviceAuthDescription')}
        >
          <FieldRow label={t('api.provider')}>
            <GlassSelect
              value={provider}
              onValueChange={(value) => changeProvider(value as ProviderType)}
              options={providerOptions.map((item) => ({
                value: item,
                label: presets[item]?.name || item,
              }))}
              triggerClassName="h-11 w-full justify-between bg-background px-3 text-[13px] text-text-primary"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </FieldRow>

          {provider === 'custom' && (
            <FieldRow label={t('api.protocol')}>
              <div className="grid grid-cols-3 gap-1 rounded-lg border border-border-muted bg-surface-muted p-1">
                {(['anthropic', 'openai', 'gemini'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={customProtocol === item}
                    onClick={() => changeProtocol(item)}
                    className={`h-8 rounded-md text-[12px] font-medium transition-colors ${
                      customProtocol === item
                        ? 'bg-background text-accent shadow-soft ring-1 ring-inset ring-accent/25'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {item === 'openai' ? 'OpenAI' : item === 'gemini' ? 'Gemini' : 'Anthropic'}
                  </button>
                ))}
              </div>
            </FieldRow>
          )}

          {!isSophronMode && !isCodexMode && (
            <FieldRow label={t('api.apiKey')}>
              <div className="relative">
                <input
                  id="api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                  className="h-11 w-full rounded-lg border border-border-muted bg-background/42 px-3 pr-11 text-[13px] text-text-primary shadow-soft outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                  aria-label={t('api.apiKey')}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
                  aria-label={showApiKey ? t('api.hideApiKey') : t('api.showApiKey')}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FieldRow>
          )}

          {isCodexMode && <CodexAuthCard />}

          <FieldRow label={t('api.baseUrl')}>
            <div className="flex min-w-0 gap-2">
              <input
                id="api-base-url-input"
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={currentPreset?.baseUrl || 'https://api.example.com'}
                className="h-11 min-w-0 flex-1 rounded-lg border border-border-muted bg-background/42 px-3 text-[13px] text-text-primary shadow-soft outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                aria-label={t('api.baseUrl')}
              />
              {isOllamaMode && (
                <button
                  type="button"
                  onClick={() => void discoverLocalOllama()}
                  disabled={isDiscoveringLocalOllama}
                  className="btn btn-secondary h-11 shrink-0"
                  title={t('api.discoverLocalOllama')}
                >
                  {isDiscoveringLocalOllama ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </FieldRow>

          {provider === 'custom' && (
            <CommonProviderSetupsCard
              setups={commonProviderSetups}
              onApplySetup={applyCommonProviderSetup}
            />
          )}
        </SettingsCard>

        <SettingsCard
          icon={<SlidersHorizontal className="h-4.5 w-4.5" />}
          title={t('api.modelInference')}
          description={t('api.modelInferenceDescription')}
        >
          <FieldRow label={t('api.model')}>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                {useCustomModel ? (
                  <input
                    id="api-model-input"
                    type="text"
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder={modelInputPlaceholder}
                    className="h-11 w-full rounded-lg border border-border-muted bg-background/42 px-3 text-[13px] text-text-primary shadow-soft outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                ) : (
                  <GlassSelect
                    value={modelOptions.length ? model : ''}
                    onValueChange={setModel}
                    options={
                      modelOptions.length
                        ? (modelOptions as ModelOptionItem[]).map((item) => ({
                            value: item.id,
                            label: item.name,
                          }))
                        : [
                            {
                              value: 'no-models',
                              label: t('api.noModelsAvailable'),
                              disabled: true,
                            },
                          ]
                    }
                    placeholder={t('api.noModelsAvailable')}
                    disabled={!modelOptions.length}
                    triggerClassName="h-11 w-full justify-between bg-background/42 px-3 text-[13px] text-text-primary"
                    contentClassName="w-[var(--radix-select-trigger-width)]"
                  />
                )}
              </div>
              {!isSophronMode && !isCodexMode && (
                <button
                  type="button"
                  onClick={toggleCustomModel}
                  className={`btn h-11 shrink-0 ${useCustomModel ? 'btn-primary' : 'btn-secondary'}`}
                >
                  <Edit3 className="h-4 w-4" />
                  <span className="hidden lg:inline">
                    {useCustomModel ? t('api.usePreset') : t('api.customModel')}
                  </span>
                </button>
              )}
              {(isOllamaMode || provider === 'sophron') && !useCustomModel && (
                <button
                  type="button"
                  onClick={() => void refreshModelOptions()}
                  disabled={isRefreshingModels}
                  className="btn btn-secondary h-11 shrink-0"
                  title={t('api.refreshModels')}
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>
          </FieldRow>

          <FieldRow label={t('api.contextWindow')}>
            <input
              id="api-context-window-input"
              type="number"
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              placeholder={t('api.contextWindowPlaceholder')}
              min={1024}
              step={1024}
              className="h-11 w-full rounded-lg border border-border-muted bg-background/42 px-3 text-[13px] text-text-primary shadow-soft outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </FieldRow>

          <FieldRow label={t('api.maxOutputTokens')}>
            <input
              id="api-max-tokens-input"
              type="number"
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.target.value)}
              placeholder={t('api.maxOutputTokensPlaceholder')}
              min={256}
              step={256}
              className="h-11 w-full rounded-lg border border-border-muted bg-background/42 px-3 text-[13px] text-text-primary shadow-soft outline-none transition-all placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </FieldRow>

          <div className="border-t border-border-muted pt-4">
            <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <BrainCircuit className="h-4.5 w-4.5 shrink-0 text-accent" />
                <p className="text-[13px] font-medium text-text-primary">
                  {t('api.enableThinking')}
                </p>
              </div>
              <GlassSwitch
                checked={enableThinking}
                onCheckedChange={setEnableThinking}
                ariaLabel={t('api.enableThinking')}
              />
            </div>
          </div>
        </SettingsCard>
      </div>

      {(diagnosticResult || isDiagnosing) && (
        <section className="rounded-xl border border-border-muted bg-background p-4 shadow-soft">
          <ApiDiagnosticsPanel
            result={diagnosticResult}
            isRunning={isDiagnosing}
            onRunDiagnostics={handleDiagnose}
            onRunDeepDiagnostics={isOllamaMode ? handleDeepDiagnose : undefined}
            disabled={requiresApiKey && !apiKey.trim()}
            showActions={false}
          />
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 mt-auto flex flex-wrap items-center gap-3 border-t border-border-muted bg-background/95 px-1 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => void handleDiagnose()}
          disabled={isDiagnosing || (requiresApiKey && !apiKey.trim())}
          className="btn btn-secondary h-10"
        >
          {isDiagnosing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isDiagnosing ? t('api.diagnostic.running') : t('api.testConnection')}
        </button>
        {isOllamaMode && (
          <button
            type="button"
            onClick={() => void handleDeepDiagnose()}
            disabled={isDiagnosing || (requiresApiKey && !apiKey.trim())}
            className="btn btn-secondary h-10"
          >
            <Cpu className="h-4 w-4" />
            {t('api.diagnostic.runDeepDiagnostics')}
          </button>
        )}

        <div
          className={`flex min-w-[180px] flex-1 items-center gap-2 text-[13px] font-medium ${
            connectionOk ? 'text-success' : connectionFailed ? 'text-error' : 'text-text-muted'
          }`}
        >
          {connectionOk ? (
            <CheckCircle className="h-5 w-5 shrink-0" />
          ) : connectionFailed ? (
            <AlertCircle className="h-5 w-5 shrink-0" />
          ) : (
            <Server className="h-5 w-5 shrink-0" />
          )}
          {connectionOk
            ? t('api.connectionSuccess', { ms: diagnosticResult?.totalLatencyMs || 0 })
            : connectionFailed
              ? t('api.connectionFailed')
              : t('api.connectionNotTested')}
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="btn btn-primary h-10 shrink-0 px-5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? t('common.saving') : t('api.saveSettings')}
        </button>
      </div>
    </div>
  );
}
