import type {
  ApiConfigSet,
  ApiTestResult,
  CustomProtocolType,
  DiagnosticResult,
  ProviderModelInfo,
  ProviderProfileKey,
  ProviderPresets,
} from '../types';
import {
  clearDiscoveredModelsForProfile,
  defaultProfileForKey,
  type PendingConfigSetAction,
  type UIProviderProfile,
} from './api-config-model';

export interface ApiConfigState {
  // Provider presets loaded from Electron
  presets: ProviderPresets;
  // Per-profile UI fields
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  // Which profile tab is selected
  activeProfileKey: ProviderProfileKey;
  // True when the selected set has no provider chosen yet (fresh blank set)
  providerUnset: boolean;
  // Config-set list and selection
  configSets: ApiConfigSet[];
  // Default set — only changed via the explicit "set as default" action
  activeConfigSetId: string;
  // Set currently loaded into the editor (selection does not change the default)
  selectedConfigSetId: string;
  // Deferred action waiting for unsaved-changes resolution
  pendingConfigSetAction: PendingConfigSetAction | null;
  // Extended thinking flag
  enableThinking: boolean;
  // Remember last custom protocol so switching back to custom restores it
  lastCustomProtocol: CustomProtocolType;
  // Signature of the last persisted state (used for dirty-check)
  savedDraftSignature: string;
  // Ollama model discovery results keyed by profile
  discoveredModels: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>;
  // Async loading flags
  isLoadingConfig: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isRefreshingModels: boolean;
  isDiscoveringLocalOllama: boolean;
  isMutatingConfigSet: boolean;
  isDiagnosing: boolean;
  // Error message — either a raw string or a i18n key + optional values
  errorText: string;
  errorKey: string | null;
  errorValues: Record<string, string | number> | undefined;
  // Success message — same dual-source pattern
  successText: string;
  successKey: string | null;
  successValues: Record<string, string | number> | undefined;
  // Persisted results
  lastSaveCompletedAt: number;
  testResult: ApiTestResult | null;
  diagnosticResult: DiagnosticResult | null;
}

// ---------------------------------------------------------------------------
// Actions (discriminated union — no plain string payloads where avoidable)
// ---------------------------------------------------------------------------

