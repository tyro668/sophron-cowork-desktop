import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { DEFAULT_OLLAMA_BASE_URL, normalizeOllamaBaseUrl } from '../../shared/ollama-base-url';
import { configClient } from '../features/config/api/config-client';
import type {
  ProviderModelInfo,
  ProviderPresets,
  ProviderProfileKey,
  ProviderType,
} from '../types';
import {
  canProviderRefreshModels,
  isElectron,
  modelPresetForProfile,
  normalizeDiscoveredOllamaModels,
} from './api-config-model';
import type { ApiConfigAction } from './api-config-reducer';

interface UseApiModelDiscoveryOptions {
  activeProfileKey: ProviderProfileKey;
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  presets: ProviderPresets;
  dispatch: Dispatch<ApiConfigAction>;
  clearError: () => void;
  clearSuccessMessage: () => void;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
}

export function useApiModelDiscovery({
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
}: UseApiModelDiscoveryOptions) {
  const ollamaRefreshRequestIdRef = useRef(0);
  const ollamaDiscoverRequestIdRef = useRef(0);
  const latestOllamaTargetRef = useRef<{
    activeProfileKey: ProviderProfileKey;
    baseUrl: string;
    provider: ProviderType;
  }>({
    activeProfileKey,
    baseUrl: '',
    provider: 'deepseek',
  });

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
    dispatch({ type: 'DELETE_DISCOVERED_MODELS', profileKey: activeProfileKey });

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
  }, [activeProfileKey, baseUrl, provider, presets, dispatch]);

  const refreshModelOptions = useCallback(async () => {
    if (!isElectron || !canProviderRefreshModels(provider)) {
      return [];
    }

    const requestedProfileKey = activeProfileKey;
    const requestedBaseUrl = baseUrl.trim();
    const requestId = ++ollamaRefreshRequestIdRef.current;

    dispatch({ type: 'SET_IS_REFRESHING_MODELS', payload: true });
    clearError();
    try {
      const models = await configClient.listModels({
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
  }, [
    activeProfileKey,
    apiKey,
    baseUrl,
    provider,
    clearError,
    dispatch,
    showErrorKey,
    showErrorText,
  ]);

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
    [dispatch]
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
        const result = await configClient.discoverLocal({
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
      dispatch,
      provider,
      showErrorKey,
      showErrorText,
      showSuccessKey,
    ]
  );

  // Auto-refresh model list when Ollama baseUrl changes (debounced).
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
    if (provider !== 'sophron' && provider !== 'openai-codex') return;
    void refreshModelOptions();
  }, [provider, refreshModelOptions]);

  return {
    refreshModelOptions,
    discoverLocalOllama,
  };
}
