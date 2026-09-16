import type {
  ApiConfigSet,
  AppConfig,
  CustomProtocolType,
  ProviderModelInfo,
  ProviderProfile,
  ProviderProfileKey,
  ProviderPresets,
  ProviderType,
} from '../types';
import { useTranslation } from 'react-i18next';
import { isLoopbackBaseUrl } from '../../shared/network/loopback';
import { normalizeOllamaBaseUrl } from '../../shared/ollama-base-url';
import { API_PROVIDER_PRESETS } from '../../shared/api-model-presets';
import type { CommonProviderSetup } from '../../shared/api-provider-guidance';

export interface UseApiConfigStateOptions {
  enabled?: boolean;
  initialConfig?: AppConfig | null;
  onSave?: (config: Partial<AppConfig>) => Promise<void>;
}

export interface UIProviderProfile {
  apiKey: string;
  baseUrl: string;
  model: string;
  customModel: string;
  useCustomModel: boolean;
  contextWindow: string;
  maxTokens: string;
}

export interface ConfigStateSnapshot {
  activeProfileKey: ProviderProfileKey;
  profiles: Record<ProviderProfileKey, UIProviderProfile>;
  enableThinking: boolean;
  providerUnset: boolean;
}

export interface ApiConfigBootstrap {
  snapshot: ConfigStateSnapshot;
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
}

export type CreateMode = 'blank' | 'clone';

export type PendingConfigSetAction = { type: 'select' | 'switch'; targetSetId: string };

export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
export const CONFIG_SET_LIMIT = 20;
export const DEFAULT_CONFIG_SET_ID = 'default';
export const DEFAULT_CONFIG_SET_NAME_ZH = '默认方案';
export const DEFAULT_VISIBLE_PROFILE_KEY: ProviderProfileKey = 'deepseek';
export const FALLBACK_PROVIDER_PRESETS: ProviderPresets = API_PROVIDER_PRESETS;

export const PROFILE_KEYS: ProviderProfileKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'openai-codex',
  'deepseek',
  'moonshot',
  'aliyun',
  'zai',
  'sophron',
  'gemini',
  'ollama',
  'custom:anthropic',
  'custom:openai',
  'custom:gemini',
];

export function isProfileKey(value: unknown): value is ProviderProfileKey {
  return typeof value === 'string' && PROFILE_KEYS.includes(value as ProviderProfileKey);
}

export function isProviderType(value: unknown): value is ProviderType {
  return (
    value === 'openrouter' ||
    value === 'anthropic' ||
    value === 'custom' ||
    value === 'openai' ||
    value === 'openai-codex' ||
    value === 'deepseek' ||
    value === 'moonshot' ||
    value === 'aliyun' ||
    value === 'zai' ||
    value === 'sophron' ||
    value === 'gemini' ||
    value === 'ollama'
  );
}

export function isCustomProtocol(value: unknown): value is CustomProtocolType {
  return value === 'anthropic' || value === 'openai' || value === 'gemini';
}

export function normalizeVisibleApiProfileKey(profileKey: ProviderProfileKey): ProviderProfileKey {
  return profileKey === 'sophron' ? DEFAULT_VISIBLE_PROFILE_KEY : profileKey;
}

export function profileKeyFromProvider(
  provider: ProviderType,
  customProtocol: CustomProtocolType = 'anthropic'
): ProviderProfileKey {
  if (provider !== 'custom') {
    return provider;
  }
  if (customProtocol === 'openai') {
    return 'custom:openai';
  }
  if (customProtocol === 'gemini') {
    return 'custom:gemini';
  }
  return 'custom:anthropic';
}

