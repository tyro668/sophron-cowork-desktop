import { getModel, type Api, type Model } from '@mariozechner/pi-ai';
import { isOfficialOpenAIBaseUrl } from '../config/auth-utils';

const COMMON_FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
const INVALID_REGISTRY_PROVIDERS = new Set(['', 'custom']);
const OPENAI_COMPATIBLE_ROUTE_PROVIDERS = new Set([
  'openai',
  'openrouter',
  'deepseek',
  'moonshot',
  'aliyun',
  'zai',
  'sophron',
  'ollama',
]);
const REASONING_MODEL_PATTERN =
  /\bthinking\b|\breasoner\b|deepseek-r1|deepseek-v4|kimi-k2|qwen3(?:\.5)?(?=[:/-]|$)/i;
const DEEPSEEK_MODEL_PATTERN = /(?:^|\/)deepseek(?:$|[/_.-])/i;
type PiRegistryProvider = Parameters<typeof getModel>[0];

export interface PiModelStringInput {
  provider?: string;
  customProtocol?: string;
  model?: string;
  defaultModel?: string;
}

export interface PiModelLookupOptions {
  configProvider?: string;
  rawProvider?: string;
  customBaseUrl?: string;
  customProtocol?: string;
}

export interface PiModelLookupCandidate {
  provider: string;
  model: string;
}

export interface SyntheticPiModelFallbackInput {
  rawModel?: string;
  resolvedModelString: string;
  rawProvider?: string;
  routeProtocol: string;
  baseUrl?: string;
}

export interface SyntheticPiModelFallback {
  provider: string;
  modelId: string;
}

export function resolvePiRouteProtocol(provider?: string, customProtocol?: string): string {
  if (provider === 'custom') {
    if (customProtocol === 'openai' || customProtocol === 'gemini') {
      return customProtocol;
    }
    return 'anthropic';
  }
  if (provider && OPENAI_COMPATIBLE_ROUTE_PROVIDERS.has(provider)) return 'openai';
  if (provider === 'gemini') return 'gemini';
  return provider || 'anthropic';
}

function shouldDisableDeveloperRoleForEndpoint(
  model: Model<Api>,
  options: PiModelLookupOptions
): boolean {
  if (model.api !== 'openai-completions' && model.api !== 'openai-responses') {
    return false;
  }

  const endpoint = options.customBaseUrl?.trim() || model.baseUrl?.trim();
  if (!endpoint || isOfficialOpenAIBaseUrl(endpoint)) {
    return false;
  }

  return true;
}

function shouldPreserveOpenAIResponsesApi(
  model: Model<Api>,
  options: PiModelLookupOptions
): boolean {
  if (model.api !== 'openai-responses') {
    return false;
  }

  const endpoint = options.customBaseUrl?.trim() || model.baseUrl?.trim();
  return !endpoint || isOfficialOpenAIBaseUrl(endpoint);
}

export function inferPiApi(protocol: string): string {
  switch (protocol) {
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
    case 'google':
      return 'google-generative-ai';
    case 'openai':
    default:
      return 'openai-completions';
  }
}

const DEFAULT_SYNTHETIC_CONTEXT_WINDOW = 200_000;
const DEEPSEEK_CONTEXT_WINDOW = 1_000_000;

/**
 * Known context window / max output specs for common model families.
 * Used as a middle layer between user config overrides and the hardcoded default.
 */
const KNOWN_MODEL_SPECS: Record<string, { contextWindow: number; maxTokens: number }> = {
  'qwen3.5': { contextWindow: 258048, maxTokens: 32768 },
  'qwen3-max': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  qwen3: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  'qwen2.5': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  'qwen-max': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  llama3: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  'llama3.1': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  'llama3.2': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  'llama3.3': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  'deepseek-r1': { contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxTokens: 16384 },
  'deepseek-v3': { contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxTokens: 16384 },
  'deepseek-v4': { contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxTokens: 16384 },
  deepseek: { contextWindow: DEEPSEEK_CONTEXT_WINDOW, maxTokens: 16384 },
  claude: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  'gpt-5': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  o3: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  'o4-mini': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  gemini: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  kimi: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  'moonshot-v1': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  glm: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  'minimax-m': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  'grok-code': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 16384 },
  gemma2: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  gemma3: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 8192 },
  phi3: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  phi4: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  mistral: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  mixtral: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  codellama: { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
  'command-r': { contextWindow: DEFAULT_SYNTHETIC_CONTEXT_WINDOW, maxTokens: 4096 },
};

