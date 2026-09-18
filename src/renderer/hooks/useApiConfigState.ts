import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderModelInfo,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
  ThinkingLevel,
} from '../types';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl } from '../../shared/ollama-base-url';
import { getModelInputGuidance } from '../../shared/api-model-presets';
import {
  COMMON_PROVIDER_SETUPS,
  detectCommonProviderSetup,
  getFallbackOpenAISetup,
  isParsableBaseUrl,
  orderCommonProviderSetups,
  resolveProviderGuidanceErrorHint,
  type CommonProviderSetup,
} from '../../shared/api-provider-guidance';
import { apiConfigReducer } from './api-config-reducer';
import type { ApiConfigState } from './api-config-reducer';
import {
  CONFIG_SET_LIMIT,
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigBootstrap,
  buildApiConfigDraftSignature,
  buildSnapshotFromConfigSet,
  buildSetupModelState,
  defaultProfileForKey,
  isCustomAnthropicLoopbackGateway,
  isCustomGeminiLoopbackGateway,
  isCustomOpenAiLoopbackGateway,
  isElectron,
  modelPresetForProfile,
  normalizeDiscoveredOllamaModels,
  normalizeThinkingLevel,
  profileKeyFromProvider,
  profileKeyToProvider,
  protocolLabel,
  providerTabLabel,
  toPersistedProfiles,
  translateApiConfigErrorMessage,
} from './api-config-model';
import type {
  ApiConfigBootstrap,
  CreateMode,
  PendingConfigSetAction,
  UIProviderProfile,
  UseApiConfigStateOptions,
} from './api-config-model';

export { getModelInputGuidance } from '../../shared/api-model-presets';
export {
  FALLBACK_PROVIDER_PRESETS,
  buildApiConfigBootstrap,
  buildApiConfigDraftSignature,
  buildApiConfigSets,
  buildApiConfigSnapshot,
  isCustomAnthropicLoopbackGateway,
  isCustomGeminiLoopbackGateway,
  isCustomOpenAiLoopbackGateway,
  profileKeyFromProvider,
  profileKeyToProvider,
} from './api-config-model';
export type {
  UIProviderProfile,
  ConfigStateSnapshot,
  ApiConfigBootstrap,
} from './api-config-model';