export function profileKeyToProvider(profileKey: ProviderProfileKey): {
  provider: ProviderType;
  customProtocol: CustomProtocolType;
} {
  if (profileKey === 'ollama') {
    return { provider: 'ollama', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:openai') {
    return { provider: 'custom', customProtocol: 'openai' };
  }
  if (profileKey === 'custom:gemini') {
    return { provider: 'custom', customProtocol: 'gemini' };
  }
  if (profileKey === 'custom:anthropic') {
    return { provider: 'custom', customProtocol: 'anthropic' };
  }
  if (profileKey === 'openai') {
    return { provider: 'openai', customProtocol: 'openai' };
  }
  if (profileKey === 'openai-codex') {
    return { provider: 'openai-codex', customProtocol: 'openai' };
  }
  if (profileKey === 'openrouter') {
    return { provider: 'openrouter', customProtocol: 'openai' };
  }
  if (profileKey === 'deepseek') {
    return { provider: 'deepseek', customProtocol: 'openai' };
  }
  if (profileKey === 'moonshot') {
    return { provider: 'moonshot', customProtocol: 'openai' };
  }
  if (profileKey === 'aliyun') {
    return { provider: 'aliyun', customProtocol: 'openai' };
  }
  if (profileKey === 'zai') {
    return { provider: 'zai', customProtocol: 'openai' };
  }
  if (profileKey === 'sophron') {
    return { provider: 'sophron', customProtocol: 'openai' };
  }
  if (profileKey === 'gemini') {
    return { provider: 'gemini', customProtocol: 'gemini' };
  }
  return { provider: profileKey, customProtocol: 'anthropic' };
}

export function isCustomAnthropicLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomGeminiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isCustomOpenAiLoopbackGateway(baseUrl: string): boolean {
  return isLoopbackBaseUrl(baseUrl);
}

export function isLegacyOllamaConfig(
  config: Pick<AppConfig, 'provider' | 'customProtocol' | 'baseUrl'> | null | undefined
): boolean {
  if (!(config?.provider === 'custom' && config.customProtocol === 'openai')) {
    return false;
  }
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl || !isLoopbackBaseUrl(baseUrl)) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return port === '11434' && (!pathname || pathname === '/v1');
  } catch {
    return false;
  }
}

export function modelPresetForProfile(profileKey: ProviderProfileKey, presets: ProviderPresets) {
  if (profileKey === 'ollama') {
    return presets.ollama;
  }
  if (profileKey === 'custom:openai') {
    return presets.openai;
  }
  if (profileKey === 'custom:gemini') {
    return presets.gemini;
  }
  if (profileKey === 'custom:anthropic') {
    return presets.custom;
  }
  return presets[profileKey];
}

export function defaultProfileForKey(
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): UIProviderProfile {
  const preset = modelPresetForProfile(profileKey, presets);
  const prefersCustomInput = profileKey.startsWith('custom:');
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    model: profileKey === 'ollama' ? '' : preset.models[0]?.id || '',
    customModel: '',
    useCustomModel: prefersCustomInput,
    contextWindow: '',
    maxTokens: '',
  };
}

export function normalizeDiscoveredOllamaModels(models: string[] | undefined): ProviderModelInfo[] {
  return (models || [])
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id }));
}

// Inline helper: produces a partial discoveredModels update that clears a profile key.
// Used by dispatch callers instead of calling this as a free function.
export function clearDiscoveredModelsForProfile(
  prev: Partial<Record<ProviderProfileKey, ProviderModelInfo[]>>,
  profileKey: ProviderProfileKey
): Partial<Record<ProviderProfileKey, ProviderModelInfo[]>> {
  return { ...prev, [profileKey]: [] };
}

export function isPristineCustomProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  fallback: UIProviderProfile
): boolean {
  if (!profileKey.startsWith('custom:') || !profile) {
    return false;
  }

  const apiKey = profile.apiKey?.trim() || '';
  const baseUrl = profile.baseUrl?.trim() || fallback.baseUrl;
  const model = profile.model?.trim() || fallback.model;

  return apiKey === '' && baseUrl === fallback.baseUrl && model === fallback.model;
}

