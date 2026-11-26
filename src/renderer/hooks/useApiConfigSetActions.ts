import { useCallback, type Dispatch, type MutableRefObject } from 'react';
import type { TFunction } from 'i18next';
import { configClient } from '../features/config/api/config-client';
import type { ApiConfigSet, AppConfig, CustomProtocolType, ProviderPresets } from '../types';
import {
  buildApiConfigDraftSignature,
  buildSnapshotFromConfigSet,
  CONFIG_SET_LIMIT,
  isElectron,
  profileKeyToProvider,
  translateApiConfigErrorMessage,
  type CreateMode,
  type PendingConfigSetAction,
} from './api-config-model';
import type { ApiConfigAction } from './api-config-reducer';

interface UseApiConfigSetActionsOptions {
  t: TFunction;
  presets: ProviderPresets;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  selectedConfigSetId: string;
  selectedConfigSetIdRef: MutableRefObject<string>;
  lastCustomProtocol: CustomProtocolType;
  hasUnsavedChanges: boolean;
  pendingConfigSetAction: PendingConfigSetAction | null;
  dispatch: Dispatch<ApiConfigAction>;
  applyPersistedConfigToStore: (
    config: AppConfig,
    loadedPresets: ProviderPresets,
    selectedId?: string
  ) => void;
  handleSave: (options?: { silentSuccess?: boolean }) => Promise<boolean>;
  clearError: () => void;
  clearSuccessMessage: () => void;
  showErrorKey: (key: string, values?: Record<string, string | number>) => void;
  showErrorText: (text: string) => void;
  showSuccessKey: (key: string, values?: Record<string, string | number>) => void;
}

export function useApiConfigSetActions({
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
}: UseApiConfigSetActionsOptions) {
  const reportMutationError = useCallback(
    (mutationError: unknown) => {
      if (mutationError instanceof Error) {
        showErrorText(translateApiConfigErrorMessage(mutationError.message, t));
      } else {
        showErrorKey('api.saveFailed');
      }
    },
    [showErrorKey, showErrorText, t]
  );

  const switchConfigSet = useCallback(
    async (setId: string) => {
      if (!isElectron) return false;

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await configClient.switchSet({ id: setId });
        applyPersistedConfigToStore(result.config, presets, setId);
        return true;
      } catch (switchError) {
        reportMutationError(switchError);
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [applyPersistedConfigToStore, clearError, dispatch, presets, reportMutationError]
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
    [
      activeConfigSetId,
      configSets,
      dispatch,
      lastCustomProtocol,
      presets,
      selectedConfigSetId,
      selectedConfigSetIdRef,
    ]
  );

  const requestSelectConfigSet = useCallback(
    (setId: string) => {
      if (!setId || setId === selectedConfigSetId) return;

      const action: PendingConfigSetAction = { type: 'select', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }
      selectConfigSet(setId);
    },
    [dispatch, hasUnsavedChanges, selectConfigSet, selectedConfigSetId]
  );

  const createConfigSet = useCallback(
    async (payload: { name: string; mode: CreateMode }) => {
      if (!isElectron) return false;

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
        const result = await configClient.createSet({
          name: trimmed,
          mode: payload.mode,
          fromSetId: payload.mode === 'clone' ? activeConfigSetId : undefined,
        });
        const createdSet = result.config.configSets?.find(
          (set) => !configSets.some((existing) => existing.id === set.id)
        );
        applyPersistedConfigToStore(result.config, presets, createdSet?.id);
        showSuccessKey('api.configSetCreated');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (createError) {
        reportMutationError(createError);
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
      dispatch,
      presets,
      reportMutationError,
      showErrorKey,
      showSuccessKey,
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
      if (!setId || setId === activeConfigSetId) return;

      const action: PendingConfigSetAction = { type: 'switch', targetSetId: setId };
      if (hasUnsavedChanges) {
        dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: action });
        return;
      }
      await switchConfigSet(setId);
    },
    [activeConfigSetId, dispatch, hasUnsavedChanges, switchConfigSet]
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
  }, [dispatch]);

  const saveAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) return;
    const action = pendingConfigSetAction;
    const saved = await handleSave({ silentSuccess: true });
    if (!saved) return;
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, dispatch, handleSave, pendingConfigSetAction]);

  const discardAndContinuePendingConfigSetAction = useCallback(async () => {
    if (!pendingConfigSetAction) return;
    const action = pendingConfigSetAction;
    dispatch({ type: 'SET_PENDING_CONFIG_SET_ACTION', payload: null });
    await continuePendingConfigSetAction(action);
  }, [continuePendingConfigSetAction, dispatch, pendingConfigSetAction]);

  const requestCreateBlankConfigSet = useCallback(async () => {
    if (hasUnsavedChanges) {
      const saved = await handleSave({ silentSuccess: true });
      if (!saved) return;
    }
    await createBlankConfigSet();
  }, [createBlankConfigSet, handleSave, hasUnsavedChanges]);

  const renameConfigSet = useCallback(
    async (id: string, name: string) => {
      if (!isElectron) return false;

      const trimmed = name.trim();
      if (!trimmed) {
        showErrorKey('api.configSetNameRequired');
        return false;
      }

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await configClient.renameSet({ id, name: trimmed });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetRenamed');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (renameError) {
        reportMutationError(renameError);
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      dispatch,
      presets,
      reportMutationError,
      showErrorKey,
      showSuccessKey,
    ]
  );

  const deleteConfigSet = useCallback(
    async (id: string) => {
      if (!isElectron) return false;

      dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: true });
      clearError();
      try {
        const result = await configClient.deleteSet({ id });
        applyPersistedConfigToStore(result.config, presets);
        showSuccessKey('api.configSetDeleted');
        setTimeout(() => clearSuccessMessage(), 1500);
        return true;
      } catch (deleteError) {
        reportMutationError(deleteError);
        return false;
      } finally {
        dispatch({ type: 'SET_IS_MUTATING_CONFIG_SET', payload: false });
      }
    },
    [
      applyPersistedConfigToStore,
      clearError,
      clearSuccessMessage,
      dispatch,
      presets,
      reportMutationError,
      showSuccessKey,
    ]
  );

  return {
    requestConfigSetSwitch,
    requestSelectConfigSet,
    requestCreateBlankConfigSet,
    cancelPendingConfigSetAction,
    saveAndContinuePendingConfigSetAction,
    discardAndContinuePendingConfigSetAction,
    createConfigSet,
    renameConfigSet,
    deleteConfigSet,
  };
}
