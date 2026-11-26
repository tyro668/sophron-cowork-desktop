import type { AgentRuntimeConfig } from '../../shared/contracts';
import { log, logCtx, logCtxWarn } from '../utils/logger';
import { normalizeOpenAICompatibleBaseUrl } from '../config/auth-utils';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from './pi-model-resolution';
import { fetchOllamaModelInfo } from '../config/ollama-api';

export async function resolveRunModel(runtimeConfig: AgentRuntimeConfig, modelString: string) {
  const configProtocol = resolvePiRouteProtocol(
    runtimeConfig.provider,
    runtimeConfig.customProtocol
  );

  // Normalize base URL for OpenAI-compatible providers (strips copy-pasted endpoint suffixes)
  const rawBaseUrl = runtimeConfig.baseUrl?.trim() || undefined;
  const effectiveBaseUrl =
    configProtocol === 'openai' && runtimeConfig.provider !== 'ollama'
      ? normalizeOpenAICompatibleBaseUrl(rawBaseUrl) || rawBaseUrl
      : rawBaseUrl;

  let usedSyntheticModel = false;
  let piModel = resolvePiRegistryModel(modelString, {
    configProvider: configProtocol,
    customBaseUrl: effectiveBaseUrl,
    rawProvider: runtimeConfig.provider,
    customProtocol: runtimeConfig.customProtocol,
  });

  if (!piModel) {
    usedSyntheticModel = true;
    // Synthetic fallback: construct a Model for unknown/custom models
    const synthetic = resolveSyntheticPiModelFallback({
      rawModel: runtimeConfig.model,
      resolvedModelString: modelString,
      rawProvider: runtimeConfig.provider,
      routeProtocol: configProtocol,
      baseUrl: effectiveBaseUrl,
    });
    piModel = buildSyntheticPiModel(
      synthetic.modelId,
      synthetic.provider,
      configProtocol,
      effectiveBaseUrl,
      undefined,
      undefined,
      runtimeConfig.contextWindow,
      runtimeConfig.maxTokens
    );
    // Apply the same runtime overrides (developer role compat, base URL, API downgrade)
    // that resolvePiRegistryModel applies to registry models
    piModel = applyPiModelRuntimeOverrides(piModel, {
      configProvider: configProtocol,
      customBaseUrl: effectiveBaseUrl,
      rawProvider: runtimeConfig.provider,
      customProtocol: runtimeConfig.customProtocol,
    });
    logCtxWarn(
      '[AgentRunner] Model not in pi-ai registry, using synthetic model:',
      modelString,
      '→',
      piModel.api
    );
  }
  logCtx('[AgentRunner] Resolved pi-ai model:', piModel.provider, piModel.id);

  // For Ollama: query actual context window from /api/show if user hasn't configured one
  const provider = runtimeConfig.provider || 'anthropic';
  if (provider === 'ollama' && !runtimeConfig.contextWindow) {
    const ollamaBaseUrl = piModel.baseUrl || runtimeConfig.baseUrl || 'http://localhost:11434/v1';
    const ollamaInfo = await fetchOllamaModelInfo({
      baseUrl: ollamaBaseUrl,
      model: piModel.id,
      apiKey: runtimeConfig.apiKey,
    });
    if (ollamaInfo.contextWindow) {
      log(
        '[AgentRunner] Ollama /api/show reported contextWindow:',
        ollamaInfo.contextWindow,
        '(was:',
        piModel.contextWindow,
        ')'
      );
      piModel = { ...piModel, contextWindow: ollamaInfo.contextWindow };
    }
  }

  return { piModel, provider, usedSyntheticModel };
}