export function normalizeProfile(
  profileKey: ProviderProfileKey,
  profile: Partial<ProviderProfile> | undefined,
  presets: ProviderPresets
): UIProviderProfile {
  const fallback = defaultProfileForKey(profileKey, presets);
  if (!profile) {
    return fallback;
  }

  if (isPristineCustomProfile(profileKey, profile, fallback)) {
    return {
      ...fallback,
      apiKey: '',
      baseUrl: fallback.baseUrl,
      customModel: '',
      useCustomModel: true,
      contextWindow: '',
      maxTokens: '',
    };
  }

  const modelValue = profile?.model?.trim() || fallback.model;
  const rawBaseUrl = profile?.baseUrl?.trim() || fallback.baseUrl;
  const hasPresetModel = modelPresetForProfile(profileKey, presets).models.some(
    (item) => item.id === modelValue
  );
  return {
    apiKey: profile?.apiKey || '',
    baseUrl:
      profileKey === 'ollama' ? normalizeOllamaBaseUrl(rawBaseUrl) || fallback.baseUrl : rawBaseUrl,
    model: hasPresetModel ? modelValue : fallback.model,
    customModel: hasPresetModel ? '' : modelValue,
    useCustomModel: !hasPresetModel,
    contextWindow: profile?.contextWindow ? String(profile.contextWindow) : '',
    maxTokens: profile?.maxTokens ? String(profile.maxTokens) : '',
  };
}

export function buildApiConfigSnapshot(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ConfigStateSnapshot {
  const migratedToOllama = config?.provider === 'ollama' || isLegacyOllamaConfig(config);
  const provider = migratedToOllama ? 'ollama' : config?.provider || 'deepseek';
  const customProtocol: CustomProtocolType = migratedToOllama
    ? 'openai'
    : config?.customProtocol === 'openai'
      ? 'openai'
      : config?.customProtocol === 'gemini'
        ? 'gemini'
        : 'anthropic';
  const derivedProfileKey = profileKeyFromProvider(provider, customProtocol);
  const rawActiveProfileKey = migratedToOllama
    ? 'ollama'
    : isProfileKey(config?.activeProfileKey)
      ? config.activeProfileKey
      : derivedProfileKey;
  const activeProfileKey = normalizeVisibleApiProfileKey(rawActiveProfileKey);

  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    profiles[key] = normalizeProfile(key, config?.profiles?.[key], presets);
  }

  if (migratedToOllama) {
    profiles.ollama = normalizeProfile(
      'ollama',
      config?.profiles?.ollama ||
        config?.profiles?.['custom:openai'] || {
          apiKey: config?.apiKey || '',
          baseUrl: config?.baseUrl,
          model: config?.model,
        },
      presets
    );
  }

  const hasProfilesFromConfig = Boolean(
    config?.profiles && Object.keys(config.profiles).length > 0
  );
  if (!hasProfilesFromConfig) {
    profiles[activeProfileKey] = normalizeProfile(
      activeProfileKey,
      {
        apiKey: config?.apiKey || '',
        baseUrl: config?.baseUrl,
        model: config?.model,
      },
      presets
    );
  }

  return {
    activeProfileKey,
    profiles,
    enableThinking: Boolean(config?.enableThinking),
    providerUnset: false,
  };
}

export function toPersistedProfiles(
  profiles: Record<ProviderProfileKey, UIProviderProfile>
): Partial<Record<ProviderProfileKey, ProviderProfile>> {
  const persisted: Partial<Record<ProviderProfileKey, ProviderProfile>> = {};
  for (const key of PROFILE_KEYS) {
    const profile = profiles[key];
    const finalModel = profile.useCustomModel
      ? profile.customModel.trim() || profile.model
      : profile.model;
    persisted[key] = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl.trim() || undefined,
      model: finalModel,
      contextWindow: profile.contextWindow ? Number(profile.contextWindow) : undefined,
      maxTokens: profile.maxTokens ? Number(profile.maxTokens) : undefined,
    };
  }
  return persisted;
}