function matchesKnownModelSpec(key: string, lowerModelId: string): boolean {
  return (
    lowerModelId === key || lowerModelId.startsWith(key + ':') || lowerModelId.startsWith(key + '-')
  );
}

function lookupModelSpecs(
  modelId: string
): { contextWindow: number; maxTokens: number } | undefined {
  const lower = modelId.toLowerCase();
  const normalizedIds = [lower];
  const slashIndex = lower.indexOf('/');
  if (slashIndex >= 0 && slashIndex < lower.length - 1) {
    normalizedIds.push(lower.slice(slashIndex + 1));
  }
  // Match by prefix: "qwen3.5:0.8b" → "qwen3.5", "deepseek-r1-distill" → "deepseek-r1"
  for (const [key, specs] of Object.entries(KNOWN_MODEL_SPECS)) {
    if (normalizedIds.some((id) => matchesKnownModelSpec(key, id))) {
      return specs;
    }
  }
  return undefined;
}

export function buildSyntheticPiModel(
  modelId: string,
  provider: string,
  protocol: string,
  baseUrl?: string,
  apiOverride?: string,
  reasoning?: boolean,
  contextWindow?: number,
  maxTokens?: number
): Model<Api> {
  const api = apiOverride || inferPiApi(protocol);
  const autoReasoning = reasoning ?? REASONING_MODEL_PATTERN.test(modelId);
  const knownSpecs = lookupModelSpecs(modelId);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: autoReasoning,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? knownSpecs?.contextWindow ?? DEFAULT_SYNTHETIC_CONTEXT_WINDOW,
    maxTokens: maxTokens ?? knownSpecs?.maxTokens ?? 16384,
  } as Model<Api>;
}

export function resolveSyntheticPiModelFallback(
  input: SyntheticPiModelFallbackInput
): SyntheticPiModelFallback {
  const rawModel = input.rawModel?.trim() || '';
  const modelString = input.resolvedModelString.trim();
  const parts = modelString.split('/');
  const parsedProvider = parts.length >= 2 ? parts[0] : '';
  const strippedModelId = parts.length >= 2 ? parts.slice(1).join('/') : modelString;
  const baseUrl = input.baseUrl?.trim() || '';
  const preservesExplicitPrefixedId =
    rawModel.includes('/') &&
    (input.rawProvider === 'openrouter' ||
      input.rawProvider === 'custom' ||
      input.rawProvider === 'deepseek' ||
      input.rawProvider === 'moonshot' ||
      input.rawProvider === 'aliyun' ||
      input.rawProvider === 'zai' ||
      (input.rawProvider === 'openai' && !!baseUrl && !isOfficialOpenAIBaseUrl(baseUrl))) &&
    input.routeProtocol === 'openai';

  if (input.rawProvider === 'openrouter') {
    return {
      provider: 'openrouter',
      modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
    };
  }

  const fallbackProvider =
    input.rawProvider === 'custom' ||
    input.rawProvider === 'ollama' ||
    input.rawProvider === 'sophron'
      ? input.routeProtocol || 'anthropic'
      : parsedProvider || input.rawProvider || input.routeProtocol || 'anthropic';

  return {
    provider: preservesExplicitPrefixedId ? parsedProvider || fallbackProvider : fallbackProvider,
    modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
  };
}

export function resolvePiModelString(input: PiModelStringInput): string {
  const model = input.model?.trim();
  if (!model) {
    return input.defaultModel || 'anthropic/claude-sonnet-4-6';
  }
  if (model.includes('/')) {
    return model;
  }
  const provider = input.provider || 'anthropic';
  const modelProvider = provider === 'custom' ? input.customProtocol || 'anthropic' : provider;
  return `${modelProvider}/${model}`;
}

