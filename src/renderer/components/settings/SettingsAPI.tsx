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
import {
  ApiConfigSetManager,
  PendingConfigSetBanner,
  pickApiConfigSetManagerProps,
} from '../ApiConfigSetManager';
import { ApiModelSelectorField } from './ApiModelSelectorField';
import { GlassSelect } from '../GlassSelect';
import { Button, Input } from '../ui';
import { CommonProviderSetupsCard } from '../ProviderGuidance';
import { CodexAuthCard } from './CodexAuthCard';

interface ModelOptionItem {
  id: string;
  name: string;
}

function ApiSectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="flex h-8 items-center gap-1.5 border-b border-border-subtle bg-surface-muted/80 px-3 text-[11.5px] font-semibold text-text-secondary">
      <span className="flex shrink-0 text-text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      {title}
    </h3>
  );
}

function ApiFieldRow({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-b border-border-subtle ${className}`}
    >
      <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
        {label}
      </span>
      <div className="flex min-w-0 items-center px-3 py-1.5">{children}</div>
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
  const isCodexMode = provider === 'openai-codex';
  const isSelectedDefault = selectedConfigSetId === activeConfigSetId;
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface md:flex-row">
      <ApiConfigSetManager
        variant="sidebar"
        showPendingBanner={false}
        {...pickApiConfigSetManagerProps(apiConfigState)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        {/* Active scheme header */}
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold text-text-primary">
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

        {/* Flush form body */}
        <div className="scrollbar-hover min-h-0 flex-1 overflow-y-auto">
          <section>
            <ApiSectionHeader icon={<Wifi />} title={t('api.serviceAuth')} />

            <ApiFieldRow label={t('api.provider')}>
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
                triggerClassName="h-8 w-full justify-between bg-surface px-2.5 text-[13px] text-text-primary"
                contentClassName="w-[var(--radix-select-trigger-width)]"
              />
            </ApiFieldRow>

            {!providerUnset && provider === 'custom' && (
              <ApiFieldRow label={t('api.protocol')}>
                <div className="inline-flex rounded-lg border border-border-subtle bg-surface-muted p-0.5">
                  {(['anthropic', 'openai', 'gemini'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={customProtocol === item}
                      onClick={() => changeProtocol(item)}
                      className={`h-7 min-w-[76px] rounded-md px-3 text-[12px] font-medium transition-colors ${
                        customProtocol === item
                          ? 'bg-surface text-accent shadow-soft ring-1 ring-accent/25'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item === 'openai' ? 'OpenAI' : item === 'gemini' ? 'Gemini' : 'Anthropic'}
                    </button>
                  ))}
                </div>
              </ApiFieldRow>
            )}

            {!providerUnset && !isSophronMode && !isCodexMode && (
              <ApiFieldRow label={t('api.apiKey')}>
                <div className="relative w-full">
                  <Input
                    id="api-key-input"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={currentPreset?.keyPlaceholder || t('api.enterApiKey')}
                    className="h-8 pr-9"
                    aria-label={t('api.apiKey')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
                    aria-label={showApiKey ? t('api.hideApiKey') : t('api.showApiKey')}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </ApiFieldRow>
            )}

            {!providerUnset && isCodexMode && <CodexAuthCard />}

            {!providerUnset && (provider === 'custom' || isOllamaMode) && (
              <ApiFieldRow label={t('api.baseUrl')}>
                <div className="flex w-full min-w-0 gap-1.5">
                  <Input
                    id="api-base-url-input"
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={currentPreset?.baseUrl || 'https://api.example.com'}
                    className="h-8 min-w-0 flex-1"
                    aria-label={t('api.baseUrl')}
                  />
                  {isOllamaMode && (
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() => void discoverLocalOllama()}
                      disabled={isDiscoveringLocalOllama}
                      className="shrink-0"
                      title={t('api.discoverLocalOllama')}
                    >
                      {isDiscoveringLocalOllama ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plug className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </ApiFieldRow>
            )}

            {!providerUnset && provider === 'custom' && (
              <div className="border-b border-border-subtle px-3 py-2.5">
                <CommonProviderSetupsCard
                  setups={commonProviderSetups}
                  onApplySetup={applyCommonProviderSetup}
                />
              </div>
            )}
          </section>

          <section>
            <ApiSectionHeader icon={<SlidersHorizontal />} title={t('api.modelInference')} />

            {providerUnset ? (
              <p className="px-4 py-4 text-[12.5px] text-text-muted">
                {t('api.selectProviderFirst')}
              </p>
            ) : (
              <>
                <ApiFieldRow label={t('api.model')}>
                  <div className="flex w-full min-w-0 gap-1.5">
                    <div className="min-w-0 flex-1">
                      <ApiModelSelectorField
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
                    {!isSophronMode && !isCodexMode && (
                      <Button
                        variant={useCustomModel ? 'primary' : 'secondary'}
                        onClick={toggleCustomModel}
                        className="h-8 shrink-0 px-2.5 text-[12px]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span className="hidden xl:inline">
                          {useCustomModel ? t('api.usePreset') : t('api.customModel')}
                        </span>
                      </Button>
                    )}
                    {(isOllamaMode || provider === 'sophron' || isCodexMode) && !useCustomModel && (
                      <Button
                        variant="secondary"
                        size="icon"
                        onClick={() => void refreshModelOptions()}
                        disabled={isRefreshingModels}
                        className="shrink-0"
                        title={t('api.refreshModels')}
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`}
                        />
                      </Button>
                    )}
                  </div>
                </ApiFieldRow>

                {/* Context window & max output tokens paired cleanly side by side */}
                <div className="grid grid-cols-1 border-b border-border-subtle lg:grid-cols-2">
                  <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)]">
                    <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
                      {t('api.contextWindow')}
                    </span>
                    <div className="flex min-w-0 items-center px-3 py-1.5">
                      <Input
                        id="api-context-window-input"
                        type="number"
                        value={contextWindow}
                        onChange={(event) => setContextWindow(event.target.value)}
                        placeholder={t('api.contextWindowPlaceholder')}
                        min={1024}
                        step={1024}
                        className="h-8 tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="grid min-h-[40px] min-w-0 grid-cols-[116px_minmax(0,1fr)] border-t border-border-subtle lg:border-l lg:border-t-0">
                    <span className="flex items-center whitespace-nowrap border-r border-border-subtle bg-surface-muted/45 px-3 text-[12px] font-medium text-text-secondary">
                      {t('api.maxOutputTokens')}
                    </span>
                    <div className="flex min-w-0 items-center px-3 py-1.5">
                      <Input
                        id="api-max-tokens-input"
                        type="number"
                        value={maxTokens}
                        onChange={(event) => setMaxTokens(event.target.value)}
                        placeholder={t('api.maxOutputTokensPlaceholder')}
                        min={256}
                        step={256}
                        className="h-8 tabular-nums"
                      />
                    </div>
                  </div>
                </div>

                <ApiFieldRow label={t('api.thinkingLevel')}>
                  <div
                    role="radiogroup"
                    aria-label={t('api.thinkingLevel')}
                    className="inline-flex rounded-lg border border-border-subtle bg-surface-muted p-0.5"
                  >
                    {(['off', 'low', 'medium', 'high'] as const).map((level) => {
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
                          className={`h-7 min-w-[58px] rounded-md px-3 text-[12px] font-medium transition-colors ${
                            active
                              ? 'bg-surface text-accent shadow-soft ring-1 ring-accent/25'
                              : 'text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {t(`api.thinkingLevels.${level}`)}
                        </button>
                      );
                    })}
                  </div>
                </ApiFieldRow>
              </>
            )}
          </section>

          {(diagnosticResult || isDiagnosing) && (
            <section className="border-t border-border-subtle px-4 py-3">
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
        </div>

        {/* Sticky bottom bar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-border-subtle bg-surface-muted/40 px-4 py-2.5">
          <Button
            variant="secondary"
            onClick={() => void handleDiagnose()}
            disabled={isDiagnosing || providerUnset || (requiresApiKey && !apiKey.trim())}
            className="h-8 text-[12.5px]"
          >
            {isDiagnosing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isDiagnosing ? t('api.diagnostic.running') : t('api.testConnection')}
          </Button>
          {isOllamaMode && (
            <Button
              variant="secondary"
              onClick={() => void handleDeepDiagnose()}
              disabled={isDiagnosing || (requiresApiKey && !apiKey.trim())}
              className="h-8 text-[12.5px]"
            >
              <Cpu className="h-3.5 w-3.5" />
              {t('api.diagnostic.runDeepDiagnostics')}
            </Button>
          )}

          <div
            className={`flex min-w-[140px] flex-1 items-center gap-1.5 text-[12px] font-medium ${
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

          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="h-8 px-3.5 text-[12.5px]"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? t('common.saving') : t('api.saveSettings')}
          </Button>
        </div>
      </div>
    </div>
  );
}
