import { useState, type ReactNode } from 'react';
import { LmbpPairing } from './LmbpPairing';
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
import {
  ApiConfigSetManager,
  PendingConfigSetBanner,
  pickApiConfigSetManagerProps,
} from '../ApiConfigSetManager';
import { ApiModelSelectorField } from './ApiModelSelectorField';
import { GlassSelect } from '../GlassSelect';
import { CommonProviderSetupsCard } from '../ProviderGuidance';
import { CodexAuthCard } from './CodexAuthCard';

interface ModelOptionItem {
  id: string;
  name: string;
}

function ApiSectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="ui-group-title gap-1.5">
      <span className="flex shrink-0 text-text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {title}
    </h3>
  );
}

function ApiFieldRow({
  label,
  children,
  valueClassName = '',
  rowClassName = '',
}: {
  label: string;
  children: ReactNode;
  valueClassName?: string;
  rowClassName?: string;
}) {
  return (
    <div className={`ui-form-row ${rowClassName}`}>
      <span className="ui-form-label items-center whitespace-nowrap">{label}</span>
      <div className={`ui-form-value ${valueClassName}`}>{children}</div>
    </div>
  );
}

export function SettingsAPI() {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const apiConfigState = useApiConfigState();
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
    currentConfigSet,
    activeConfigSetId,
    selectedConfigSetId,
    hasUnsavedChanges,
    isSaving,
    isLoadingConfig,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    enableThinking,
    thinkingLevel,
    isOllamaMode,
    requiresApiKey,
    commonProviderSetups,
    pendingConfigSetAction,
    pendingConfigSet,
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
    handleSave,
    refreshModelOptions,
    discoverLocalOllama,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
  } = apiConfigState;

  if (isLoadingConfig) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <span className="ml-2 text-[13px] text-text-secondary">{t('common.loading')}</span>
      </div>
    );
  }

  const isSophronMode = provider === 'sophron';
  const isLmbpMode = provider === 'lmbp';
  const modelCapabilities = isLmbpMode
    ? modelOptions.find((item) => item.id === model)?.capabilities
    : undefined;
  const supportsMaxTokens =
    !modelCapabilities?.includes('params') || modelCapabilities.includes('max_tokens');
  const isCodexMode = provider === 'openai-codex';
  const isSelectedDefault = selectedConfigSetId === activeConfigSetId;
  const selectedProviderValue = providerUnset
    ? ''
    : provider === 'custom'
      ? `custom:${customProtocol}`
      : provider;
  const providerSelectOptions: Array<{ value: string; label: string }> = [
    { value: '', label: t('api.providerEmpty') },
    ...VISIBLE_API_PROVIDER_OPTIONS.map((item) => ({
      value: item,
      label:
        item === 'custom:openai'
          ? t('api.openaiCompatibleLabel')
          : item === 'custom:anthropic'
            ? t('api.anthropicCompatibleLabel')
            : presets[item]?.name || item,
    })),
    ...(provider === 'custom' && customProtocol === 'gemini'
      ? [{ value: 'custom:gemini', label: presets.custom?.name || 'Custom' }]
      : []),
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[6px] border border-border-subtle bg-surface md:flex-row">
      <ApiConfigSetManager
        variant="sidebar"
        showPendingBanner={false}
        {...pickApiConfigSetManagerProps(apiConfigState)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {/* Active scheme header — matches left rail height for a continuous 1px rule */}
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-surface-muted px-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[12.5px] font-semibold text-text-primary">
              {currentConfigSet?.name || t('api.configSet')}
            </h2>
            {isSelectedDefault && (
              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent">
                {t('api.defaultSetTag')}
              </span>
            )}
            {hasUnsavedChanges && (
              <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-warning">
                {t('api.unsavedBadge')}
              </span>
            )}
          </div>
        </div>

        {pendingConfigSetAction && (
          <PendingConfigSetBanner
            pendingConfigSet={pendingConfigSet}
            isMutatingConfigSet={isMutatingConfigSet}
            isSaving={isSaving}
            onSaveAndContinue={saveAndContinuePendingConfigSetAction}
            onDiscardAndContinue={discardAndContinuePendingConfigSetAction}
            onCancel={cancelPendingConfigSetAction}
          />
        )}

        {/* Flush, gapless form body */}
        <div className="scrollbar-hover ui-form-flush min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-border-subtle">
            <ApiSectionHeader icon={<Wifi />} title={t('api.serviceAuth')} />

            <ApiFieldRow label={t('api.provider')}>
              <GlassSelect
                value={selectedProviderValue}
                onValueChange={(value) => {
                  if (value === '') {
                    clearProviderSelection();
                  } else if (value === 'custom:openai') {
                    changeProtocol('openai');
                  } else if (value === 'custom:anthropic') {
                    changeProtocol('anthropic');
                  } else if (value === 'custom:gemini') {
                    changeProtocol('gemini');
                  } else {
                    changeProvider(value as ProviderType);
                  }
                }}
                options={providerSelectOptions}
                triggerClassName="w-full justify-between text-[12.5px] text-text-primary focus-visible:ring-0"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </ApiFieldRow>

            {!providerUnset && provider === 'custom' && customProtocol === 'gemini' && (
              <ApiFieldRow label={t('api.protocol')}>
                <div className="grid min-h-[35px] w-full grid-cols-3 divide-x divide-border-subtle">
                  {(['anthropic', 'openai', 'gemini'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={customProtocol === item}
                      onClick={() => changeProtocol(item)}
                      className={`flex items-center justify-center text-[12px] font-medium transition-colors ${
                        customProtocol === item
                          ? 'bg-accent-muted text-accent'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      {item === 'openai' ? 'OpenAI' : item === 'gemini' ? 'Gemini' : 'Anthropic'}
                    </button>
                  ))}
                </div>
              </ApiFieldRow>
            )}

            {!providerUnset && !isSophronMode && !isCodexMode && !isLmbpMode && (
              <ApiFieldRow label={t('api.apiKey')} valueClassName="!flex-row items-stretch">
                <input
                  id="api-key-input"
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                  className="min-w-0 flex-1 font-mono text-text-primary placeholder:font-sans placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                  aria-label={t('api.apiKey')}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((visible) => !visible)}
                  className="flex w-9 shrink-0 items-center justify-center border-l border-border-subtle text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                  aria-label={showApiKey ? t('api.hideApiKey') : t('api.showApiKey')}
                >
                  {showApiKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </ApiFieldRow>
            )}

            {!providerUnset && isCodexMode && <CodexAuthCard />}
            {!providerUnset && isLmbpMode && (
              <LmbpPairing
                key={selectedConfigSetId}
                selectedModel={model}
                onModels={apiConfigState.applyLmbpModels}
              />
            )}

            {!providerUnset && (provider === 'custom' || isOllamaMode) && (
              <ApiFieldRow label={t('api.baseUrl')} valueClassName="!flex-row items-stretch">
                <input
                  id="api-base-url-input"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={currentPreset?.baseUrl || 'https://api.example.com'}
                  className="min-w-0 flex-1 font-mono text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                  aria-label={t('api.baseUrl')}
                />
                {isOllamaMode && (
                  <button
                    type="button"
                    onClick={() => void discoverLocalOllama()}
                    disabled={isDiscoveringLocalOllama}
                    className="ui-accent-cell w-9 shrink-0 border-l border-border-subtle !px-0"
                    title={t('api.discoverLocalOllama')}
                  >
                    {isDiscoveringLocalOllama ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plug className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </ApiFieldRow>
            )}

            {!providerUnset && provider === 'custom' && (
              <CommonProviderSetupsCard
                flush
                setups={commonProviderSetups}
                onApplySetup={applyCommonProviderSetup}
              />
            )}
          </section>

          <section className="border-b border-border-subtle">
            <ApiSectionHeader icon={<SlidersHorizontal />} title={t('api.modelInference')} />

            {providerUnset ? (
              <p className="px-3 py-3 text-[12px] text-text-muted">
                {t('api.selectProviderFirst')}
              </p>
            ) : (
              <>
                <ApiFieldRow label={t('api.model')} valueClassName="!flex-row items-stretch">
                  <div className="ui-flush-split flex min-w-0 flex-1 items-stretch">
                    <ApiModelSelectorField
                      flush
                      inputId="api-model-input"
                      useCustomModel={useCustomModel}
                      model={model}
                      customModel={customModel}
                      modelOptions={modelOptions as ModelOptionItem[]}
                      modelInputPlaceholder={modelInputPlaceholder}
                      onModelChange={setModel}
                      onCustomModelChange={setCustomModel}
                    />
                  </div>
                  {!isSophronMode && !isCodexMode && !isLmbpMode && (
                    <button
                      type="button"
                      onClick={toggleCustomModel}
                      className={`inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle px-2.5 text-[12px] font-medium transition-colors ${
                        useCustomModel
                          ? 'bg-accent-muted text-accent'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                      title={useCustomModel ? t('api.usePreset') : t('api.customModel')}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">
                        {useCustomModel ? t('api.usePreset') : t('api.customModel')}
                      </span>
                    </button>
                  )}
                  {(isOllamaMode || isSophronMode || isCodexMode || isLmbpMode) &&
                    !useCustomModel && (
                      <button
                        type="button"
                        onClick={() => void refreshModelOptions()}
                        disabled={isRefreshingModels}
                        className="inline-flex w-9 shrink-0 items-center justify-center border-l border-border-subtle text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                        title={t('api.refreshModels')}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`}
                        />
                      </button>
                    )}
                </ApiFieldRow>

                {/* Context window & max output tokens paired flush side by side */}
                <div className="grid grid-cols-1 border-b border-border-subtle lg:grid-cols-2 lg:divide-x lg:divide-border-subtle">
                  <ApiFieldRow label={t('api.contextWindow')} rowClassName="!border-b-0">
                    <input
                      id="api-context-window-input"
                      type="number"
                      value={contextWindow}
                      onChange={(event) => setContextWindow(event.target.value)}
                      placeholder={t('api.contextWindowPlaceholder')}
                      min={1024}
                      step={1024}
                      className="tabular-nums text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                    />
                  </ApiFieldRow>
                  {supportsMaxTokens && (
                    <ApiFieldRow
                      label={t('api.maxOutputTokens')}
                      rowClassName="border-t border-border-subtle !border-b-0 lg:border-t-0"
                    >
                      <input
                        id="api-max-tokens-input"
                        type="number"
                        value={maxTokens}
                        onChange={(event) => setMaxTokens(event.target.value)}
                        placeholder={t('api.maxOutputTokensPlaceholder')}
                        min={256}
                        step={256}
                        className="tabular-nums text-text-primary placeholder:text-text-muted focus:bg-surface-hover/40 focus:outline-none"
                      />
                    </ApiFieldRow>
                  )}
                </div>

                {!isLmbpMode && (
                  <ApiFieldRow label={t('api.thinkingLevel')}>
                    <div
                      role="radiogroup"
                      aria-label={t('api.thinkingLevel')}
                      className="grid min-h-[35px] w-full grid-cols-6 divide-x divide-border-subtle"
                    >
                      {(['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) => {
                        const active =
                          level === 'off'
                            ? !enableThinking
                            : enableThinking && thinkingLevel === level;
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
                            className={`flex items-center justify-center whitespace-nowrap px-1 text-[12px] font-medium transition-colors ${
                              active
                                ? 'bg-accent-muted text-accent'
                                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                            }`}
                          >
                            {t(`api.thinkingLevels.${level}`)}
                          </button>
                        );
                      })}
                    </div>
                  </ApiFieldRow>
                )}
              </>
            )}
          </section>

          {(diagnosticResult || isDiagnosing) && (
            <section className="border-b border-border-subtle p-3">
              <ApiDiagnosticsPanel
                result={diagnosticResult}
                isRunning={isDiagnosing}
                onRunDiagnostics={handleDiagnose}
                onRunDeepDiagnostics={isOllamaMode || isLmbpMode ? handleDeepDiagnose : undefined}
                disabled={requiresApiKey && !apiKey.trim()}
                showActions={false}
              />
            </section>
          )}
        </div>

        {/* Flush, gapless bottom action bar */}
        <div className="flex h-9 shrink-0 items-stretch border-t border-border-subtle bg-surface">
          <div
            className={`flex min-w-0 flex-1 items-center gap-1.5 px-3 text-[12px] font-medium ${
              connectionOk ? 'text-success' : connectionFailed ? 'text-error' : 'text-text-muted'
            }`}
          >
            {connectionOk ? (
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            ) : connectionFailed ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Server className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">
              {connectionOk
                ? t('api.connectionSuccess', { ms: diagnosticResult?.totalLatencyMs || 0 })
                : connectionFailed
                  ? t('api.connectionFailed')
                  : t('api.connectionNotTested')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleDiagnose()}
            disabled={isDiagnosing || providerUnset || (requiresApiKey && !apiKey.trim())}
            className="ui-accent-cell shrink-0 border-l border-border-subtle"
          >
            {isDiagnosing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isDiagnosing ? t('api.diagnostic.running') : t('api.testConnection')}
          </button>

          {(isOllamaMode || isLmbpMode) && (
            <button
              type="button"
              onClick={() => void handleDeepDiagnose()}
              disabled={isDiagnosing || (requiresApiKey && !apiKey.trim())}
              className="ui-accent-cell shrink-0 border-l border-border-subtle"
            >
              <Cpu className="h-3.5 w-3.5" />
              {t('api.diagnostic.runDeepDiagnostics')}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 border-l border-border-subtle bg-accent px-4 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-muted"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? t('common.saving') : t('api.saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}