function addLookupCandidate(
  candidates: PiModelLookupCandidate[],
  seen: Set<string>,
  provider: string | undefined,
  model: string | undefined
): void {
  const normalizedProvider = provider?.trim() || '';
  const normalizedModel = model?.trim() || '';
  if (
    !normalizedProvider ||
    !normalizedModel ||
    INVALID_REGISTRY_PROVIDERS.has(normalizedProvider)
  ) {
    return;
  }

  const key = `${normalizedProvider}\u0000${normalizedModel}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({ provider: normalizedProvider, model: normalizedModel });
}

export function buildPiModelLookupCandidates(
  modelString: string,
  options: Pick<PiModelLookupOptions, 'configProvider' | 'rawProvider'> = {}
): PiModelLookupCandidate[] {
  const keyProvider =
    options.configProvider === 'custom' ? 'anthropic' : options.configProvider || 'anthropic';
  const rawProvider = options.rawProvider?.trim() || '';
  const trimmedModel = modelString.trim();
  const parts = trimmedModel.split('/');
  const seen = new Set<string>();
  const candidates: PiModelLookupCandidate[] = [];

  if (parts.length >= 2) {
    const parsedProvider = parts[0];
    const parsedModelId = parts.slice(1).join('/');

    if (rawProvider && rawProvider !== keyProvider && rawProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, rawProvider, trimmedModel);
    }
    if (keyProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
    }
    addLookupCandidate(candidates, seen, parsedProvider, parsedModelId);
    for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
      addLookupCandidate(candidates, seen, fallbackProvider, parsedModelId);
    }
    return candidates;
  }

  addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
  for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
    addLookupCandidate(candidates, seen, fallbackProvider, trimmedModel);
  }
  return candidates;
}

export function applyPiModelRuntimeOverrides(
  model: Model<Api>,
  options: PiModelLookupOptions = {}
): Model<Api> {
  let nextModel = model;
  const isCustomProvider = options.rawProvider === 'custom' || options.configProvider === 'custom';
  const shouldHonorConfiguredBaseUrl =
    Boolean(options.rawProvider && OPENAI_COMPATIBLE_ROUTE_PROVIDERS.has(options.rawProvider)) ||
    isCustomProvider;
  const modelHasBaseUrl = Boolean(nextModel.baseUrl);

  if (options.customBaseUrl && (shouldHonorConfiguredBaseUrl || !modelHasBaseUrl)) {
    nextModel = { ...nextModel, baseUrl: options.customBaseUrl } as typeof nextModel;
  }

  const effectiveProvider = options.rawProvider || options.configProvider;
  if (
    options.customBaseUrl &&
    isCustomProvider &&
    nextModel.api === 'openai-responses' &&
    !shouldPreserveOpenAIResponsesApi(nextModel, options)
  ) {
    // Most custom OpenAI-compatible relays only implement chat/completions.
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (effectiveProvider === 'openrouter' && nextModel.api !== 'openai-completions') {
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (shouldDisableDeveloperRoleForEndpoint(nextModel, options)) {
    nextModel = {
      ...nextModel,
      compat: {
        ...(nextModel.compat || {}),
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    } as typeof nextModel;
  }

  if (effectiveProvider === 'zai' && nextModel.api === 'openai-completions') {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        supportsDeveloperRole: false,
        supportsStore: false,
        thinkingFormat: 'zai',
      },
    } as typeof nextModel;
  }

  if (
    options.rawProvider === 'ollama' &&
    nextModel.reasoning &&
    nextModel.api === 'openai-completions'
  ) {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    const currentReasoningEffortMap = (
      currentCompat.reasoningEffortMap && typeof currentCompat.reasoningEffortMap === 'object'
        ? currentCompat.reasoningEffortMap
        : {}
    ) as Record<string, string>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        supportsReasoningEffort: true,
        reasoningEffortMap: {
          ...currentReasoningEffortMap,
          off: 'none',
        },
      },
    } as typeof nextModel;
  }

  // DeepSeek expects replayed reasoning as a top-level reasoning_content field,
  // not as a { type: "thinking" } content block.
  if (
    nextModel.api === 'openai-completions' &&
    (effectiveProvider === 'deepseek' || DEEPSEEK_MODEL_PATTERN.test(nextModel.id))
  ) {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        dropsThinkingInHistory: false,
        requiresThinkingInContent: false,
      },
    } as typeof nextModel;
  }

  // Handle custom provider with explicit protocol override
  if (isCustomProvider && options.customProtocol) {
    const targetApi = inferPiApi(options.customProtocol);
    if (nextModel.api !== targetApi && !shouldPreserveOpenAIResponsesApi(nextModel, options)) {
      nextModel = { ...nextModel, api: targetApi } as typeof nextModel;
    }
  }

  return nextModel;
}

export function resolvePiRegistryModel(
  modelString: string,
  options: PiModelLookupOptions = {}
): Model<Api> | undefined {
  for (const candidate of buildPiModelLookupCandidates(modelString, options)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (getModel as (...args: unknown[]) => Model<Api> | undefined)(
      candidate.provider as PiRegistryProvider,
      candidate.model
    );
    if (model) {
      return applyPiModelRuntimeOverrides(model, options);
    }
  }
  return undefined;
}
