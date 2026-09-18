/**
 * Allowlist-based log summary for `config.save` payloads.
 *
 * The save path submits the full config graph — top-level `apiKey`, every
 * `profiles[*].apiKey`, every `configSets[*].profiles[*].apiKey`, and the
 * `memoryRuntime`/`personalAnalysis` secrets. Logs are persisted to disk and
 * bundled by `logs.export`, so anything beyond the allowlist below must never
 * reach a log line. Add new non-sensitive fields here deliberately; never
 * spread the raw payload.
 */
import type { AppConfigUpdate, MemoryModelRuntimeConfig } from '../../../shared/contracts';
import { sanitizeUrlForLog } from '../../utils/sanitize-url';

const SCALAR_FIELDS = [
  'provider',
  'customProtocol',
  'model',
  'builtinLlmModel',
  'activeProfileKey',
  'activeConfigSetId',
  'contextWindow',
  'maxTokens',
  'theme',
  'sandboxEnabled',
  'memoryEnabled',
  'enableThinking',
  'thinkingLevel',
  'enableDevLogs',
  'isConfigured',

  'defaultWorkdir',
  'globalSkillsPath',
] as const;

function sanitizeUrl(value: string | undefined): string | undefined {
  return typeof value === 'string' && value ? sanitizeUrlForLog(value) : undefined;
}

function summarizeMemoryModel(model: MemoryModelRuntimeConfig | undefined) {
  if (!model) return undefined;
  return {
    inheritFromActive: model.inheritFromActive,
    provider: model.provider,
    customProtocol: model.customProtocol,
    model: model.model,
    baseUrl: sanitizeUrl(model.baseUrl),
    timeoutMs: model.timeoutMs,
    hasApiKey: Boolean(model.apiKey),
  };
}

export function summarizeConfigUpdate(config: AppConfigUpdate): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    updatedKeys: Object.keys(config).sort(),
  };

  for (const field of SCALAR_FIELDS) {
    const value = config[field];
    if (value !== undefined) {
      summary[field] = value;
    }
  }

  if (config.apiKey !== undefined) {
    summary.hasApiKey = Boolean(config.apiKey);
  }
  if (config.baseUrl !== undefined) {
    // Credentials can hide in userinfo or query params — never log them raw.
    summary.baseUrl = sanitizeUrl(config.baseUrl) ?? null;
  }
  if (config.profiles !== undefined) {
    summary.profileKeys = Object.keys(config.profiles).sort();
  }
  if (config.configSets !== undefined) {
    summary.configSets = config.configSets.map((set) => ({
      id: set.id,
      provider: set.provider,
      activeProfileKey: set.activeProfileKey,
      profileKeys: Object.keys(set.profiles ?? {}).sort(),
    }));
  }
  if (config.memoryRuntime !== undefined) {
    const memory = config.memoryRuntime;
    summary.memoryRuntime = {
      useEmbedding: memory.useEmbedding,
      maxNavSteps: memory.maxNavSteps,
      ingestionConcurrency: memory.ingestionConcurrency,
      storageRoot: memory.storageRoot,
      evalEnabled: memory.evalEnabled,
      evalMaxRounds: memory.evalMaxRounds,
      evalArtifactsRoot: memory.evalArtifactsRoot,
      promptIterationRounds: memory.promptIterationRounds,
      llm: summarizeMemoryModel(memory.llm),
      embedding: summarizeMemoryModel(memory.embedding),
    };
  }
  if (config.personalAnalysis !== undefined) {
    summary.personalAnalysis = {
      apiOrigin: sanitizeUrl(config.personalAnalysis.apiOrigin) ?? null,
      hasApiKey: Boolean(config.personalAnalysis.apiKey),
    };
  }

  return summary;
}