export function useApiConfigState(options: UseApiConfigStateOptions = {}) {
  const { t } = useTranslation();
  const { enabled = true, initialConfig, onSave } = options;
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const initialBootstrapRef = useRef<ApiConfigBootstrap | null>(null);
  if (!initialBootstrapRef.current) {
    initialBootstrapRef.current = buildApiConfigBootstrap(initialConfig, FALLBACK_PROVIDER_PRESETS);
  }
  const initialBootstrap = initialBootstrapRef.current;

  const initialLastCustomProtocol: CustomProtocolType =
    initialConfig?.customProtocol === 'openai'
      ? 'openai'
      : initialConfig?.customProtocol === 'gemini'
        ? 'gemini'
        : 'anthropic';

  const [state, dispatch] = useReducer(
    apiConfigReducer,
    undefined,
    (): ApiConfigState => ({
      presets: FALLBACK_PROVIDER_PRESETS,
      profiles: initialBootstrap.snapshot.profiles,
      activeProfileKey: initialBootstrap.snapshot.activeProfileKey,
      providerUnset:
        initialBootstrap.configSets.find((set) => set.id === initialBootstrap.activeConfigSetId)
          ?.provider === '',
      configSets: initialBootstrap.configSets,
      activeConfigSetId: initialBootstrap.activeConfigSetId,
      selectedConfigSetId: initialBootstrap.activeConfigSetId,
      pendingConfigSetAction: null,
      isMutatingConfigSet: false,
      lastCustomProtocol: initialLastCustomProtocol,
      enableThinking: Boolean(initialConfig?.enableThinking),
      thinkingLevel: normalizeThinkingLevel(initialConfig?.thinkingLevel, 'medium'),
      discoveredModels: {},
      isLoadingConfig: true,
      savedDraftSignature: '',
      isSaving: false,
      isTesting: false,
      isRefreshingModels: false,
      isDiscoveringLocalOllama: false,
      errorText: '',
      errorKey: null,
      errorValues: undefined,
      successText: '',
      successKey: null,
      successValues: undefined,
      lastSaveCompletedAt: 0,
      testResult: null,
      diagnosticResult: null,
      isDiagnosing: false,
    })
  );

  // Destructure state for convenience — avoids `state.X` in every expression
  const {
    presets,
    profiles,
    activeProfileKey,
    providerUnset,
    configSets,
    activeConfigSetId,
    selectedConfigSetId,
    pendingConfigSetAction,
    isMutatingConfigSet,
    lastCustomProtocol,
    enableThinking,
    thinkingLevel,
    discoveredModels,
    isLoadingConfig,
    savedDraftSignature,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    errorText,
    errorKey,
    errorValues,
    successText,
    successKey,
    successValues,
    lastSaveCompletedAt,
    testResult,
    diagnosticResult,
    isDiagnosing,
  } = state;

  const ollamaRefreshRequestIdRef = useRef(0);
  const selectedConfigSetIdRef = useRef(selectedConfigSetId);
  const hasAppliedLoadedStateRef = useRef(false);
  useEffect(() => {
    selectedConfigSetIdRef.current = selectedConfigSetId;
  }, [selectedConfigSetId]);
  const latestOllamaTargetRef = useRef<{
    activeProfileKey: ProviderProfileKey;
    baseUrl: string;
    provider: ProviderType;
  }>({
    activeProfileKey,
    baseUrl: '',
    provider: 'deepseek',
  });
  const ollamaDiscoverRequestIdRef = useRef(0);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const showErrorKey = useCallback((key: string, values?: Record<string, string | number>) => {
    dispatch({ type: 'SET_ERROR_KEY', key, values });
  }, []);

  const showErrorText = useCallback((text: string) => {
    dispatch({ type: 'SET_ERROR_TEXT', text });
  }, []);

  const clearSuccessMessage = useCallback(() => {
    dispatch({ type: 'CLEAR_SUCCESS' });
  }, []);

  const showSuccessKey = useCallback((key: string, values?: Record<string, string | number>) => {
    dispatch({ type: 'SET_SUCCESS_KEY', key, values });
  }, []);

  const showSuccessText = useCallback((text: string) => {
    dispatch({ type: 'SET_SUCCESS_TEXT', text });
  }, []);

  const error = errorKey ? t(errorKey, errorValues) : errorText;
  const successMessage = successKey ? t(successKey, successValues) : successText;

  const providerMeta = useMemo(() => profileKeyToProvider(activeProfileKey), [activeProfileKey]);
  const provider = providerMeta.provider;
  const customProtocol = providerMeta.customProtocol;
  const currentProfile =
    profiles[activeProfileKey] || defaultProfileForKey(activeProfileKey, presets);
  const modelPreset = modelPresetForProfile(activeProfileKey, presets);
  const currentPreset = modelPreset;
  const usesDiscoveredModelOptions = provider === 'ollama' || provider === 'sophron';
  const hasDiscoveredModelOptions =
    usesDiscoveredModelOptions &&
    Object.prototype.hasOwnProperty.call(discoveredModels, activeProfileKey);
  const modelOptions = useMemo(
    () =>
      provider === 'ollama'
        ? discoveredModels[activeProfileKey] || []
        : hasDiscoveredModelOptions
          ? discoveredModels[activeProfileKey] || []
          : modelPreset.models,
    [activeProfileKey, discoveredModels, hasDiscoveredModelOptions, modelPreset.models, provider]
  );
  const modelInputGuidance = getModelInputGuidance(provider, customProtocol);

  const currentConfigSet = useMemo(
    () => configSets.find((set) => set.id === selectedConfigSetId) || null,
    [configSets, selectedConfigSetId]
  );
  const pendingConfigSet = useMemo(
    () =>
      pendingConfigSetAction
        ? configSets.find((set) => set.id === pendingConfigSetAction.targetSetId) || null
        : null,
    [configSets, pendingConfigSetAction]
  );

  const apiKey = currentProfile.apiKey;
  const baseUrl = currentProfile.baseUrl;
  const model = currentProfile.model;
  const customModel = currentProfile.customModel;
  const useCustomModel = currentProfile.useCustomModel;
  const shouldShowOllamaManualModelToggle =
    provider !== 'ollama' || useCustomModel || Boolean(error) || modelOptions.length === 0;
  const contextWindow = currentProfile.contextWindow;
  const maxTokens = currentProfile.maxTokens;
  const detectedProviderSetup = useMemo(
    () => (provider === 'custom' ? detectCommonProviderSetup(baseUrl) : null),
    [baseUrl, provider]
  );
  const fallbackOpenAISetup = useMemo(() => getFallbackOpenAISetup(), []);
  const effectiveProviderSetup = useMemo(() => {
    if (detectedProviderSetup) {
      return detectedProviderSetup;
    }
    if (
      provider === 'custom' &&
      customProtocol === 'openai' &&
      baseUrl.trim() &&
      isParsableBaseUrl(baseUrl)
    ) {
      return fallbackOpenAISetup;
    }
    return null;
  }, [baseUrl, customProtocol, detectedProviderSetup, fallbackOpenAISetup, provider]);
  const setupDisplayProtocol = useCallback(
    (setup: CommonProviderSetup) =>
      setup.protocolLabel || protocolLabel(setup.recommendedProtocol, t),
    [t]
  );
  const protocolGuidanceTone = useMemo<'info' | 'warning' | undefined>(() => {
    if (provider !== 'custom' || !detectedProviderSetup) {
      return undefined;
    }
    if (detectedProviderSetup.preferProviderTab) {
      return 'warning';
    }
    return customProtocol === detectedProviderSetup.recommendedProtocol ? 'info' : 'warning';
  }, [customProtocol, detectedProviderSetup, provider]);
  const protocolGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !detectedProviderSetup) {
      return '';
    }

    const serviceName = t(detectedProviderSetup.nameKey);
    if (detectedProviderSetup.preferProviderTab) {
      return t('api.guidance.preferProviderTab', {
        service: serviceName,
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    }

    if (customProtocol !== detectedProviderSetup.recommendedProtocol) {
      return t('api.guidance.protocolMismatch', {
        service: serviceName,
        recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
      });
    }

    return t('api.guidance.protocolLooksGood', {
      service: serviceName,
      recommendedProtocol: setupDisplayProtocol(detectedProviderSetup),
    });
  }, [customProtocol, detectedProviderSetup, presets, provider, setupDisplayProtocol, t]);
  const baseUrlGuidanceText = useMemo(() => {
    if (provider !== 'custom' || !effectiveProviderSetup) {
      return '';
    }

    if (!detectedProviderSetup && effectiveProviderSetup.id === fallbackOpenAISetup.id) {
      return t('api.guidance.genericBaseUrlHint', {
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
        baseUrl: effectiveProviderSetup.recommendedBaseUrl,
        model: effectiveProviderSetup.exampleModel,
      });
    }

    return t('api.guidance.baseUrlHint', {
      service: t(effectiveProviderSetup.nameKey),
      recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      baseUrl: effectiveProviderSetup.recommendedBaseUrl,
      model: effectiveProviderSetup.exampleModel,
    });
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    fallbackOpenAISetup.id,
    provider,
    setupDisplayProtocol,
    t,
  ]);
  const commonProviderSetups = useMemo(
    () =>
      provider === 'custom'
        ? orderCommonProviderSetups(detectedProviderSetup?.id).map((setup) => ({
            id: setup.id,
            name: t(setup.nameKey),
            protocolLabel: setupDisplayProtocol(setup),
            baseUrl: setup.recommendedBaseUrl,
            exampleModel: setup.exampleModel,
            notes: t(setup.noteKey),
            isDetected: setup.id === detectedProviderSetup?.id,
          }))
        : [],
    [detectedProviderSetup?.id, provider, setupDisplayProtocol, t]
  );
  const friendlyTestDetails = useMemo(() => {
    const hintKind = resolveProviderGuidanceErrorHint(testResult?.details, detectedProviderSetup);
    if (!hintKind) {
      return '';
    }

    if (hintKind === 'emptyProbePreferProvider' && detectedProviderSetup?.preferProviderTab) {
      return t('api.guidance.errorHints.emptyProbePreferProvider', {
        service: t(detectedProviderSetup.nameKey),
        provider: providerTabLabel(detectedProviderSetup.preferProviderTab, presets, t),
      });
    }
    if (hintKind === 'emptyProbeDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.emptyProbeDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    if (hintKind === 'emptyProbeGeneric') {
      return t('api.guidance.errorHints.emptyProbeGeneric');
    }
    if (hintKind === 'probeMismatchDetected' && effectiveProviderSetup) {
      return t('api.guidance.errorHints.probeMismatchDetected', {
        service: t(effectiveProviderSetup.nameKey),
        recommendedProtocol: setupDisplayProtocol(effectiveProviderSetup),
      });
    }
    if (hintKind === 'probeMismatchGeneric') {
      return t('api.guidance.errorHints.probeMismatchGeneric');
    }

    return '';
  }, [
    detectedProviderSetup,
    effectiveProviderSetup,
    presets,
    setupDisplayProtocol,
    t,
    testResult?.details,
  ]);

  const allowEmptyApiKey =
    provider === 'sophron' ||
    provider === 'ollama' ||
    provider === 'openai-codex' ||
    (provider === 'custom' &&
      ((customProtocol === 'anthropic' && isCustomAnthropicLoopbackGateway(baseUrl)) ||
        (customProtocol === 'openai' && isCustomOpenAiLoopbackGateway(baseUrl)) ||
        (customProtocol === 'gemini' && isCustomGeminiLoopbackGateway(baseUrl))));
  const requiresApiKey = !allowEmptyApiKey;
  const currentDraftSignature = useMemo(
    () =>
      buildApiConfigDraftSignature(
        activeProfileKey,
        profiles,
        enableThinking,
        thinkingLevel,
        providerUnset
      ),
    [activeProfileKey, profiles, enableThinking, thinkingLevel, providerUnset]
  );
  const hasUnsavedChanges =
    savedDraftSignature !== '' && currentDraftSignature !== savedDraftSignature;

  const applyLoadedState = useCallback(
    (
      config: AppConfig | null | undefined,
      loadedPresets: ProviderPresets,
      requestedSelectedConfigSetId?: string
    ) => {
      const bootstrap = buildApiConfigBootstrap(config, loadedPresets);

      // The initial reducer state may be only a placeholder before config.get()
      // resolves. On the first real load, select the persisted active set;
      // later refreshes preserve the user's editor selection.
      const candidateSelectedId =
        requestedSelectedConfigSetId ??
        (hasAppliedLoadedStateRef.current
          ? selectedConfigSetIdRef.current
          : bootstrap.activeConfigSetId);
      const selectedConfigSetId = bootstrap.configSets.some((set) => set.id === candidateSelectedId)
        ? (candidateSelectedId as string)
        : bootstrap.activeConfigSetId;
      selectedConfigSetIdRef.current = selectedConfigSetId;
      hasAppliedLoadedStateRef.current = true;
      const selectedSet =
        bootstrap.configSets.find((set) => set.id === selectedConfigSetId) ?? null;
      const snapshot =
        selectedSet && selectedConfigSetId !== bootstrap.activeConfigSetId
          ? buildSnapshotFromConfigSet(selectedSet, loadedPresets)
          : bootstrap.snapshot;
      const loadedProviderUnset = selectedSet?.provider === '' || snapshot.providerUnset;

      const selectedMeta = profileKeyToProvider(snapshot.activeProfileKey);
      const resolvedLastCustomProtocol: CustomProtocolType =
        selectedMeta.provider === 'custom'
          ? selectedMeta.customProtocol
          : config?.customProtocol === 'openai'
            ? 'openai'
            : config?.customProtocol === 'gemini'
              ? 'gemini'
              : 'anthropic';

      dispatch({
        type: 'APPLY_LOADED_STATE',
        payload: {
          presets: loadedPresets,
          profiles: snapshot.profiles,
          activeProfileKey: snapshot.activeProfileKey,
          providerUnset: loadedProviderUnset,
          enableThinking: snapshot.enableThinking,
          thinkingLevel: snapshot.thinkingLevel,
          configSets: bootstrap.configSets,
          activeConfigSetId: bootstrap.activeConfigSetId,
          selectedConfigSetId,
          lastCustomProtocol: resolvedLastCustomProtocol,
          savedDraftSignature: buildApiConfigDraftSignature(
            snapshot.activeProfileKey,
            snapshot.profiles,
            snapshot.enableThinking,
            snapshot.thinkingLevel,
            loadedProviderUnset
          ),
        },
      });
    },
    []
  );

  const applyPersistedConfigToStore = useCallback(
    (config: AppConfig, loadedPresets: ProviderPresets, selectedId?: string) => {
      applyLoadedState(config, loadedPresets, selectedId);
      setAppConfig(config);
      setIsConfigured(Boolean(config.isConfigured));
    },
    [applyLoadedState, setAppConfig, setIsConfigured]
  );

  const updateActiveProfile = useCallback(
    (updater: (prev: UIProviderProfile) => UIProviderProfile) => {
      dispatch({ type: 'UPDATE_PROFILE_FN', profileKey: activeProfileKey, updater });
    },
    [activeProfileKey]
  );

  const changeProvider = useCallback(
    (newProvider: ProviderType) => {
      const nextProfileKey = profileKeyFromProvider(
        newProvider,
        newProvider === 'custom' ? lastCustomProtocol : 'anthropic'
      );
      dispatch({ type: 'SET_ACTIVE_PROFILE_KEY', payload: nextProfileKey });
    },
    [lastCustomProtocol]
  );

  const clearProviderSelection = useCallback(() => {
    dispatch({ type: 'SET_PROVIDER_UNSET', payload: true });
  }, []);

  const changeProtocol = useCallback((newProtocol: CustomProtocolType) => {
    dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: newProtocol });
    dispatch({
      type: 'SET_ACTIVE_PROFILE_KEY',
      payload: profileKeyFromProvider('custom', newProtocol),
    });
  }, []);

  const setApiKey = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, apiKey: value }));
    },
    [updateActiveProfile]
  );

  const setBaseUrl = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, baseUrl: value }));
    },
    [updateActiveProfile]
  );

  const setModel = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, model: value, useCustomModel: false }));
    },
    [updateActiveProfile]
  );

  const setCustomModel = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, customModel: value, useCustomModel: true }));
    },
    [updateActiveProfile]
  );

  const setContextWindow = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, contextWindow: value }));
    },
    [updateActiveProfile]
  );

  const setMaxTokens = useCallback(
    (value: string) => {
      updateActiveProfile((prev) => ({ ...prev, maxTokens: value }));
    },
    [updateActiveProfile]
  );

  const applyCommonProviderSetup = useCallback(
    (setupId: string) => {
      const setup = COMMON_PROVIDER_SETUPS.find((item) => item.id === setupId);
      if (!setup) {
        return;
      }

      const nextProvider = setup.applyProvider;
      const nextProfileKey = profileKeyFromProvider(nextProvider, setup.recommendedProtocol);
      const nextModelState = buildSetupModelState(setup, nextProfileKey, presets);

      if (nextProvider === 'custom') {
        dispatch({ type: 'SET_LAST_CUSTOM_PROTOCOL', payload: setup.recommendedProtocol });
      }

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: nextProfileKey,
        updater: (current) => ({
          ...current,
          baseUrl: setup.recommendedBaseUrl,
          ...nextModelState,
        }),
      });
      dispatch({ type: 'SET_ACTIVE_PROFILE_KEY', payload: nextProfileKey });
    },
    [presets]
  );

  const toggleCustomModel = useCallback(() => {
    updateActiveProfile((prev) => {
      if (!prev.useCustomModel) {
        return {
          ...prev,
          useCustomModel: true,
          customModel: prev.customModel || prev.model,
        };
      }
      return {
        ...prev,
        useCustomModel: false,
        model: modelOptions.some((option) => option.id === prev.model)
          ? prev.model
          : modelOptions[0]?.id || prev.model,
      };
    });
  }, [modelOptions, updateActiveProfile]);

  // Public setter exposed to consumers — wraps dispatch so the interface stays stable
  const setEnableThinking = useCallback((value: boolean) => {
    dispatch({ type: 'SET_ENABLE_THINKING', payload: value });
  }, []);

  const setThinkingLevel = useCallback((value: ThinkingLevel) => {
    dispatch({ type: 'SET_THINKING_LEVEL', payload: value });
  }, []);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: 0 });
      return;
    }

    let cancelled = false;
    async function load() {
      dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: true });
      try {
        const loadedPresets = isElectron
          ? await window.electronAPI.config.getPresets()
          : FALLBACK_PROVIDER_PRESETS;
        const config = initialConfig || (isElectron ? await window.electronAPI.config.get() : null);
        if (cancelled) {
          return;
        }
        applyLoadedState(config, loadedPresets);
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to load API config:', loadError);
          applyLoadedState(initialConfig, FALLBACK_PROVIDER_PRESETS);
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: 'SET_IS_LOADING_CONFIG', payload: false });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, initialConfig, applyLoadedState]);

  useEffect(() => {
    clearError();
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
  }, [
    activeConfigSetId,
    selectedConfigSetId,
    activeProfileKey,
    apiKey,
    baseUrl,
    clearError,
    customModel,
    model,
    useCustomModel,
  ]);

  useEffect(() => {
    latestOllamaTargetRef.current = {
      activeProfileKey,
      baseUrl: baseUrl.trim(),
      provider,
    };
  }, [activeProfileKey, baseUrl, provider]);

  useEffect(() => {
    if (provider !== 'ollama') {
      return;
    }
    // Drop stale discovered model list when baseUrl changes
    dispatch({ type: 'DELETE_DISCOVERED_MODELS', profileKey: activeProfileKey });

    // If the current model came from discovered models and is not in presets,
    // reset to an endpoint-selected model once discovery runs again.
    const preset = modelPresetForProfile(activeProfileKey, presets);
    dispatch({
      type: 'UPDATE_PROFILE_FN',
      profileKey: activeProfileKey,
      updater: (current) => {
        if (current && !current.useCustomModel && current.model) {
          const inPreset = preset.models.some((m) => m.id === current.model);
          if (!inPreset) {
            return {
              ...current,
              model: provider === 'ollama' ? '' : preset.models[0]?.id || '',
            };
          }
        }
        return current;
      },
    });
  }, [activeProfileKey, baseUrl, provider, presets]);

  const handleTest = useCallback(async () => {
    if (requiresApiKey && !apiKey.trim()) {
      showErrorKey('api.testError.missing_key');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      showErrorKey('api.selectModelRequired');
      return;
    }

    if (provider === 'ollama' && !baseUrl.trim()) {
      showErrorKey('api.testError.missing_base_url');
      return;
    }

    clearError();
    dispatch({ type: 'SET_IS_TESTING', payload: true });
    dispatch({ type: 'SET_TEST_RESULT', payload: null });
    try {
      const resolvedBaseUrl =
        provider === 'custom' || provider === 'ollama'
          ? baseUrl.trim()
          : (baseUrl.trim() || currentPreset.baseUrl || '').trim();

      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
      });
      dispatch({ type: 'SET_TEST_RESULT', payload: result });
      if (result.ok && hasUnsavedChanges) {
        showSuccessKey('api.testSuccessNeedSave');
        setTimeout(() => clearSuccessMessage(), 2500);
      }
    } catch (testError) {
      dispatch({
        type: 'SET_TEST_RESULT',
        payload: {
          ok: false,
          errorType: 'unknown',
          details: testError instanceof Error ? testError.message : String(testError),
        },
      });
    } finally {
      dispatch({ type: 'SET_IS_TESTING', payload: false });
    }
  }, [
    apiKey,
    baseUrl,
    currentPreset.baseUrl,
    customModel,
    customProtocol,
    model,
    provider,
    requiresApiKey,
    hasUnsavedChanges,
    clearError,
    clearSuccessMessage,
    useCustomModel,
    showErrorKey,
    showSuccessKey,
  ]);

  const handleDiagnose = useCallback(
    async (verificationLevel: 'fast' | 'deep' = 'fast') => {
      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return;
      }

      clearError();
      dispatch({ type: 'SET_IS_DIAGNOSING', payload: true });
      dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: null });
      dispatch({ type: 'SET_TEST_RESULT', payload: null });
      try {
        const resolvedBaseUrl =
          provider === 'custom' || provider === 'ollama'
            ? baseUrl.trim()
            : (baseUrl.trim() || currentPreset.baseUrl || '').trim();

        const finalModel = useCustomModel ? customModel.trim() : model;

        const result = await window.electronAPI.config.diagnose({
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolvedBaseUrl || undefined,
          customProtocol,
          model: finalModel || undefined,
          verificationLevel,
        });
        dispatch({ type: 'SET_DIAGNOSTIC_RESULT', payload: result });
      } catch (err) {
        showErrorText((err as Error).message || 'Diagnosis failed');
      } finally {
        dispatch({ type: 'SET_IS_DIAGNOSING', payload: false });
      }
    },
    [
      requiresApiKey,
      apiKey,
      baseUrl,
      provider,
      customProtocol,
      model,
      customModel,
      useCustomModel,
      currentPreset.baseUrl,
      clearError,
      showErrorKey,
      showErrorText,
    ]
  );

  const handleDeepDiagnose = useCallback(async () => {
    await handleDiagnose('deep');
  }, [handleDiagnose]);

  const refreshModelOptions = useCallback(async () => {
    if (!isElectron || (provider !== 'ollama' && provider !== 'sophron')) {
      return [];
    }

    const requestedProfileKey = activeProfileKey;
    const requestedBaseUrl = baseUrl.trim();
    const requestId = ++ollamaRefreshRequestIdRef.current;

    dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: true });
    clearError();
    try {
      const models = await window.electronAPI.config.listModels({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: requestedBaseUrl || undefined,
      });

      const latestTarget = latestOllamaTargetRef.current;
      if (
        requestId !== ollamaRefreshRequestIdRef.current ||
        latestTarget.provider !== provider ||
        latestTarget.activeProfileKey !== requestedProfileKey ||
        latestTarget.baseUrl !== requestedBaseUrl
      ) {
        return models;
      }

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: requestedProfileKey, models });

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: requestedProfileKey,
        updater: (current) => {
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(models[0]?.id) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            model: shouldAutoSelectModel ? models[0]!.id : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });
      return models;
    } catch (refreshError) {
      const latestTarget = latestOllamaTargetRef.current;
      if (
        requestId !== ollamaRefreshRequestIdRef.current ||
        latestTarget.provider !== provider ||
        latestTarget.activeProfileKey !== requestedProfileKey ||
        latestTarget.baseUrl !== requestedBaseUrl
      ) {
        return [];
      }
      dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
      if (refreshError instanceof Error) {
        showErrorText(refreshError.message);
      } else {
        showErrorKey('api.refreshModelsFailed');
      }
      return [];
    } finally {
      if (requestId === ollamaRefreshRequestIdRef.current) {
        dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: false });
      }
    }
  }, [activeProfileKey, apiKey, baseUrl, provider, clearError, showErrorKey, showErrorText]);

  const applyDiscoveredOllamaState = useCallback(
    (
      targetProfileKey: ProviderProfileKey,
      discoveredBaseUrl: string,
      models: ProviderModelInfo[],
      options?: { autoSelectModelId?: string }
    ) => {
      const normalizedBaseUrl =
        normalizeOllamaBaseUrl(discoveredBaseUrl) || DEFAULT_OLLAMA_BASE_URL;

      dispatch({
        type: 'UPDATE_PROFILE_FN',
        profileKey: targetProfileKey,
        updater: (current) => {
          const autoSelectModelId = options?.autoSelectModelId?.trim() || '';
          const explicitManualModel = current.useCustomModel ? current.customModel.trim() : '';
          const currentModel = explicitManualModel || current.model.trim();
          const hasDiscoveredMatch = models.some((item) => item.id === currentModel);
          const shouldAutoSelectModel =
            Boolean(autoSelectModelId) &&
            !explicitManualModel &&
            (!currentModel || !hasDiscoveredMatch);

          return {
            ...current,
            baseUrl: normalizedBaseUrl,
            model: shouldAutoSelectModel ? autoSelectModelId : current.model,
            useCustomModel: shouldAutoSelectModel ? false : current.useCustomModel,
          };
        },
      });

      dispatch({ type: 'SET_DISCOVERED_MODELS', profileKey: targetProfileKey, models });
    },
    []
  );

  const discoverLocalOllama = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isElectron || provider !== 'ollama') {
        return null;
      }

      const requestedProfileKey = activeProfileKey;
      const requestedBaseUrl = baseUrl.trim();
      const shouldClearDiscoveredModels = !requestedBaseUrl || isLoopbackBaseUrl(requestedBaseUrl);
      const requestId = ++ollamaDiscoverRequestIdRef.current;
      dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: true });
      if (!options?.silent) {
        clearError();
      }

      try {
        const result = await window.electronAPI.config.discoverLocal({
          baseUrl: requestedBaseUrl || undefined,
        });
        const latestTarget = latestOllamaTargetRef.current;
        if (
          requestId !== ollamaDiscoverRequestIdRef.current ||
          latestTarget.provider !== 'ollama' ||
          latestTarget.activeProfileKey !== requestedProfileKey ||
          latestTarget.baseUrl !== requestedBaseUrl
        ) {
          return result;
        }
        if (!result.available) {
          if (shouldClearDiscoveredModels) {
            dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
          }
          if (!options?.silent) {
            showErrorKey('api.localOllamaNotFound');
          }
          return result;
        }

        const models = normalizeDiscoveredOllamaModels(result.models);
        applyDiscoveredOllamaState(requestedProfileKey, result.baseUrl, models, {
          autoSelectModelId: models[0]?.id,
        });

        if (!options?.silent) {
          if (result.status === 'service_available') {
            showErrorKey('api.localOllamaNoModels');
          } else {
            showSuccessKey('api.localOllamaDiscovered', { count: models.length });
            setTimeout(() => clearSuccessMessage(), 2500);
          }
        }
        return result;
      } catch (discoveryError) {
        const latestTarget = latestOllamaTargetRef.current;
        if (
          requestId !== ollamaDiscoverRequestIdRef.current ||
          latestTarget.provider !== 'ollama' ||
          latestTarget.activeProfileKey !== requestedProfileKey ||
          latestTarget.baseUrl !== requestedBaseUrl
        ) {
          return null;
        }
        if (shouldClearDiscoveredModels) {
          dispatch({ type: 'CLEAR_DISCOVERED_MODELS', profileKey: requestedProfileKey });
        }
        if (!options?.silent) {
          if (discoveryError instanceof Error) {
            showErrorText(discoveryError.message);
          } else {
            showErrorKey('api.localOllamaNotFound');
          }
        }
        return null;
      } finally {
        if (requestId === ollamaDiscoverRequestIdRef.current) {
          dispatch({ type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA', payload: false });
        }
      }
    },
    [
      activeProfileKey,
      applyDiscoveredOllamaState,
      baseUrl,
      clearError,
      clearSuccessMessage,
      provider,
      showErrorKey,
      showErrorText,
      showSuccessKey,
    ]
  );

  // Auto-refresh model list when Ollama baseUrl changes (debounced).
  // Only fires for URLs that look plausible (start with http(s):// and have a host).
  useEffect(() => {
    if (provider !== 'ollama') return;
    const trimmed = baseUrl.trim();
    if (!trimmed || !/^https?:\/\/.{3,}/i.test(trimmed)) return;
    const timer = setTimeout(() => {
      void refreshModelOptions();
    }, 800);
    return () => clearTimeout(timer);
  }, [provider, baseUrl, refreshModelOptions]);

  useEffect(() => {
    if (provider !== 'sophron') return;
    void refreshModelOptions();
  }, [provider, refreshModelOptions]);

  const handleSave = useCallback(
    async (options?: { silentSuccess?: boolean }) => {
      if (providerUnset) {
        showErrorKey('api.providerRequired');
        return false;
      }

      if (requiresApiKey && !apiKey.trim()) {
        showErrorKey('api.testError.missing_key');
        return false;
      }

      const finalModel = useCustomModel ? customModel.trim() : model;
      if (!finalModel) {
        showErrorKey('api.selectModelRequired');
        return false;
      }

      if (provider === 'ollama' && !baseUrl.trim()) {
        showErrorKey('api.testError.missing_base_url');
        return false;
      }

      clearError();
      dispatch({ type: 'SET_IS_SAVING', payload: true });
      try {
        const resolvedBaseUrl =
          provider === 'custom' || provider === 'ollama'
            ? baseUrl.trim()
            : (baseUrl.trim() || currentPreset.baseUrl || '').trim();

        const persistedProfiles = toPersistedProfiles(profiles);

        const payload: Partial<AppConfig> = {
          provider,
          apiKey: apiKey.trim(),
          baseUrl: resolvedBaseUrl || undefined,
          customProtocol,
          model: finalModel,
          activeProfileKey,
          profiles: persistedProfiles,
          enableThinking,
          thinkingLevel,
        };

        const isEditingDefaultSet = selectedConfigSetId === activeConfigSetId;
        if (!isEditingDefaultSet && isElectron && window.electronAPI?.config?.updateSet) {
          // Editing a non-default set: persist into that set only, keeping the
          // default set untouched.
          const result = await window.electronAPI.config.updateSet({
            id: selectedConfigSetId,
            updates: payload,
          });
          applyPersistedConfigToStore(result.config, presets, selectedConfigSetId);
        } else {
          const savePayload = { ...payload, activeConfigSetId };
          if (onSave) {
            await onSave(savePayload);
          } else {
            const result = await window.electronAPI.config.save(savePayload);
            applyPersistedConfigToStore(result.config, presets);
          }
        }

        dispatch({ type: 'SET_SAVED_DRAFT_SIGNATURE', payload: currentDraftSignature });
        if (!options?.silentSuccess) {
          showSuccessKey('common.saved');
          dispatch({ type: 'SET_LAST_SAVE_COMPLETED_AT', payload: Date.now() });
          setTimeout(() => clearSuccessMessage(), 2000);
        }
        return true;
      } catch (saveError) {
        if (saveError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(saveError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_SAVING', payload: false });
      }
    },
    [
      activeConfigSetId,
      selectedConfigSetId,
      activeProfileKey,
      apiKey,
      applyPersistedConfigToStore,
      baseUrl,
      currentDraftSignature,
      currentPreset.baseUrl,
      customModel,
      customProtocol,
      enableThinking,
      thinkingLevel,
      model,
      onSave,
      presets,
      profiles,
      provider,
      providerUnset,
      requiresApiKey,
      clearError,
      clearSuccessMessage,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
      useCustomModel,
    ]
  );

  const switchConfigSet = useCallback(
    async (setId: string) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.switchSet({ id: setId });
        // Setting the default also brings that set into the editor.
        applyPersistedConfigToStore(result.config, presets, setId);
        return true;
      } catch (switchError) {
        if (switchError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(switchError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [applyPersistedConfigToStore, clearError, presets, showErrorKey, showErrorText, t]
  );

  const selectConfigSet = useCallback(
    (setId: string) => {
      const target = configSets.find((set) => set.id === setId);
      if (!target || setId === selectedConfigSetId) return;
      selectedConfigSetIdRef.current = setId;
      const snapshot = buildSnapshotFromConfigSet(target, presets);
      const selectedMeta = profileKeyToProvider(snapshot.activeProfileKey);
      dispatch({
        type: 'APPLY_LOADED_STATE',
        payload: {
          presets,
          profiles: snapshot.profiles,
          activeProfileKey: snapshot.activeProfileKey,
          providerUnset: target.provider === '',
          enableThinking: snapshot.enableThinking,
          thinkingLevel: snapshot.thinkingLevel,
          configSets,
          activeConfigSetId,
          selectedConfigSetId: setId,
          lastCustomProtocol:
            selectedMeta.provider === 'custom' ? selectedMeta.customProtocol : lastCustomProtocol,
          savedDraftSignature: buildApiConfigDraftSignature(
            snapshot.activeProfileKey,
            snapshot.profiles,
            snapshot.enableThinking,
            snapshot.thinkingLevel,
            snapshot.providerUnset
          ),
        },
      });
    },
    [activeConfigSetId, configSets, lastCustomProtocol, presets, selectedConfigSetId]
  );

  const requestSelectConfigSet = useCallback(
    (setId: string) => {
      if (!setId || setId === selectedConfigSetId) {
        return;
      }

      const action: PendingConfigSetAction = { type: 'select', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }

      selectConfigSet(setId);
    },
    [hasUnsavedChanges, selectConfigSet, selectedConfigSetId]
  );

  const createConfigSet = useCallback(
    async (payload: { name: string; mode: CreateMode }) => {
      if (!isElectron) {
        return false;
      }

      if (configSets.length >= CONFIG_SET_LIMIT) {
        showErrorKey('api.configSetLimitReached', { count: CONFIG_SET_LIMIT });
        return false;
      }

      const trimmed = payload.name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.createSet({
          name: trimmed,
          mode: payload.mode,
          fromSetId: payload.mode === 'clone' ? activeConfigSetId : undefined,
        });
        // Open the freshly created set in the editor without touching the default.
        const createdSet = result.config.configSets?.find(
          (set) => !configSets.some((existing) => existing.id === set.id)
        );
        applyPersistedConfigToStore(result.config, presets, createdSet?.id);
        showSuccessKey('api.configSetCreated');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (createError) {
        if (createError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(createError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      activeConfigSetId,
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      configSets,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const createBlankConfigSet = useCallback(async () => {
    await createConfigSet({
      name: t('api.newSetDefaultName'),
      mode: 'blank',
    });
  }, [createConfigSet, t]);

  const requestConfigSetSwitch = useCallback(
    async (setId: string) => {
      if (!setId || setId === activeConfigSetId) {
        return;
      }

      const action: PendingConfigSetAction = { type: 'switch', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }

      await switchConfigSet(setId);
    },
    [activeConfigSetId, hasUnsavedChanges, switchConfigSet]
  );

  const continuePendingConfigSetAction = useCallback(
    async (action: PendingConfigSetAction) => {
      if (action.type === 'select') {
        selectConfigSet(action.targetSetId);
        return;
      }
      await switchConfigSet(action.targetSetId);
    },
    [selectConfigSet, switchConfigSet]
  );

  const cancelPendingConfigSetAction = useCallback(() => {
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
  }, []);

  const saveAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }
    const action = pendingConfigSetAction;
    const saved = await handleSave({ silentSuccess: true });
    if (!saved) {
      return;
    }
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, handleSave, pendingConfigSetAction]);

  const discardAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) {
      return;
    }
    const action = pendingConfigSetAction;
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, pendingConfigSetAction]);

  const requestCreateBlankConfigSet = useCallback(async () => {
    if (hasUnsavedChanges) {
      const saved = await handleSave({ silentSuccess: true });
      if (!saved) {
        return;
      }
    }
    await createBlankConfigSet();
  }, [createBlankConfigSet, handleSave, hasUnsavedChanges]);

  const renameConfigSet = useCallback(
    async (id: string, name: string) => {
      if (!isElectron) {
        return false;
      }

      const trimmed = name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.renameSet({ id, name: trimmed });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetRenamed');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (renameError) {
        if (renameError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(renameError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  const deleteConfigSet = useCallback(
    async (id: string) => {
      if (!isElectron) {
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await window.electronAPI.config.deleteSet({ id });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetDeleted');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (deleteError) {
        if (deleteError instanceof Error) {
          showErrorText(translateApiConfigErrorMessage(deleteError.message, t));
        } else {
          showErrorKey('api.saveFailed');
        }
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      presets,
      showErrorKey,
      showErrorText,
      showSuccessKey,
      t,
    ]
  );

  return {
    isLoadingConfig,
    presets,
    provider,
    providerUnset,
    customProtocol,
    modelOptions,
    currentPreset,
    apiKey,
    baseUrl,
    model,
    customModel,
    useCustomModel,
    contextWindow,
    maxTokens,
    modelInputPlaceholder: modelInputGuidance.placeholder,
    modelInputHint: modelInputGuidance.hint,
    enableThinking,
    thinkingLevel,
    isSaving,
    isTesting,
    isRefreshingModels,
    isDiscoveringLocalOllama,
    error,
    successMessage,
    lastSaveCompletedAt,
    testResult,
    friendlyTestDetails,
    diagnosticResult,
    isDiagnosing,
    handleDiagnose,
    handleDeepDiagnose,
    isOllamaMode: provider === 'ollama',
    shouldShowOllamaManualModelToggle,
    requiresApiKey,
    detectedProviderSetup,
    protocolGuidanceText,
    protocolGuidanceTone,
    baseUrlGuidanceText,
    commonProviderSetups,
    configSets,
    activeConfigSetId,
    selectedConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    configSetLimit: CONFIG_SET_LIMIT,
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
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
    handleSave,
    handleTest,
    refreshModelOptions,
    discoverLocalOllama,
    setError: showErrorText,
    setSuccessMessage: showSuccessText,
  };
}