export type ApiConfigAction =
  // Bulk resets from loaded config
  | {
      type: 'APPLY_LOADED_STATE';
      payload: {
        presets: ProviderPresets;
        profiles: Record<ProviderProfileKey, UIProviderProfile>;
        activeProfileKey: ProviderProfileKey;
        providerUnset: boolean;
        enableThinking: boolean;
        configSets: ApiConfigSet[];
        activeConfigSetId: string;
        selectedConfigSetId: string;
        lastCustomProtocol: CustomProtocolType;
        savedDraftSignature: string;
      };
    }
  // Active profile key
  | { type: 'SET_ACTIVE_PROFILE_KEY'; payload: ProviderProfileKey }
  // No-provider-selected flag for blank sets
  | { type: 'SET_PROVIDER_UNSET'; payload: boolean }
  // Enable thinking toggle
  | { type: 'SET_ENABLE_THINKING'; payload: boolean }
  // Patch one profile in the profiles map
  | { type: 'PATCH_PROFILE'; profileKey: ProviderProfileKey; patch: Partial<UIProviderProfile> }
  // Replace a profile using a functional updater
  | {
      type: 'UPDATE_PROFILE_FN';
      profileKey: ProviderProfileKey;
      updater: (prev: UIProviderProfile) => UIProviderProfile;
    }
  // Discovered Ollama models
  | {
      type: 'SET_DISCOVERED_MODELS';
      profileKey: ProviderProfileKey;
      models: ProviderModelInfo[];
    }
  | { type: 'CLEAR_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  | { type: 'DELETE_DISCOVERED_MODELS'; profileKey: ProviderProfileKey }
  // Config set mutations
  | { type: 'SET_CONFIG_SETS'; payload: ApiConfigSet[] }
  | { type: 'SET_ACTIVE_CONFIG_SET_ID'; payload: string }
  | { type: 'SET_PENDING_CONFIG_SET_ACTION'; payload: PendingConfigSetAction | null }
  // Loading flags
  | { type: 'SET_IS_LOADING_CONFIG'; payload: boolean }
  | { type: 'SET_IS_SAVING'; payload: boolean }
  | { type: 'SET_IS_TESTING'; payload: boolean }
  | { type: 'SET_IS_REFRESHING_MODELS'; payload: boolean }
  | { type: 'SET_IS_DISCOVERING_LOCAL_OLLAMA'; payload: boolean }
  | { type: 'SET_IS_MUTATING_CONFIG_SET'; payload: boolean }
  | { type: 'SET_IS_DIAGNOSING'; payload: boolean }
  // Error message helpers
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_ERROR_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_ERROR_TEXT'; text: string }
  // Success message helpers
  | { type: 'CLEAR_SUCCESS' }
  | { type: 'SET_SUCCESS_KEY'; key: string; values?: Record<string, string | number> }
  | { type: 'SET_SUCCESS_TEXT'; text: string }
  // Results
  | { type: 'SET_LAST_SAVE_COMPLETED_AT'; payload: number }
  | { type: 'SET_TEST_RESULT'; payload: ApiTestResult | null }
  | { type: 'SET_DIAGNOSTIC_RESULT'; payload: DiagnosticResult | null }
  // Save signature
  | { type: 'SET_SAVED_DRAFT_SIGNATURE'; payload: string }
  // Last custom protocol memory
  | { type: 'SET_LAST_CUSTOM_PROTOCOL'; payload: CustomProtocolType };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function apiConfigReducer(state: ApiConfigState, action: ApiConfigAction): ApiConfigState {
  switch (action.type) {
    case 'APPLY_LOADED_STATE':
      return {
        ...state,
        presets: action.payload.presets,
        profiles: action.payload.profiles,
        activeProfileKey: action.payload.activeProfileKey,
        providerUnset: action.payload.providerUnset,
        enableThinking: action.payload.enableThinking,
        configSets: action.payload.configSets,
        activeConfigSetId: action.payload.activeConfigSetId,
        selectedConfigSetId: action.payload.selectedConfigSetId,
        pendingConfigSetAction: null,
        lastCustomProtocol: action.payload.lastCustomProtocol,
        savedDraftSignature: action.payload.savedDraftSignature,
      };

    case 'SET_ACTIVE_PROFILE_KEY':
      return { ...state, activeProfileKey: action.payload, providerUnset: false };

    case 'SET_PROVIDER_UNSET':
      return { ...state, providerUnset: action.payload };

    case 'SET_ENABLE_THINKING':
      return { ...state, enableThinking: action.payload };

    case 'PATCH_PROFILE':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: {
            ...(state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)),
            ...action.patch,
          },
        },
      };

    case 'UPDATE_PROFILE_FN':
      return {
        ...state,
        profiles: {
          ...state.profiles,
          [action.profileKey]: action.updater(
            state.profiles[action.profileKey] ||
              defaultProfileForKey(action.profileKey, state.presets)
          ),
        },
      };

    case 'SET_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: { ...state.discoveredModels, [action.profileKey]: action.models },
      };

    case 'CLEAR_DISCOVERED_MODELS':
      return {
        ...state,
        discoveredModels: clearDiscoveredModelsForProfile(
          state.discoveredModels,
          action.profileKey
        ),
      };

    case 'DELETE_DISCOVERED_MODELS': {
      const next = { ...state.discoveredModels };
      delete next[action.profileKey];
      return { ...state, discoveredModels: next };
    }

    case 'SET_CONFIG_SETS':
      return { ...state, configSets: action.payload };

    case 'SET_ACTIVE_CONFIG_SET_ID':
      return { ...state, activeConfigSetId: action.payload };

    case 'SET_PENDING_CONFIG_SET_ACTION':
      return { ...state, pendingConfigSetAction: action.payload };

    case 'SET_IS_LOADING_CONFIG':
      return { ...state, isLoadingConfig: action.payload };

    case 'SET_IS_SAVING':
      return { ...state, isSaving: action.payload };

    case 'SET_IS_TESTING':
      return { ...state, isTesting: action.payload };

    case 'SET_IS_REFRESHING_MODELS':
      return { ...state, isRefreshingModels: action.payload };

    case 'SET_IS_DISCOVERING_LOCAL_OLLAMA':
      return { ...state, isDiscoveringLocalOllama: action.payload };

    case 'SET_IS_MUTATING_CONFIG_SET':
      return { ...state, isMutatingConfigSet: action.payload };

    case 'SET_IS_DIAGNOSING':
      return { ...state, isDiagnosing: action.payload };

    case 'CLEAR_ERROR':
      return { ...state, errorText: '', errorKey: null, errorValues: undefined };

    case 'SET_ERROR_KEY':
      return { ...state, errorText: '', errorKey: action.key, errorValues: action.values };

    case 'SET_ERROR_TEXT':
      return { ...state, errorKey: null, errorValues: undefined, errorText: action.text };

    case 'CLEAR_SUCCESS':
      return { ...state, successText: '', successKey: null, successValues: undefined };

    case 'SET_SUCCESS_KEY':
      return { ...state, successText: '', successKey: action.key, successValues: action.values };

    case 'SET_SUCCESS_TEXT':
      return { ...state, successKey: null, successValues: undefined, successText: action.text };

    case 'SET_LAST_SAVE_COMPLETED_AT':
      return { ...state, lastSaveCompletedAt: action.payload };

    case 'SET_TEST_RESULT':
      return { ...state, testResult: action.payload };

    case 'SET_DIAGNOSTIC_RESULT':
      return { ...state, diagnosticResult: action.payload };

    case 'SET_SAVED_DRAFT_SIGNATURE':
      return { ...state, savedDraftSignature: action.payload };

    case 'SET_LAST_CUSTOM_PROTOCOL':
      return { ...state, lastCustomProtocol: action.payload };

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
