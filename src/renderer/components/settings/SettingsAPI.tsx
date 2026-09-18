import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
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
import { Button, Input } from '../ui';
import { CommonProviderSetupsCard } from '../ProviderGuidance';
import { CodexAuthCard } from './CodexAuthCard';

interface ModelOptionItem {
  id: string;
  name: string;
}

function SettingsCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border-muted bg-background p-4 shadow-soft sm:p-5 lg:h-full">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-muted text-accent">
          {icon}
        </div>
        <h2 className="min-w-0 text-[15px] font-semibold text-text-primary">{title}</h2>
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
    providerUnset,
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
    thinkingLevel,
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
    setContextWindow,
    setMaxTokens,
    toggleCustomModel,
    setEnableThinking,
    setThinkingLevel,
    applyCommonProviderSetup,
    changeProvider,
    clearProviderSelection,
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
    !providerUnset &&
    (!requiresApiKey || Boolean(apiKey.trim()));
  const connectionOk = Boolean(diagnosticResult?.overallOk);
  const connectionFailed = Boolean(diagnosticResult && !diagnosticResult.overallOk);

  return (
    <div className="flex min-h-full flex-col gap-4 pb-2">
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
        <SettingsCard icon={<Wifi className="h-4.5 w-4.5" />} title={t('api.serviceAuth')}>
          <FieldRow label={t('api.provider')}>
            <GlassSelect
              value={providerUnset ? '' : provider}
              onValueChange={(value) => {
                if (value === '') {
                  clearProviderSelection();
                } else {
                  changeProvider(value as ProviderType);
                }
              }}
              options={[
                { value: '', label: t('api.providerEmpty') },
                ...providerOptions.map((item) => ({
                  value: item,
                  label: presets[item]?.name || item,
                })),
              ]}
              triggerClassName="h-11 w-full justify-between bg-surface px-3 text-[13px] text-text-primary"
              contentClassName="w-[var(--radix-select-trigger-width)]"
            />
          </FieldRow>

          {!providerUnset && provider === 'custom' && (
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

          {!providerUnset && !isSophronMode && !isCodexMode && (
            <FieldRow label={t('api.apiKey')}>
              <div className="relative">
                <Input
                  id="api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                  className="h-11 pr-11 shadow-soft"
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

          {!providerUnset && isCodexMode && <CodexAuthCard />}

          {!providerUnset && (provider === 'custom' || isOllamaMode) && (
            <FieldRow label={t('api.baseUrl')}>
              <div className="flex min-w-0 gap-2">
                <Input
                  id="api-base-url-input"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={currentPreset?.baseUrl || 'https://api.example.com'}
                  className="h-11 min-w-0 flex-1 shadow-soft"
                  aria-label={t('api.baseUrl')}
                />
                {isOllamaMode && (
                  <Button
                    variant="secondary"
                    onClick={() => void discoverLocalOllama()}
                    disabled={isDiscoveringLocalOllama}
                    className="h-11 shrink-0"
                    title={t('api.discoverLocalOllama')}
                  >
                    {isDiscoveringLocalOllama ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </FieldRow>
          )}

          {!providerUnset && provider === 'custom' && (
            <CommonProviderSetupsCard
              setups={commonProviderSetups}
              onApplySetup={applyCommonProviderSetup}
            />
          )}
        </SettingsCard>

        <SettingsCard
          icon={<SlidersHorizontal className="h-4.5 w-4.5" />}
          title={t('api.modelInference')}
        >
          {providerUnset ? (
            <p className="py-2 text-[13px] text-text-muted">{t('api.selectProviderFirst')}</p>
          ) : (
            <>
              <FieldRow label={t('api.model')}>
                <div className="flex min-w-0 gap-2">
                  <div className="min-w-0 flex-1">
                    {useCustomModel ? (
                      <Input
                        id="api-model-input"
                        type="text"
                        value={customModel}
                        onChange={(event) => setCustomModel(event.target.value)}
                        placeholder={modelInputPlaceholder}
                        className="h-11 shadow-soft"
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
                        triggerClassName="h-11 w-full justify-between bg-surface px-3 text-[13px] text-text-primary"
                        contentClassName="w-[var(--radix-select-trigger-width)]"
                      />
                    )}
                  </div>
                  {!isSophronMode && !isCodexMode && (
                    <Button
                      variant={useCustomModel ? 'primary' : 'secondary'}
                      onClick={toggleCustomModel}
                      className="h-11 shrink-0"
                    >
                      <Edit3 className="h-4 w-4" />
                      <span className="hidden lg:inline">
                        {useCustomModel ? t('api.usePreset') : t('api.customModel')}
                      </span>
                    </Button>
                  )}
                  {(isOllamaMode || provider === 'sophron') && !useCustomModel && (
                    <Button
                      variant="secondary"
                      onClick={() => void refreshModelOptions()}
                      disabled={isRefreshingModels}
                      className="h-11 shrink-0"
                      title={t('api.refreshModels')}
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${isRefreshingModels ? 'animate-spin' : ''}`}
                      />
                    </Button>
                  )}
                </div>
              </FieldRow>

              <FieldRow label={t('api.contextWindow')}>
                <Input
                  id="api-context-window-input"
                  type="number"
                  value={contextWindow}
                  onChange={(event) => setContextWindow(event.target.value)}
                  placeholder={t('api.contextWindowPlaceholder')}
                  min={1024}
                  step={1024}
                  className="h-11 shadow-soft"
                />
              </FieldRow>

              <FieldRow label={t('api.maxOutputTokens')}>
                <Input
                  id="api-max-tokens-input"
                  type="number"
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(event.target.value)}
                  placeholder={t('api.maxOutputTokensPlaceholder')}
                  min={256}
                  step={256}
                  className="h-11 shadow-soft"
                />
              </FieldRow>

              <FieldRow label={t('api.thinkingLevel')}>
                <div
                  role="radiogroup"
                  aria-label={t('api.thinkingLevel')}
                  className="grid grid-cols-4 gap-1 rounded-lg border border-border-muted bg-surface-muted p-1"
                >
                  {(['off', 'low', 'medium', 'high'] as const).map((level) => {
                    const active =
                      level === 'off' ? !enableThinking : enableThinking && thinkingLevel === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          if (level === 'off') {
                            setEnableThinking(false);
                          } else {
                            setEnableThinking(true);
                            setThinkingLevel(level);
                          }
                        }}
                        className={`h-8 rounded-md text-[12px] font-medium transition-colors ${
                          active
                            ? 'bg-accent text-accent-foreground shadow-soft'
                            : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                        }`}
                      >
                        {t(`api.thinkingLevels.${level}`)}
                      </button>
                    );
                  })}
                </div>
              </FieldRow>
            </>
          )}
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

      <div className="sticky bottom-0 z-10 -mx-1 mt-auto flex flex-wrap items-center gap-3 border-t border-border-muted bg-background px-1 py-3">
        <Button
          variant="secondary"
          onClick={() => void handleDiagnose()}
          disabled={isDiagnosing || providerUnset || (requiresApiKey && !apiKey.trim())}
          className="h-10"
        >
          {isDiagnosing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isDiagnosing ? t('api.diagnostic.running') : t('api.testConnection')}
        </Button>
        {isOllamaMode && (
          <Button
            variant="secondary"
            onClick={() => void handleDeepDiagnose()}
            disabled={isDiagnosing || (requiresApiKey && !apiKey.trim())}
            className="h-10"
          >
            <Cpu className="h-4 w-4" />
            {t('api.diagnostic.runDeepDiagnostics')}
          </Button>
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

        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={!canSave}
          loading={isSaving}
          className="h-10 shrink-0 px-5"
        >
          {isSaving ? null : <Save className="h-4 w-4" />}
          {isSaving ? t('common.saving') : t('api.saveSettings')}
        </Button>
      </div>
    </div>
  );
}
