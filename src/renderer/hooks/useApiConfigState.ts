import { configClient } from '../features/config/api/config-client';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import type {
  AppConfig,
  CustomProtocolType,
  ProviderPresets,
  ProviderType,
  ThinkingLevel,
} from '../types';
import { getModelInputGuidance } from '../../shared/api-model-presets';
import { COMMON_PROVIDER_SETUPS } from '../../shared/api-provider-guidance';
import { apiConfigReducer } from './api-config-reducer';
import type { ApiConfigState } from './api-config-reducer';
import { showToast } from '../utils/toast';
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
  normalizeThinkingLevel,
  profileKeyFromProvider,
  profileKeyToProvider,
  canProviderRefreshModels,
  resolveProfileModelOptions,
  toPersistedProfiles,
  translateApiConfigErrorMessage,
} from './api-config-model';
import type {
  ApiConfigBootstrap,
  UIProviderProfile,
  UseApiConfigStateOptions,
} from './api-config-model';
import { computeApiProviderGuidance } from './api-config-guidance';
import { useApiModelDiscovery } from './useApiModelDiscovery';
import { useApiConfigSetActions } from './useApiConfigSetActions';

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

  const [state, dispatch] = useReducer(apiConfigReducer, undefined, (): ApiConfigState => ({
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
  }));

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

  const selectedConfigSetIdRef = useRef(selectedConfigSetId);
  const hasAppliedLoadedStateRef = useRef(false);
  useEffect(() => {
    selectedConfigSetIdRef.current = selectedConfigSetId;
  }, [selectedConfigSetId]);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const showErrorKey = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      showToast('error', t(key, values));
      dispatch({ type: 'SET_ERROR_KEY', key, values });
    },
    [t]
  );

  const showErrorText = useCallback((text: string) => {
    if (text) showToast('error', text);
    dispatch({ type: 'SET_ERROR_TEXT', text });
  }, []);

  const clearSuccessMessage = useCallback(() => {
    dispatch({ type: 'CLEAR_SUCCESS' });
  }, []);

  const showSuccessKey = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      showToast('success', t(key, values));
      dispatch({ type: 'SET_SUCCESS_KEY', key, values });
    },
    [t]
  );

  const showSuccessText = useCallback((text: string) => {
    if (text) showToast('success', text);
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
  const usesDiscoveredModelOptions = canProviderRefreshModels(provider);
  const hasDiscoveredModelOptions =
    usesDiscoveredModelOptions &&
    Object.prototype.hasOwnProperty.call(discoveredModels, activeProfileKey);
  const modelOptions = useMemo(
    () =>
      resolveProfileModelOptions(
        provider,
        modelPreset.models,
        discoveredModels[activeProfileKey],
        hasDiscoveredModelOptions
      ),
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
  const {
    detectedProviderSetup,
    protocolGuidanceTone,
    protocolGuidanceText,
    baseUrlGuidanceText,
    commonProviderSetups,
    friendlyTestDetails,
  } = useMemo(
    () =>
      computeApiProviderGuidance({
        provider,
        customProtocol,
        baseUrl,
        presets,
        testResultDetails: testResult?.details,
        t,
      }),
    [baseUrl, customProtocol, presets, provider, t, testResult?.details]
  );

  const allowEmptyApiKey =
    provider === 'lmbp' ||
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
          ? await configClient.getPresets()
          : FALLBACK_PROVIDER_PRESETS;
        const config = initialConfig || (isElectron ? await configClient.get() : null);
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

      const result = await configClient.test({
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

        const result = await configClient.diagnose({
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

  const { refreshModelOptions, discoverLocalOllama, applyLmbpModels } = useApiModelDiscovery({
    activeProfileKey,
    provider,
    apiKey,
    baseUrl,
    presets,
    dispatch,
    clearError,
    clearSuccessMessage,
    showErrorKey,
    showErrorText,
    showSuccessKey,
  });

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
        if (!isEditingDefaultSet && isElectron && configClient.isAvailable()) {
          // Editing a non-default set: persist into that set only, keeping the
          // default set untouched.
          const result = await configClient.updateSet({
            id: selectedConfigSetId,
            updates: payload,
          });
          applyPersistedConfigToStore(result.config, presets, selectedConfigSetId);
        } else {
          const savePayload = { ...payload, activeConfigSetId };
          if (onSave) {
            await onSave(savePayload);
          } else {
            const result = await configClient.save(savePayload);
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

  const {
    requestConfigSetSwitch,
    requestSelectConfigSet,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
  } = useApiConfigSetActions({
    t,
    presets,
    configSets,
    activeConfigSetId,
    selectedConfigSetId,
    selectedConfigSetIdRef,
    lastCustomProtocol,
    hasUnsavedChanges,
    pendingConfigSetAction,
    dispatch,
    applyPersistedConfigToStore,
    handleSave,
    clearError,
    clearSuccessMessage,
    showErrorKey,
    showErrorText,
    showSuccessKey,
  });

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
    applyLmbpModels,
    setError: showErrorText,
    setSuccessMessage: showSuccessText,
  };
}