export function buildApiConfigDraftSignature(
  activeProfileKey: ProviderProfileKey,
  profiles: Record<ProviderProfileKey, UIProviderProfile>,
  enableThinking: boolean
): string {
  const persisted = toPersistedProfiles(profiles);
  return JSON.stringify({
    activeProfileKey,
    enableThinking,
    profiles: PROFILE_KEYS.map((key) => ({
      key,
      apiKey: persisted[key]?.apiKey || '',
      baseUrl: persisted[key]?.baseUrl || '',
      model: persisted[key]?.model || '',
    })),
  });
}

export function buildApiConfigSets(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigSet[] {
  const now = new Date().toISOString();

  if (config?.configSets && config.configSets.length > 0) {
    return config.configSets.map((set, index) => {
      const isMigratedOllamaSet = isLegacyOllamaConfig({
        provider: isProviderType(set.provider) ? set.provider : 'openrouter',
        customProtocol: isCustomProtocol(set.customProtocol) ? set.customProtocol : 'anthropic',
        baseUrl: set.profiles?.['custom:openai']?.baseUrl || config?.baseUrl,
      });
      const provider = isMigratedOllamaSet
        ? 'ollama'
        : set.provider === ''
          ? ''
          : isProviderType(set.provider)
            ? set.provider
            : 'openrouter';
      const customProtocol = isMigratedOllamaSet
        ? 'openai'
        : isCustomProtocol(set.customProtocol)
          ? set.customProtocol
          : 'anthropic';
      const fallbackActive = provider
        ? profileKeyFromProvider(provider, customProtocol)
        : 'deepseek';
      const activeProfileKey = isMigratedOllamaSet
        ? 'ollama'
        : isProfileKey(set.activeProfileKey)
          ? set.activeProfileKey
          : fallbackActive;

      const normalizedProfiles = {} as Record<ProviderProfileKey, ProviderProfile>;
      for (const key of PROFILE_KEYS) {
        const uiProfile = normalizeProfile(key, set.profiles?.[key], presets);
        normalizedProfiles[key] = {
          apiKey: uiProfile.apiKey,
          baseUrl: uiProfile.baseUrl,
          model: uiProfile.useCustomModel
            ? uiProfile.customModel.trim() || uiProfile.model
            : uiProfile.model,
        };
      }

      if (isMigratedOllamaSet) {
        const ollamaProfile = normalizeProfile(
          'ollama',
          set.profiles?.ollama || set.profiles?.['custom:openai'],
          presets
        );
        normalizedProfiles.ollama = {
          apiKey: ollamaProfile.apiKey,
          baseUrl: ollamaProfile.baseUrl,
          model: ollamaProfile.useCustomModel
            ? ollamaProfile.customModel.trim() || ollamaProfile.model
            : ollamaProfile.model,
        };
      }

      return {
        ...set,
        id: typeof set.id === 'string' && set.id.trim() ? set.id : `set-${index + 1}`,
        name: typeof set.name === 'string' && set.name.trim() ? set.name : `配置方案 ${index + 1}`,
        provider,
        customProtocol,
        activeProfileKey,
        profiles: normalizedProfiles,
        enableThinking: Boolean(set.enableThinking),
        updatedAt: typeof set.updatedAt === 'string' && set.updatedAt.trim() ? set.updatedAt : now,
      };
    });
  }

  const snapshot = buildApiConfigSnapshot(config, presets);
  const activeMeta = profileKeyToProvider(snapshot.activeProfileKey);
  const fallbackId =
    typeof config?.activeConfigSetId === 'string' && config.activeConfigSetId.trim()
      ? config.activeConfigSetId
      : DEFAULT_CONFIG_SET_ID;

  return [
    {
      id: fallbackId,
      name: DEFAULT_CONFIG_SET_NAME_ZH,
      isSystem: true,
      provider: activeMeta.provider,
      customProtocol: activeMeta.customProtocol,
      activeProfileKey: snapshot.activeProfileKey,
      profiles: toPersistedProfiles(snapshot.profiles),
      enableThinking: snapshot.enableThinking,
      updatedAt: now,
    },
  ];
}

export function buildApiConfigBootstrap(
  config: AppConfig | null | undefined,
  presets: ProviderPresets
): ApiConfigBootstrap {
  const snapshot = buildApiConfigSnapshot(config, presets);
  const configSets = buildApiConfigSets(config, presets);
  const activeConfigSetId =
    typeof config?.activeConfigSetId === 'string' &&
    configSets.some((set) => set.id === config.activeConfigSetId)
      ? config.activeConfigSetId
      : configSets[0]?.id || DEFAULT_CONFIG_SET_ID;

  return {
    snapshot,
    configSets,
    activeConfigSetId,
  };
}

export function buildSnapshotFromConfigSet(
  set: ApiConfigSet,
  presets: ProviderPresets
): ConfigStateSnapshot {
  const fallbackProvider = isProviderType(set.provider) ? set.provider : 'deepseek';
  const fallbackProtocol = isCustomProtocol(set.customProtocol) ? set.customProtocol : 'anthropic';
  const rawActiveProfileKey = isProfileKey(set.activeProfileKey)
    ? set.activeProfileKey
    : profileKeyFromProvider(fallbackProvider, fallbackProtocol);
  const activeProfileKey = normalizeVisibleApiProfileKey(rawActiveProfileKey);

  const profiles = {} as Record<ProviderProfileKey, UIProviderProfile>;
  for (const key of PROFILE_KEYS) {
    profiles[key] = normalizeProfile(key, set.profiles?.[key], presets);
  }

  return {
    activeProfileKey,
    profiles,
    enableThinking: Boolean(set.enableThinking),
    providerUnset: set.provider === '',
  };
}

export function translateApiConfigErrorMessage(
  message: string,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (message === 'Config set name is required') {
    return t('api.configSetNameRequired');
  }
  if (message === 'Config set clone source not found') {
    return t('api.configSetCloneSourceMissing');
  }
  if (message === 'Config set not found') {
    return t('api.configSetMissing');
  }
  if (message === 'System config set cannot be deleted') {
    return t('api.configSetSystemDeleteForbidden');
  }
  if (message === 'At least one config set must be kept') {
    return t('api.configSetKeepOne');
  }

  const limitMatch = message.match(/^Config set limit reached: max\s+(\d+)$/);
  if (limitMatch) {
    return t('api.configSetLimitReached', { count: Number(limitMatch[1]) });
  }

  return message;
}

export function protocolLabel(
  protocol: CustomProtocolType,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (protocol === 'openai') {
    return t('api.guidance.protocolLabels.openai');
  }
  if (protocol === 'gemini') {
    return t('api.guidance.protocolLabels.gemini');
  }
  return t('api.guidance.protocolLabels.anthropic');
}

export function providerTabLabel(
  provider: ProviderType,
  presets: ProviderPresets,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (provider === 'custom') {
    return t('api.custom');
  }
  return presets[provider]?.name || provider;
}

export function buildSetupModelState(
  setup: CommonProviderSetup,
  profileKey: ProviderProfileKey,
  presets: ProviderPresets
): Pick<UIProviderProfile, 'model' | 'customModel' | 'useCustomModel'> {
  const preset = modelPresetForProfile(profileKey, presets);
  const hasPresetModel = preset.models.some((item) => item.id === setup.exampleModel);
  return {
    model: hasPresetModel ? setup.exampleModel : preset.models[0]?.id || setup.exampleModel,
    customModel: hasPresetModel ? '' : setup.exampleModel,
    useCustomModel: !hasPresetModel,
  };
}

// ---------------------------------------------------------------------------
// Reducer state
// ---------------------------------------------------------------------------
